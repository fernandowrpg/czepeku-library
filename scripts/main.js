// Czepeku Library — busca rápida no catálogo do Moulinette (Cze and Peku + Czepeku Scenes)
// e importação sob demanda: cada cena só é baixada para o servidor quando você a importa.

import { MouApi, buildIndex, localDirFromBase, pool, thumbUrl, DEFAULT_CREATORS } from "./catalog.js";

const MOD = "czepeku-library";
const PAGE = 120;
const LIB_DIR = "czepeku-library"; // na pasta Data, fora da pasta do módulo (sobrevive a atualizações)
const CATALOG_FILE = "catalog.json";
const THUMB_TTL = 50 * 60 * 1000; // URLs assinadas do Moulinette valem ~1h

// Termos em português -> termos em inglês usados nos nomes das cenas
const SYNONYMS = {
  noite: ["night"], noturno: ["night"], dia: ["day"], diurno: ["day"], entardecer: ["sunset", "dusk"], amanhecer: ["dawn", "sunrise"], crepusculo: ["dusk", "sunset"],
  chuva: ["rain"], chuvoso: ["rain"], neve: ["snow", "winter"], inverno: ["winter"], outono: ["autumn"], primavera: ["spring"], verao: ["summer"],
  nevoa: ["fog", "mist"], neblina: ["fog", "mist"], tempestade: ["storm"], sangue: ["blood"], toxico: ["toxic"], aurora: ["aurora"],
  fogo: ["fire"], incendio: ["fire", "burning"], inundado: ["flood"], enchente: ["flood"], vazio: ["empty"], escuro: ["dark"],
  animado: ["animated"], animada: ["animated"], animacao: ["animated"], assombrado: ["haunted"], inferno: ["hell"], infernal: ["hell"],
  deserto: ["desert"], floresta: ["forest", "woods"], bosque: ["woods", "grove"], selva: ["jungle"], pantano: ["swamp", "marsh"], caverna: ["cave"],
  gruta: ["cave"], mina: ["mine"], masmorra: ["dungeon"], catacumba: ["catacomb"], tumba: ["tomb"], cemiterio: ["graveyard", "cemetery"], ruinas: ["ruins"],
  castelo: ["castle"], fortaleza: ["fortress", "fort"], palacio: ["palace"], prisao: ["prison", "jail"], templo: ["temple"], igreja: ["church", "chapel"],
  catedral: ["cathedral"], mosteiro: ["monastery"], taverna: ["tavern", "inn"], estalagem: ["inn"], loja: ["shop"], mercado: ["market", "bazaar"],
  vila: ["village", "town", "hamlet"], aldeia: ["village", "hamlet"], cidade: ["city", "town"], rua: ["street"], esgoto: ["sewer"],
  porto: ["port", "docks", "wharf", "harbor"], cais: ["docks", "wharf"], navio: ["ship"], barco: ["boat", "ship"], pirata: ["pirate"], praia: ["beach"], ilha: ["island", "isle"],
  mar: ["sea"], rio: ["river"], lago: ["lake"], cachoeira: ["waterfall", "falls"], ponte: ["bridge"], montanha: ["mountain"], penhasco: ["cliff"],
  dragao: ["dragon"], covil: ["lair"], acampamento: ["camp"], trem: ["train"], estacao: ["station"], gelo: ["ice", "arctic", "glacier", "frozen"],
  fada: ["fey", "fairy"], feerico: ["fey"], bruxa: ["witch", "hag"], anao: ["dwarven", "dwarf"], elfo: ["elven", "elf"], interior: ["interior", "indoors"],
  telhado: ["roof"], andar: ["floor"], porao: ["basement", "cellar"], jardim: ["garden"], biblioteca: ["library"], laboratorio: ["lab", "alchemy"],
};
const TIME_TAGS = { day: "Dia", night: "Noite", sunset: "Pôr do sol", dawn: "Amanhecer", dusk: "Crepúsculo" };

const norm = (s) => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const route = (p) => (/^https?:/.test(p) ? p : foundry.utils.getRoute ? foundry.utils.getRoute(p) : "/" + p);
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const FP = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
const fmtSize = (b) => (b >= 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB");

// ------------------------------------------------------------------ sessão do Moulinette
function getSession() {
  const own = game.settings.get(MOD, "session");
  if (own) return own;
  try { return game.settings.get("moulinette", "session_ID") || null; } catch { return null; }
}
function getApi() {
  const s = getSession();
  if (!s) throw new Error("Sem sessão do Moulinette. Conecte o Moulinette ao Patreon ou cole o Session ID nas configurações do Czepeku Library.");
  return new MouApi(s);
}

// ------------------------------------------------------------------ arquivos no servidor
const dirCache = new Map(); // dir -> Set(caminhos) | null (não existe)
const createdDirs = new Set();
const cleanPath = (p) => decodeURIComponent(p.split("?")[0]).replace(/^\/+/, "");

async function listDir(dir, force = false) {
  if (!force && dirCache.has(dir)) return dirCache.get(dir);
  let files = null;
  try { files = new Set((await FP().browse("data", dir)).files.map(cleanPath)); } catch { files = null; }
  dirCache.set(dir, files);
  return files;
}
async function fileExists(p) {
  const dir = p.slice(0, p.lastIndexOf("/"));
  return !!(await listDir(dir))?.has(p);
}
async function ensureDir(dir) {
  if (createdDirs.has(dir)) return;
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) {
    cur = cur ? `${cur}/${part}` : part;
    if (createdDirs.has(cur)) continue;
    if ((await listDir(cur)) === null) {
      try { await FP().createDirectory("data", cur, {}); } catch (e) { if (!/exist/i.test(e?.message ?? "")) console.warn(MOD, e); }
      dirCache.set(cur, new Set());
    }
    createdDirs.add(cur);
  }
}
async function uploadFile(p, blobOrText, type) {
  const dir = p.slice(0, p.lastIndexOf("/"));
  const name = p.slice(p.lastIndexOf("/") + 1);
  await ensureDir(dir);
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: type || "application/json" });
  const res = await FP().upload("data", dir, new File([blob], name, { type: blob.type }), {}, { notify: false });
  if (!res || res.status === "error" || res === false) throw new Error(`Falha ao enviar ${p} para o servidor`);
  (dirCache.get(dir) ?? dirCache.set(dir, new Set()).get(dir)).add(p);
}

// ------------------------------------------------------------------ catálogo
let INDEX = null;
function prepare(idx) {
  for (const e of idx.entries) {
    e._hay = " " + norm([e.name, e.label, e.code, ...(e.tags || [])].join(" "));
    e._tags = new Set(e.tags || []);
  }
  idx.byId = new Map(idx.entries.map((e) => [e.id, e]));
  return idx;
}
async function loadIndex(force = false) {
  if (INDEX && !force) return INDEX;
  const r = await fetch(route(`${LIB_DIR}/${CATALOG_FILE}`) + `?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) return (INDEX = null);
  const idx = await r.json();
  if (idx.version !== 2) return (INDEX = null); // formato antigo
  return (INDEX = prepare(idx));
}

/** Busca o catálogo inteiro no Moulinette e grava em Data/czepeku-library/catalog.json. */
async function refreshCatalog(onProgress) {
  const api = getApi();
  const creators = game.settings.get(MOD, "creators").split(",").map((s) => s.trim()).filter(Boolean);
  const { index, raw } = await buildIndex(api, { creators, concurrency: 6, onProgress });
  await uploadFile(`${LIB_DIR}/${CATALOG_FILE}`, JSON.stringify(index));
  INDEX = prepare(index);
  // aproveita as thumbs assinadas que acabaram de chegar
  const now = Date.now();
  for (const [id, a] of raw) thumbCache.set(id, { url: thumbUrl(a), at: now });
  return INDEX;
}

// ------------------------------------------------------------------ miniaturas (URLs assinadas por pack)
const thumbCache = new Map(); // id -> {url, at}
const packFetches = new Map(); // packId -> Promise
async function signPack(e) {
  const k = e.packId;
  if (packFetches.has(k)) return packFetches.get(k);
  const p = (async () => {
    const list = await getApi().assets(e.creator, k);
    const now = Date.now();
    for (const a of list) thumbCache.set(a._id, { url: thumbUrl(a), at: now });
    // mesma cena repetida com outro id: usa a thumb de qualquer um com o mesmo arquivo
    for (const x of INDEX.entries) if (x.packId === k && !thumbCache.has(x.id)) {
      const twin = list.find((a) => a.filepath === x.file);
      if (twin) thumbCache.set(x.id, { url: thumbUrl(twin), at: now });
    }
  })().finally(() => setTimeout(() => packFetches.delete(k), 1000));
  packFetches.set(k, p);
  return p;
}
function cachedThumb(id) {
  const t = thumbCache.get(id);
  return t && Date.now() - t.at < THUMB_TTL ? t.url : null;
}

// ------------------------------------------------------------------ importação
function importedMap() {
  const m = new Map();
  for (const s of game.scenes) {
    const id = s.flags?.[MOD]?.assetId;
    if (id != null) m.set(Number(id), s);
  }
  return m;
}

const folderCache = new Map();
async function getFolder(packName) {
  const mode = game.settings.get(MOD, "folderMode");
  if (mode === "none") return null;
  let root = game.folders.find((f) => f.type === "Scene" && f.name === "Czepeku" && !f.folder);
  if (!root) root = await Folder.create({ name: "Czepeku", type: "Scene", color: "#6b3fa0" });
  if (mode === "root") return root;
  let f = folderCache.get(packName);
  if (f && game.folders.get(f.id)) return f;
  f = game.folders.find((x) => x.type === "Scene" && x.name === packName && x.folder?.id === root.id)
    ?? await Folder.create({ name: packName, type: "Scene", folder: root.id });
  folderCache.set(packName, f);
  return f;
}

function progressNote(msg) {
  try {
    const n = ui.notifications.info(msg, { progress: true });
    if (n?.update) return { update: (pct, m) => n.update({ pct, message: m ?? msg }), done: () => n.update({ pct: 1 }) };
  } catch {}
  return { update: () => {}, done: () => {} };
}

/** Garante que a cena (JSON + arquivos) está no servidor; baixa do Moulinette só o que faltar. Retorna o texto do JSON. */
async function ensureLocal(e, note) {
  if (await fileExists(e.json)) {
    const r = await fetch(route(encPath(e.json)), { cache: "no-store" });
    if (r.ok) return r.text();
  }
  const api = getApi();
  const det = await api.asset(e.id);
  if (!det?.base_url || !det?.file_url) throw new Error("Sua conta não tem acesso a esta cena no Moulinette.");
  const dir = localDirFromBase(det.base_url);
  const base = det.base_url.replace(/\/+$/, "");
  const deps = det.deps || [];
  let i = 0;
  for (const dep of deps) {
    i++;
    const rel = decodeURIComponent(dep.split("?")[0]);
    const target = `${dir}/${rel}`;
    if (await fileExists(target)) continue;
    note?.update(i / (deps.length + 1), `${e.label}: baixando ${rel.split("/").pop()} (${i}/${deps.length})`);
    const r = await fetch(`${base}/${dep}`);
    if (!r.ok) {
      if (r.status === 404 && /-thumb\.webp$/.test(rel)) continue; // o Moulinette lista thumbs que não existem
      throw new Error(`HTTP ${r.status} ao baixar ${rel}`);
    }
    await uploadFile(target, await r.blob());
  }
  const r = await fetch(`${base}/${det.file_url}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} ao baixar o JSON da cena`);
  const text = (await r.text()).replace(/#DEP#/g, dir + "/");
  await uploadFile(`${dir}/${decodeURIComponent(det.filepath)}`, text); // fica salvo: próximas importações são locais
  // miniatura local (busca funciona mesmo sem sessão)
  try {
    const tu = cachedThumb(e.id);
    if (tu && !(await fileExists(e.thumb))) { const t = await fetch(tu); if (t.ok) await uploadFile(e.thumb, await t.blob()); }
  } catch {}
  return text;
}

async function importEntry(e, { view = false, activate = false, note = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Só o GM pode importar cenas.");
  const own = note ?? progressNote(`Importando ${e.label}…`);
  try {
    const text = await ensureLocal(e, own);
    const data = JSON.parse(text);
    for (const k of ["_stats", "_id", "folder", "ownership", "active", "sort", "navigation", "navOrder"]) delete data[k];
    const needsDims = !("width" in data);
    const folder = await getFolder(e.pack);
    data.folder = folder?.id ?? null;
    foundry.utils.setProperty(data, `flags.${MOD}`, { assetId: e.id, pack: e.pack });
    const Cls = CONFIG.Scene.documentClass;
    const scene = await Cls.create(Cls.fromImport ? await Cls.fromImport(data) : data);
    if (!scene) return null;
    try {
      const t = await scene.createThumbnail({ img: scene.background?.src ?? scene.img });
      const upd = { thumb: t.thumb };
      if (needsDims && t.width && t.height) Object.assign(upd, { width: t.width, height: t.height });
      await scene.update(upd);
    } catch (err) { console.warn(`${MOD} | miniatura da cena falhou`, err); }
    if (activate) await scene.activate();
    else if (view) await scene.view();
    return scene;
  } finally {
    if (!note) own.done();
  }
}

// ------------------------------------------------------------------ prefs (por usuário)
const DEFAULT_PREFS = { favorites: [], sort: "pack", lastQuery: "" };
const getPrefs = () => ({ ...DEFAULT_PREFS, ...(game.settings.get(MOD, "prefs") || {}) });
const setPrefs = (p) => game.settings.set(MOD, "prefs", { ...getPrefs(), ...p });

// ------------------------------------------------------------------ janela
const { ApplicationV2 } = foundry.applications.api;

class CzepekuLibrary extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "czepeku-library",
    classes: ["czepeku-library"],
    window: { title: "Biblioteca Czepeku", icon: "fa-solid fa-map-location-dot", resizable: true },
    position: { width: 1180, height: 820 },
  };

  constructor(options) {
    super(options);
    const p = getPrefs();
    this.f = { q: p.lastQuery || "", pack: "", creator: "", time: "", anim: "", lights: false, walls: false, favs: false, hideImported: false, local: false, tags: new Set(), sort: p.sort || "pack" };
    this.shown = PAGE;
    this.results = [];
  }

  async _prepareContext() {
    await loadIndex();
    return {};
  }

  async _renderHTML() {
    return `
    <div class="czl-root">
      <aside class="czl-side">
        <div class="czl-search"><i class="fa-solid fa-magnifying-glass"></i>
          <input type="search" name="q" placeholder="Buscar… (ex: taverna noite -animated)" autocomplete="off"></div>
        <label class="czl-lbl">Criador</label>
        <select name="creator"></select>
        <label class="czl-lbl">Pack</label>
        <select name="pack"></select>
        <label class="czl-lbl">Hora do dia</label>
        <div class="czl-seg" data-group="time"></div>
        <label class="czl-lbl">Animação</label>
        <div class="czl-seg" data-group="anim"><button data-v="">Todas</button><button data-v="only">Animadas</button><button data-v="none">Estáticas</button></div>
        <label class="czl-lbl">Mostrar</label>
        <label class="czl-chk"><input type="checkbox" name="favs"> Só favoritas ★</label>
        <label class="czl-chk"><input type="checkbox" name="hideImported"> Esconder já importadas</label>
        <label class="czl-chk"><input type="checkbox" name="lights"> Com luzes</label>
        <label class="czl-chk"><input type="checkbox" name="walls"> Com paredes</label>
        <label class="czl-lbl">Variações / tags <a class="czl-clear-tags">limpar</a></label>
        <div class="czl-tags"></div>
        <button class="czl-reset"><i class="fa-solid fa-rotate-left"></i> Limpar filtros</button>
        <div class="czl-catalog-info"></div>
        <button class="czl-refresh"><i class="fa-solid fa-cloud-arrow-down"></i> Atualizar catálogo</button>
      </aside>
      <section class="czl-main">
        <header class="czl-bar">
          <span class="czl-count"></span><span class="czl-spacer"></span>
          <label>Ordenar <select name="sort"><option value="pack">Pack</option><option value="name">Nome</option><option value="size">Tamanho</option><option value="random">Aleatório</option></select></label>
          <button class="czl-bulk" title="Importar todas as cenas filtradas"><i class="fa-solid fa-file-import"></i> Importar resultados</button>
        </header>
        <div class="czl-grid"></div>
        <div class="czl-more"></div>
      </section>
    </div>`;
  }

  _replaceHTML(result, content) {
    if (!this._built) { content.innerHTML = result; this._built = true; this._bind(content); }
    this.fillSelects();
    this.refresh();
  }

  _bind(root) {
    this.root = root;
    const $ = (s) => root.querySelector(s);
    const q = $("input[name=q]");
    q.value = this.f.q;
    let deb;
    q.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => { this.f.q = q.value; this.shown = PAGE; this.refresh(); setPrefs({ lastQuery: q.value }); }, 150); });
    $("select[name=creator]").addEventListener("change", (ev) => { this.f.creator = ev.target.value; this.f.pack = ""; this.fillSelects(); this.shown = PAGE; this.refresh(); });
    $("select[name=pack]").addEventListener("change", (ev) => { this.f.pack = ev.target.value; this.shown = PAGE; this.refresh(); });
    $("select[name=sort]").value = this.f.sort;
    $("select[name=sort]").addEventListener("change", (ev) => { this.f.sort = ev.target.value; this._shuffle = null; this.refresh(); setPrefs({ sort: this.f.sort }); });
    for (const seg of root.querySelectorAll(".czl-seg")) seg.addEventListener("click", (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      this.f[seg.dataset.group] = b.dataset.v; this.shown = PAGE; this.refresh();
    });
    for (const name of ["favs", "hideImported", "lights", "walls"]) {
      const el = $(`input[name=${name}]`);
      el.addEventListener("change", () => { this.f[name] = el.checked; this.shown = PAGE; this.refresh(); });
    }
    $(".czl-tags").addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-tag]"); if (!t) return;
      const tag = t.dataset.tag;
      this.f.tags.has(tag) ? this.f.tags.delete(tag) : this.f.tags.add(tag);
      this.shown = PAGE; this.refresh();
    });
    $(".czl-clear-tags").addEventListener("click", () => { this.f.tags.clear(); this.refresh(); });
    $(".czl-reset").addEventListener("click", () => {
      Object.assign(this.f, { q: "", pack: "", creator: "", time: "", anim: "", lights: false, walls: false, favs: false, hideImported: false });
      this.f.tags.clear(); q.value = "";
      for (const n of ["favs", "hideImported", "lights", "walls"]) $(`input[name=${n}]`).checked = false;
      this.fillSelects(); this.shown = PAGE; this.refresh();
    });
    $(".czl-bulk").addEventListener("click", () => this.bulkImport());
    $(".czl-refresh").addEventListener("click", () => this.doRefreshCatalog());

    $(".czl-grid").addEventListener("click", async (ev) => {
      const card = ev.target.closest(".czl-card"); if (!card) return;
      const e = INDEX.byId.get(Number(card.dataset.id)); if (!e) return;
      if (ev.target.closest(".czl-fav")) return this.toggleFav(e.id, card);
      if (ev.target.closest(".czl-pack-link")) { this.f.pack = String(e.packId); this.fillSelects(); this.shown = PAGE; return this.refresh(); }
      if (ev.target.closest(".czl-open")) return importedMap().get(e.id)?.view();
      if (card.classList.contains("busy")) return;
      card.classList.add("busy");
      try { await this.doImport([e], { view: ev.shiftKey, activate: ev.ctrlKey || ev.metaKey }); }
      finally { card.classList.remove("busy"); }
    });

    this._io = new IntersectionObserver((ents) => {
      if (ents.some((x) => x.isIntersecting) && this.shown < this.results.length) { this.shown += PAGE; this.renderGrid(true); }
    }, { root: $(".czl-main") });
    this._io.observe($(".czl-more"));
  }

  fillSelects() {
    if (!this.root || !INDEX) return;
    const cs = new Map(), ps = new Map();
    for (const e of INDEX.entries) {
      cs.set(e.creator, (cs.get(e.creator) || 0) + 1);
      if (!this.f.creator || e.creator === this.f.creator) {
        const k = String(e.packId);
        const p = ps.get(k) ?? ps.set(k, { name: e.pack, n: 0 }).get(k);
        p.n++;
      }
    }
    const csel = this.root.querySelector("select[name=creator]");
    csel.innerHTML = `<option value="">Todos</option>` + [...cs].map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join("");
    csel.value = this.f.creator;
    const packs = [...ps].sort((a, b) => a[1].name.localeCompare(b[1].name));
    const psel = this.root.querySelector("select[name=pack]");
    psel.innerHTML = `<option value="">Todos os packs (${packs.length})</option>` +
      packs.map(([id, p]) => `<option value="${id}">${esc(p.name)}${this.f.creator ? "" : packs.filter((x) => x[1].name === p.name).length > 1 ? " ·" + id : ""} (${p.n})</option>`).join("");
    psel.value = this.f.pack;
    this.root.querySelector(".czl-seg[data-group=time]").innerHTML = `<button data-v="">Todas</button>` +
      Object.entries(TIME_TAGS).filter(([t]) => INDEX.entries.some((e) => e._tags.has(t))).map(([t, l]) => `<button data-v="${t}">${l}</button>`).join("");
  }

  matches(e) {
    const f = this.f;
    if (f.creator && e.creator !== f.creator) return false;
    if (f.pack && String(e.packId) !== f.pack) return false;
    if (f.time && !e._tags.has(f.time)) return false;
    if (f.anim === "only" && !e.animated) return false;
    if (f.anim === "none" && e.animated) return false;
    if (f.lights && !e.lights) return false;
    if (f.walls && !e.walls) return false;
    if (f.favs && !this._favs.has(e.id)) return false;
    if (f.hideImported && this._imported.has(e.id)) return false;
    for (const t of this._terms) {
      // termo digitado: casa em qualquer parte; sinônimo traduzido: só no início de uma palavra
      const hit = e._hay.includes(t.w) || t.syn.some((a) => e._hay.includes(" " + a));
      if (t.neg ? hit : !hit) return false;
    }
    return true;
  }

  refresh() {
    if (!this.root) return;
    const info = this.root.querySelector(".czl-catalog-info");
    if (!INDEX) {
      this.root.querySelector(".czl-count").innerHTML = "";
      this.root.querySelector(".czl-tags").innerHTML = "";
      this.root.querySelector(".czl-grid").innerHTML = `<div class="czl-empty">
        <p>Ainda não há catálogo neste servidor.</p>
        <p>Clique em <b>Atualizar catálogo</b> para ler a lista de cenas do Moulinette (leva ~1 minuto). Nada é baixado agora: cada cena só é baixada quando você a importa.</p></div>`;
      info.textContent = "";
      return;
    }
    info.textContent = `Catálogo de ${new Date(INDEX.generated).toLocaleDateString()} · ${INDEX.entries.length} cenas`;
    this._terms = norm(this.f.q).split(/\s+/).filter(Boolean).map((t) => {
      const neg = t.startsWith("-") && t.length > 1;
      const w = neg ? t.slice(1) : t;
      return { neg, w, syn: SYNONYMS[w] || [] };
    });
    this._favs = new Set(getPrefs().favorites);
    this._imported = importedMap();
    const base = INDEX.entries.filter((e) => this.matches(e));
    const res = this.f.tags.size ? base.filter((e) => [...this.f.tags].every((t) => e._tags.has(t))) : base;
    const s = this.f.sort;
    if (s === "name") res.sort((a, b) => a.name.localeCompare(b.name));
    else if (s === "size") res.sort((a, b) => b.size - a.size);
    else if (s === "random") { this._shuffle ||= new Map(INDEX.entries.map((e) => [e.id, Math.random()])); res.sort((a, b) => this._shuffle.get(a.id) - this._shuffle.get(b.id)); }
    this.results = res;

    const counts = new Map();
    for (const e of res) for (const t of e._tags) if (!(t in TIME_TAGS)) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of this.f.tags) if (!counts.has(t)) counts.set(t, 0);
    const chips = [...counts].filter(([t, c]) => this.f.tags.has(t) || (c > 0 && (c < res.length || res.length < 2)))
      .sort((a, b) => (this.f.tags.has(b[0]) - this.f.tags.has(a[0])) || b[1] - a[1]).slice(0, 60);
    this.root.querySelector(".czl-tags").innerHTML = chips.map(([t, c]) =>
      `<span class="czl-tag ${this.f.tags.has(t) ? "on" : ""}" data-tag="${esc(t)}">${esc(t)} <small>${c}</small></span>`).join("") || `<em>—</em>`;
    for (const seg of this.root.querySelectorAll(".czl-seg"))
      for (const b of seg.querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === this.f[seg.dataset.group]);
    this.root.querySelector(".czl-count").innerHTML = `<b>${res.length}</b> cenas <span class="czl-dim">· ${this._imported.size} importadas neste mundo</span>`;
    this.renderGrid(false);
  }

  cardHTML(e) {
    const imp = this._imported.has(e.id);
    const fav = this._favs.has(e.id);
    const badges = [
      e.animated ? `<i class="fa-solid fa-film" title="Animada"></i>` : "",
      e.lights ? `<i class="fa-regular fa-lightbulb" title="Tem luzes"></i>` : "",
      e.walls ? `<i class="fa-solid fa-block-brick" title="Tem paredes"></i>` : "",
    ].join("");
    const src = cachedThumb(e.id);
    return `<div class="czl-card ${imp ? "imported" : ""}" data-id="${e.id}" title="${esc(e.name)}\nClique: importar · Shift: importar e abrir · Ctrl: importar e ativar">
      <div class="czl-thumb" style="background:#${esc(e.color || "222")}">
        <img ${src ? `src="${esc(src)}"` : ""} data-local="${esc(route(encPath(e.thumb)))}" loading="lazy" alt="">
        <div class="czl-badges">${badges}</div>
        <a class="czl-fav ${fav ? "on" : ""}" title="Favoritar"><i class="fa-${fav ? "solid" : "regular"} fa-star"></i></a>
        ${imp ? `<a class="czl-open" title="Já importada — abrir"><i class="fa-solid fa-check"></i></a>` : ""}
        <span class="czl-busy"><i class="fa-solid fa-spinner fa-spin"></i></span>
      </div>
      <div class="czl-info">
        <div class="czl-title">${esc(e.label)}</div>
        <div class="czl-sub"><a class="czl-pack-link">${esc(e.pack)}</a> ${esc(e.code)} · ${e.w}×${e.h} · ${fmtSize(e.size)}</div>
      </div>
    </div>`;
  }

  renderGrid(append) {
    const grid = this.root.querySelector(".czl-grid");
    const from = append ? grid.querySelectorAll(".czl-card").length : 0;
    const slice = this.results.slice(from, this.shown);
    const html = slice.map((e) => this.cardHTML(e)).join("");
    if (append) grid.insertAdjacentHTML("beforeend", html);
    else { grid.innerHTML = html || `<div class="czl-empty">Nada encontrado.</div>`; this.root.querySelector(".czl-main").scrollTop = 0; }
    this.root.querySelector(".czl-more").textContent = this.shown < this.results.length ? "carregando mais…" : "";
    for (const img of grid.querySelectorAll("img:not([data-bound])")) {
      img.dataset.bound = "1";
      img.addEventListener("error", () => {
        if (img.dataset.local && img.src !== new URL(img.dataset.local, location.href).href) img.src = img.dataset.local;
        else img.remove();
      });
    }
    this.loadThumbs(slice);
  }

  /** Pede ao Moulinette as URLs assinadas das miniaturas dos packs visíveis (1 requisição por pack). */
  async loadThumbs(entries) {
    const need = new Map();
    for (const e of entries) if (!cachedThumb(e.id) && !need.has(e.packId)) need.set(e.packId, e);
    if (!need.size) return;
    let api = true;
    try { getApi(); } catch { api = false; }
    if (!api) { // sem sessão: tenta as miniaturas locais
      for (const img of this.root.querySelectorAll(".czl-card img:not([src])")) img.src = img.dataset.local;
      return;
    }
    await pool([...need.values()], 4, async (e) => {
      try { await signPack(e); } catch (err) { console.warn(MOD, err); }
      for (const card of this.root?.querySelectorAll(".czl-card") ?? []) {
        const x = INDEX.byId.get(Number(card.dataset.id));
        if (x?.packId !== e.packId) continue;
        const img = card.querySelector("img");
        if (img && !img.getAttribute("src")) img.src = cachedThumb(x.id) || img.dataset.local;
      }
    });
  }

  async toggleFav(id, card) {
    const s = new Set(getPrefs().favorites);
    s.has(id) ? s.delete(id) : s.add(id);
    await setPrefs({ favorites: [...s] });
    this._favs = s;
    const a = card.querySelector(".czl-fav");
    a.classList.toggle("on", s.has(id));
    a.innerHTML = `<i class="fa-${s.has(id) ? "solid" : "regular"} fa-star"></i>`;
  }

  async doImport(list, opts = {}) {
    const single = list.length === 1;
    const note = single ? null : progressNote(`Importando ${list.length} cenas…`);
    let n = 0, last = null;
    for (const e of list) {
      try {
        note?.update(n / list.length, `Importando ${n + 1}/${list.length}: ${e.label}`);
        last = await importEntry(e, single ? opts : { note });
        n++;
      } catch (err) {
        console.error(`${MOD} | falha ao importar ${e.name}`, err);
        ui.notifications.error(`Falha ao importar "${e.name}": ${err.message}`);
      }
    }
    note?.done();
    if (n) ui.notifications.info(single && last ? `Cena importada: ${last.name}` : `${n} cenas importadas.`);
    this.refresh();
  }

  async bulkImport() {
    const list = this.results.filter((e) => !this._imported.has(e.id));
    if (!list.length) return ui.notifications.warn("Nada novo para importar nos resultados atuais.");
    const mb = list.reduce((a, e) => a + e.size, 0) / 1e6;
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Importar resultados" },
      content: `<p>Importar <b>${list.length}</b> cenas? Até <b>${mb.toFixed(0)} MB</b> podem ser baixados para o servidor (o que já estiver lá não é baixado de novo).</p>`,
    });
    if (yes) await this.doImport(list);
  }

  async doRefreshCatalog() {
    const btn = this.root.querySelector(".czl-refresh");
    btn.disabled = true;
    const note = progressNote("Lendo o catálogo do Moulinette…");
    try {
      await refreshCatalog((d, t) => { note.update(d / t, `Lendo o catálogo do Moulinette… pack ${d}/${t}`); btn.textContent = `Lendo… ${d}/${t}`; });
      ui.notifications.info(`Catálogo atualizado: ${INDEX.entries.length} cenas.`);
    } catch (err) {
      console.error(MOD, err);
      ui.notifications.error(`Não consegui atualizar o catálogo: ${err.message}`);
    } finally {
      note.done();
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i> Atualizar catálogo`;
      this.fillSelects();
      this.refresh();
    }
  }

  _onClose(options) {
    this._io?.disconnect();
    this._built = false;
    super._onClose?.(options);
  }
}

// ------------------------------------------------------------------ bootstrap
let app = null;
function openLibrary() {
  if (!game.user.isGM) return ui.notifications.warn("A Biblioteca Czepeku é só para o GM.");
  app ??= new CzepekuLibrary();
  app.render({ force: true });
  return app;
}

function registerSettings() {
  game.settings.register(MOD, "prefs", { scope: "client", config: false, type: Object, default: DEFAULT_PREFS });
  game.settings.register(MOD, "session", {
    name: "Session ID do Moulinette (opcional)",
    hint: "Deixe vazio para usar a sessão do próprio módulo Moulinette. Preencha só se quiser usar a biblioteca com o Moulinette desativado.",
    scope: "client", config: true, type: String, default: "",
  });
  game.settings.register(MOD, "creators", {
    name: "Criadores",
    hint: "Criadores do Moulinette incluídos no catálogo, separados por vírgula. Depois de mudar, clique em Atualizar catálogo.",
    scope: "world", config: true, type: String, default: DEFAULT_CREATORS.join(", "),
  });
  game.settings.register(MOD, "folderMode", {
    name: "Pasta das cenas importadas",
    scope: "world", config: true, type: String, default: "pack",
    choices: { pack: "Czepeku / nome do pack", root: "Czepeku", none: "Sem pasta" },
  });
}

Hooks.once("init", () => {
  registerSettings();
  game.keybindings.register(MOD, "open", {
    name: "Abrir Biblioteca Czepeku",
    editable: [{ key: "KeyK", modifiers: ["Control", "Shift"] }],
    restricted: true,
    onDown: () => { openLibrary(); return true; },
  });
});

Hooks.once("ready", () => {
  game.modules.get(MOD).api = { open: openLibrary, importEntry, loadIndex, refreshCatalog };
});

Hooks.on("renderSceneDirectory", (dirApp, html) => {
  if (!game.user.isGM) return;
  const el = html instanceof HTMLElement ? html : html[0];
  if (!el || el.querySelector(".czl-open-btn")) return;
  const actions = el.querySelector(".header-actions") || el.querySelector(".directory-header");
  if (!actions) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "czl-open-btn";
  btn.innerHTML = `<i class="fa-solid fa-map-location-dot"></i> Czepeku`;
  btn.addEventListener("click", (ev) => { ev.preventDefault(); openLibrary(); });
  actions.append(btn);
});

export { openLibrary, importEntry, loadIndex, refreshCatalog, registerSettings, CzepekuLibrary };
