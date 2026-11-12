// Landing page: the corridor map, its side panel, and the view state in the URL.
//
// The view is a species group ("corridor"), optionally with a selected space or a selected
// link between two spaces. It lives in the URL hash so views can be shared and the browser's
// Back button steps through them:
//
//   #birds                          the birds network and every space's species and effort
//   #birds/metzger                  one space: its links in the birds network, then its signature species
//   #birds/broomfield~metzger       the comparison for one link
//
// (#signature/metzger, the old site summary, still opens that space in the default group.)
// Clicking a space on the map or its chip under "Sites" selects it, keeping the group, so it
// works the same either way and on touch screens; the space's "Explore" button opens its own
// page. Clicking empty map steps back out of a selection.

const grid = document.getElementById("grid");
const map_el = document.getElementById("space-map");
const panel = document.getElementById("panel-content");
const spaces = window.SPACES || [];
const located = spaces.filter((spc) => Array.isArray(spc.location) && spc.location.length === 2);
const byId = Object.fromEntries(spaces.map((spc) => [spc.id, spc]));
const TABS = NETWORK_DATA.groups;

let state = { tab: null, space: null, pair: null };
let network = null;

// ---------- URL state ----------

const DEFAULT_TAB = (TABS.find((t) => t.id === "birds") || TABS[0])?.id; // birds have the most complete data

function parseHash() {
    let raw = "";
    try {
        raw = decodeURIComponent(location.hash.replace(/^#/, ""));
    } catch (err) {
        raw = ""; // a malformed hash (e.g. "#%E0") falls back to the default view
    }
    const [tab, target] = raw.split("/");
    const s = { tab: TABS.some((t) => t.id === tab) ? tab : DEFAULT_TAB, space: null, pair: null };
    if (target && target.includes("~")) {
        const [a, b] = target.split("~");
        if (byId[a] && byId[b] && a !== b) s.pair = [a, b];
    } else if (target && byId[target]) {
        s.space = target;
    }
    return s;
}

function hashFor(s) {
    const target = s.pair ? s.pair.join("~") : s.space;
    return "#" + s.tab + (target ? "/" + target : "");
}

// Change the view; `push` adds a history entry so Back returns to the previous view
function go(next, push = true) {
    state = { tab: next.tab ?? state.tab, space: next.space ?? null, pair: next.pair ?? null };
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

// On a phone the panel sits under the map, so a selection made on the map would change
// content that is off screen: bring the panel's content into view
function revealPanel() {
    if (!matchMedia("(max-width: 800px)").matches) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

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

// What the lines mean, in one row: a wedge from the least to the most alike pair, and the
// dashed style of pairs with too few records
function mapKey(group_id) {
    const scale = linkScale(corridorLinks(located, NETWORK_DATA, group_id));
    const key = el("p", "map-key net-" + group_id);
    if (scale.any) {
        const lo = Math.round(scale.lo * 100), hi = Math.round(scale.hi * 100);
        const wedge = el("span", lo === hi ? "key-wedge is-flat" : "key-wedge");
        wedge.setAttribute("aria-hidden", "true");
        key.append(wedge, el("span", null, lo === hi ? `${hi}% alike` : `${lo}% to ${hi}% alike`));
    }
    const dash = el("span", "key-dash");
    dash.setAttribute("aria-hidden", "true");
    key.append(dash, el("span", null, "few records"));
    return key;
}

// A group's overview: what the map shows, then one row per space: its native species, its
// survey effort and, where it has enough records, its species count at equal effort
function groupView(group_id) {
    const parts = [
        el("p", "panel-lede", "Lines show shared species, not tracked movement. Thicker means more alike."),
        mapKey(group_id),
    ];
    const equal = NETWORK_DATA.equal_effort?.[group_id];

    const ol = el("ol", "network-counts");
    located
        .map((spc) => ({ spc, n: (NETWORK_DATA.by_space[spc.id]?.[group_id] || []).length, ...spaceEffort(NETWORK_DATA, spc.id, group_id) }))
        .sort((x, y) => y.n - x.n || y.obs - x.obs)
        .forEach(({ spc, n, obs, low }) => {
            const a = el("a", "network-count-row");
            a.dataset.space = spc.id;
            a.href = hashFor({ tab: group_id, space: spc.id });
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
    parts.push(ol);

    return parts;
}

// A selected space: its links in this group, what only it has, and a taste of its signature
// species (its own page has the rest)
function spaceView(spc, group_id) {
    const parts = [
        backButton("← All spaces", () => go({ tab: group_id })),
        ...spaceHeader(spc),
        el("h3", "panel-heading", "Native " + groupLabel(group_id)),
        effortLine(spc, group_id),
    ];
    if (spaceEffort(NETWORK_DATA, spc.id, group_id).obs > 0) {
        parts.push(connectionsList(spc, located, group_id, (other) => hashFor({ tab: group_id, pair: [spc.id, other.id] })));
    }
    const unique = onlyHere(spc, located, group_id);
    if (unique.length > 0) parts.push(speciesDetails("Seen only here", unique, spc, group_id));
    parts.push(...signatureSection(spc, "h3", 3));
    return parts;
}

// A selected link: what differs between the two spaces first (each space's own species, side
// by side), then the species they share, collapsed
function comparisonView(a, b, group_id) {
    const at_a = new Set(NETWORK_DATA.by_space[a.id]?.[group_id] || []);
    const at_b = new Set(NETWORK_DATA.by_space[b.id]?.[group_id] || []);
    const shared = [...at_a].filter((id) => at_b.has(id));
    const only_a = [...at_a].filter((id) => !at_b.has(id));
    const only_b = [...at_b].filter((id) => !at_a.has(id));
    const label = groupLabel(group_id).toLowerCase();
    const link = corridorLinks(located, NETWORK_DATA, group_id).find((l) => (l.a.id === a.id && l.b.id === b.id) || (l.a.id === b.id && l.b.id === a.id));
    // Pairs that aren't neighbors have no link; compare them the same way
    const equal_effort = NETWORK_DATA.similarity?.[group_id]?.[[a.id, b.id].sort().join("|")];
    const similarity = link?.similarity ?? equal_effort ?? (at_a.size + at_b.size > 0 ? (2 * shared.length) / (at_a.size + at_b.size) : null);
    const thin = link ? link.thin : [a, b].some((spc) => spaceEffort(NETWORK_DATA, spc.id, group_id).low);

    const title = el("h2", "panel-title panel-title-small");
    [a, b].forEach((spc, i) => {
        if (i) title.append(" ↔ ");
        const name = el("a", null, shortName(spc));
        name.dataset.space = spc.id;
        name.href = hashFor({ tab: group_id, space: spc.id });
        title.appendChild(name);
    });
    const alike = similarity !== null && !thin && shared.length > 0 ? ` · ${Math.round(similarity * 100)}% alike at equal effort` : "";
    const parts = [
        backButton("← All spaces", () => go({ tab: group_id })),
        title,
        el("p", "panel-lede", `${shared.length} native ${label} seen at both${alike}.`),
    ];
    const fewest = [a, b].map((spc) => ({ spc, ...spaceEffort(NETWORK_DATA, spc.id, group_id) })).sort((x, y) => x.obs - y.obs)[0];
    if (fewest.low) {
        const note = dataFlag(fewest.spc, group_id, fewest.obs);
        note.classList.add("comparison-caveat");
        parts.push(note);
    }

    // Two columns: both headings on one grid row (so they line up when a long name wraps),
    // then each space's own species
    const columns = el("div", "network-columns");
    const own = [[a, only_a], [b, only_b]];
    own.forEach(([spc, ids]) => {
        const h = el("h4", null, `Only at ${shortName(spc)}`);
        h.appendChild(el("span", "network-column-count", `${ids.length} of ${(NETWORK_DATA.by_space[spc.id]?.[group_id] || []).length} species`));
        columns.appendChild(h);
    });
    own.forEach(([spc, ids]) => {
        const ul = el("ul", "species-list");
        sortedSpecies(ids).forEach((id) => ul.appendChild(networkSpeciesItem(id, "li", ebirdOnly(spc.id, group_id, id) ? "eBird only" : "", spc, group_id)));
        if (ids.length === 0) ul.appendChild(el("li", "panel-hint", "None"));
        columns.appendChild(ul);
    });
    parts.push(columns);
    if (shared.length > 0) parts.push(speciesDetails("Seen at both", shared, null, group_id));
    return parts;
}

function panelFor(s) {
    if (s.pair) return comparisonView(byId[s.pair[0]], byId[s.pair[1]], s.tab);
    if (s.space) return spaceView(byId[s.space], s.tab);
    return groupView(s.tab);
}

let rendered_key = null;
function renderPanel() {
    const key = hashFor(state);
    if (key === rendered_key) return;
    rendered_key = key;
    panel.replaceChildren(...panelFor(state));
    panel.scrollTop = 0;
}

// ---------- Map ----------

const marker_parts = {}; // space id -> { wrap, outline }

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
    document.querySelectorAll('#panel-tabs [role="tab"]').forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
    if (network) {
        network.show(state.tab);
        network.select(state.space, state.pair);
    }
    // The selected space's dot and outline stay highlighted
    Object.entries(marker_parts).forEach(([id, parts]) => {
        const on = id === state.space || (state.pair || []).includes(id);
        parts.wrap.classList.toggle("is-selected", on);
        parts.outline?.eachLayer((layer) => layer.getElement()?.classList.toggle("selected", on));
    });
    renderPanel();
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
    return wrap;
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

// The panel header: one toggle with a tab per species group. Spaces are picked on the map or
// from the overview's list.
function buildTabs() {
    const tabs = document.getElementById("panel-tabs");
    const options = el("div", "segmented");
    options.setAttribute("role", "tablist");
    options.setAttribute("aria-label", "Species group");
    TABS.forEach((t) => {
        const b = el("button", null, t.label);
        b.type = "button";
        b.role = "tab";
        b.id = "tab-" + t.id;
        b.dataset.tab = t.id;
        b.setAttribute("aria-controls", "panel-content");
        // Switching groups keeps the selected space or pair, so you can compare its groups
        b.addEventListener("click", () => { if (t.id !== state.tab) go({ tab: t.id, space: state.space, pair: state.pair }); });
        options.appendChild(b);
    });
    tabs.appendChild(options);
    // Left/right arrows move between the tabs, as screen-reader users expect of a tab list
    tabs.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const buttons = [...tabs.querySelectorAll('[role="tab"]')];
        const i = buttons.indexOf(document.activeElement);
        if (i < 0) return;
        const next = buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length];
        next.focus();
        next.click();
        e.preventDefault();
    });
}

function buildMap() {
    // Scroll to zoom toward the pointer; quarter-level steps keep it smooth
    const map = L.map(map_el, { scrollWheelZoom: true, zoomSnap: 0.25, wheelPxPerZoomLevel: 90 });
    // Esri hybrid: World Imagery satellite photos with transparent road and place-name overlays.
    // Esri-style tile services, so the URLs are z/y/x
    const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
    L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 18,
        attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    }).addTo(map);
    L.tileLayer(ESRI + "Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 }).addTo(map);
    L.tileLayer(ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 18,
        attribution: "Labels &copy; Esri",
    }).addTo(map);

    const boundaries = window.SPACE_BOUNDARIES || {};
    const frame = L.latLngBounds(located.map((spc) => spc.location));
    const selectSpace = (spc) => {
        go({ tab: state.tab, space: spc.id });
        revealPanel();
    };

    located.forEach((spc) => {
        let outline = null;
        if (boundaries[spc.id]) {
            outline = L.geoJSON(boundaries[spc.id], { style: { className: "space-boundary" }, interactive: true }).addTo(map);
            outline.on("click", (e) => { L.DomEvent.stopPropagation(e); selectSpace(spc); });
            frame.extend(outline.getBounds());
        }

        const wrap = makeMarker(spc);
        L.marker(spc.location, {
            icon: L.divIcon({ className: "map-marker", html: wrap, iconSize: [20, 20], iconAnchor: [10, 10] }),
            riseOnHover: true,
            keyboard: false, // the link inside the marker is the focus target
        }).addTo(map);
        const card = wrap.firstChild;
        marker_parts[spc.id] = { wrap, outline };

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

    // Frame every space and its boundary, with room for the name beside each dot
    let fitting = false;
    let user_moved = false; // once someone pans or zooms, resizes stop re-framing the map
    const fit = () => {
        const narrow = map_el.clientWidth < 600;
        fitting = true;
        map.fitBounds(frame, {
            paddingTopLeft: narrow ? [24, 30] : [50, 40],
            paddingBottomRight: narrow ? [70, 24] : [50, 30], // phones keep the labels off the right edge
            maxZoom: 16,
            animate: false,
        });
        fitting = false;
    };
    fit();
    map.on("dragstart zoomstart", () => { if (!fitting) user_moved = true; });
    let last_size = map.getSize();
    window.addEventListener("resize", () => {
        const size = map.getSize();
        if (size.x === last_size.x && size.y === last_size.y) return;
        last_size = size;
        if (!user_moved) fit();
    });

    if (typeof createNetwork === "function") {
        network = createNetwork(map, located, NETWORK_DATA, {
            onPairClick: (a, b, group) => {
                go({ tab: group, pair: [a.id, b.id] });
                revealPanel();
            },
        });
    }

    // Clicking empty map (not a space, a line, or the end of a drag) steps out of a selection
    map.on("click", () => {
        if (state.pair || state.space) go({ tab: state.tab });
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
    buildTabs();
    buildMap();
    state = parseHash();
    go(state, false);
}
