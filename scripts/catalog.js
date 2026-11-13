// Catálogo do Moulinette: chamadas à API e conversão de cada asset numa entrada pesquisável.
// Roda tanto no navegador (módulo do Foundry) quanto no Node (downloader) — sem dependências.

export const API = "https://assets.moulinette.cloud/api/v2";
export const BLOB = "https://mttestorage.blob.core.windows.net";
export const LOCAL_ROOT = "moulinette-v2/cloud"; // mesma pasta do Moulinette: os dois reaproveitam os arquivos
export const SCENE_TYPE = 1;
export const DEFAULT_CREATORS = ["Cze and Peku", "Czepeku Scenes"];

export class MouApi {
  constructor(session, mode = "cloud-accessible") {
    this.session = session;
    this.scope = { session, mode };
  }
  async post(path, body) {
    const r = await fetch(API + path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Moulinette ${path}: HTTP ${r.status}`);
    return r.json();
  }
  async get(path, query = {}) {
    const qs = new URLSearchParams({ session: this.session, ms: String(Date.now()), ...query });
    const r = await fetch(`${API}${path}?${qs}`, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Moulinette ${path}: HTTP ${r.status}`);
    return r.json();
  }
  /** Criadores com cenas acessíveis: [{name, assets}] */
  creators() {
    return this.post("/creators", { type: SCENE_TYPE, searchTerms: "", creator: "", pack: [], folder: "", scope: this.scope });
  }
  /** Packs de um criador: [{id, name, count}] */
  async packs(creator) {
    const p = await this.post("/packs", { type: SCENE_TYPE, searchTerms: "", creator, pack: [], folder: "", scope: this.scope });
    return p.map((x) => ({ id: String(x.pack_ref), name: x.name, count: x.assets }));
  }
  /** Todas as cenas de um pack (assets "crus" da API, com thumb assinada válida ~1h). */
  async assets(creator, packId) {
    const out = [];
    for (let page = 0; page < 100; page++) {
      const a = await this.post("/assets", { type: SCENE_TYPE, searchTerms: "", creator, pack: String(packId), folder: "", page, scope: this.scope });
      out.push(...a);
      if (a.length < 100) break;
    }
    return out;
  }
  /** Detalhe para download: base_url, file_url (assinado), deps[] (assinados). */
  asset(id) {
    return this.get(`/asset/${id}`);
  }
}

export async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await worker(items[k], k); }
  }));
}

/** "https://...blob.core.windows.net/czepeku/Pack" -> "moulinette-v2/cloud/czepeku/Pack" */
export function localDirFromBase(baseUrl) {
  const m = baseUrl.replace(/\/+$/, "").match(/^https:\/\/[^.]+\.blob\.core\.windows\.net\/(.+)$/);
  if (!m) throw new Error("base_url inesperada: " + baseUrl);
  return `${LOCAL_ROOT}/${m[1]}`;
}

/** URL assinada da miniatura de um asset cru. */
export function thumbUrl(a) {
  if (!a.thumb) return null;
  if (/^https?:/.test(a.thumb)) return a.thumb;
  return `${BLOB}/${a.pack.creator_ref}/${a.pack.path}/${a.thumb}`;
}

const STOP = { s: null, of: null, the: null, and: null, a: null, "-": null, anim: "animated", orig: "original" };
const titleCase = (w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1));

/** Converte um asset cru da API numa entrada do índice. */
export function makeEntry(a) {
  const file = a.filepath;
  const base = file.split("/").pop().replace(/\.json$/i, "");
  const toks = base.split(/[-_\s]+/).filter(Boolean).map(titleCase);
  const packName = a.pack.name;

  // código da variação = último token numérico seguido de uma palavra ("the-vale-1-16b-tavern" -> 16b)
  const isCode = (t) => /^\d{1,3}[a-z]?$/i.test(t);
  let ci = -1;
  for (let i = 0; i < toks.length - 1; i++) if (isCode(toks[i]) && !isCode(toks[i + 1])) ci = i;
  let start = ci + 1;
  if (ci < 0) {
    // sem código: remove o prefixo que repete o nome do pack
    const pt = packName.toLowerCase().replace(/^czepeku scenes - /, "").split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, ""));
    start = 0;
    while (start < toks.length - 1 && start < pt.length && toks[start].toLowerCase().replace(/[^a-z0-9]/g, "") === pt[start]) start++;
  }
  const labelToks = toks.slice(start);
  const tags = new Set();
  for (const t of labelToks) {
    const w = t.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!w || /^\d/.test(w)) continue;
    const n = w in STOP ? STOP[w] : w;
    if (n) tags.add(n);
  }
  const animated = /(^|[-_])anim/i.test(base);
  if (animated) tags.add("animated");
  const dir = `${LOCAL_ROOT}/${a.pack.creator_ref}/${a.pack.path}`;
  return {
    id: a._id,
    name: `${packName} — ${labelToks.join(" ") || toks.join(" ")}`,
    label: labelToks.join(" ") || toks.join(" "),
    code: ci >= 0 ? toks[ci] : "",
    pack: packName,
    packId: Number(a.pack_ref),
    creator: a.pack.creator,
    tags: [...tags],
    animated,
    lights: !!a.scene?.hasLights,
    walls: !!a.scene?.hasWalls,
    w: a.size?.width || 0,
    h: a.size?.height || 0,
    size: a.filesize || 0,
    color: a.main_color || null,
    file,
    dir,
    json: `${dir}/${file}`,
    thumb: `${dir}/${file.replace(/\.json$/i, "_thumb.webp")}`,
  };
}

/** Monta o índice completo (deduplicado: a API repete a mesma cena com ids diferentes). */
export async function buildIndex(api, { creators = DEFAULT_CREATORS, concurrency = 6, onProgress } = {}) {
  const jobs = [];
  for (const c of creators) for (const p of await api.packs(c)) jobs.push({ creator: c, pack: p });
  const entries = [];
  const seen = new Set();
  let done = 0;
  const raw = new Map(); // id -> asset cru (para quem precisar da thumb assinada)
  await pool(jobs, concurrency, async (j) => {
    const list = await api.assets(j.creator, j.pack.id);
    for (const a of list) {
      const e = makeEntry(a);
      if (seen.has(e.json)) continue;
      seen.add(e.json);
      entries.push(e);
      raw.set(e.id, a);
    }
    onProgress?.(++done, jobs.length, j);
  });
  entries.sort((a, b) => a.pack.localeCompare(b.pack) || a.code.localeCompare(b.code, undefined, { numeric: true }) || a.label.localeCompare(b.label));
  return { index: { version: 2, generated: new Date().toISOString(), creators, entries }, raw };
}
