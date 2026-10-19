// Network overlays for the landing page map, one species group at a time (data:
// js/species_network.js). Each space gets a halo sized by how many native species of the
// group it has, and neighboring spaces (each space's nearest few) are joined by one line
// whose thickness is their Sørensen similarity, 2 × shared / (A's species + B's species).
// Dots drift along each line in both directions. Dashed halos and lines mark where more
// observations are needed.

const NETWORK_BEND = 0.14;        // curve height as a fraction of the distance between spaces
const NETWORK_STEPS = 28;         // samples along each curve
const NETWORK_LOW_EFFORT = 30;    // fewer observations of a group than this: "more data needed"

const LINK_NEIGHBORS = 3;         // join each space to its nearest few spaces
const LINK_MIN_WEIGHT = 2;        // px, for a single shared species
const LINK_MAX_WEIGHT = 14;       // px, for identical species lists
const HALO_MIN_RADIUS = 13;       // px, just outside the 20 px marker dot
const HALO_MAX_RADIUS = 30;       // px, for the space with the most species in the group


function createNetwork(map, spaces, data, onPairClick) {
    const layer = L.layerGroup();
    let group = null;
    let items = [];           // { el: layer, a, b, kind } for focus styling
    let focused_space = null; // a hovered space: only its connections stay bright
    let focused_pair = null;  // a hovered connection: only that pair stays bright
    let selected_pair = null; // the clicked connection, shown in the panel: it glows, the rest dims

    function speciesAt(spc) {
        return new Set(data.by_space[spc.id]?.[group] || []);
    }

    function effortAt(spc) {
        return data.observations?.[spc.id]?.[group] ?? 0;
    }

    function applyFocus() {
        items.forEach(({ el, a, b, kind }) => {
            const node = el.getElement();
            if (!node) return;
            let state = "";
            if (focused_pair) {
                const on = kind === "node" ? focused_pair.has(a.id) : focused_pair.has(a.id) && focused_pair.has(b.id);
                state = on ? "is-out" : "is-dim";
            } else if (focused_space) {
                if (kind === "node") state = a.id === focused_space ? "is-out" : "is-dim";
                else state = a.id === focused_space || b.id === focused_space ? "is-out" : "is-dim";
            } else if (selected_pair) {
                const on = kind === "node" ? selected_pair.has(a.id) : selected_pair.has(a.id) && selected_pair.has(b.id);
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

    // Each space's nearest few other spaces, as unique unordered pairs
    function neighborPairs() {
        const km = (a, b) => {
            const dlat = (a.location[0] - b.location[0]) * 111.32;
            const dlng = (a.location[1] - b.location[1]) * 111.32 * Math.cos((a.location[0] * Math.PI) / 180);
            return Math.hypot(dlat, dlng);
        };
        const pairs = new Map();
        spaces.forEach((a) => {
            spaces.filter((b) => b !== a)
                .sort((x, y) => km(a, x) - km(a, y))
                .slice(0, LINK_NEIGHBORS)
                .forEach((b) => {
                    const [p, q] = a.id < b.id ? [a, b] : [b, a];
                    pairs.set(p.id + "|" + q.id, [p, q]);
                });
        });
        return [...pairs.values()];
    }

    function drawLinks() {
        const counts = spaces.map((spc) => speciesAt(spc).size);
        const max = Math.max(1, ...counts);
        const label = (data.groups.find((g) => g.id === group)?.label || "species").toLowerCase();

        neighborPairs().forEach(([a, b]) => {
            const sa = speciesAt(a), sb = speciesAt(b);
            const shared = [...sa].filter((id) => sb.has(id)).length;
            const pa = map.latLngToLayerPoint(a.location), pb = map.latLngToLayerPoint(b.location);
            const c = controlPoint(pa, pb);
            const t0 = Math.min(0.4, HALO_MIN_RADIUS / (pa.distanceTo(pb) || 1));
            const line = curveLine(pa, c, pb, t0, 1 - t0);

            let tip, cls, weight;
            if (sa.size === 0 || sb.size === 0) {
                tip = `${a.title} ↔ ${b.title}: more observations needed to compare`;
                cls = "net-link is-gap";
                weight = 1.5;
            } else if (shared === 0) {
                tip = `${a.title} ↔ ${b.title}: no shared ${label} recorded yet`;
                cls = "net-link is-gap";
                weight = 1.5;
            } else {
                const similarity = (2 * shared) / (sa.size + sb.size);
                tip = `${a.title} ↔ ${b.title}: ${shared} shared ${label} · ${Math.round(similarity * 100)}% similar`;
                cls = "net-link";
                weight = LINK_MIN_WEIGHT + similarity * (LINK_MAX_WEIGHT - LINK_MIN_WEIGHT);
            }
            const link = L.polyline(toLatLngs(line), { className: `${cls} net-${group}`, weight, interactive: true })
                .bindTooltip(tip, { sticky: true, className: "net-tooltip" })
                .addTo(layer);
            if (shared > 0) {
                link.on("click", (e) => {
                    L.DomEvent.stopPropagation(e); // so the map's own click handler doesn't clear it
                    selected_pair = new Set([a.id, b.id]);
                    link.getElement()?.blur(); // the glow marks the selection, not the browser's focus box
                    applyFocus();
                    onPairClick(a, b, group);
                });
            }
            hoverPair(link, a, b);
            items.push({ el: link, a, b, kind: "link" });

            // Drifting dots in both directions, on either side of the line
            if (shared > 0) {
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
            const low = effortAt(spc) < NETWORK_LOW_EFFORT;
            const halo = L.circleMarker(spc.location, {
                radius,
                className: `net-node net-${group}` + (low ? " needs-data" : "") + (n === 0 ? " is-empty" : ""),
                interactive: false,
            }).addTo(layer);
            items.push({ el: halo, a: spc, b: spc, kind: "node" });
        });
    }

    function draw() {
        layer.clearLayers();
        items = [];
        if (!group) return;
        drawLinks();
        applyFocus();
    }

    // Shapes are sized in screen pixels, so they're rebuilt whenever the zoom changes
    map.on("zoomend viewreset", draw);

    return {
        lowEffort: NETWORK_LOW_EFFORT,
        show(group_id) {
            group = group_id;
            selected_pair = null;
            layer.addTo(map);
            draw();
        },
        hide() {
            group = null;
            selected_pair = null;
            items = [];
            layer.clearLayers();
            layer.remove();
        },
        hasSelection() {
            return selected_pair !== null;
        },
        // Forget the clicked connection, e.g. when the panel goes back to the overview
        clearSelection() {
            selected_pair = null;
            applyFocus();
        },
        // Highlight one space's connections (null clears it)
        focus(space_id) {
            focused_space = space_id;
            applyFocus();
        },
    };
}
