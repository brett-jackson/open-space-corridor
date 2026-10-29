// Corridor networks, one species group at a time (data: js/species_network.js).
//
// corridorLinks() works out which spaces are linked and how similar they are; it needs no
// map, so space pages use it too. createNetwork() draws it on the landing page map: each
// space gets a halo sized by how many native species of the group it has, and neighboring
// spaces (each space's nearest few) are joined by one line whose thickness is their Sørensen
// similarity, 2 × shared / (A's species + B's species). Dots drift along each line in both
// directions. Dashed halos and lines mark where more observations are needed.

const NETWORK_BEND = 0.14;        // curve height as a fraction of the distance between spaces
const NETWORK_STEPS = 28;         // samples along each curve
const NETWORK_LOW_EFFORT = 30;    // fewer observations of a group than this: "more data needed"

const LINK_NEIGHBORS = 3;         // join each space to its nearest few spaces
const LINK_MIN_WEIGHT = 2;        // px, for a single shared species
const LINK_MAX_WEIGHT = 14;       // px, for identical species lists
const HALO_MIN_RADIUS = 13;       // px, just outside the 20 px marker dot
const HALO_MAX_RADIUS = 30;       // px, for the space with the most species in the group

function spaceDistanceKm(a, b) {
    const dlat = (a.location[0] - b.location[0]) * 111.32;
    const dlng = (a.location[1] - b.location[1]) * 111.32 * Math.cos((a.location[0] * Math.PI) / 180);
    return Math.hypot(dlat, dlng);
}

// Every linked pair for a group: each space joined to its nearest few, as unordered pairs.
// Each link: { a, b, shared, sizeA, sizeB, similarity (0-1, or null when either list is
// empty), thin: either space has too few observations of the group for the similarity to
// mean much, gap: the pair can't be compared, shares nothing yet, or is thin (drawn dashed),
// selectable: at least one space has species, so the comparison has something to show }
function corridorLinks(spaces, data, group) {
    const speciesAt = (spc) => new Set(data.by_space[spc.id]?.[group] || []);
    const pairs = new Map();
    spaces.forEach((a) => {
        spaces.filter((b) => b !== a)
            .sort((x, y) => spaceDistanceKm(a, x) - spaceDistanceKm(a, y))
            .slice(0, LINK_NEIGHBORS)
            .forEach((b) => {
                const [p, q] = a.id < b.id ? [a, b] : [b, a];
                pairs.set(p.id + "|" + q.id, [p, q]);
            });
    });
    return [...pairs.values()].map(([a, b]) => {
        const sa = speciesAt(a), sb = speciesAt(b);
        const shared = [...sa].filter((id) => sb.has(id)).length;
        const comparable = sa.size > 0 && sb.size > 0;
        const thin = spaceEffort(data, a.id, group).low || spaceEffort(data, b.id, group).low;
        return {
            a, b, shared, thin,
            sizeA: sa.size,
            sizeB: sb.size,
            similarity: comparable ? (2 * shared) / (sa.size + sb.size) : null,
            gap: !comparable || shared === 0 || thin,
            selectable: sa.size + sb.size > 0,
        };
    });
}

// Observations of the group at a space, and whether that's too few to say much yet
function spaceEffort(data, space_id, group) {
    const obs = data.observations?.[space_id]?.[group] ?? 0;
    return { obs, low: obs < NETWORK_LOW_EFFORT };
}

function createNetwork(map, spaces, data, handlers) {
    const layer = L.layerGroup();
    let group = null;
    let items = [];             // { el: layer, a, b, kind } for focus styling
    let focused_space = null;   // a hovered space: only its connections stay bright
    let focused_pair = null;    // a hovered connection: only that pair stays bright
    let selected_space = null;  // the clicked space: its connections glow, the rest dims
    let selected_pair = null;   // the clicked connection: it glows, the rest dims

    function applyFocus() {
        const touches = (set, a, b, kind) => (kind === "node" ? set.has(a.id) : set.has(a.id) && set.has(b.id));
        items.forEach(({ el, a, b, kind }) => {
            const node = el.getElement();
            if (!node) return;
            let state = "";
            if (focused_pair) {
                state = touches(focused_pair, a, b, kind) ? "is-out" : "is-dim";
            } else if (focused_space) {
                if (kind === "node") state = a.id === focused_space ? "is-out" : "is-dim";
                else state = a.id === focused_space || b.id === focused_space ? "is-out" : "is-dim";
            } else if (selected_pair) {
                state = touches(selected_pair, a, b, kind) ? "is-selected" : "is-muted";
            } else if (selected_space) {
                const on = kind === "node" ? a.id === selected_space : a.id === selected_space || b.id === selected_space;
                state = on ? "is-selected" : "is-muted";
            }
            node.classList.remove("is-out", "is-dim", "is-selected", "is-muted");
            if (state) node.classList.add(state);
        });
    }

    function hoverPair(target, a, b) {
        target.on("mouseover", () => { focused_pair = new Set([a.id, b.id]); applyFocus(); });
        target.on("mouseout", () => { focused_pair = null; applyFocus(); });
    }

    // Point at t on the quadratic curve p0 -> p2 with control point c, in layer pixels
    function curvePoint(p0, c, p2, t) {
        const u = 1 - t;
        return L.point(u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, u * u * p0.y + 2 * u * t * c.y + t * t * p2.y);
    }

    function controlPoint(pa, pb) {
        const dist = pa.distanceTo(pb) || 1;
        return L.point((pa.x + pb.x) / 2 - ((pb.y - pa.y) / dist) * dist * NETWORK_BEND,
                       (pa.y + pb.y) / 2 + ((pb.x - pa.x) / dist) * dist * NETWORK_BEND);
    }

    // Points along the curve, shifted sideways by `offset` px (positive = right of travel)
    function curveLine(pa, c, pb, t0, t1, offset = 0) {
        const pts = [];
        for (let i = 0; i <= NETWORK_STEPS; i++) {
            const t = t0 + (t1 - t0) * (i / NETWORK_STEPS);
            const p = curvePoint(pa, c, pb, t), q = curvePoint(pa, c, pb, Math.min(1, t + 0.001));
            const len = p.distanceTo(q) || 1;
            pts.push(L.point(p.x - ((q.y - p.y) / len) * offset, p.y + ((q.x - p.x) / len) * offset));
        }
        return pts;
    }

    const toLatLngs = (pts) => pts.map((p) => map.layerPointToLatLng(p));

    function draw() {
        layer.clearLayers();
        items = [];
        if (!group) return;
        const counts = spaces.map((spc) => (data.by_space[spc.id]?.[group] || []).length);
        const max = Math.max(1, ...counts);
        const label = (data.groups.find((g) => g.id === group)?.label || "species").toLowerCase();

        corridorLinks(spaces, data, group).forEach(({ a, b, shared, similarity, thin, gap, selectable }) => {
            const pa = map.latLngToLayerPoint(a.location), pb = map.latLngToLayerPoint(b.location);
            const c = controlPoint(pa, pb);
            const t0 = Math.min(0.4, HALO_MIN_RADIUS / (pa.distanceTo(pb) || 1));
            const line = curveLine(pa, c, pb, t0, 1 - t0);

            let tip, weight;
            if (similarity === null) {
                tip = `${a.title} ↔ ${b.title}: too few observations to compare yet`;
                weight = 1.5;
            } else if (thin) {
                // Tentative: drawn dashed, but still as thick as its similarity so its strength shows
                tip = `${a.title} ↔ ${b.title}: ${shared} shared ${label} · ${Math.round(similarity * 100)}% similar, from few records`;
                weight = shared === 0 ? 1.5 : LINK_MIN_WEIGHT + similarity * (LINK_MAX_WEIGHT - LINK_MIN_WEIGHT);
            } else if (shared === 0) {
                tip = `${a.title} ↔ ${b.title}: no shared ${label} recorded yet`;
                weight = 1.5;
            } else {
                tip = `${a.title} ↔ ${b.title}: ${shared} shared ${label} · ${Math.round(similarity * 100)}% similar`;
                weight = LINK_MIN_WEIGHT + similarity * (LINK_MAX_WEIGHT - LINK_MIN_WEIGHT);
            }
            const cls = `net-link${gap ? " is-gap" : ""}${thin && shared > 0 ? " is-thin" : ""}${selectable ? "" : " is-unselectable"} net-${group}`;
            const link = L.polyline(toLatLngs(line), { className: cls, weight, interactive: true })
                .bindTooltip(tip, { sticky: true, className: "net-tooltip" })
                .addTo(layer);
            if (selectable) {
                link.on("click", (e) => {
                    L.DomEvent.stopPropagation(e); // so the map's own click handler doesn't clear it
                    link.getElement()?.blur(); // the glow marks the selection, not the browser's focus box
                    handlers.onPairClick(a, b, group);
                });
            }
            hoverPair(link, a, b);
            items.push({ el: link, a, b, kind: "link" });

            // Drifting dots in both directions, on either side of the line
            if (!gap) {
                [[pa, pb, 1], [pb, pa, -1]].forEach(([from, to, side]) => {
                    const flow = curveLine(from, c, to, t0, 1 - t0, (side * -weight) / 4);
                    const dots = L.polyline(toLatLngs(flow), { className: `net-flow net-${group}`, weight: 2.5, interactive: false }).addTo(layer);
                    items.push({ el: dots, a, b, kind: "link" });
                });
            }
        });

        // Halos: size = native species seen; dashed = few observations of this group so far
        spaces.forEach((spc, i) => {
            const n = counts[i];
            const radius = n === 0 ? HALO_MIN_RADIUS : HALO_MIN_RADIUS + Math.sqrt(n / max) * (HALO_MAX_RADIUS - HALO_MIN_RADIUS);
            const halo = L.circleMarker(spc.location, {
                radius,
                className: `net-node net-${group}` + (spaceEffort(data, spc.id, group).low ? " needs-data" : "") + (n === 0 ? " is-empty" : ""),
                interactive: false,
            }).addTo(layer);
            items.push({ el: halo, a: spc, b: spc, kind: "node" });
        });
        applyFocus();
    }

    // Shapes are sized in screen pixels, so they're rebuilt whenever the zoom changes
    map.on("zoomend viewreset", draw);

    return {
        show(group_id) {
            if (group !== group_id) {
                group = group_id;
                layer.addTo(map);
                draw();
            }
        },
        hide() {
            group = null;
            items = [];
            layer.clearLayers();
            layer.remove();
        },
        // Persistent selection (from a click or the URL): one space, one pair, or nothing
        select(space_id, pair_ids) {
            selected_space = pair_ids ? null : space_id || null;
            selected_pair = pair_ids ? new Set(pair_ids) : null;
            applyFocus();
        },
        // Hover highlight of one space's connections (null clears it)
        focus(space_id) {
            focused_space = space_id;
            applyFocus();
        },
    };
}
