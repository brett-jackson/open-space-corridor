// Landing page: the corridor map, its side panel, and the view state in the URL.
//
// The view is a set of active species groups (all three by default, toggleable on/off),
// optionally with a selected space or a selected link between two spaces. It lives in the
// URL hash so views can be shared and the browser's Back button steps through them:
//
//   #all                            all groups on the map and every space's summary
//   #birds                          just the birds network and effort comparison
//   #birds+bees/metzger             one space across the selected groups + signature species
//   #birds/broomfield~metzger       the comparison for one link
//
// (#signature/metzger, the old site summary, opens that space with all groups.)
// Clicking a space on the map or its row in the panel selects it, keeping the active groups;
// the space's "Explore" button opens its own page. Clicking empty map or pressing Escape
// steps back out of a selection.

const grid = document.getElementById("grid");
const map_el = document.getElementById("space-map");
const panel = document.getElementById("panel-content");
const panel_wrap = document.getElementById("space-panel");
const spaces = window.SPACES || [];
const located = spaces.filter((spc) => Array.isArray(spc.location) && spc.location.length === 2);
const byId = Object.fromEntries(spaces.map((spc) => [spc.id, spc]));
const TABS = NETWORK_DATA.groups;
const ALL_GROUPS = TABS.map((t) => t.id);

let state = { groups: [...ALL_GROUPS], space: null, pair: null };
let network = null;
let updateLabels = null;

// ---------- URL state ----------

function normalizeGroups(list) {
    const set = new Set(list);
    const ordered = ALL_GROUPS.filter((id) => set.has(id));
    return ordered.length ? ordered : [...ALL_GROUPS];
}

function parseHash() {
    let raw = "";
    try {
        raw = decodeURIComponent(location.hash.replace(/^#/, ""));
    } catch (err) {
        raw = ""; // a malformed hash (e.g. "#%E0") falls back to the default view
    }
    const [group_token, target] = raw.split("/");
    let groups = [...ALL_GROUPS];
    if (group_token && group_token !== "all" && group_token !== "signature") {
        const parsed = group_token.split("+").filter((id) => ALL_GROUPS.includes(id));
        if (parsed.length) groups = normalizeGroups(parsed);
    }
    const s = { groups, space: null, pair: null };
    if (target && target.includes("~")) {
        const [a, b] = target.split("~");
        if (byId[a] && byId[b] && a !== b) s.pair = [a, b];
    } else if (target && byId[target]) {
        s.space = target;
    }
    return s;
}

function hashFor(s) {
    const groups = normalizeGroups(s.groups || ALL_GROUPS);
    const token = groups.length === ALL_GROUPS.length ? "all" : groups.join("+");
    const target = s.pair ? s.pair.join("~") : s.space;
    return "#" + token + (target ? "/" + target : "");
}

// Change the view; `push` adds a history entry so Back returns to the previous view
function go(next, push = true) {
    state = {
        groups: normalizeGroups(next.groups ?? state.groups),
        space: next.space ?? null,
        pair: next.pair ?? null,
    };
    const hash = hashFor(state);
    if (hash !== location.hash) {
        if (push) history.pushState(null, "", hash);
        else history.replaceState(null, "", hash);
    }
    render();
}

window.addEventListener("popstate", () => {
    state = parseHash();
    render();
});

// Escape steps back out of a selected space or pair to the overview
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && (state.pair || state.space)) {
        go({ groups: state.groups });
    }
});

// On a phone the panel sits under the map, so a selection made on the map would change
// content that is off screen: bring the panel's content into view
function revealPanel() {
    if (!matchMedia("(max-width: 800px)").matches) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

// Subtle bottom fade when the desktop panel has more content below the fold
function updatePanelScrollCue() {
    if (!panel_wrap) return;
    const has_more = panel.scrollHeight - panel.clientHeight > 6 && panel.scrollTop + panel.clientHeight < panel.scrollHeight - 4;
    panel_wrap.classList.toggle("has-more-below", has_more);
}
panel.addEventListener("scroll", updatePanelScrollCue, { passive: true });
window.addEventListener("resize", updatePanelScrollCue);

// ---------- Panel views ----------

function backButton(text, onClick) {
    const b = el("button", "panel-back", text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
}

// A space's name and the way into its own page
function spaceHeader(spc) {
    const parts = [el("h2", "panel-title", spc.title)];
    if (spc.subtitle) parts.push(el("p", "panel-subtitle", spc.subtitle));
    const explore = el("a", "panel-explore", `Explore ${shortName(spc)} →`);
    explore.href = spaceHref(spc);
    parts.push(explore);
    return parts;
}

// Concise visual key for the map: circle size, line thickness, thin dashed, and (only when
// present) empty dashed gaps
function mapKey(groups) {
    const multi = groups.length > 1;
    const key = el("p", "map-key" + (multi ? "" : " net-" + groups[0]));
    const item = (icon_cls, text) => {
        const span = el("span", "key-item");
        const icon = el("span", icon_cls);
        icon.setAttribute("aria-hidden", "true");
        span.append(icon, text);
        return span;
    };

    key.appendChild(item(multi ? "key-halo is-multi" : "key-halo", "more species"));

    if (!multi) {
        const links = corridorLinks(located, NETWORK_DATA, groups[0]);
        const scale = linkScale(links);
        if (scale.any) {
            const lo = Math.round(scale.lo * 100), hi = Math.round(scale.hi * 100);
            key.appendChild(item(lo === hi ? "key-wedge is-flat" : "key-wedge", lo === hi ? `${hi}% alike` : `${lo}%–${hi}% alike`));
        }
        if (links.some((l) => l.thin && l.shared > 0)) key.appendChild(item("key-dash is-thin", "few records"));
        if (links.some((l) => l.gap && !(l.thin && l.shared > 0))) key.appendChild(item("key-dash", "no shared yet"));
    } else {
        const links_by_group = groups.map((g) => corridorLinks(located, NETWORK_DATA, g));
        const any_solid = links_by_group.some((links) => links.some((l) => !l.gap));
        const any_thin = links_by_group.some((links) => links.some((l) => l.thin && l.shared > 0));
        // Empty white dashed lines appear in multi-group mode only when a pair has 0 shared across all active groups
        const pair_has_strand = new Map();
        links_by_group.forEach((links) => {
            links.forEach((l) => {
                const k = l.a.id + "|" + l.b.id;
                pair_has_strand.set(k, (pair_has_strand.get(k) || false) || l.shared > 0);
            });
        });
        const any_empty_gap = [...pair_has_strand.values()].some((has) => !has);
        if (any_solid) key.appendChild(item("key-wedge is-multi", "more alike"));
        if (any_thin) key.appendChild(item("key-dash is-thin is-multi", "few records"));
        if (any_empty_gap) key.appendChild(item("key-dash", "no shared yet"));
    }
    return key;
}

// Overview: what the map shows, then one row per space
function groupView(groups) {
    const parts = [
        el("p", "panel-lede", "Nearest neighbors connected by shared native species, not tracked movement."),
        mapKey(groups),
    ];

    const ol = el("ol", "network-counts");
    if (groups.length === 1) {
        const group_id = groups[0];
        const equal = NETWORK_DATA.equal_effort?.[group_id];
        located
            .map((spc) => ({ spc, n: (NETWORK_DATA.by_space[spc.id]?.[group_id] || []).length, ...spaceEffort(NETWORK_DATA, spc.id, group_id) }))
            .sort((x, y) => y.n - x.n || y.obs - x.obs)
            .forEach(({ spc, n, obs, low }) => {
                const a = el("a", "network-count-row");
                a.dataset.space = spc.id;
                a.href = hashFor({ groups, space: spc.id });
                a.append(el("span", "network-count-name", shortName(spc)), el("span", "network-count", `${n} species`));
                const effort = el("span", "network-count-effort");
                const fair = equal?.species?.[spc.id];
                effort.append(effortMeter(obs), `${obs.toLocaleString()} ${obs === 1 ? "record" : "records"}`
                    + (fair === undefined ? "" : ` · ${Math.round(fair)} species per ${equal.records.toLocaleString()} records`));
                a.appendChild(effort);
                const li = el("li");
                li.appendChild(a);
                if (low) li.appendChild(dataFlag(spc, group_id, obs));
                ol.appendChild(li);
            });
    } else {
        located
            .map((spc) => {
                const per_group = groups.map((g) => ({
                    g,
                    n: (NETWORK_DATA.by_space[spc.id]?.[g] || []).length,
                    ...spaceEffort(NETWORK_DATA, spc.id, g),
                }));
                const total = per_group.reduce((s, x) => s + x.n, 0);
                const total_obs = per_group.reduce((s, x) => s + x.obs, 0);
                return { spc, per_group, total, total_obs, all_low: per_group.every((x) => x.low) };
            })
            .sort((x, y) => y.total - x.total || y.total_obs - x.total_obs)
            .forEach(({ spc, per_group, total, all_low }) => {
                const a = el("a", "network-count-row");
                a.dataset.space = spc.id;
                a.href = hashFor({ groups, space: spc.id });
                a.append(el("span", "network-count-name", shortName(spc)), el("span", "network-count", `${total} species`));
                const breakdown = el("span", "network-breakdown");
                per_group.forEach(({ g, n }, i) => {
                    if (i) breakdown.append(" · ");
                    const chip = el("span", "breakdown-item net-" + g);
                    const dot = el("span", "breakdown-dot");
                    dot.setAttribute("aria-hidden", "true");
                    chip.append(dot, `${n} ${n === 1 ? groupUnit(g, 1) : groupShortLabel(g)}`);
                    breakdown.appendChild(chip);
                });
                a.appendChild(breakdown);
                const li = el("li");
                li.appendChild(a);
                if (all_low) {
                    const flag = el("a", "network-flag", "More data needed →");
                    flag.href = helpHref(spc);
                    li.appendChild(flag);
                }
                ol.appendChild(li);
            });
    }
    parts.push(ol);
    return parts;
}

// A selected space: its links in the active group(s), what only it has, and its top signature species
function spaceView(spc, groups) {
    const multi = groups.length > 1;
    const parts = [
        backButton("← All spaces", () => go({ groups })),
        ...spaceHeader(spc),
    ];
    groups.forEach((group_id) => {
        const heading = el("h3", "panel-heading" + (multi ? " panel-heading-group net-" + group_id : ""), "Native " + groupLabel(group_id));
        parts.push(heading, effortLine(spc, group_id));
        if (spaceEffort(NETWORK_DATA, spc.id, group_id).obs > 0) {
            parts.push(connectionsList(spc, located, group_id, (other) => hashFor({ groups: [group_id], pair: [spc.id, other.id] })));
        }
        const unique = onlyHere(spc, located, group_id);
        if (unique.length > 0) parts.push(speciesDetails("Seen only here", unique, spc, group_id));
    });
    parts.push(...signatureSection(spc, "h3", 3));
    return parts;
}

// One group's diff columns and shared list for a pair comparison
function comparisonGroupBlock(a, b, group_id, show_heading) {
    const at_a = new Set(NETWORK_DATA.by_space[a.id]?.[group_id] || []);
    const at_b = new Set(NETWORK_DATA.by_space[b.id]?.[group_id] || []);
    const shared = [...at_a].filter((id) => at_b.has(id));
    const only_a = [...at_a].filter((id) => !at_b.has(id));
    const only_b = [...at_b].filter((id) => !at_a.has(id));
    const link = corridorLinks(located, NETWORK_DATA, group_id).find((l) => (l.a.id === a.id && l.b.id === b.id) || (l.a.id === b.id && l.b.id === a.id));
    const equal_effort = NETWORK_DATA.similarity?.[group_id]?.[[a.id, b.id].sort().join("|")];
    const similarity = link?.similarity ?? equal_effort ?? (at_a.size + at_b.size > 0 ? (2 * shared.length) / (at_a.size + at_b.size) : null);
    const thin = link ? link.thin : [a, b].some((spc) => spaceEffort(NETWORK_DATA, spc.id, group_id).low);

    const alike = similarity !== null && !thin && shared.length > 0 ? ` · ${Math.round(similarity * 100)}% alike at equal effort` : "";
    const parts = [];
    if (show_heading) parts.push(el("h3", "panel-heading panel-heading-group net-" + group_id, "Native " + groupLabel(group_id)));
    parts.push(el("p", "panel-lede", `${shared.length} native ${groupUnit(group_id, shared.length)} seen at both${alike}.`));

    const fewest = [a, b].map((spc) => ({ spc, ...spaceEffort(NETWORK_DATA, spc.id, group_id) })).sort((x, y) => x.obs - y.obs)[0];
    if (fewest.low) {
        const note = dataFlag(fewest.spc, group_id, fewest.obs, true);
        note.classList.add("comparison-caveat");
        parts.push(note);
    }

    // Two semantic columns (each heading immediately precedes its list in DOM order; CSS subgrid aligns row heights)
    const columns = el("div", "network-columns");
    [[a, only_a], [b, only_b]].forEach(([spc, ids]) => {
        const col = el("div", "network-column");
        const h = el("h4", null, `Only at ${shortName(spc)}`);
        h.appendChild(el("span", "network-column-count", `${ids.length} of ${(NETWORK_DATA.by_space[spc.id]?.[group_id] || []).length} species`));
        const ul = el("ul", "species-list");
        sortedSpecies(ids).forEach((id) => ul.appendChild(networkSpeciesItem(id, "li", ebirdOnly(spc.id, group_id, id) ? "eBird only" : "", spc, group_id)));
        if (ids.length === 0) ul.appendChild(el("li", "panel-hint", "None"));
        col.append(h, ul);
        columns.appendChild(col);
    });
    parts.push(columns);
    if (shared.length > 0) parts.push(speciesDetails("Seen at both", shared, null, group_id));
    return parts;
}

// A selected link: what differs between the two spaces first, then the species they share
function comparisonView(a, b, groups) {
    const title = el("h2", "panel-title panel-title-small");
    [a, b].forEach((spc, i) => {
        if (i) title.append(" ↔ ");
        const name = el("a", null, shortName(spc));
        name.dataset.space = spc.id;
        name.href = hashFor({ groups, space: spc.id });
        title.appendChild(name);
    });
    const parts = [
        backButton("← All spaces", () => go({ groups })),
        title,
    ];
    const multi = groups.length > 1;
    groups.forEach((group_id) => {
        parts.push(...comparisonGroupBlock(a, b, group_id, multi));
    });
    return parts;
}

function panelFor(s) {
    if (s.pair) return comparisonView(byId[s.pair[0]], byId[s.pair[1]], s.groups);
    if (s.space) return spaceView(byId[s.space], s.groups);
    return groupView(s.groups);
}

let rendered_key = null;
function renderPanel() {
    const key = hashFor(state);
    if (key === rendered_key) return;
    rendered_key = key;
    panel.replaceChildren(...panelFor(state));
    panel.scrollTop = 0;
    requestAnimationFrame(updatePanelScrollCue);
}

// ---------- Map ----------

const marker_parts = {}; // space id -> { wrap, outline, label }

// Highlight a space on the map as if it were hovered: its outline lights up, its dot is
// ringed, and only its links stay bright
function highlightSpace(id, on) {
    const parts = marker_parts[id];
    if (!parts) return;
    parts.outline?.eachLayer((layer) => layer.getElement()?.classList.toggle("active", on));
    parts.wrap.classList.toggle("is-hover", on);
    network?.focus(on ? id : null);
}

// Hovering (or tabbing to) a space's name in the panel highlights it on the map, without
// replacing what the panel shows
let panel_hover = null;
function panelHover(e) {
    const id = e.target.closest?.("[data-space]")?.dataset.space || null;
    if (id === panel_hover) return;
    if (panel_hover) highlightSpace(panel_hover, false);
    panel_hover = id;
    if (id) highlightSpace(id, true);
}
panel.addEventListener("pointerover", panelHover);
panel.addEventListener("focusin", panelHover);
panel.addEventListener("pointerleave", () => panelHover({ target: panel }));
panel.addEventListener("focusout", (e) => { if (!panel.contains(e.relatedTarget)) panelHover({ target: panel }); });

function render() {
    document.querySelectorAll("#panel-tabs button[data-group]").forEach((b) => {
        b.setAttribute("aria-pressed", String(state.groups.includes(b.dataset.group)));
    });
    if (network) {
        network.show(state.groups);
        network.select(state.space, state.pair);
    }
    // The selected space's dot and outline stay highlighted
    Object.entries(marker_parts).forEach(([id, parts]) => {
        const on = id === state.space || (state.pair || []).includes(id);
        parts.wrap.classList.toggle("is-selected", on);
        parts.outline?.eachLayer((layer) => layer.getElement()?.classList.toggle("selected", on));
    });
    renderPanel();
    updateLabels?.();
}

// A space's marker: a small round photo on its point, with its short name beside it
function makeMarker(spc) {
    const a = el("a", "map-card");
    a.href = spaceHref(spc);
    a.setAttribute("aria-label", `${spc.title}: show summary`);
    const photo = spc.thumb || spc.image;
    a.appendChild(photo ? Object.assign(el("img"), { src: photo, alt: "" }) : el("div", "placeholder"));
    const label = el("span", "map-label", shortName(spc));
    label.setAttribute("aria-hidden", "true");
    const wrap = el("div");
    wrap.append(a, label);
    return { wrap, label };
}

// The original card; used as the fallback list when the map can't be shown
function makeCard(spc) {
    const a = el("a", "space");
    a.href = spaceHref(spc);
    a.appendChild(spc.image ? Object.assign(el("img"), { src: spc.image, alt: "", loading: "lazy" }) : el("div", "placeholder"));
    const body = el("div", "space-body");
    body.appendChild(el("h2", null, spc.title));
    if (spc.description) body.appendChild(el("p", null, spc.description));
    a.appendChild(body);
    return a;
}

// Without the map, fall back to the plain page layout with no side panel
function useListLayout() {
    document.getElementById("landing-body").remove();
    document.getElementById("landing").classList.remove("landing");
}

// The panel header: toggleable color-coded chips for each species group (all active by default).
// Clicking turns a group on or off; clicking the last remaining active group turns all back on.
function buildGroupToggles() {
    const tabs = document.getElementById("panel-tabs");
    const options = el("div", "group-toggles");
    options.setAttribute("role", "group");
    options.setAttribute("aria-label", "Wildlife groups");
    TABS.forEach((t) => {
        const b = el("button", "group-toggle net-" + t.id);
        b.type = "button";
        b.id = "toggle-" + t.id;
        b.dataset.group = t.id;
        b.setAttribute("aria-pressed", "true");
        const dot = el("span", "group-dot");
        dot.setAttribute("aria-hidden", "true");
        b.append(dot, t.label);
        b.addEventListener("click", () => {
            const on = state.groups.includes(t.id);
            let next;
            if (on && state.groups.length === 1) next = [...ALL_GROUPS]; // clicking the last one resets to all
            else if (on) next = state.groups.filter((id) => id !== t.id);
            else next = normalizeGroups([...state.groups, t.id]);
            go({ groups: next, space: state.space, pair: state.pair });
        });
        options.appendChild(b);
    });
    tabs.appendChild(options);
    tabs.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const buttons = [...tabs.querySelectorAll("button[data-group]")];
        const i = buttons.indexOf(document.activeElement);
        if (i < 0) return;
        const next = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
        next.focus();
        e.preventDefault();
    });
}

function buildMap() {
    // On narrow touchscreens, let one-finger drags scroll the page past the map cleanly
    const touch_phone = matchMedia("(pointer: coarse)").matches && matchMedia("(max-width: 800px)").matches;
    const map = L.map(map_el, {
        scrollWheelZoom: true,
        zoomSnap: 0.25,
        wheelPxPerZoomLevel: 90,
        dragging: !touch_phone,
    });
    if (touch_phone) map_el.classList.add("is-touch-scroll");

    // Esri hybrid: softened imagery and quiet reference overlays so corridor lines and space labels lead
    const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
    L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 18,
        className: "basemap-imagery",
        attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    }).addTo(map);
    L.tileLayer(ESRI + "Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 18,
        opacity: 0.35,
    }).addTo(map);
    L.tileLayer(ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 18,
        opacity: 0.55,
        attribution: "Labels &copy; Esri",
    }).addTo(map);

    const boundaries = window.SPACE_BOUNDARIES || {};
    const frame = L.latLngBounds(located.map((spc) => spc.location));
    const selectSpace = (spc) => {
        go({ groups: state.groups, space: spc.id });
        revealPanel();
    };

    located.forEach((spc) => {
        let outline = null;
        if (boundaries[spc.id]) {
            outline = L.geoJSON(boundaries[spc.id], { style: { className: "space-boundary" }, interactive: true }).addTo(map);
            outline.on("click", (e) => { L.DomEvent.stopPropagation(e); selectSpace(spc); });
            frame.extend(outline.getBounds());
        }

        const { wrap, label } = makeMarker(spc);
        L.marker(spc.location, {
            icon: L.divIcon({ className: "map-marker", html: wrap, iconSize: [20, 20], iconAnchor: [10, 10] }),
            riseOnHover: true,
            keyboard: false, // the link inside the marker is the focus target
        }).addTo(map);
        const card = wrap.firstChild;
        marker_parts[spc.id] = { wrap, outline, label };

        // A click selects the space instead of leaving the page; "Explore" opens its page
        card.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectSpace(spc);
        });

        const enter = () => highlightSpace(spc.id, true);
        const leave = () => highlightSpace(spc.id, false);
        card.addEventListener("pointerenter", enter);
        card.addEventListener("focus", enter);
        card.addEventListener("pointerleave", leave);
        card.addEventListener("blur", leave);
        outline?.on("mouseover", enter);
        outline?.on("mouseout", leave);
    });

    // Place each space's label on whichever side (right, left, top, bottom) avoids map edges,
    // other dots, and previously placed labels; hide crowded labels on phones unless selected
    const POSITIONS = ["right", "left", "top", "bottom"];
    const overlaps = (r1, r2, pad = 4) => !(r1.x2 + pad <= r2.x1 || r2.x2 + pad <= r1.x1 || r1.y2 + pad <= r2.y1 || r2.y2 + pad <= r1.y1);
    updateLabels = () => {
        const w = map_el.clientWidth, h = map_el.clientHeight;
        if (!w || !h) return;
        const narrow = w < 520;
        const pts = Object.fromEntries(located.map((spc) => [spc.id, map.latLngToContainerPoint(spc.location)]));
        const dot_r = narrow ? 9 : 12;
        const dots = located.map((spc) => {
            const p = pts[spc.id];
            return { id: spc.id, x1: p.x - dot_r, y1: p.y - dot_r, x2: p.x + dot_r, y2: p.y + dot_r };
        });
        // Prioritize selected spaces first, then spaces with more total species across active groups
        const priority = (spc) => {
            if (spc.id === state.space || (state.pair || []).includes(spc.id)) return 1e9;
            return state.groups.reduce((s, g) => s + (NETWORK_DATA.by_space[spc.id]?.[g] || []).length, 0);
        };
        const ordered = [...located].sort((a, b) => priority(b) - priority(a));
        const placed = [];

        ordered.forEach((spc) => {
            const { label } = marker_parts[spc.id];
            const p = pts[spc.id];
            const lw = label.offsetWidth || 80;
            const lh = label.offsetHeight || 20;
            const gap = narrow ? 12 : 14;
            const candidates = {
                right:  { x1: p.x + gap,      y1: p.y - lh / 2, x2: p.x + gap + lw, y2: p.y + lh / 2 },
                left:   { x1: p.x - gap - lw, y1: p.y - lh / 2, x2: p.x - gap,      y2: p.y + lh / 2 },
                top:    { x1: p.x - lw / 2,   y1: p.y - gap - lh, x2: p.x + lw / 2, y2: p.y - gap },
                bottom: { x1: p.x - lw / 2,   y1: p.y + gap,    x2: p.x + lw / 2,   y2: p.y + gap + lh },
            };
            let best_pos = "right";
            let best_score = Infinity;
            let best_rect = candidates.right;

            POSITIONS.forEach((pos, idx) => {
                const r = candidates[pos];
                let score = idx * 0.25; // gentle preference for right, then left, top, bottom
                // Penalize clipping map edges (leave room for top-left zoom control too)
                if (r.x1 < 6 || r.x2 > w - 6 || r.y1 < 6 || r.y2 > h - 22) score += 100;
                if (r.x1 < 48 && r.y1 < 82) score += 80; // avoid Leaflet zoom buttons
                dots.forEach((d) => { if (d.id !== spc.id && overlaps(r, d, 2)) score += 35; });
                placed.forEach((o) => { if (overlaps(r, o, 3)) score += 80; });
                if (score < best_score) {
                    best_score = score;
                    best_pos = pos;
                    best_rect = r;
                }
            });

            label.classList.remove("pos-left", "pos-top", "pos-bottom", "is-crowded");
            if (best_pos !== "right") label.classList.add("pos-" + best_pos);
            const crowded = narrow && best_score >= 70 && spc.id !== state.space && !(state.pair || []).includes(spc.id);
            label.classList.toggle("is-crowded", crowded);
            if (!crowded) placed.push(best_rect);
        });
    };

    // Frame every space and its boundary with generous breathing room
    let fitting = false;
    let user_moved = false; // once someone pans or zooms, resizes stop re-framing the map
    let fit_zoom = null;
    const fit = () => {
        const narrow = map_el.clientWidth < 600;
        fitting = true;
        map.fitBounds(frame, {
            paddingTopLeft: narrow ? [26, 34] : [60, 44],
            paddingBottomRight: narrow ? [26, 34] : [60, 38],
            maxZoom: 16,
            animate: false,
        });
        fit_zoom = map.getZoom();
        fitting = false;
    };
    fit();
    // On phones, enable map dragging only once zoomed in past the fitted overview
    if (touch_phone) {
        map.on("zoomend", () => {
            const zoomed_in = fit_zoom !== null && map.getZoom() > fit_zoom + 0.2;
            if (zoomed_in) {
                map.dragging.enable();
                map_el.classList.remove("is-touch-scroll");
            } else {
                map.dragging.disable();
                map_el.classList.add("is-touch-scroll");
            }
        });
    }
    map.on("dragstart zoomstart", () => { if (!fitting) user_moved = true; });
    map.on("zoomend moveend", () => updateLabels?.());
    let last_size = map.getSize();
    window.addEventListener("resize", () => {
        const size = map.getSize();
        if (size.x === last_size.x && size.y === last_size.y) return;
        last_size = size;
        if (!user_moved) fit();
        updateLabels?.();
    });

    if (typeof createNetwork === "function") {
        network = createNetwork(map, located, NETWORK_DATA, {
            onPairClick: (a, b, group) => {
                // Clicking a specific strand opens that taxon's comparison (and preserves all groups if single wasn't clicked)
                go({ groups: group ? [group] : state.groups, pair: [a.id, b.id] });
                revealPanel();
            },
        });
    }

    // Clicking empty map (not a space, a line, or the end of a drag) steps out of a selection
    map.on("click", () => {
        if (state.pair || state.space) go({ groups: state.groups });
    });
}

// ---------- Start ----------

document.getElementById("credits")?.replaceChildren(...creditsLine().childNodes);

if (spaces.length === 0) {
    const msg = el("p", "empty", "No spaces found.");
    grid.replaceWith(msg);
    useListLayout();
} else if (typeof L === "undefined" || located.length === 0 || TABS.length === 0) {
    // No map library (e.g. offline), no coordinates or no network data: show the plain card grid, north to south
    useListLayout();
    [...spaces].sort((a, b) => (b.location?.[0] ?? 0) - (a.location?.[0] ?? 0)).forEach((spc) => grid.appendChild(makeCard(spc)));
} else {
    grid.remove();
    buildGroupToggles();
    buildMap();
    state = parseHash();
    go(state, false);
}
