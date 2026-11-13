// Czepeku Library — busca e importação das cenas do Czepeku Scenes baixadas localmente.

const MOD = "czepeku-library";
const PAGE = 120;
// Índice gerado pelo downloader. Fica FORA da pasta do módulo para não sumir quando o módulo atualiza.
const INDEX_PATH = globalThis.CZL_INDEX_URL ?? "czepeku-library/index.json";

// Termos em português -> tags/termos em inglês usados nos nomes das cenas
const SYNONYMS = {
  noite: ["night"], noturno: ["night"], dia: ["day"], diurno: ["day"], "por-do-sol": ["sunset"], entardecer: ["sunset", "dusk"], amanhecer: ["dawn", "sunrise"],
  chuva: ["rain"], chuvoso: ["rain"], neve: ["snow", "winter"], inverno: ["winter"], outono: ["autumn"], primavera: ["spring"], verao: ["summer"],
  nevoa: ["fog", "mist"], neblina: ["fog", "mist"], tempestade: ["storm"], sangue: ["blood"], massacre: ["massacre"], toxico: ["toxic"],
  fogo: ["fire"], incendio: ["fire", "burning"], lava: ["lava"], inundado: ["flood"], enchente: ["flood"], vazio: ["empty"], escuro: ["dark"],
  animado: ["animated"], animada: ["animated"], animacao: ["animated"], assombrado: ["haunted"], inferno: ["hell"], infernal: ["hell"],
  deserto: ["desert"], floresta: ["forest", "woods"], bosque: ["woods", "grove"], selva: ["jungle"], pantano: ["swamp", "marsh"], caverna: ["cave"],
  gruta: ["cave"], mina: ["mine"], masmorra: ["dungeon"], catacumba: ["catacomb"], tumba: ["tomb"], cemiterio: ["graveyard"], ruinas: ["ruins"],
  castelo: ["castle"], fortaleza: ["fortress", "fort"], palacio: ["palace"], prisao: ["prison", "jail"], templo: ["temple"], igreja: ["church", "chapel"],
  catedral: ["cathedral"], mosteiro: ["monastery"], taverna: ["tavern", "inn"], estalagem: ["inn"], loja: ["shop"], mercado: ["market", "bazaar"],
  vila: ["village", "town", "hamlet"], aldeia: ["village", "hamlet"], cidade: ["city", "town"], rua: ["street", "streets"], esgoto: ["sewer"],
  porto: ["port", "docks", "wharf"], cais: ["docks", "wharf"], navio: ["ship"], pirata: ["pirate"], praia: ["beach"], ilha: ["island", "isle"],
  mar: ["sea"], rio: ["river"], lago: ["lake"], cachoeira: ["waterfall", "falls"], ponte: ["bridge"], montanha: ["mountain"], penhasco: ["cliff"],
  dragao: ["dragon"], covil: ["lair"], acampamento: ["camp"], trem: ["train"], estacao: ["station"], arena: ["arena", "colosseum"], gelo: ["ice", "arctic", "glacier"],
  fada: ["fey", "fairy"], feerico: ["fey"], bruxa: ["witch", "hag"], goblin: ["goblin"], orc: ["orc"], anao: ["dwarven"], elfo: ["elven"], drow: ["drow"],
};

const TIME_TAGS = { day: "Dia", night: "Noite", sunset: "Pôr do sol", dawn: "Amanhecer", dusk: "Crepúsculo" };

const norm = (s) => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esc = (s) => foundry.utils.escapeHTML ? foundry.utils.escapeHTML(String(s ?? "")) : String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const route = (p) => (/^https?:/.test(p) ? p : foundry.utils.getRoute ? foundry.utils.getRoute(p) : "/" + p);
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

// ------------------------------------------------------------------ data
let INDEX = null;
async function loadIndex(force = false) {
  if (INDEX && !force) return INDEX;
  const r = await fetch(route(INDEX_PATH) + `?t=${Date.now()}`);
  if (!r.ok) throw new Error(`Não encontrei ${INDEX_PATH} na pasta Data (rode o script de download).`);
  const idx = await r.json();
  for (const e of idx.entries) {
    e._hay = " " + norm([e.name, e.pack, e.label, e.place, e.code, ...(e.tags || [])].join(" "));
    e._tags = new Set(e.tags || []);
  }
  INDEX = idx;
  return idx;
}

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
  const prefs = getPrefs();
  if (prefs.folderMode === "none") return null;
  const rootName = "Czepeku";
  let root = folderCache.get("__root") || game.folders.find((f) => f.type === "Scene" && f.name === rootName && !f.folder);
  if (!root) root = await Folder.create({ name: rootName, type: "Scene", color: "#6b3fa0" });
  folderCache.set("__root", root);
  if (prefs.folderMode === "root") return root;
  const key = "pack:" + packName;
  let f = folderCache.get(key);
  if (f && game.folders.get(f.id)) return f;
  f = game.folders.find((x) => x.type === "Scene" && x.name === packName && x.folder?.id === root.id);
  if (!f) f = await Folder.create({ name: packName, type: "Scene", folder: root.id });
  folderCache.set(key, f);
  return f;
}

async function importEntry(e, { view = false, activate = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn("Só o GM pode importar cenas.");
  if (!e.ok || !e.json) return ui.notifications.warn(`"${e.name}" ainda não foi baixada (rode o script de download).`);
  const resp = await fetch(route(encPath(e.json)));
  if (!resp.ok) throw new Error(`Arquivo não encontrado no servidor: ${e.json}`);
  const data = await resp.json();
  for (const k of ["_stats", "_id", "folder", "ownership", "active", "sort", "navigation", "navOrder"]) delete data[k];
  const needsDims = !("width" in data);
  const folder = await getFolder(e.pack);
  data.folder = folder?.id ?? null;
  foundry.utils.setProperty(data, `flags.${MOD}`, { assetId: e.id, pack: e.pack });
  const SceneCls = CONFIG.Scene.documentClass;
  const doc = SceneCls.fromImport ? await SceneCls.fromImport(data) : data;
  const scene = await SceneCls.create(doc);
  if (!scene) return null;
  try {
    const src = scene.background?.src ?? scene.img;
    const t = await scene.createThumbnail({ img: src });
    const upd = { thumb: t.thumb };
    if (needsDims && t.width && t.height) Object.assign(upd, { width: t.width, height: t.height });
    await scene.update(upd);
  } catch (err) {
    console.warn(`${MOD} | thumbnail falhou`, err);
  }
  if (activate) await scene.activate();
  else if (view) await scene.view();
  return scene;
}

// ------------------------------------------------------------------ prefs
const DEFAULT_PREFS = { favorites: [], onlyDownloaded: false, folderMode: "pack", sort: "pack", lastQuery: "" };
function getPrefs() {
  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_PREFS), game.settings.get(MOD, "prefs") || {}, { inplace: false });
}
async function setPrefs(p) {
  await game.settings.set(MOD, "prefs", foundry.utils.mergeObject(getPrefs(), p, { inplace: false }));
}

// ------------------------------------------------------------------ app
const { ApplicationV2 } = foundry.applications.api;

class CzepekuLibrary extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "czepeku-library",
    classes: ["czepeku-library"],
    tag: "div",
    window: { title: "Biblioteca Czepeku", icon: "fa-solid fa-map-location-dot", resizable: true },
    position: { width: 1180, height: 820 },
  };

  constructor(options) {
    super(options);
    const p = getPrefs();
    this.f = {
      q: p.lastQuery || "",
      pack: "",
      time: "",
      anim: "", // "", "only", "none"
      lights: false,
      walls: false,
      favs: false,
      onlyDl: p.onlyDownloaded,
      hideImported: false,
      tags: new Set(),
      sort: p.sort || "pack",
    };
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
        <div class="czl-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="search" name="q" placeholder="Buscar… (ex: taverna noite -animated)" autocomplete="off">
        </div>
        <label class="czl-lbl">Pack</label>
        <select name="pack"></select>
        <label class="czl-lbl">Hora do dia</label>
        <div class="czl-seg" data-group="time"></div>
        <label class="czl-lbl">Animação</label>
        <div class="czl-seg" data-group="anim">
          <button data-v="">Todas</button><button data-v="only">Animadas</button><button data-v="none">Estáticas</button>
        </div>
        <label class="czl-lbl">Mostrar</label>
        <label class="czl-chk"><input type="checkbox" name="favs"> Só favoritas ★</label>
        <label class="czl-chk"><input type="checkbox" name="onlyDl"> Só baixadas</label>
        <label class="czl-chk"><input type="checkbox" name="hideImported"> Esconder já importadas</label>
        <label class="czl-chk"><input type="checkbox" name="lights"> Com luzes</label>
        <label class="czl-chk"><input type="checkbox" name="walls"> Com paredes</label>
        <label class="czl-lbl">Variações / tags <a class="czl-clear-tags">limpar</a></label>
        <div class="czl-tags"></div>
        <label class="czl-lbl">Pasta ao importar</label>
        <select name="folderMode">
          <option value="pack">Czepeku / nome do pack</option>
          <option value="root">Czepeku</option>
          <option value="none">Sem pasta</option>
        </select>
        <button class="czl-reset"><i class="fa-solid fa-rotate-left"></i> Limpar filtros</button>
      </aside>
      <section class="czl-main">
        <header class="czl-bar">
          <span class="czl-count"></span>
          <span class="czl-spacer"></span>
          <label>Ordenar
            <select name="sort">
              <option value="pack">Pack</option><option value="name">Nome</option>
              <option value="size">Tamanho</option><option value="random">Aleatório</option>
            </select>
          </label>
          <button class="czl-bulk" title="Importar todas as cenas filtradas"><i class="fa-solid fa-file-import"></i> Importar resultados</button>
        </header>
        <div class="czl-grid"></div>
        <div class="czl-more"></div>
      </section>
    </div>`;
  }

  _replaceHTML(result, content) {
    if (!this._built) {
      content.innerHTML = result;
      this._built = true;
      this._bind(content);
    }
    this.refresh();
  }

  _bind(root) {
    this.root = root;
    const $ = (s) => root.querySelector(s);
    const idx = INDEX;

    // pack select
    const packs = new Map();
    for (const e of idx.entries) packs.set(e.pack, (packs.get(e.pack) || 0) + 1);
    $("select[name=pack]").innerHTML = `<option value="">Todos os packs (${packs.size})</option>` +
      [...packs].sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => `<option value="${esc(n)}">${esc(n)} (${c})</option>`).join("");

    // time segment
    $(".czl-seg[data-group=time]").innerHTML = `<button data-v="">Todas</button>` +
      Object.entries(TIME_TAGS).filter(([t]) => idx.entries.some((e) => e._tags.has(t))).map(([t, l]) => `<button data-v="${t}">${l}</button>`).join("");

    const q = $("input[name=q]");
    q.value = this.f.q;
    let deb;
    q.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(() => { this.f.q = q.value; this.shown = PAGE; this.refresh(); setPrefs({ lastQuery: q.value }); }, 150); });
    $("select[name=pack]").addEventListener("change", (ev) => { this.f.pack = ev.target.value; this.shown = PAGE; this.refresh(); });
    $("select[name=sort]").value = this.f.sort;
    $("select[name=sort]").addEventListener("change", (ev) => { this.f.sort = ev.target.value; this._shuffle = null; this.refresh(); setPrefs({ sort: this.f.sort }); });
    $("select[name=folderMode]").value = getPrefs().folderMode;
    $("select[name=folderMode]").addEventListener("change", (ev) => setPrefs({ folderMode: ev.target.value }));

    for (const seg of root.querySelectorAll(".czl-seg")) {
      seg.addEventListener("click", (ev) => {
        const b = ev.target.closest("button"); if (!b) return;
        this.f[seg.dataset.group] = b.dataset.v; this.shown = PAGE; this.refresh();
      });
    }
    for (const name of ["favs", "onlyDl", "hideImported", "lights", "walls"]) {
      const el = $(`input[name=${name}]`);
      el.checked = !!this.f[name];
      el.addEventListener("change", () => { this.f[name] = el.checked; this.shown = PAGE; this.refresh(); if (name === "onlyDl") setPrefs({ onlyDownloaded: el.checked }); });
    }
    $(".czl-tags").addEventListener("click", (ev) => {
      const t = ev.target.closest("[data-tag]"); if (!t) return;
      const tag = t.dataset.tag;
      this.f.tags.has(tag) ? this.f.tags.delete(tag) : this.f.tags.add(tag);
      this.shown = PAGE; this.refresh();
    });
    $(".czl-clear-tags").addEventListener("click", () => { this.f.tags.clear(); this.refresh(); });
    $(".czl-reset").addEventListener("click", () => {
      Object.assign(this.f, { q: "", pack: "", time: "", anim: "", lights: false, walls: false, favs: false, hideImported: false });
      this.f.tags.clear(); q.value = ""; $("select[name=pack]").value = "";
      for (const n of ["favs", "hideImported", "lights", "walls"]) $(`input[name=${n}]`).checked = false;
      this.shown = PAGE; this.refresh();
    });
    $(".czl-bulk").addEventListener("click", () => this.bulkImport());

    const grid = $(".czl-grid");
    grid.addEventListener("click", async (ev) => {
      const card = ev.target.closest(".czl-card"); if (!card) return;
      const e = this.byId.get(Number(card.dataset.id)); if (!e) return;
      if (ev.target.closest(".czl-fav")) return this.toggleFav(e.id, card);
      if (ev.target.closest(".czl-pack-link")) { this.f.pack = e.pack; $("select[name=pack]").value = e.pack; this.shown = PAGE; return this.refresh(); }
      if (ev.target.closest(".czl-open")) { const s = importedMap().get(e.id); return s?.view(); }
      await this.doImport([e], { view: ev.shiftKey || !!ev.target.closest(".czl-view"), activate: ev.ctrlKey || ev.metaKey });
    });

    // infinite scroll
    this._io = new IntersectionObserver((ents) => {
      if (ents.some((x) => x.isIntersecting) && this.shown < this.results.length) { this.shown += PAGE; this.renderGrid(true); }
    }, { root: $(".czl-main") });
    this._io.observe($(".czl-more"));

    this.byId = new Map(idx.entries.map((e) => [e.id, e]));
  }

  // ---------- filtering
  matches(e, skipTags = false) {
    const f = this.f;
    if (f.pack && e.pack !== f.pack) return false;
    if (f.time && !e._tags.has(f.time)) return false;
    if (f.anim === "only" && !e.animated) return false;
    if (f.anim === "none" && e.animated) return false;
    if (f.lights && !e.lights) return false;
    if (f.walls && !e.walls) return false;
    if (f.onlyDl && !e.ok) return false;
    if (f.favs && !this._favs.has(e.id)) return false;
    if (f.hideImported && this._imported.has(e.id)) return false;
    if (!skipTags) for (const t of f.tags) if (!e._tags.has(t)) return false;
    for (const term of this._terms) {
      // termo digitado: casa em qualquer parte; sinônimo traduzido: só no início de uma palavra
      const hit = e._hay.includes(term.w) || term.syn.some((a) => e._hay.includes(" " + a));
      if (term.neg ? hit : !hit) return false;
    }
    return true;
  }

  parseTerms(q) {
    return norm(q).split(/\s+/).filter(Boolean).map((t) => {
      const neg = t.startsWith("-") && t.length > 1;
      const w = neg ? t.slice(1) : t;
      return { neg, w, syn: SYNONYMS[w] || [] };
    });
  }

  refresh() {
    if (!this.root) return;
    this._terms = this.parseTerms(this.f.q);
    this._favs = new Set(getPrefs().favorites);
    this._imported = importedMap();
    const base = INDEX.entries.filter((e) => this.matches(e, true));
    const res = this.f.tags.size ? base.filter((e) => [...this.f.tags].every((t) => e._tags.has(t))) : base;
    const s = this.f.sort;
    if (s === "name") res.sort((a, b) => a.name.localeCompare(b.name));
    else if (s === "size") res.sort((a, b) => (b.size || 0) - (a.size || 0));
    else if (s === "random") { this._shuffle ||= new Map(INDEX.entries.map((e) => [e.id, Math.random()])); res.sort((a, b) => this._shuffle.get(a.id) - this._shuffle.get(b.id)); }
    this.results = res;

    // tag chips: counts within current results (before tag filter), excluding words of the pack name
    const counts = new Map();
    for (const e of res) for (const t of e._tags) if (!(t in TIME_TAGS)) counts.set(t, (counts.get(t) || 0) + 1);
    for (const t of this.f.tags) if (!counts.has(t)) counts.set(t, 0);
    const chips = [...counts].filter(([t, c]) => this.f.tags.has(t) || (c > 0 && c < res.length) || res.length < 2)
      .sort((a, b) => (this.f.tags.has(b[0]) - this.f.tags.has(a[0])) || b[1] - a[1]).slice(0, 60);
    this.root.querySelector(".czl-tags").innerHTML = chips.map(([t, c]) =>
      `<span class="czl-tag ${this.f.tags.has(t) ? "on" : ""}" data-tag="${esc(t)}">${esc(t)} <small>${c}</small></span>`).join("") || `<em>—</em>`;

    for (const seg of this.root.querySelectorAll(".czl-seg")) {
      for (const b of seg.querySelectorAll("button")) b.classList.toggle("on", b.dataset.v === this.f[seg.dataset.group]);
    }
    const dl = INDEX.entries.filter((e) => e.ok).length;
    this.root.querySelector(".czl-count").innerHTML =
      `<b>${res.length}</b> cenas <span class="czl-dim">· ${dl}/${INDEX.entries.length} baixadas · ${this._imported.size} importadas</span>`;
    this.renderGrid(false);
  }

  cardHTML(e) {
    const imp = this._imported.has(e.id);
    const fav = this._favs.has(e.id);
    const badges = [
      e.animated ? `<i class="fa-solid fa-film" title="Animada"></i>` : "",
      e.lights ? `<i class="fa-regular fa-lightbulb" title="Tem luzes"></i>` : "",
      e.walls ? `<i class="fa-solid fa-block-brick" title="Tem paredes"></i>` : "",
      e.sounds ? `<i class="fa-solid fa-volume-high" title="Tem sons"></i>` : "",
    ].join("");
    const img = e.thumb ? `<img loading="lazy" src="${esc(route(encPath(e.thumb)))}" onerror="this.remove()">` : "";
    return `<div class="czl-card ${e.ok ? "" : "missing"} ${imp ? "imported" : ""}" data-id="${e.id}" title="${esc(e.name)}${e.ok ? "\nClique: importar · Shift: importar e abrir · Ctrl: importar e ativar" : "\nAinda não baixada"}">
      <div class="czl-thumb" style="background:#${esc(e.color || "222")}">${img}
        <div class="czl-badges">${badges}</div>
        <a class="czl-fav ${fav ? "on" : ""}" title="Favoritar"><i class="fa-${fav ? "solid" : "regular"} fa-star"></i></a>
        ${imp ? `<a class="czl-open" title="Já importada — abrir"><i class="fa-solid fa-check"></i></a>` : ""}
        ${e.ok ? "" : `<span class="czl-missing">não baixada</span>`}
      </div>
      <div class="czl-info">
        <div class="czl-title">${esc(e.label)}</div>
        <div class="czl-sub"><a class="czl-pack-link">${esc(e.pack)}</a> <span>${esc(e.code)}</span>${e.dims ? ` · ${esc(e.dims)}` : ""}</div>
      </div>
    </div>`;
  }

  renderGrid(append) {
    const grid = this.root.querySelector(".czl-grid");
    const from = append ? grid.childElementCount : 0;
    const slice = this.results.slice(from, this.shown);
    const html = slice.map((e) => this.cardHTML(e)).join("");
    if (append) grid.insertAdjacentHTML("beforeend", html);
    else { grid.innerHTML = html || `<div class="czl-empty">Nada encontrado.</div>`; this.root.querySelector(".czl-main").scrollTop = 0; }
    this.root.querySelector(".czl-more").textContent = this.shown < this.results.length ? "carregando mais…" : "";
  }

  async toggleFav(id, card) {
    const p = getPrefs();
    const s = new Set(p.favorites);
    s.has(id) ? s.delete(id) : s.add(id);
    await setPrefs({ favorites: [...s] });
    this._favs = s;
    const a = card.querySelector(".czl-fav");
    a.classList.toggle("on", s.has(id));
    a.innerHTML = `<i class="fa-${s.has(id) ? "solid" : "regular"} fa-star"></i>`;
  }

  async doImport(list, opts = {}) {
    const ok = list.filter((e) => e.ok);
    if (!ok.length) return ui.notifications.warn("Nenhuma dessas cenas foi baixada ainda.");
    let n = 0, last = null;
    const single = ok.length === 1;
    for (const e of ok) {
      try {
        last = await importEntry(e, single ? opts : {});
        n++;
        if (!single && n % 5 === 0) ui.notifications.info(`Importando… ${n}/${ok.length}`);
      } catch (err) {
        console.error(`${MOD} | falha ao importar ${e.name}`, err);
        ui.notifications.error(`Falha ao importar "${e.name}": ${err.message}`);
      }
    }
    ui.notifications.info(single && last ? `Cena importada: ${last.name}` : `${n} cenas importadas.`);
    ui.scenes?.activate?.();
    this.refresh();
  }

  async bulkImport() {
    const list = this.results.filter((e) => e.ok && !this._imported.has(e.id));
    if (!list.length) return ui.notifications.warn("Nada novo para importar nos resultados atuais.");
    const DialogV2 = foundry.applications.api.DialogV2;
    const yes = await DialogV2.confirm({
      window: { title: "Importar resultados" },
      content: `<p>Importar <b>${list.length}</b> cenas (as já importadas serão puladas)?</p>`,
    });
    if (yes) await this.doImport(list);
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

Hooks.once("init", () => {
  game.settings.register(MOD, "prefs", { scope: "client", config: false, type: Object, default: DEFAULT_PREFS });
  game.keybindings.register(MOD, "open", {
    name: "Abrir Biblioteca Czepeku",
    editable: [{ key: "KeyK", modifiers: ["Control", "Shift"] }],
    restricted: true,
    onDown: () => { openLibrary(); return true; },
  });
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MOD);
  mod.api = { open: openLibrary, importEntry, loadIndex, reload: () => loadIndex(true) };
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

export { openLibrary, importEntry, loadIndex, CzepekuLibrary };
