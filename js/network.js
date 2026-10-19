// Network overlays for the landing page map: for one species group at a time, each pair of
// spaces is joined by two arrows sharing a curved centerline, one in each direction, each on
// its own side of the line like the two lanes of a road. An arrow from A to B starts as wide
// as A's species count in the group and ends as wide as the part of A's species also seen
// at B, so it's either constant (all shared) or tapering. Data: js/species_network.js.

const NETWORK_MAX_WIDTH = 22;    // px, for the space with the most species in the group
const NETWORK_MIN_WIDTH = 1.5;   // px, so a single shared species stays visible
const NETWORK_BEND = 0.16;       // curve height as a fraction of the distance between spaces
const NETWORK_END_GAP = 18;      // px left clear around each space's dot
const NETWORK_HEAD = 12;         // px length of the arrowhead
const NETWORK_STEPS = 28;        // samples along each curve

function createNetwork(map, spaces, data, onArrowClick) {
    const layer = L.layerGroup();
    let group = null;
    let arrows = [];         // { poly, from, to } for the current group
    let focused_space = null; // a hovered space: only its arrows stay bright
    let focused_pair = null;  // a hovered arrow: only that pair stays bright

    // Out of the focused space = full color, into it = paler, everything else faded
    function applyFocus() {
        arrows.forEach(({ poly, from, to }) => {
            const el = poly.getElement();
            if (!el) return;
            let state = "";
            if (focused_pair) {
                state = focused_pair.has(from.id) && focused_pair.has(to.id) ? "is-out" : "is-dim";
            } else if (focused_space) {
                state = from.id === focused_space ? "is-out" : to.id === focused_space ? "is-in" : "is-dim";
            }
            el.classList.remove("is-out", "is-in", "is-dim");
            if (state) el.classList.add(state);
        });
    }

    function speciesAt(spc) {
        return new Set(data.by_space[spc.id]?.[group] || []);
    }

    // Point at t on the quadratic curve p0 -> p2 with control point c, in layer pixels
    function curvePoint(p0, c, p2, t) {
        const u = 1 - t;
        return L.point(u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, u * u * p0.y + 2 * u * t * c.y + t * t * p2.y);
    }

    // Tapered half-arrow polygon (layer pixels) along the curve from `from` to `to`, on the right of travel
    function arrowPolygon(from, c, to, w0, w1) {
        const total = from.distanceTo(to);
        const t0 = Math.min(0.45, NETWORK_END_GAP / total);
        const t1 = 1 - t0;
        const head_t = Math.max(t0, t1 - NETWORK_HEAD / total);
        const inner = [], outer = [];
        for (let i = 0; i <= NETWORK_STEPS; i++) {
            const t = t0 + (head_t - t0) * (i / NETWORK_STEPS);
            const p = curvePoint(from, c, to, t);
            const q = curvePoint(from, c, to, Math.min(1, t + 0.001));
            const len = p.distanceTo(q) || 1;
            const nx = -(q.y - p.y) / len, ny = (q.x - p.x) / len; // right-hand normal in screen space
            const w = w0 + (w1 - w0) * ((t - t0) / (t1 - t0));
            inner.push(L.point(p.x + nx * 1, p.y + ny * 1)); // 1px gap from the shared centerline
            outer.push(L.point(p.x + nx * (w + 1), p.y + ny * (w + 1)));
        }
        // Arrowhead: a barb on the outer side that narrows to a tip on the centerline
        const tip = curvePoint(from, c, to, t1);
        const base = curvePoint(from, c, to, head_t);
        const len = base.distanceTo(tip) || 1;
        const nx = -(tip.y - base.y) / len, ny = (tip.x - base.x) / len;
        const barb = Math.max(w1 * 1.5, w1 + 5);
        const head = L.point(base.x + nx * (barb + 1), base.y + ny * (barb + 1));
        return [...inner, tip, head, ...outer.reverse()];
    }

    function draw() {
        layer.clearLayers();
        arrows = [];
        if (!group) return;
        const counts = spaces.map((spc) => speciesAt(spc).size);
        const max = Math.max(1, ...counts);
        const width = (n) => (n === 0 ? 0 : Math.max(NETWORK_MIN_WIDTH, (n / max) * NETWORK_MAX_WIDTH));

        for (let i = 0; i < spaces.length; i++) {
            for (let j = i + 1; j < spaces.length; j++) {
                const a = spaces[i], b = spaces[j];
                const sa = speciesAt(a), sb = speciesAt(b);
                const shared = [...sa].filter((id) => sb.has(id)).length;
                if (shared === 0) continue; // no shared species: leave the pair unconnected

                // One centerline per pair, bent to the same side for both directions
                const pa = map.latLngToLayerPoint(a.location), pb = map.latLngToLayerPoint(b.location);
                const dist = pa.distanceTo(pb) || 1;
                const c = L.point((pa.x + pb.x) / 2 - ((pb.y - pa.y) / dist) * dist * NETWORK_BEND,
                                  (pa.y + pb.y) / 2 + ((pb.x - pa.x) / dist) * dist * NETWORK_BEND);

                [[a, b, sa, pa, pb], [b, a, sb, pb, pa]].forEach(([from, to, set, pf, pt]) => {
                    const pts = arrowPolygon(pf, c, pt, width(set.size), width(shared));
                    const pct = Math.round((shared / set.size) * 100);
                    const poly = L.polygon(pts.map((p) => map.layerPointToLatLng(p)), {
                        className: "net-arrow net-" + group,
                        interactive: true,
                    })
                        .bindTooltip(`${from.title}: ${shared} of ${set.size} also at ${to.title} (${pct}%)`, { sticky: true, className: "net-tooltip" })
                        .on("click", () => onArrowClick(from, to, group))
                        .on("mouseover", () => { focused_pair = new Set([from.id, to.id]); applyFocus(); })
                        .on("mouseout", () => { focused_pair = null; applyFocus(); })
                        .addTo(layer);
                    arrows.push({ poly, from, to });
                });
            }
        }
        applyFocus();
    }

    // Widths are in screen pixels, so the arrows are rebuilt whenever the zoom changes
    map.on("zoomend viewreset", draw);

    return {
        show(group_id) {
            group = group_id;
            layer.addTo(map);
            draw();
        },
        hide() {
            group = null;
            arrows = [];
            layer.clearLayers();
            layer.remove();
        },
        // Highlight one space's arrows (null clears it)
        focus(space_id) {
            focused_space = space_id;
            applyFocus();
        },
    };
}
