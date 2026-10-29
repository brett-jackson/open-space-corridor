// Landing page: the corridor map, its side panel, and the view state in the URL.
//
// The view is one of: a tab ("signature" or a species group), optionally with a selected
// space or a selected link between two spaces. It lives in the URL hash so views can be
// shared and the browser's Back button steps through them:
//
//   #signature                      overview: hover a space for a preview
//   #signature/metzger              a space's summary: signature species and connections
//   #birds                          the birds network and its overview
//   #birds/metzger                  one space's links in the birds network
//   #birds/broomfield~metzger       the comparison for one link
//
// Clicking a space selects it (so it works on touch screens too); the summary's "Explore"
// button opens the space's own page. Clicking empty map steps back out of a selection.

const grid = document.getElementById("grid");
const map_el = document.getElementById("space-map");
const panel = document.getElementById("panel-content");
const spaces = window.SPACES || [];
const located = spaces.filter((spc) => Array.isArray(spc.location) && spc.location.length === 2);
const byId = Object.fromEntries(spaces.map((spc) => [spc.id, spc]));
const TABS = [{ id: "signature", label: "Signature Species" }, ...NETWORK_DATA.groups];

let state = { tab: "signature", space: null, pair: null };
let network = null;
let preview_space = null; // hovered (not selected) space shown in the Signature Species panel

// ---------- URL state ----------

const DEFAULT_TAB = TABS.some((t) => t.id === "birds") ? "birds" : "signature"; // birds have the most complete data

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
        if (byId[a] && byId[b] && s.tab !== "signature") s.pair = [a, b];
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

// ---------- Panel views ----------

function exploreButton(spc) {
    const a = el("a", "panel-explore", `Explore ${shortName(spc)} →`);
    a.href = spaceHref(spc);
    return a;
}

function backButton(text, onClick) {
    const b = el("button", "panel-back", text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
}

function spaceHeader(spc) {
    const parts = [el("h2", "panel-title", spc.title)];
    if (spc.subtitle) parts.push(el("p", "panel-subtitle", spc.subtitle));
    parts.push(exploreButton(spc));
    return parts;
}

// Signature tab, nothing selected
function hintView() {
    const touch = matchMedia("(hover: none)").matches;
    return [el("p", "panel-hint", touch
        ? "Tap an open space to see its signature species and connections."
        : "Hover over an open space for a preview, or click one to see its signature species and connections.")];
}

// Signature tab, a space selected (or previewed on hover)
function spaceSummaryView(spc) {
    const parts = [...spaceHeader(spc), ...signatureSection(spc)];
    if (NETWORK_DATA.groups.length > 0) {
        parts.push(el("h3", "panel-heading", "Connections"));
        parts.push(el("p", "panel-lede", "Similarities between this space and neighboring spaces."));
        const ul = el("ul", "connection-groups");
        NETWORK_DATA.groups.forEach((g) => {
            const links = connectionsOf(spc, located, g.id);
            const best = links.find((c) => !c.link.gap) || links.find((c) => c.link.shared > 0);
            const row = el("a", "connection connection-group net-" + g.id);
            row.href = hashFor({ tab: g.id, space: spc.id });
            row.appendChild(el("span", "connection-name", g.label));
            row.appendChild(el("span", "connection-detail", best
                ? `Most like ${shortName(best.other)} (${Math.round(best.link.similarity * 100)}%${best.link.thin ? ", few records" : ""})`
                : "More data needed"));
            const li = el("li");
            li.appendChild(row);
            ul.appendChild(li);
        });
        parts.push(ul);
    }
    return parts;
}

// A network tab's overview: what the map shows, and every space's species and effort
function groupView(group_id) {
    const label = groupLabel(group_id).toLowerCase();
    const parts = [
        el("h3", "panel-heading", "Native " + groupLabel(group_id)),
        el("p", "panel-lede", `Open spaces are linked together in a natural network. Thicker lines mean more of their native ${label} overlap. Click a space or a line to explore.`),
    ];

    const ol = el("ol", "network-counts");
    located
        .map((spc) => ({ spc, n: (NETWORK_DATA.by_space[spc.id]?.[group_id] || []).length, ...spaceEffort(NETWORK_DATA, spc.id, group_id) }))
        .sort((x, y) => y.n - x.n || y.obs - x.obs)
        .forEach(({ spc, n, obs, low }) => {
            const a = el("a", "network-count-row");
            a.dataset.space = spc.id;
            a.href = hashFor({ tab: group_id, space: spc.id });
            a.append(el("span", null, shortName(spc)), el("span", "network-count", `${n} species · ${obs.toLocaleString()} records`));
            const li = el("li");
            li.appendChild(a);
            if (low) {
                const flag = el("a", "network-flag", obs === 0 ? `Be the first to record ${label} here →` : "More data needed →");
                flag.href = helpHref(spc);
                li.appendChild(flag);
            }
            ol.appendChild(li);
        });
    parts.push(ol);
    return parts;
}

// A network tab with a space selected: its links in this group
function spaceInGroupView(spc, group_id) {
    return [
        backButton("← All spaces", () => go({ tab: group_id })),
        ...spaceHeader(spc),
        el("h3", "panel-heading", "Native " + groupLabel(group_id)),
        effortLine(spc, group_id),
        connectionsList(spc, located, group_id, (other) => hashFor({ tab: group_id, pair: [spc.id, other.id] })),
    ];
}

// A network tab with a link selected: one row per species seen at either space, with a gap
// on the side where it hasn't been seen. Shared species first, then each space's own.
function comparisonView(a, b, group_id) {
    const at_a = new Set(NETWORK_DATA.by_space[a.id]?.[group_id] || []);
    const at_b = new Set(NETWORK_DATA.by_space[b.id]?.[group_id] || []);
    const shared = [...at_a].filter((id) => at_b.has(id));
    const only_a = [...at_a].filter((id) => !at_b.has(id));
    const only_b = [...at_b].filter((id) => !at_a.has(id));
    const label = groupLabel(group_id).toLowerCase();
    const similarity = at_a.size + at_b.size > 0 ? Math.round(((2 * shared.length) / (at_a.size + at_b.size)) * 100) : 0;

    const title = el("h2", "panel-title panel-title-small");
    [a, b].forEach((spc, i) => {
        if (i) title.append(" ↔ ");
        const link = el("a", null, shortName(spc));
        link.dataset.space = spc.id;
        link.href = hashFor({ tab: group_id, space: spc.id });
        title.appendChild(link);
    });
    const lede = el("p", "panel-lede",
        `${shared.length} native ${label} seen at both · ${only_a.length} only at ${shortName(a)} · ` +
        `${only_b.length} only at ${shortName(b)} (${similarity}% similar).`);

    const columns = el("div", "network-columns");
    // Column headings: the site's name, then its species count on a line of its own, so both
    // columns line up whether or not a long name wraps
    [[a, at_a], [b, at_b]].forEach(([spc, ids]) => {
        const h = el("h4", null, shortName(spc));
        h.appendChild(el("span", "network-column-count", `${ids.size} species`));
        columns.appendChild(h);
    });
    const gap = (where) => {
        const g = el("div", "network-gap");
        g.setAttribute("role", "img");
        g.setAttribute("aria-label", "Not seen at " + where);
        return g;
    };
    [
        ["Seen at both", shared, true, true],
        [`Only at ${shortName(a)}`, only_a, true, false],
        [`Only at ${shortName(b)}`, only_b, false, true],
    ].forEach(([heading, ids, left, right]) => {
        if (ids.length === 0) return;
        columns.appendChild(el("div", "network-section", `${heading} (${ids.length})`));
        sortedSpecies(ids).forEach((id) => {
            const via = (spc) => (ebirdOnly(spc.id, group_id, id) ? "eBird only" : "");
            columns.appendChild(left ? networkSpeciesItem(id, "div", via(a), a, group_id) : gap(shortName(a)));
            columns.appendChild(right ? networkSpeciesItem(id, "div", via(b), b, group_id) : gap(shortName(b)));
        });
    });
    const parts = [backButton("← All spaces", () => go({ tab: group_id })), title, lede];
    const fewest = [a, b].map((spc) => ({ spc, ...spaceEffort(NETWORK_DATA, spc.id, group_id) })).sort((x, y) => x.obs - y.obs)[0];
    if (fewest.low) {
        const note = el("a", "network-flag comparison-caveat", "More data needed →");
        note.href = helpHref(fewest.spc);
        parts.push(note);
    }
    return [...parts, columns];
}

function panelFor(s) {
    if (s.tab === "signature") {
        const spc = byId[s.space] || byId[preview_space];
        return spc ? spaceSummaryView(spc) : hintView();
    }
    if (s.pair) return comparisonView(byId[s.pair[0]], byId[s.pair[1]], s.tab);
    if (s.space) return spaceInGroupView(byId[s.space], s.tab);
    return groupView(s.tab);
}

let rendered_key = null;
function renderPanel() {
    const key = hashFor(state) + "|" + (state.tab === "signature" && !state.space ? preview_space : "");
    if (key === rendered_key) return;
    rendered_key = key;
    panel.replaceChildren(...panelFor(state));
    panel.scrollTop = 0;
}

// ---------- Map ----------

const marker_parts = {}; // space id -> { wrap, card, outline }

// Highlight a space on the map as if it were hovered: its outline lights up, its marker or
// dot is ringed, and in a corridor view only its links stay bright
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
    document.querySelectorAll("#panel-tabs .site-options button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.space === state.space)));
    if (network) {
        map_el.classList.toggle("network-mode", state.tab !== "signature");
        if (state.tab === "signature") network.hide();
        else {
            network.show(state.tab);
            network.select(state.space, state.pair);
        }
    }
    // The selected space's marker and outline stay highlighted
    Object.entries(marker_parts).forEach(([id, parts]) => {
        const on = id === state.space || (state.pair || []).includes(id);
        parts.wrap.classList.toggle("is-selected", on);
        parts.outline?.eachLayer((layer) => layer.getElement()?.classList.toggle("selected", on));
    });
    renderPanel();
}

function makeMarker(spc) {
    const a = el("a", "map-card");
    a.href = spaceHref(spc);
    a.setAttribute("aria-label", `${spc.title}: show summary`);
    a.appendChild(spc.image ? Object.assign(el("img"), { src: spc.image, alt: "" }) : el("div", "placeholder"));
    const body = el("div", "map-card-body");
    body.appendChild(el("h2", null, spc.title));
    if (spc.description) body.appendChild(el("p", null, spc.description));
    a.appendChild(body);
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

// The panel header: a "Corridors" toggle with one tab per species group, and a "Sites" row
// with one button per space. Hovering a site highlights it on the map; clicking selects it
// and shows its summary (signature species and connections).
function buildTabs() {
    const tabs = document.getElementById("panel-tabs");
    const makeTab = (t) => {
        const b = el("button", null, t.label);
        b.type = "button";
        b.role = "tab";
        b.id = "tab-" + t.id;
        b.dataset.tab = t.id;
        b.setAttribute("aria-controls", "panel-content");
        // Switching tabs keeps the selected space, so you can compare its groups
        b.addEventListener("click", () => { if (t.id !== state.tab) go({ tab: t.id, space: state.space }); });
        return b;
    };
    if (NETWORK_DATA.groups.length > 0) {
        const corridors = el("div", "corridor-toggle");
        const label = el("span", "corridor-toggle-label", "Corridors");
        label.id = "corridors-label";
        const options = el("div", "segmented");
        options.setAttribute("role", "group");
        options.setAttribute("aria-labelledby", "corridors-label");
        NETWORK_DATA.groups.forEach((g) => options.appendChild(makeTab(g)));
        corridors.append(label, options);
        tabs.appendChild(corridors);
    }
    const sites = el("div", "corridor-toggle site-toggle");
    const sites_label = el("span", "corridor-toggle-label", "Sites");
    sites_label.id = "sites-label";
    const site_options = el("div", "segmented site-options");
    site_options.setAttribute("role", "group");
    site_options.setAttribute("aria-labelledby", "sites-label");
    located.forEach((spc) => {
        const b = el("button", null, shortName(spc));
        b.type = "button";
        b.dataset.space = spc.id; // also highlights the site on the map while hovered (panelHover)
        b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", () => go({ tab: "signature", space: spc.id }));
        site_options.appendChild(b);
    });
    sites.append(sites_label, site_options);
    tabs.appendChild(sites);
    tabs.addEventListener("pointerover", panelHover);
    tabs.addEventListener("focusin", panelHover);
    tabs.addEventListener("pointerleave", () => panelHover({ target: tabs }));
    tabs.addEventListener("focusout", (e) => { if (!tabs.contains(e.relatedTarget)) panelHover({ target: tabs }); });
    // Left/right arrows move between the corridor tabs, as screen-reader users expect of a tab list
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

    const EXPANDED_CARD = { w: 260, h: 250 }; // matches .map-card:hover in styles.css
    const boundaries = window.SPACE_BOUNDARIES || {};
    const frame = L.latLngBounds(located.map((spc) => spc.location));
    const selectSpace = (spc) => go({ tab: state.tab, space: spc.id });

    located.forEach((spc) => {
        let outline = null;
        if (boundaries[spc.id]) {
            outline = L.geoJSON(boundaries[spc.id], { style: { className: "space-boundary" }, interactive: true }).addTo(map);
            outline.on("click", (e) => { L.DomEvent.stopPropagation(e); selectSpace(spc); });
            frame.extend(outline.getBounds());
        }

        const wrap = makeMarker(spc);
        L.marker(spc.location, {
            icon: L.divIcon({ className: "map-marker", html: wrap, iconSize: [64, 64], iconAnchor: [32, 64] }),
            riseOnHover: true,
            keyboard: false, // the link inside the marker is the focus target
        }).addTo(map);
        const card = wrap.firstChild;
        marker_parts[spc.id] = { wrap, card, outline };

        // A click selects the space instead of leaving the page; "Explore" opens its page
        card.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            selectSpace(spc);
        });

        // Before a card expands, keep it inside the map: slide it sideways off the edges,
        // and grow it downward from the thumbnail when there isn't room above the pin
        const placeCard = () => {
            if (map_el.classList.contains("network-mode")) {
                wrap.classList.remove("down"); // compact dots never expand, so stay centered
                return;
            }
            const pt = map.latLngToContainerPoint(spc.location);
            const half = EXPANDED_CARD.w / 2 + 8;
            const shift = Math.max(half - pt.x, Math.min(0, map_el.clientWidth - half - pt.x));
            card.style.setProperty("--shift-x", shift + "px");
            wrap.classList.toggle("down", pt.y < EXPANDED_CARD.h + 16);
        };

        // Hover previews: the panel (when nothing is selected), the outline and the space's links
        const enter = () => {
            placeCard();
            highlightSpace(spc.id, true);
            if (state.tab === "signature" && !state.space) {
                preview_space = spc.id;
                renderPanel();
            }
        };
        const leave = () => highlightSpace(spc.id, false);
        card.addEventListener("pointerenter", enter);
        card.addEventListener("focus", enter);
        card.addEventListener("pointerleave", leave);
        card.addEventListener("blur", leave);
        outline?.on("mouseover", enter);
        outline?.on("mouseout", leave);
    });

    // Frame every space and its boundary, with room for the markers to expand
    // Narrow maps need less side padding, and phones keep marker labels off the right edge
    let fitting = false;
    let user_moved = false; // once someone pans or zooms, resizes stop re-framing the map
    const fit = () => {
        const narrow = map_el.clientWidth < 600;
        fitting = true;
        map.fitBounds(frame, {
            paddingTopLeft: narrow ? [24, 80] : [50, 90], // room for the resting markers, which sit above their pins
            paddingBottomRight: narrow ? [70, 24] : [50, 30],
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

    if (typeof createNetwork === "function" && NETWORK_DATA.groups.length > 0) {
        network = createNetwork(map, located, NETWORK_DATA, {
            onPairClick: (a, b, group) => go({ tab: group, pair: [a.id, b.id] }),
        });
    }

    // Clicking empty map (not a space, a line, or the end of a drag) steps out of a selection
    map.on("click", () => {
        if (state.pair) go({ tab: state.tab });
        else if (state.space) go({ tab: state.tab });
    });
}

// ---------- Start ----------

if (spaces.length === 0) {
    const msg = el("p", "empty", "No spaces found.");
    grid.replaceWith(msg);
    useListLayout();
} else if (typeof L === "undefined" || located.length === 0) {
    // No map library (e.g. offline) or no coordinates: show the plain card grid, north to south
    useListLayout();
    [...spaces].sort((a, b) => (b.location?.[0] ?? 0) - (a.location?.[0] ?? 0)).forEach((spc) => grid.appendChild(makeCard(spc)));
} else {
    grid.remove();
    buildTabs();
    buildMap();
    state = parseHash();
    go(state, false);
}
