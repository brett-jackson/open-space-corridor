// Space page: where this space sits in the corridor. Fills the sidebar's mini map (every
// space's boundary, this one highlighted), the Signature Species section, and the Corridor
// Connections section, whose rows open that comparison on the landing page map. Needs
// SPACE (space.html), js/panels.js, js/network.js and, for the map, Leaflet and
// js/boundaries.js.

(function () {
    const all_spaces = (window.SPACES || []).filter((spc) => Array.isArray(spc.location) && spc.location.length === 2);
    const landing = (hash) => "index.html#" + hash;

    // "← All open spaces" returns to the map with this space selected
    document.querySelector(".sidebar .back")?.setAttribute("href", landing("signature/" + SPACE.id));

    // Signature Species: the section supplies its own heading
    const signature = document.getElementById("signature-list");
    if (signature) signature.replaceChildren(...signatureSection(SPACE).slice(1));

    // Corridor Connections: one block per species group
    const body = document.getElementById("connections-body");
    if (body) {
        const blocks = NETWORK_DATA.groups.map((g) => {
            const block = el("div", "connections-block");
            const heading = el("h3", "connections-heading net-" + g.id);
            const link = el("a", null, "Native " + g.label);
            link.href = landing(g.id + "/" + SPACE.id);
            heading.appendChild(link);
            block.append(
                heading,
                effortLine(SPACE, g.id),
                connectionsList(SPACE, all_spaces, g.id, (other) => landing(`${g.id}/${SPACE.id}~${other.id}`)),
            );
            return block;
        });
        const intro = el("p", "panel-lede",
            "How many of the native species seen here have also been seen at each of its nearest neighbors. " +
            "Open spaces that share species may help wildlife move along the corridor.");
        body.replaceChildren(intro, ...blocks);
    }

    // Sidebar mini map: every space's boundary, this one highlighted; others link to their pages
    const map_el = document.getElementById("corridor-map");
    const boundaries = window.SPACE_BOUNDARIES || {};
    if (!map_el || typeof L === "undefined" || !boundaries[SPACE.id]) {
        map_el?.remove();
        return;
    }
    const map = L.map(map_el, {
        zoomControl: false,
        attributionControl: false, // credited in the caption under the map
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
    });
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 18 }).addTo(map);

    const frame = L.latLngBounds([]);
    all_spaces.forEach((spc) => {
        if (!boundaries[spc.id]) return;
        const here = spc.id === SPACE.id;
        const shape = L.geoJSON(boundaries[spc.id], { style: { className: "corridor-shape" + (here ? " is-here" : "") }, interactive: !here }).addTo(map);
        if (!here) {
            shape.bindTooltip(shortName(spc), { className: "net-tooltip", direction: "top" });
            shape.on("click", () => { location.href = spaceHref(spc); });
        }
        frame.extend(shape.getBounds());
    });
    map.fitBounds(frame, { padding: [10, 10] });
})();
