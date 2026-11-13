#!/usr/bin/env node
// Download EM MASSA (opcional). O módulo já baixa sob demanda cada cena que você importa;
// use este script só se quiser tudo (ou packs inteiros) pré-baixado na pasta Data.
//
// Uso:
//   node downloader/download.mjs --data "C:\caminho\para\FoundryVTT\Data" [opções]
//
// Opções:
//   --data <dir>         Pasta Data do Foundry (ou uma pasta de staging que você depois copia para o servidor). Obrigatório.
//   --session <id>       Session ID do Moulinette (ou variável MOU_SESSION, ou arquivo downloader/session.txt).
//   --creator <nome>     Criador (pode repetir). Padrão: "Cze and Peku" e "Czepeku Scenes".
//   --pack <texto>       Só packs cujo nome contém o texto (pode repetir).
//   --no-animated        Pula as cenas animadas.
//   --concurrency <n>    Downloads paralelos (padrão 6).
//   --index-only         Só grava o catálogo (czepeku-library/catalog.json), sem baixar mapas.
//   --verify             Re-checa cenas já marcadas como baixadas.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MouApi, buildIndex, localDirFromBase, pool, thumbUrl, DEFAULT_CREATORS } from "../scripts/catalog.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------- args ----------
const args = process.argv.slice(2);
const opt = { creators: [], packs: [], concurrency: 6, animated: true, indexOnly: false, verify: false };
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
  else if (a === "-h" || a === "--help") { console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 18).join("\n")); process.exit(0); }
  else { console.error("Argumento desconhecido:", a); process.exit(1); }
}
if (!opt.creators.length) opt.creators = DEFAULT_CREATORS;
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
const LIB_DIR = path.join(DATA, "czepeku-library"); // catálogo + estado (fora da pasta do módulo)
const STATE_FILE = path.join(LIB_DIR, "state.json");
const api = new MouApi(opt.session);

// ---------- utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (b) => (b > 1e9 ? (b / 1e9).toFixed(2) + " GB" : (b / 1e6).toFixed(1) + " MB");
const abs = (rel) => path.join(DATA, ...rel.split("/"));
async function exists(p) { try { return (await fsp.stat(p)).size > 0; } catch { return false; } }

async function retry(fn, label, tries = 4) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (e) { err = e; if (e.fatal) break; await sleep(1000 * 2 ** i); }
  }
  throw new Error(`${label}: ${err?.message || err}`);
}

let bytesDone = 0;
async function downloadTo(url, dest, transform) {
  const r = await fetch(url);
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.fatal = r.status === 404; throw e; }
  let buf = Buffer.from(await r.arrayBuffer());
  if (transform) buf = Buffer.from(transform(buf.toString("utf8")), "utf8");
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest + ".part", buf);
  await fsp.rename(dest + ".part", dest);
  bytesDone += buf.length;
}

// ---------- state ----------
let state = { assets: {} };
try { state = JSON.parse(await fsp.readFile(STATE_FILE, "utf8")); } catch {}
let lastSave = 0;
async function saveState(force = false) {
  if (!force && Date.now() - lastSave < 5000) return;
  lastSave = Date.now();
  await fsp.mkdir(LIB_DIR, { recursive: true });
  await fsp.writeFile(STATE_FILE + ".tmp", JSON.stringify(state));
  await fsp.rename(STATE_FILE + ".tmp", STATE_FILE);
}

// ---------- 1. catálogo ----------
console.log(`Destino: ${DATA}\nLendo o catálogo do Moulinette (${opt.creators.join(", ")})…`);
const { index, raw } = await buildIndex(api, {
  creators: opt.creators,
  onProgress: (d, t) => { if (d % 25 === 0 || d === t) process.stdout.write(`  packs ${d}/${t}\r`); },
});
console.log(`\n${index.entries.length} cenas únicas, ~${fmt(index.entries.reduce((a, e) => a + e.size, 0))}.`);
await fsp.mkdir(LIB_DIR, { recursive: true });
await fsp.writeFile(path.join(LIB_DIR, "catalog.json"), JSON.stringify(index));
if (opt.indexOnly) process.exit(0);

// ---------- 2. download ----------
let todo = index.entries;
if (opt.packs.length) todo = todo.filter((e) => opt.packs.some((q) => e.pack.toLowerCase().includes(q)));
if (!opt.animated) todo = todo.filter((e) => !e.animated);
todo = todo.filter((e) => opt.verify || !state.assets[e.id]?.ok);
console.log(`${todo.length} cenas para baixar (${fmt(todo.reduce((a, e) => a + e.size, 0))}).`);

const failures = [];
const t0 = Date.now();
let n = 0;
await pool(todo, opt.concurrency, async (e) => {
  try {
    // miniatura (para a busca funcionar offline)
    const tu = thumbUrl(raw.get(e.id));
    if (tu && !(await exists(abs(e.thumb)))) { try { await retry(() => downloadTo(tu, abs(e.thumb)), "thumb", 2); } catch {} }

    const det = await retry(() => api.asset(e.id), `asset ${e.id}`);
    if (!det?.base_url || !det?.file_url) throw new Error("sem permissão ou asset inválido");
    const dir = localDirFromBase(det.base_url);
    const base = det.base_url.replace(/\/+$/, "");
    for (const dep of det.deps || []) {
      const rel = decodeURIComponent(dep.split("?")[0]);
      const dest = abs(`${dir}/${rel}`);
      if (await exists(dest)) continue;
      try { await retry(() => downloadTo(`${base}/${dep}`, dest), rel); } catch (err) {
        if (/-thumb\.webp$/.test(rel) && /404/.test(err.message)) continue; // o Moulinette lista thumbs que não existem
        throw err;
      }
    }
    await retry(() => downloadTo(`${base}/${det.file_url}`, abs(`${dir}/${decodeURIComponent(det.filepath)}`), (t) => t.replace(/#DEP#/g, dir + "/")), "json");
    state.assets[e.id] = { ok: true, at: new Date().toISOString() };
  } catch (err) {
    state.assets[e.id] = { ok: false, error: String(err.message || err) };
    failures.push(`${e.name}: ${err.message || err}`);
  }
  await saveState();
  if (++n % 20 === 0 || n === todo.length) {
    const secs = (Date.now() - t0) / 1000;
    console.log(`${n}/${todo.length} cenas | ${fmt(bytesDone)} (${fmt(bytesDone / Math.max(secs, 1))}/s) | ${failures.length} falhas`);
  }
});
await saveState(true);

console.log(`\nPronto. ${fmt(bytesDone)} baixados nesta execução.`);
if (failures.length) {
  const f = path.join(LIB_DIR, "failures.txt");
  await fsp.writeFile(f, failures.join("\n"));
  console.log(`${failures.length} falhas (rode de novo para tentar só elas). Lista: ${f}`);
}
