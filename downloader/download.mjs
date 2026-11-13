#!/usr/bin/env node
// Baixa todas as cenas do Czepeku Scenes (via API do Moulinette, com a sua sessão de assinante)
// e instala o módulo "czepeku-library" na pasta Data do Foundry.
//
// Uso:
//   node download.mjs --data "C:\caminho\para\FoundryVTT\Data" [opções]
//
// Opções:
//   --data <dir>         Pasta Data do Foundry (ou uma pasta de staging que você depois copia para o servidor). Obrigatório.
//   --session <id>       Session ID do Moulinette (ou variável MOU_SESSION, ou arquivo session.txt ao lado do script).
//   --creator <nome>     Criador (pode repetir). Padrão: "Cze and Peku" e "Czepeku Scenes".
//   --pack <texto>       Só packs cujo nome contém o texto (pode repetir).
//   --no-animated        Pula as cenas animadas (economiza ~14 GB).
//   --concurrency <n>    Downloads paralelos (padrão 6).
//   --index-only         Só atualiza a lista/índice, sem baixar mapas.
//   --install-module     Também copia o módulo deste repositório para Data/modules (alternativa ao manifest).
//   --verify             Re-checa arquivos já marcados como baixados.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiGET, apiPOST, localDirFromBase, makeEntry, SCENE_TYPE } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULE_ID = "czepeku-library";
const MODULE_SRC = path.resolve(HERE, "..");

// ---------- args ----------
const args = process.argv.slice(2);
const opt = { creators: [], packs: [], concurrency: 6, animated: true, indexOnly: false, verify: false, installModule: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const next = () => args[++i];
  if (a === "--data") opt.data = next();
  else if (a === "--session") opt.session = next();
  else if (a === "--creator") opt.creators.push(next());
  else if (a === "--pack") opt.packs.push(next().toLowerCase());
  else if (a === "--concurrency") opt.concurrency = Math.max(1, parseInt(next(), 10) || 6);
  else if (a === "--no-animated") opt.animated = false;
  else if (a === "--index-only") opt.indexOnly = true;
  else if (a === "--verify") opt.verify = true;
  else if (a === "--install-module") opt.installModule = true;
  else if (a === "-h" || a === "--help") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 20).join("\n")); process.exit(0); }
  else { console.error("Argumento desconhecido:", a); process.exit(1); }
}
if (!opt.creators.length) opt.creators = ["Cze and Peku", "Czepeku Scenes"];
if (!opt.data) { console.error('Informe --data "<pasta Data do Foundry>"'); process.exit(1); }
opt.session ||= process.env.MOU_SESSION;
if (!opt.session && fs.existsSync(path.join(HERE, "session.txt"))) opt.session = fs.readFileSync(path.join(HERE, "session.txt"), "utf8").trim();
if (!opt.session) {
  console.error("Session ID não encontrado. No Foundry (como GM), abra o console (F12) e rode:\n" +
    '  copy(game.settings.get("moulinette","session_ID"))\n' +
    "Depois cole o valor em downloader/session.txt (ou use --session / MOU_SESSION).");
  process.exit(1);
}
const DATA = path.resolve(opt.data);
const MODULE_DIR = path.join(DATA, "modules", MODULE_ID);
const LIB_DIR = path.join(DATA, MODULE_ID); // índice + estado (fora da pasta do módulo)
const STATE_FILE = path.join(LIB_DIR, "state.json");
const scope = { session: opt.session, mode: "cloud-accessible" };

// ---------- utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB");
const abs = (rel) => path.join(DATA, ...rel.split("/"));

async function exists(p) {
  try { const s = await fsp.stat(p); return s.size > 0; } catch { return false; }
}

async function retry(fn, label, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (e) {
      err = e;
      if (e.fatal) break;
      await sleep(1000 * 2 ** i);
    }
  }
  throw new Error(`${label}: ${err?.message || err}`);
}

let bytesDone = 0;
async function downloadTo(url, dest) {
  const r = await fetch(url);
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; e.fatal = r.status === 404; throw e; }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + ".part";
  const buf = Buffer.from(await r.arrayBuffer());
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, dest);
  bytesDone += buf.length;
  return buf;
}

async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const it = items[i++]; await worker(it); }
  }));
}

// ---------- state ----------
let state = { assets: {} };
try { state = JSON.parse(await fsp.readFile(STATE_FILE, "utf8")); } catch {}
let lastSave = 0;
async function saveState(force = false) {
  if (!force && Date.now() - lastSave < 5000) return;
  lastSave = Date.now();
  await fsp.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fsp.writeFile(STATE_FILE + ".tmp", JSON.stringify(state));
  await fsp.rename(STATE_FILE + ".tmp", STATE_FILE);
}

// ---------- install module files ----------
async function installModule() {
  const items = ["module.json", "scripts", "styles"];
  for (const it of items) await fsp.cp(path.join(MODULE_SRC, it), path.join(MODULE_DIR, it), { recursive: true });
  console.log(`Módulo copiado para ${MODULE_DIR}`);
}

// ---------- listing ----------
async function listPacks(creator) {
  const packs = await apiPOST("/packs", { type: SCENE_TYPE, searchTerms: "", creator, pack: [], folder: "", scope });
  return packs.map((p) => ({ id: String(p.pack_ref), name: p.name, count: p.assets }));
}

async function listAssets(creator, packId) {
  const out = [];
  for (let page = 0; page < 100; page++) {
    const a = await retry(() => apiPOST("/assets", { type: SCENE_TYPE, searchTerms: "", creator, pack: packId, folder: "", page, scope }), `assets ${packId}`);
    out.push(...a);
    if (a.length < 100) break;
  }
  return out;
}

// ---------- per-scene download ----------
async function downloadScene(listing, entry, failures) {
  const st = state.assets[entry.id];
  if (st?.ok && !opt.verify) { entry.ok = true; return; }

  // thumbnail for the search UI (signed URL from the listing, valid ~1h)
  if (listing.previewUrl && !(await exists(abs(entry.thumb)))) {
    try { await retry(() => downloadTo(listing.previewUrl, abs(entry.thumb)), "thumb", 3); } catch {}
  }

  const files = [];
  try {
    const det = await retry(() => apiGET(`/asset/${entry.id}`, { session: opt.session, ms: String(Date.now()) }), `asset ${entry.id}`);
    if (!det?.base_url || !det?.file_url) throw new Error("sem permissão ou asset inválido");
    const dir = localDirFromBase(det.base_url);
    const base = det.base_url.replace(/\/+$/, "");

    // dependencies (maps, videos, tiles, sounds...)
    for (const dep of det.deps || []) {
      const rel = decodeURIComponent(dep.split("?")[0]);
      const dest = abs(`${dir}/${rel}`);
      files.push(`${dir}/${rel}`);
      if (await exists(dest)) continue;
      try {
        await retry(() => downloadTo(`${base}/${dep}`, dest), rel);
      } catch (e) {
        // Moulinette lists some thumbs that do not exist on the server; ignore those.
        if (/assets\/scenes\/.*-thumb\./.test(rel) && /404/.test(e.message)) { files.pop(); continue; }
        throw e;
      }
    }

    // scene JSON with #DEP# -> local folder
    const jsonRel = `${dir}/${decodeURIComponent(det.filepath)}`;
    const r = await retry(async () => { const x = await fetch(`${base}/${det.file_url}`); if (!x.ok) throw new Error("HTTP " + x.status); return x.text(); }, "json");
    const text = r.replace(/#DEP#/g, dir + "/");
    await fsp.mkdir(path.dirname(abs(jsonRel)), { recursive: true });
    await fsp.writeFile(abs(jsonRel), text);
    files.push(jsonRel);

    entry.json = jsonRel;
    entry.dir = dir;
    if (/\.(webm|mp4|m4v)"/i.test(text)) { entry.animated = true; if (!entry.tags.includes("animated")) entry.tags.push("animated"); }
    try {
      const sc = JSON.parse(text);
      entry.walls = entry.walls || (sc.walls?.length || 0) > 0;
      entry.lights = entry.lights || (sc.lights?.length || 0) > 0;
      entry.sounds = (sc.sounds?.length || 0) > 0;
      entry.grid = sc.grid?.size ?? sc.grid ?? null;
    } catch {}
    entry.ok = true;
    state.assets[entry.id] = { ok: true, files, at: new Date().toISOString() };
  } catch (e) {
    entry.ok = false;
    state.assets[entry.id] = { ok: false, error: String(e.message || e) };
    failures.push(`${entry.name}: ${e.message || e}`);
  }
  await saveState();
}

// ---------- main ----------
console.log(`Destino: ${DATA}`);
if (opt.installModule) await installModule();

const index = { generated: new Date().toISOString(), creators: opt.creators, entries: [] };
const failures = [];
const t0 = Date.now();
let done = 0, total = 0;
const seen = new Set();

for (const creator of opt.creators) {
  let packs = await listPacks(creator);
  if (opt.packs.length) packs = packs.filter((p) => opt.packs.some((q) => p.name.toLowerCase().includes(q)));
  total += packs.reduce((a, p) => a + p.count, 0);
  console.log(`${creator}: ${packs.length} packs, ${packs.reduce((a, p) => a + p.count, 0)} cenas`);

  for (const [pi, pack] of packs.entries()) {
    const listing = await listAssets(creator, pack.id);
    // a API do Moulinette repete a mesma cena com ids diferentes: deduplica pelo arquivo
    const pairs = [];
    for (const a of listing) {
      const e = makeEntry(a, pack.name, pack.id);
      const key = e.json || `id:${e.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ a, e });
    }
    for (const { e } of pairs) {
      e.creator = creator;
      if (state.assets[e.id]?.ok) e.ok = true;
      index.entries.push(e);
    }
    if (!opt.indexOnly) {
      const todo = pairs.filter(({ e }) => opt.animated || !e.animated);
      await pool(todo, opt.concurrency, ({ a, e }) => downloadScene(a, e, failures));
    }
    done += listing.length;
    const secs = (Date.now() - t0) / 1000;
    console.log(`[${pi + 1}/${packs.length}] ${pack.name} — ${listing.length} cenas | total ${done}/${total} | ${fmt(bytesDone)} baixados (${fmt(bytesDone / Math.max(secs, 1))}/s)`);
  }
}

// write index used by the Foundry module
index.entries.sort((a, b) => a.pack.localeCompare(b.pack) || a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name));
await fsp.mkdir(LIB_DIR, { recursive: true });
await fsp.writeFile(path.join(LIB_DIR, "index.json"), JSON.stringify(index));
await saveState(true);

const ok = index.entries.filter((e) => e.ok).length;
console.log(`\nPronto. ${ok}/${index.entries.length} cenas disponíveis localmente. ${fmt(bytesDone)} baixados nesta execução.`);
if (failures.length) {
  const f = path.join(LIB_DIR, "failures.txt");
  await fsp.writeFile(f, failures.join("\n"));
  console.log(`${failures.length} falhas (rode de novo para tentar só elas). Lista: ${f}`);
}
