#!/usr/bin/env python3
"""Generate a local-only, self-contained HTML triage page (.local/pollinator_triage.html)
that tiles all unannotated pollinator interaction candidate observations from our open spaces.

Because .local/ is gitignored, this page is NEVER committed or served with the website.
Open it directly in your browser (double-click or `open .local/pollinator_triage.html`).

Clicking any tile opens that observation in iNaturalist Identify mode:
    https://www.inaturalist.org/observations/identify?reviewed=any&quality_grade=needs_id,research,casual&id=<id>

Usage:
    python3 scripts/build_pollinator_triage.py
    python3 scripts/build_pollinator_triage.py --space broomfield
"""
import argparse
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from areas import (API_V1, OPEN_COORDS, ROOT, area_for, exclusions, inat_get,  # noqa: E402
                   is_excluded, read_spaces)

USER_AGENT = "open-space-corridor local pollinator triage (iNaturalist user: brettjackson)"
POLLINATOR_GROUPS = (
    ("bees", "Bees", 630955),                      # Anthophila
    ("lepidoptera", "Butterflies & Moths", 47157), # Lepidoptera
    ("syrphids", "Flower Flies", 49995),           # Syrphidae
)
TAXON_IDS_PARAM = ",".join(str(tid) for _, _, tid in POLLINATOR_GROUPS)

FLOWER_FIELD_IDS = {4935, 3126, 498, 33, 11442, 4980}
FLOWER_FIELD_NAMES = {
    "nectar / pollen delivering plant",
    "interaction->visited flower of",
    "nectar plant",
    "pollinates",
    "nectar  plant",
    "observed species association: pollination",
}
PER_PAGE = 200
OUT = ROOT / ".local" / "pollinator_triage.html"


def has_flower_field(obs):
    for ofv in obs.get("ofvs") or []:
        if ofv.get("field_id") in FLOWER_FIELD_IDS:
            return True
        if (ofv.get("name") or "").lower() in FLOWER_FIELD_NAMES:
            return True
    return False


def classify_group(taxon):
    ancestors = set(taxon.get("ancestor_ids") or [])
    ancestors.add(taxon.get("id"))
    for gid, _, tid in POLLINATOR_GROUPS:
        if tid in ancestors:
            return gid
    return "bees"


def medium_photo_url(photo):
    url = photo.get("url") or ""
    if not url:
        return ""
    return url.replace("square.", "medium.")


def fetch_space_candidates(area, boxes):
    kept, id_above = [], 0
    while True:
        params = {
            **area, **OPEN_COORDS, "verifiable": "true", "photos": "true",
            "taxon_id": TAXON_IDS_PARAM, "order_by": "id", "order": "asc",
            "per_page": PER_PAGE,
        }
        if id_above:
            params["id_above"] = id_above
        data = inat_get(API_V1 + "observations", USER_AGENT, params)
        results = data.get("results") or []
        for obs in results:
            if boxes and is_excluded(obs, boxes):
                continue
            if has_flower_field(obs):
                continue
            photos = [medium_photo_url(p) for p in (obs.get("photos") or []) if p.get("url")]
            if not photos:
                continue
            kept.append((obs, photos[:4]))
        if len(results) < PER_PAGE:
            return kept
        id_above = results[-1]["id"]


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pollinator Interaction Triage (Local)</title>
<style>
  :root {
    --bg: #11161c;
    --bg-box: #1a212b;
    --bg-card: #1d2530;
    --outline: #2d3847;
    --hover: #7db0ff;
    --text: #e8eef5;
    --muted: #93a3b5;
    --bees: #f5b841;
    --lepidoptera: #c780ff;
    --syrphids: #5ec2b7;
    --done: #6fbf73;
    --skip: #8b98a8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    background: rgba(17, 22, 28, 0.94);
    backdrop-filter: blur(8px);
    border-bottom: 1px solid var(--outline);
    padding: 12px 18px;
  }
  .topbar-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 14px;
    max-width: 1680px;
    margin: 0 auto;
  }
  .topbar-row + .topbar-row { margin-top: 10px; }
  .title-wrap { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 14px; }
  h1 { margin: 0; font-size: 1.15rem; font-weight: 600; letter-spacing: -0.01em; }
  .badge-local {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--outline);
    color: var(--muted);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .counts { color: var(--muted); font-size: 0.82rem; font-variant-numeric: tabular-nums; }
  .controls-group { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  select, input[type="search"], button, .btn-link {
    min-height: 32px;
    padding: 5px 11px;
    border: 1px solid var(--outline);
    border-radius: 999px;
    background: var(--bg-box);
    color: var(--text);
    font: inherit;
    font-size: 0.8rem;
  }
  input[type="search"] { width: 200px; }
  input[type="search"]::placeholder { color: var(--muted); }
  select, button, .btn-link { cursor: pointer; }
  button:hover, select:hover, .btn-link:hover { border-color: var(--hover); }
  .btn-link {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    text-decoration: none;
    background: rgba(125, 176, 255, 0.14);
    border-color: rgba(125, 176, 255, 0.45);
    font-weight: 500;
  }
  .btn-link:hover { background: rgba(125, 176, 255, 0.24); }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    color: var(--muted);
  }
  .pill[aria-pressed="true"] {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text);
    border-color: var(--pill-color, var(--text));
  }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--pill-color, var(--muted)); }
  .seg {
    display: inline-flex;
    border: 1px solid var(--outline);
    border-radius: 999px;
    padding: 2px;
    background: var(--bg-box);
  }
  .seg button {
    border: 0;
    min-height: 26px;
    padding: 3px 10px;
    background: transparent;
    color: var(--muted);
  }
  .seg button[aria-pressed="true"] {
    background: var(--text);
    color: var(--bg);
    font-weight: 600;
  }
  main {
    max-width: 1680px;
    margin: 0 auto;
    padding: 16px 18px 48px;
  }
  .hint {
    margin: 0 0 14px;
    color: var(--muted);
    font-size: 0.8rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--tile-min, 235px), 1fr));
    gap: 12px;
  }
  .grid.is-large { --tile-min: 310px; }
  .tile {
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: 1px solid var(--outline);
    border-radius: 10px;
    overflow: hidden;
    transition: border-color 0.14s ease, opacity 0.14s ease, transform 0.14s ease;
  }
  .tile:hover { border-color: var(--hover); }
  .tile.is-done { border-color: rgba(111, 191, 115, 0.55); opacity: 0.72; }
  .tile.is-skip { opacity: 0.45; }
  .photo-wrap {
    position: relative;
    aspect-ratio: 4 / 3;
    background: #0c1015;
    overflow: hidden;
  }
  .photo-link { display: block; width: 100%; height: 100%; }
  .photo-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .photo-nav {
    position: absolute;
    right: 6px;
    bottom: 6px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 5px;
    border-radius: 999px;
    background: rgba(12, 16, 21, 0.78);
    border: 1px solid rgba(255, 255, 255, 0.16);
    font-size: 0.72rem;
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .photo-nav button {
    min-height: 0;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--text);
    font-size: 0.85rem;
    line-height: 1.2;
  }
  .grade-tag {
    position: absolute;
    left: 6px;
    top: 6px;
    padding: 2px 7px;
    border-radius: 999px;
    background: rgba(12, 16, 21, 0.76);
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 0.68rem;
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .tile-body {
    padding: 8px 10px 9px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    flex: 1;
  }
  .tile-title {
    color: var(--text);
    text-decoration: none;
    font-weight: 500;
    font-size: 0.84rem;
    line-height: 1.25;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .tile-title:hover { color: var(--hover); }
  .sci { font-style: italic; }
  .tile-meta {
    color: var(--muted);
    font-size: 0.74rem;
    display: flex;
    justify-content: space-between;
    gap: 6px;
    white-space: nowrap;
  }
  .tile-meta span:first-child { overflow: hidden; text-overflow: ellipsis; }
  .tile-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-top: auto;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .tile-links { display: inline-flex; align-items: center; gap: 8px; }
  .micro-link {
    color: var(--muted);
    text-decoration: none;
    font-size: 0.73rem;
    white-space: nowrap;
  }
  .micro-link:hover { color: var(--hover); text-decoration: underline; }
  .triage-btns { display: inline-flex; gap: 4px; flex: none; }
  .triage-btn {
    min-height: 22px;
    padding: 1px 7px;
    font-size: 0.7rem;
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    white-space: nowrap;
  }
  .triage-btn.is-done[aria-pressed="true"] {
    background: rgba(111, 191, 115, 0.22);
    border-color: var(--done);
    color: #a9e8ac;
  }
  .triage-btn.is-skip[aria-pressed="true"] {
    background: rgba(147, 163, 181, 0.2);
    border-color: var(--skip);
    color: var(--text);
  }
  .more-wrap {
    margin-top: 22px;
    display: flex;
    justify-content: center;
    gap: 10px;
  }
  .empty {
    padding: 48px 16px;
    text-align: center;
    color: var(--muted);
  }
</style>
</head>
<body>
<header class="topbar">
  <div class="topbar-row">
    <div class="title-wrap">
      <h1 id="page-title">Pollinator Interaction Triage</h1>
      <span class="badge-local">Local only · Not deployed</span>
      <span class="counts" id="counts"></span>
    </div>
    <div class="controls-group">
      <a class="btn-link" id="batch-identify" target="_blank" rel="noopener">Open next 30 in Identify ↗</a>
      <div class="seg" id="size-seg" role="group" aria-label="Tile size">
        <button type="button" data-size="m" aria-pressed="true">Compact</button>
        <button type="button" data-size="l" aria-pressed="false">Large</button>
      </div>
    </div>
  </div>
  <div class="topbar-row">
    <div class="controls-group" id="group-pills"></div>
    <div class="controls-group">
      <select id="space-select" aria-label="Filter by open space"></select>
      <div class="seg" id="status-seg" role="group" aria-label="Triage status">
        <button type="button" data-status="remaining" aria-pressed="true">Remaining</button>
        <button type="button" data-status="done" aria-pressed="false">Done</button>
        <button type="button" data-status="skip" aria-pressed="false">No flower</button>
        <button type="button" data-status="all" aria-pressed="false">All</button>
      </div>
      <select id="sort-select" aria-label="Sort order">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="species">By species</option>
      </select>
      <input type="search" id="search-input" placeholder="Filter species or #id…">
    </div>
  </div>
</header>
<main>
  <p class="hint" id="hint">
    Click any photo to open that observation in iNaturalist Identify mode (with Research Grade &amp; reviewed filters overridden).
    Use <strong>Obs ↗</strong> to add the <em>Nectar / Pollen delivering plant</em> field, or mark tiles <strong>Done</strong> / <strong>No flower</strong> (saved locally in this browser).
  </p>
  <div class="grid" id="grid"></div>
  <div class="more-wrap" id="more-wrap"></div>
</main>
<script>
const PAYLOAD = __PAYLOAD_JSON__;
const STORAGE_KEY = "pollinator_triage_marks:" + PAYLOAD.repo;
const GROUP_COLORS = { bees: "#f5b841", lepidoptera: "#c780ff", syrphids: "#5ec2b7" };
const PAGE_SIZE = 120;

let marks = {};
try { marks = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch (e) { marks = {}; }
function saveMarks() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(marks)); } catch (e) {}
}

const spaceById = Object.fromEntries(PAYLOAD.spaces.map((s) => [s.id, s.name]));
const state = {
  space: "all",
  groups: new Set(PAYLOAD.groups.map((g) => g.id)),
  status: "remaining",
  sort: "newest",
  query: "",
  size: "m",
  limit: PAGE_SIZE,
};

document.getElementById("page-title").textContent = PAYLOAD.title;
const countsEl = document.getElementById("counts");
const batchEl = document.getElementById("batch-identify");
const groupPillsEl = document.getElementById("group-pills");
const spaceSel = document.getElementById("space-select");
const statusSeg = document.getElementById("status-seg");
const sizeSeg = document.getElementById("size-seg");
const sortSel = document.getElementById("sort-select");
const searchIn = document.getElementById("search-input");
const gridEl = document.getElementById("grid");
const moreEl = document.getElementById("more-wrap");

function identifyUrl(ids) {
  return "https://www.inaturalist.org/observations/identify?reviewed=any&quality_grade=needs_id,research,casual&id=" + ids.join(",");
}

function buildControls() {
  groupPillsEl.replaceChildren();
  PAYLOAD.groups.forEach((g) => {
    const n = PAYLOAD.items.filter((x) => x.group === g.id).length;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill";
    btn.style.setProperty("--pill-color", GROUP_COLORS[g.id] || "#7db0ff");
    btn.setAttribute("aria-pressed", String(state.groups.has(g.id)));
    const dot = document.createElement("span");
    dot.className = "dot";
    btn.append(dot, `${g.label} (${n})`);
    btn.addEventListener("click", () => {
      if (state.groups.has(g.id)) {
        if (state.groups.size > 1) state.groups.delete(g.id);
      } else {
        state.groups.add(g.id);
      }
      btn.setAttribute("aria-pressed", String(state.groups.has(g.id)));
      state.limit = PAGE_SIZE;
      render();
    });
    groupPillsEl.appendChild(btn);
  });

  spaceSel.replaceChildren();
  const optAll = new Option(`All spaces (${PAYLOAD.items.length})`, "all");
  spaceSel.appendChild(optAll);
  PAYLOAD.spaces.forEach((s) => {
    const n = PAYLOAD.items.filter((x) => x.spaces.includes(s.id)).length;
    if (n > 0) spaceSel.appendChild(new Option(`${s.name} (${n})`, s.id));
  });
  spaceSel.addEventListener("change", () => { state.space = spaceSel.value; state.limit = PAGE_SIZE; render(); });

  statusSeg.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.status = btn.dataset.status;
      statusSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      state.limit = PAGE_SIZE;
      render();
    });
  });

  sizeSeg.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.size = btn.dataset.size;
      sizeSeg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      gridEl.classList.toggle("is-large", state.size === "l");
    });
  });

  sortSel.addEventListener("change", () => { state.sort = sortSel.value; render(); });

  let timer = null;
  searchIn.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.query = searchIn.value.trim().toLowerCase(); state.limit = PAGE_SIZE; render(); }, 90);
  });
}

function getFiltered() {
  const q = state.query;
  const list = PAYLOAD.items.filter((item) => {
    if (!state.groups.has(item.group)) return false;
    if (state.space !== "all" && !item.spaces.includes(state.space)) return false;
    const m = marks[item.id] || "";
    if (state.status === "remaining" && m) return false;
    if (state.status === "done" && m !== "done") return false;
    if (state.status === "skip" && m !== "skip") return false;
    if (q) {
      const hay = `${item.common} ${item.sci} ${item.id}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (state.sort === "newest") list.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id);
  else if (state.sort === "oldest") list.sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id);
  else list.sort((a, b) => (a.common || a.sci).localeCompare(b.common || b.sci) || b.id - a.id);
  return list;
}

function updateCounts(filtered) {
  let done = 0, skip = 0;
  PAYLOAD.items.forEach((it) => {
    if (marks[it.id] === "done") done++;
    else if (marks[it.id] === "skip") skip++;
  });
  const rem = PAYLOAD.items.length - done - skip;
  countsEl.textContent = `Showing ${filtered.length.toLocaleString()} · ${rem.toLocaleString()} remaining · ${done} done · ${skip} no-flower · Generated ${PAYLOAD.generated}`;

  const batchIds = filtered.slice(0, 30).map((x) => x.id);
  if (batchIds.length) {
    batchEl.href = identifyUrl(batchIds);
    batchEl.textContent = `Open next ${batchIds.length} in Identify ↗`;
    batchEl.hidden = false;
  } else {
    batchEl.hidden = true;
  }
}

function makeTile(item) {
  const mark = marks[item.id] || "";
  const idUrl = identifyUrl([item.id]);
  const obsUrl = "https://www.inaturalist.org/observations/" + item.id;

  const card = document.createElement("article");
  card.className = "tile" + (mark === "done" ? " is-done" : mark === "skip" ? " is-skip" : "");

  const wrap = document.createElement("div");
  wrap.className = "photo-wrap";

  let photoIdx = 0;
  const link = document.createElement("a");
  link.className = "photo-link";
  link.href = idUrl;
  link.target = "_blank";
  link.rel = "noopener";
  link.title = "Open in iNaturalist Identify mode";

  const img = document.createElement("img");
  img.src = item.photos[0];
  img.alt = item.common || item.sci || ("Observation " + item.id);
  img.loading = "lazy";
  link.appendChild(img);
  wrap.appendChild(link);

  const tag = document.createElement("span");
  tag.className = "grade-tag";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = GROUP_COLORS[item.group] || "#7db0ff";
  tag.append(dot, item.grade === "research" ? "RG" : "Needs ID");
  wrap.appendChild(tag);

  if (item.photos.length > 1) {
    const nav = document.createElement("span");
    nav.className = "photo-nav";
    const prev = document.createElement("button");
    prev.type = "button"; prev.textContent = "‹"; prev.title = "Previous photo";
    const lbl = document.createElement("span");
    lbl.textContent = `1/${item.photos.length}`;
    const next = document.createElement("button");
    next.type = "button"; next.textContent = "›"; next.title = "Next photo";
    const setIdx = (d) => {
      photoIdx = (photoIdx + d + item.photos.length) % item.photos.length;
      img.src = item.photos[photoIdx];
      lbl.textContent = `${photoIdx + 1}/${item.photos.length}`;
    };
    prev.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setIdx(-1); });
    next.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); setIdx(1); });
    nav.append(prev, lbl, next);
    wrap.appendChild(nav);
  }

  const body = document.createElement("div");
  body.className = "tile-body";

  const title = document.createElement("a");
  title.className = "tile-title" + (item.common ? "" : " sci");
  title.href = idUrl;
  title.target = "_blank";
  title.rel = "noopener";
  title.textContent = item.common || item.sci || `#${item.id}`;
  title.title = item.common && item.sci ? `${item.common} (${item.sci})` : title.textContent;

  const meta = document.createElement("div");
  meta.className = "tile-meta";
  const where = item.spaces.map((sid) => spaceById[sid] || sid).join(", ");
  const s1 = document.createElement("span"); s1.textContent = where; s1.title = where;
  const s2 = document.createElement("span"); s2.textContent = item.date || "";
  meta.append(s1, s2);

  const actions = document.createElement("div");
  actions.className = "tile-actions";

  const links = document.createElement("span");
  links.className = "tile-links";
  const aId = document.createElement("a");
  aId.className = "micro-link"; aId.href = idUrl; aId.target = "_blank"; aId.rel = "noopener";
  aId.textContent = "Identify ↗";
  const aObs = document.createElement("a");
  aObs.className = "micro-link"; aObs.href = obsUrl; aObs.target = "_blank"; aObs.rel = "noopener";
  aObs.textContent = "Obs ↗";
  links.append(aId, aObs);

  const btns = document.createElement("span");
  btns.className = "triage-btns";
  const bDone = document.createElement("button");
  bDone.type = "button"; bDone.className = "triage-btn is-done"; bDone.textContent = "✓"; bDone.title = "Mark done";
  bDone.setAttribute("aria-pressed", String(mark === "done"));
  const bSkip = document.createElement("button");
  bSkip.type = "button"; bSkip.className = "triage-btn is-skip"; bSkip.textContent = "No flower"; bSkip.title = "Mark no flower visible";
  bSkip.setAttribute("aria-pressed", String(mark === "skip"));

  const toggleMark = (val) => {
    if (marks[item.id] === val) delete marks[item.id];
    else marks[item.id] = val;
    saveMarks();
    render();
  };
  bDone.addEventListener("click", () => toggleMark("done"));
  bSkip.addEventListener("click", () => toggleMark("skip"));
  btns.append(bDone, bSkip);

  actions.append(links, btns);
  body.append(title, meta, actions);
  card.append(wrap, body);
  return card;
}

function render() {
  const filtered = getFiltered();
  updateCounts(filtered);
  gridEl.replaceChildren();
  moreEl.replaceChildren();

  if (!filtered.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No candidate observations match the current filters.";
    gridEl.appendChild(p);
    return;
  }

  const slice = filtered.slice(0, state.limit);
  const frag = document.createDocumentFragment();
  slice.forEach((item) => frag.appendChild(makeTile(item)));
  gridEl.appendChild(frag);

  if (filtered.length > slice.length) {
    const rem = filtered.length - slice.length;
    const bMore = document.createElement("button");
    bMore.type = "button";
    bMore.textContent = `Show ${Math.min(PAGE_SIZE, rem)} more (${rem} remaining)`;
    bMore.addEventListener("click", () => { state.limit += PAGE_SIZE; render(); });
    const bAll = document.createElement("button");
    bAll.type = "button";
    bAll.textContent = `Show all ${filtered.length}`;
    bAll.addEventListener("click", () => { state.limit = filtered.length; render(); });
    moreEl.append(bMore, bAll);
  }
}

buildControls();
render();
</script>
</body>
</html>
"""


def main():
    parser = argparse.ArgumentParser(description="Build local-only tiled pollinator triage HTML page.")
    parser.add_argument("--space", help="Optional single space ID to fetch (defaults to all top-level spaces)")
    args = parser.parse_args()

    spaces = [s for s in read_spaces() if not s.get("parent")]
    if args.space:
        spaces = [s for s in spaces if s["id"] == args.space]
        if not spaces:
            sys.exit(f"Unknown top-level space id: {args.space}")

    by_obs = {}
    for spc in spaces:
        area, _ = area_for(spc)
        boxes = exclusions(spc)
        rows = fetch_space_candidates(area, boxes)
        print(f"  {spc['id']}: {len(rows)} unannotated candidate observations")
        for obs, photos in rows:
            oid = obs["id"]
            if oid in by_obs:
                if spc["id"] not in by_obs[oid]["spaces"]:
                    by_obs[oid]["spaces"].append(spc["id"])
                continue
            taxon = obs.get("taxon") or {}
            by_obs[oid] = {
                "id": oid,
                "spaces": [spc["id"]],
                "group": classify_group(taxon),
                "common": taxon.get("preferred_common_name") or "",
                "sci": taxon.get("name") or "",
                "date": obs.get("observed_on") or "",
                "grade": obs.get("quality_grade") or "",
                "photos": photos,
            }

    items = sorted(by_obs.values(), key=lambda x: (x["date"], x["id"]), reverse=True)
    payload = {
        "repo": ROOT.name,
        "title": "Pollinator Interaction Triage · Open Space Corridors",
        "generated": datetime.date.today().isoformat(),
        "groups": [{"id": gid, "label": label} for gid, label, _ in POLLINATOR_GROUPS],
        "spaces": [{"id": s["id"], "name": s.get("short") or s.get("title") or s.get("name") or s["id"]} for s in spaces],
        "items": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    html = HTML_TEMPLATE.replace("__PAYLOAD_JSON__", json.dumps(payload, separators=(",", ":")).replace("</", "<\\/"))
    OUT.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(items)} candidate tiles, {OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
