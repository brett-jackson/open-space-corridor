// Corridor networks, showing one or more species groups at once (data: js/species_network.js).
//
// corridorLinks() works out which spaces are linked and how similar they are; it needs no
// map, so space pages use it too. createNetwork() draws active groups on the landing page map:
// each space gets a halo sized by its native species, and neighboring spaces (each space's
// nearest few) are joined by curved lines whose thickness reflects equal-effort similarity.
// When multiple groups are active, shared strands run side by side as parallel ribbons. A
// soft non-directional light sweep highlights hovered or selected connections. Dashed halos
// and lines mark where more observations are needed.

const NETWORK_BEND = 0.14;        // curve height as a fraction of the distance between spaces
const NETWORK_STEPS = 28;         // samples along each curve
const NETWORK_LOW_EFFORT = 30;    // fewer observations of a group than this: "more data needed"

const LINK_NEIGHBORS = 3;         // join each space to its nearest few spaces
const LINK_MIN_WEIGHT = 2.2;      // px, single-group mode, least alike pair with enough records
const LINK_MAX_WEIGHT = 10;       // px, single-group mode, most alike pair
const MULTI_MIN_WEIGHT = 1.8;     // px, multi-group parallel strand minimum
const MULTI_MAX_WEIGHT = 7.5;     // px, multi-group parallel strand maximum
const MULTI_SIM_LO = 0.25;        // shared absolute similarity floor in multi-group mode
const MULTI_SIM_HI = 0.85;        // shared absolute similarity ceiling in multi-group mode
const LINK_CURVE = 1.4;           // mild power curve so strong corridors stand out clearly
const LINK_MIN_OPACITY = 0.48;    // weaker solid links recede slightly; strongest sit near 1
const LINK_MAX_OPACITY = 0.96;
const STRAND_GAP = 2.5;           // px between parallel strands in multi-group mode
const HALO_MIN_RADIUS = 13;       // px, just outside the 20 px marker dot
const HALO_MAX_RADIUS = 30;       // px, for the space with the most species

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
        const equal_effort = data.similarity?.[group]?.[a.id + "|" + b.id]; // ids are in sorted order
        const thin = spaceEffort(data, a.id, group).low || spaceEffort(data, b.id, group).low;
        return {
            a, b, shared, thin,
            sizeA: sa.size,
            sizeB: sb.size,
            similarity: comparable ? equal_effort ?? (2 * shared) / (sa.size + sb.size) : null,
            gap: !comparable || shared === 0 || thin,
            selectable: sa.size + sb.size > 0,
        };
    });
}

// The least and most alike of the links with enough records, and a link's width and opacity
// between them. Thin links don't use it: they are drawn dashed at the minimum width.
function linkScale(links, min_w = LINK_MIN_WEIGHT, max_w = LINK_MAX_WEIGHT, fixed_lo = null, fixed_hi = null) {
    const solid = links.filter((l) => !l.gap).map((l) => l.similarity);
    const lo = fixed_lo !== null ? fixed_lo : (solid.length ? Math.min(...solid) : 0);
    const hi = fixed_hi !== null ? fixed_hi : (solid.length ? Math.max(...solid) : 1);
    const norm = (similarity) => {
        if (hi - lo < 0.02) return 0.55;
        const linear = Math.max(0, Math.min(1, (similarity - lo) / (hi - lo)));
        return Math.pow(linear, LINK_CURVE);
    };
    const weight = (similarity) => min_w + norm(similarity) * (max_w - min_w);
    const opacity = (similarity) => LINK_MIN_OPACITY + norm(similarity) * (LINK_MAX_OPACITY - LINK_MIN_OPACITY);
    return { lo, hi, any: solid.length > 0, weight, opacity };
}

// Observations of the group at a space, and whether that's too few to say much yet
function spaceEffort(data, space_id, group) {
    const obs = data.observations?.[space_id]?.[group] ?? 0;
    return { obs, low: obs < NETWORK_LOW_EFFORT };
}

function createNetwork(map, spaces, data, handlers) {
    const layer = L.layerGroup();
    let active_groups = [];     // active group ids shown on the map
    let items = [];             // { el: layer, a, b, kind, group } for focus styling
    let focused_space = null;   // a hovered space: only its connections stay bright
    let focused_pair = null;    // a hovered connection: only that pair stays bright
    let focused_group = null;   // when hovering one strand of a multi-strand pair
    let selected_space = null;  // the clicked space: its connections glow, the rest dims
    let selected_pair = null;   // the clicked connection: it glows, the rest dims

    function applyFocus() {
        const touches = (set, a, b, kind) => (kind === "node" ? set.has(a.id) : set.has(a.id) && set.has(b.id));
        items.forEach(({ el, a, b, kind, group }) => {
            const node = el.getElement();
            if (!node) return;
            let state = "";
            if (focused_pair) {
                if (touches(focused_pair, a, b, kind)) {
                    state = (kind === "node" || !focused_group || group === focused_group) ? "is-out" : "";
                } else {
                    state = "is-dim";
                }
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

    function wirePairInteraction(target, a, b, group_id, tip, selectable) {
        const enter = () => { focused_pair = new Set([a.id, b.id]); focused_group = group_id; applyFocus(); };
        const leave = () => { focused_pair = null; focused_group = null; applyFocus(); };
        target.on("mouseover", enter);
        target.on("mouseout", leave);
        if (selectable) {
            target.on("click", (e) => {
                L.DomEvent.stopPropagation(e); // so the map's own click handler doesn't clear it
                target.getElement()?.blur(); // the glow marks the selection, not the browser's focus box
                handlers.onPairClick(a, b, group_id);
            });
        }
        const path = target.getElement();
        if (path && selectable) {
            path.setAttribute("tabindex", "0");
            path.setAttribute("role", "button");
            path.setAttribute("aria-label", tip);
            path.addEventListener("focus", () => { enter(); target.openTooltip(); });
            path.addEventListener("blur", () => { leave(); target.closeTooltip(); });
            path.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handlers.onPairClick(a, b, group_id);
                }
            });
        }
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

    function linkTip(l, group_id) {
        const label = (data.groups.find((g) => g.id === group_id)?.label || "species").toLowerCase();
        const unit = typeof groupUnit === "function" ? groupUnit(group_id, l.shared) : label;
        if (l.similarity === null) return `${l.a.title} ↔ ${l.b.title}: too few ${label} records to compare yet`;
        if (l.thin) return `${l.a.title} ↔ ${l.b.title}: ${l.shared} shared ${unit}, from few records`;
        if (l.shared === 0) return `${l.a.title} ↔ ${l.b.title}: no shared ${label} recorded yet`;
        return `${l.a.title} ↔ ${l.b.title}: ${l.shared} shared ${unit} · ${Math.round(l.similarity * 100)}% alike`;
    }

    function addStrand(line, l, group_id, weight, opacity, tip) {
        const cls = `net-link${l.gap ? " is-gap" : ""}${l.thin && l.shared > 0 ? " is-thin" : ""}${l.selectable ? "" : " is-unselectable"} net-${group_id}`;
        const link = L.polyline(toLatLngs(line), { className: cls, weight, interactive: true })
            .bindTooltip(tip, { sticky: true, className: "net-tooltip" })
            .addTo(layer);
        if (opacity !== null) link.getElement()?.style.setProperty("--link-opacity", opacity.toFixed(2));
        wirePairInteraction(link, l.a, l.b, group_id, tip, l.selectable);
        items.push({ el: link, a: l.a, b: l.b, kind: "link", group: group_id });

        // Layered feathered light sweep on solid links while hovered or selected (gradual longitudinal fade, crisp edges)
        if (!l.gap) {
            const latlngs = toLatLngs(line);
            [
                ["outer", Math.max(1.4, weight * 0.54)],
                ["mid", Math.max(1.3, weight * 0.48)],
                ["inner", Math.max(1.2, weight * 0.42)],
                ["core", Math.max(1.0, weight * 0.36)],
            ].forEach(([tier, w]) => {
                const sweep = L.polyline(latlngs, {
                    className: `net-sweep net-sweep-${tier} net-${group_id}`,
                    weight: w,
                    interactive: false,
                }).addTo(layer);
                sweep.getElement()?.setAttribute("pathLength", "100");
                items.push({ el: sweep, a: l.a, b: l.b, kind: "link", group: group_id });
            });
        }
    }

    function draw() {
        layer.clearLayers();
        items = [];
        if (active_groups.length === 0) return;
        const multi = active_groups.length > 1;
        const min_w = multi ? MULTI_MIN_WEIGHT : LINK_MIN_WEIGHT;
        const max_w = multi ? MULTI_MAX_WEIGHT : LINK_MAX_WEIGHT;

        const links_by_group = {};
        const scale_by_group = {};
        const pair_map = new Map();
        active_groups.forEach((g) => {
            const links = corridorLinks(spaces, data, g);
            links_by_group[g] = links;
            // In multi-group mode use one shared similarity scale across all taxa so strands compare honestly
            scale_by_group[g] = multi
                ? linkScale(links, min_w, max_w, MULTI_SIM_LO, MULTI_SIM_HI)
                : linkScale(links, min_w, max_w);
            links.forEach((l) => {
                const key = l.a.id + "|" + l.b.id;
                if (!pair_map.has(key)) pair_map.set(key, { a: l.a, b: l.b, by_group: {} });
                pair_map.get(key).by_group[g] = l;
            });
        });

        pair_map.forEach(({ a, b, by_group }) => {
            const pa = map.latLngToLayerPoint(a.location), pb = map.latLngToLayerPoint(b.location);
            const c = controlPoint(pa, pb);
            const t0 = Math.min(0.4, HALO_MIN_RADIUS / (pa.distanceTo(pb) || 1));

            if (!multi) {
                const g = active_groups[0];
                const l = by_group[g];
                const weight = l.similarity === null || l.shared === 0 ? 1.5
                    : l.thin ? min_w
                    : scale_by_group[g].weight(l.similarity);
                const opacity = l.gap ? null : scale_by_group[g].opacity(l.similarity);
                const line = curveLine(pa, c, pb, t0, 1 - t0, 0);
                addStrand(line, l, g, weight, opacity, linkTip(l, g));
                return;
            }

            // Multi-group mode: draw every active group that shares species as parallel ribbons
            const strands = active_groups
                .map((g) => ({ g, l: by_group[g] }))
                .filter(({ l }) => l && l.shared > 0)
                .map(({ g, l }) => ({
                    g,
                    l,
                    weight: l.thin ? min_w : scale_by_group[g].weight(l.similarity),
                    opacity: l.gap ? null : scale_by_group[g].opacity(l.similarity),
                }));

            if (strands.length === 0) {
                // One shared dashed gap line when none of the active groups share species on this pair
                const first_selectable = active_groups.find((g) => by_group[g]?.selectable);
                const any_comparable = active_groups.some((g) => by_group[g]?.similarity !== null);
                const tip = `${a.title} ↔ ${b.title}: ${any_comparable ? "no shared species recorded yet" : "too few observations to compare yet"}`;
                const line = curveLine(pa, c, pb, t0, 1 - t0, 0);
                const cls = `net-link is-gap${first_selectable ? "" : " is-unselectable"}`;
                const link = L.polyline(toLatLngs(line), { className: cls, weight: 1.5, interactive: true })
                    .bindTooltip(tip, { sticky: true, className: "net-tooltip" })
                    .addTo(layer);
                wirePairInteraction(link, a, b, first_selectable || active_groups[0], tip, Boolean(first_selectable));
                items.push({ el: link, a, b, kind: "link", group: null });
                return;
            }

            const total_w = strands.reduce((sum, st) => sum + st.weight, 0) + STRAND_GAP * (strands.length - 1);
            let cursor = -total_w / 2;
            strands.forEach(({ g, l, weight, opacity }) => {
                const offset = cursor + weight / 2;
                cursor += weight + STRAND_GAP;
                const line = curveLine(pa, c, pb, t0, 1 - t0, offset);
                addStrand(line, l, g, weight, opacity, linkTip(l, g));
            });
        });

        // Halos: size = native species seen across active groups; dashed = few observations so far
        const counts = spaces.map((spc) => active_groups.reduce((sum, g) => sum + (data.by_space[spc.id]?.[g] || []).length, 0));
        const max = Math.max(1, ...counts);
        spaces.forEach((spc, i) => {
            const n = counts[i];
            const radius = n === 0 ? HALO_MIN_RADIUS : HALO_MIN_RADIUS + Math.sqrt(n / max) * (HALO_MAX_RADIUS - HALO_MIN_RADIUS);
            const all_low = active_groups.every((g) => spaceEffort(data, spc.id, g).low);
            const group_cls = multi ? "is-multi" : `net-${active_groups[0]}`;
            const halo = L.circleMarker(spc.location, {
                radius,
                className: `net-node ${group_cls}` + (all_low ? " needs-data" : "") + (n === 0 ? " is-empty" : ""),
                interactive: false,
            }).addTo(layer);
            items.push({ el: halo, a: spc, b: spc, kind: "node", group: null });
        });
        applyFocus();
    }

    // Shapes are sized in screen pixels, so they're rebuilt whenever the zoom changes
    map.on("zoomend viewreset", draw);

    return {
        show(groups) {
            const next = Array.isArray(groups) ? groups : [groups];
            if (active_groups.join("+") !== next.join("+")) {
                active_groups = [...next];
                layer.addTo(map);
                draw();
            }
        },
        hide() {
            active_groups = [];
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
