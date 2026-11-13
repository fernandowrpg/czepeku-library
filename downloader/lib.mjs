// Shared helpers: Moulinette cloud API + name parsing for the index.

export const API = "https://assets.moulinette.cloud/api/v2";
export const AZURE_RE = /^https:\/\/[^.]+\.blob\.core\.windows\.net\/(.+)$/;
export const LOCAL_ROOT = "moulinette-v2/cloud"; // same folder Moulinette uses, so both share files
export const SCENE_TYPE = 1;

export async function apiPOST(path, body, query) {
  const qs = query ? "?" + new URLSearchParams(query) : "";
  const r = await fetch(API + path + qs, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} -> HTTP ${r.status}`);
  return r.json();
}

export async function apiGET(path, query) {
  const qs = query ? "?" + new URLSearchParams(query) : "";
  const r = await fetch(API + path + qs, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`GET ${path} -> HTTP ${r.status}`);
  return r.json();
}

/** "https://...blob.core.windows.net/czepekuscenes/Czepeku-X" -> "moulinette-v2/cloud/czepekuscenes/Czepeku-X" */
export function localDirFromBase(baseUrl) {
  const m = baseUrl.replace(/\/+$/, "").match(AZURE_RE);
  if (!m) throw new Error("Unexpected base_url: " + baseUrl);
  return `${LOCAL_ROOT}/${m[1]}`;
}

/** Derive the pack base URL from a listing entry (previewUrl = base + "/" + url with _thumb.webp). */
export function baseFromListing(a) {
  const prev = (a.previewUrl || a.preview || "").split("?")[0];
  const thumbRel = a.url.replace(/\.json$/i, "_thumb.webp");
  if (prev.endsWith("/" + thumbRel)) return prev.slice(0, -thumbRel.length - 1);
  // fallback: cut at /json/
  const i = prev.indexOf("/json/");
  return i > 0 ? prev.slice(0, i) : null;
}

const NORMALIZE = { anim: "animated", orig: "original", s: null, no: "no", of: null, the: null, "-": null, "&": null, and: null };

function parseSizeText(t) {
  if (!t) return 0;
  const [n, unit] = t.split(" ");
  const mult = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9 }[unit] || 1;
  return Math.round(parseFloat(n.replace(/\./g, "").replace(",", ".")) * mult);
}

/** Build one index entry from a listing asset. */
export function makeEntry(a, packName, packId) {
  const raw = a.name.replace(/\s*\(json\)\s*$/i, "").trim();
  const toks = raw.split(/\s+/);
  // código da variação = último token numérico seguido de uma palavra ("The Vale 1 16b Tavern" -> 16b)
  const isCode = (t) => /^\d{1,3}[a-z]?$/i.test(t);
  let ci = -1;
  for (let i = 0; i < toks.length - 1; i++) if (isCode(toks[i]) && !isCode(toks[i + 1])) ci = i;
  let start = ci + 1;
  if (ci < 0) {
    // sem código numérico (ex.: Cze and Peku): remove o prefixo que repete o nome do pack
    const pt = packName.toLowerCase().replace(/^czepeku scenes - /, "").split(/\s+/);
    start = 0;
    while (start < toks.length - 1 && start < pt.length && toks[start].toLowerCase().replace(/[^a-z0-9']/g, "") === pt[start].replace(/[^a-z0-9']/g, "")) start++;
  }
  const place = ci > 0 ? toks.slice(0, ci).join(" ") : packName;
  const code = ci >= 0 ? toks[ci] : "";
  const labelToks = toks.slice(start).filter((t) => t !== "-");
  const label = labelToks.join(" ") || raw;
  const tags = new Set();
  for (let t of labelToks) {
    t = t.toLowerCase().replace(/[^a-z0-9']/g, "");
    if (!t) continue;
    const n = t in NORMALIZE ? NORMALIZE[t] : t;
    if (n) tags.add(n);
  }
  const animated = /\banim/i.test(raw);
  if (animated) tags.add("animated");
  const icons = (a.icons || []).map((i) => (typeof i === "string" ? i : i.descr));
  const lights = icons.some((i) => /lights/i.test(i));
  const walls = icons.some((i) => /walls/i.test(i));
  const meta = a.meta || [];
  const dims = meta.find((m) => /Image size/i.test(m.hint))?.text?.replace(/\./g, "") || "";
  const size = parseSizeText(meta.find((m) => /File size/i.test(m.hint))?.text);
  const base = baseFromListing(a);
  const dir = base ? localDirFromBase(base) : null;
  return {
    id: a.id,
    name: raw,
    place,
    code,
    label,
    pack: packName,
    packId: Number(packId),
    tags: [...tags],
    animated,
    lights,
    walls,
    freebie: icons.some((i) => /freebie/i.test(i)),
    dims,
    size,
    color: a.background_color || a.bg || null,
    dir,
    json: dir ? `${dir}/${a.url}` : null,
    thumb: dir ? `${dir}/${a.url.replace(/\.json$/i, "_thumb.webp")}` : null,
    ok: false,
  };
}
