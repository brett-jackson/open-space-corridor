// Pollinator Interactions page: interactive insect–flower graph with two layouts
// (bipartite Columns + force-directed Network for cluster visualization) and scope tabs
// for local spaces vs. all of Colorado (data: js/pollinator_network.js).
//
// URL hash state:
//   #spaces                         local spaces only (default)
//   #spaces/<space_id>              one local space
//   #colorado                       all Colorado interactions (default min 3+ obs)
//   #colorado/local                 Colorado interactions where both species occur locally
//   #.../network                    force-directed network layout
//   #.../<type>:<id>                selected insect, plant, or link (<i~p>)

(function () {
    const DATA = window.POLLINATOR_NETWORK || { groups: [], insects: {}, plants: {}, links: [], observations: 0, co_observations: 0, unannotated: {} };
    const spaces = window.SPACES || [];
    const byId = Object.fromEntries(spaces.map((s) => [s.id, s]));
    const topSpaces = spaces.filter((s) => !s.parent);

    const GROUP_COLORS = {
        bees: "#f5b841",
        lepidoptera: "#c780ff",
        flies: "#5ec2b7",
        other: "#e09172",
    };
    const PLANT_NATIVE_COLOR = "#6fbf73";
    const PLANT_INTRO_COLOR = "#9aa8b5";
    const SVG_NS = "http://www.w3.org/2000/svg";

    const pageEl = document.getElementById("poll-page");
    const localLabel = pageEl?.dataset.localLabel || "Open spaces";
    const scopeTabsEl = document.getElementById("poll-scope-tabs");
    const viewToggleEl = document.getElementById("poll-view-toggle");
    const searchEl = document.getElementById("poll-search");
    const groupsEl = document.getElementById("poll-groups");
    const spaceWrapEl = document.getElementById("poll-space-wrap");
    const spaceEl = document.getElementById("poll-space");
    const localOnlyBtn = document.getElementById("poll-local-only");
    const minObsEl = document.getElementById("poll-min-obs");
    const scopeNoteEl = document.getElementById("poll-scope-note");
    const stageEl = document.getElementById("poll-stage");
    const legendEl = document.getElementById("poll-legend");
    const panelEl = document.getElementById("poll-panel-content");
    const creditsEl = document.getElementById("credits");

    const allGroupIds = DATA.groups.map((g) => g.id);

    let state = {
        scope: "spaces",       // "spaces" | "colorado"
        view: "columns",       // "columns" | "network"
        space: "all",          // "all" | <space.id> (used when scope === "spaces")
        localOnly: false,      // when scope === "colorado", restrict to insect+plant seen in our spaces
        minObs: 3,             // when scope === "colorado" and not searching: 3, 2, or 1
        query: "",             // live substring search on insect or flower name
        groups: new Set(allGroupIds),
        selected: null,        // { type: "insect"|"plant", id } | { type: "link", insect, plant }
    };
    let hovered = null;
    let activeSimCancel = null;
    let lastStageWidth = 0;

    function svgEl(tag, attrs) {
        const node = document.createElementNS(SVG_NS, tag);
        if (attrs) Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)));
        return node;
    }

    function displayOf(taxon) {
        if (!taxon) return { text: "Unknown", scientific: false };
        return taxonDisplayName({ preferred_common_name: taxon.common_name, name: taxon.name });
    }

    function truncate(str, max) {
        return str.length > max ? str.slice(0, max - 1).trimEnd() + "…" : str;
    }

    function matchesQuery(taxon, q) {
        if (!q || !taxon) return false;
        const c = (taxon.common_name || "").toLowerCase();
        const n = (taxon.name || "").toLowerCase();
        return c.includes(q) || n.includes(q);
    }

    // ---------- URL hash ----------

    function parseSelection(tok) {
        if (!tok) return null;
        const [kind, val] = tok.split(":");
        if (kind === "insect" && DATA.insects[val]) return { type: "insect", id: Number(val) };
        if (kind === "plant" && DATA.plants[val]) return { type: "plant", id: Number(val) };
        if (kind === "link" && val?.includes("~")) {
            const [i, p] = val.split("~").map(Number);
            if (DATA.insects[i] && DATA.plants[p]) return { type: "link", insect: i, plant: p };
        }
        return null;
    }

    function parseHash() {
        let raw = "";
        try { raw = decodeURIComponent(location.hash.replace(/^#/, "")); } catch (err) { raw = ""; }
        const parts = raw.split("/").filter(Boolean);
        state.scope = "spaces";
        state.view = "columns";
        state.space = "all";
        state.localOnly = false;
        state.selected = null;

        const rest = [];
        parts.forEach((p) => {
            if (p === "network") { state.view = "network"; return; }
            const sel = parseSelection(p);
            if (sel) { state.selected = sel; return; }
            rest.push(p);
        });

        if (rest[0] === "colorado") {
            state.scope = "colorado";
            if (rest[1] === "local") state.localOnly = true;
        } else if (rest[0] === "spaces") {
            if (rest[1] && byId[rest[1]]) state.space = rest[1];
        } else if (rest[0] && byId[rest[0]]) {
            // Backward-compatible link from space.html How to Help cards: pollinators.html#<space_id>
            state.space = rest[0];
        }
    }

    function syncHash(push = false) {
        let h = "";
        if (state.scope === "colorado") {
            h = "#colorado" + (state.localOnly ? "/local" : "");
        } else if (state.space !== "all") {
            h = "#spaces/" + state.space;
        } else if (state.view === "network" || state.selected) {
            h = "#spaces";
        }
        if (state.view === "network") h += "/network";
        if (state.selected) {
            const sel = state.selected.type === "link"
                ? `link:${state.selected.insect}~${state.selected.plant}`
                : `${state.selected.type}:${state.selected.id}`;
            h += "/" + sel;
        }
        if (h !== location.hash) {
            if (push) history.pushState(null, "", h || location.pathname + location.search);
            else history.replaceState(null, "", h || location.pathname + location.search);
        }
    }

    window.addEventListener("popstate", () => {
        parseHash();
        syncControlsUI();
        render();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && state.selected) {
            state.selected = null;
            syncHash(true);
            render();
        }
    });

    // ---------- Filtering & layout helpers ----------

    function scopeLinksRaw() {
        const out = [];
        DATA.links.forEach((l) => {
            const grp = DATA.insects[l.insect]?.group || "other";
            if (state.scope === "spaces") {
                const obs = state.space === "all" ? (l.obs || []) : (l.by_space?.[state.space] || []);
                if (obs.length === 0) return;
                out.push({
                    insect: l.insect,
                    plant: l.plant,
                    group: grp,
                    count: obs.length,
                    localCount: obs.length,
                    coCount: l.co_count || obs.length,
                    obs,
                    by_space: l.by_space || {},
                });
            } else {
                const coCount = l.co_count || l.count || 0;
                if (coCount === 0) return;
                if (state.localOnly && !(DATA.insects[l.insect]?.in_spaces && DATA.plants[l.plant]?.in_spaces)) return;
                out.push({
                    insect: l.insect,
                    plant: l.plant,
                    group: grp,
                    count: coCount,
                    localCount: l.count || 0,
                    coCount,
                    obs: l.co_obs || l.obs || [],
                    localObs: l.obs || [],
                    by_space: l.by_space || {},
                });
            }
        });
        return out;
    }

    function filteredLinks() {
        const q = state.query.trim().toLowerCase();
        const raw = scopeLinksRaw();
        const byGroupAndQuery = raw.filter((l) => {
            if (!state.groups.has(l.group)) return false;
            if (q && !matchesQuery(DATA.insects[l.insect], q) && !matchesQuery(DATA.plants[l.plant], q)) return false;
            return true;
        });

        const effectiveMin = state.scope === "colorado" && !q ? state.minObs : 1;
        const shown = effectiveMin > 1
            ? byGroupAndQuery.filter((l) => l.count >= effectiveMin)
            : byGroupAndQuery;

        return { shown, totalMatching: byGroupAndQuery, effectiveMin };
    }

    function orderBipartite(links) {
        const insectTotals = new Map();
        const plantTotals = new Map();
        const insectEdges = new Map();
        const plantEdges = new Map();
        links.forEach((l) => {
            insectTotals.set(l.insect, (insectTotals.get(l.insect) || 0) + l.count);
            plantTotals.set(l.plant, (plantTotals.get(l.plant) || 0) + l.count);
            if (!insectEdges.has(l.insect)) insectEdges.set(l.insect, []);
            if (!plantEdges.has(l.plant)) plantEdges.set(l.plant, []);
            insectEdges.get(l.insect).push(l);
            plantEdges.get(l.plant).push(l);
        });

        const groupOrder = DATA.groups.map((g) => g.id);
        let insects = [...insectTotals.keys()].sort((a, b) => {
            const ga = groupOrder.indexOf(DATA.insects[a]?.group || "other");
            const gb = groupOrder.indexOf(DATA.insects[b]?.group || "other");
            return ga - gb || insectTotals.get(b) - insectTotals.get(a) || displayOf(DATA.insects[a]).text.localeCompare(displayOf(DATA.insects[b]).text);
        });
        let plants = [...plantTotals.keys()].sort((a, b) =>
            plantTotals.get(b) - plantTotals.get(a) || displayOf(DATA.plants[a]).text.localeCompare(displayOf(DATA.plants[b]).text)
        );

        for (let iter = 0; iter < 4; iter++) {
            const iPos = new Map(insects.map((id, idx) => [id, idx]));
            plants.sort((a, b) => {
                const ba = barycenter(plantEdges.get(a), (l) => iPos.get(l.insect));
                const bb = barycenter(plantEdges.get(b), (l) => iPos.get(l.insect));
                return ba - bb || plantTotals.get(b) - plantTotals.get(a);
            });
            const pPos = new Map(plants.map((id, idx) => [id, idx]));
            insects.sort((a, b) => {
                const ba = barycenter(insectEdges.get(a), (l) => pPos.get(l.plant));
                const bb = barycenter(insectEdges.get(b), (l) => pPos.get(l.plant));
                return ba - bb || insectTotals.get(b) - insectTotals.get(a);
            });
        }
        return { insects, plants, insectTotals, plantTotals };
    }

    function barycenter(edges, posFn) {
        let num = 0, den = 0;
        edges.forEach((e) => { num += posFn(e) * e.count; den += e.count; });
        return den ? num / den : 0;
    }

    function strokeWidth(count, maxCount) {
        if (maxCount <= 1) return 3.2;
        const t = (Math.sqrt(count) - 1) / (Math.sqrt(maxCount) - 1);
        return +(2.0 + t * 11.5).toFixed(2);
    }

    function strokeOpacity(count, maxCount) {
        if (maxCount <= 1) return 0.78;
        const t = (Math.sqrt(count) - 1) / (Math.sqrt(maxCount) - 1);
        return +(0.46 + t * 0.44).toFixed(2);
    }

    // ---------- Controls ----------

    function buildControls() {
        const tabSpaces = scopeTabsEl.querySelector('[data-scope="spaces"]');
        const tabColorado = scopeTabsEl.querySelector('[data-scope="colorado"]');
        if (tabSpaces) tabSpaces.textContent = `${localLabel} (${(DATA.observations || 0).toLocaleString()})`;
        if (tabColorado) tabColorado.textContent = `All Colorado (${(DATA.co_observations || 0).toLocaleString()})`;

        scopeTabsEl.querySelectorAll("button").forEach((btn) => {
            btn.addEventListener("click", () => {
                const next = btn.dataset.scope;
                if (next === state.scope) return;
                state.scope = next;
                state.selected = null;
                state.groups = new Set(allGroupIds);
                if (state.scope === "colorado" && state.localOnly && state.minObs > 2) state.minObs = 2;
                syncControlsUI();
                syncHash(true);
                render();
            });
        });

        if (viewToggleEl) {
            viewToggleEl.querySelectorAll("button").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const next = btn.dataset.view;
                    if (next === state.view) return;
                    state.view = next;
                    syncControlsUI();
                    syncHash(true);
                    renderGraph(filteredLinks());
                });
            });
        }

        spaceEl.replaceChildren();
        const optAll = el("option", null, `All spaces (${DATA.observations || 0})`);
        optAll.value = "all";
        spaceEl.appendChild(optAll);

        const countInSpace = (sid) => {
            const ids = new Set();
            DATA.links.forEach((l) => (l.by_space?.[sid] || []).forEach((oid) => ids.add(oid)));
            return ids.size;
        };
        spaces.forEach((spc) => {
            const c = countInSpace(spc.id);
            const opt = el("option", null, (spc.parent ? "↳ " : "") + shortName(spc) + ` (${c})`);
            opt.value = spc.id;
            spaceEl.appendChild(opt);
        });
        spaceEl.addEventListener("change", () => {
            state.space = spaceEl.value;
            state.selected = null;
            syncHash(true);
            render();
        });

        localOnlyBtn.addEventListener("click", () => {
            state.localOnly = !state.localOnly;
            state.selected = null;
            if (state.localOnly && state.minObs === 3) state.minObs = 2;
            else if (!state.localOnly && state.minObs === 2) state.minObs = 3;
            syncControlsUI();
            syncHash(true);
            render();
        });

        minObsEl.querySelectorAll("button").forEach((btn) => {
            btn.addEventListener("click", () => {
                const val = Number(btn.dataset.min);
                if (val === state.minObs) return;
                state.minObs = val;
                state.selected = null;
                syncControlsUI();
                render();
            });
        });

        let searchTimer = null;
        searchEl.addEventListener("input", () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.query = searchEl.value;
                state.selected = null;
                syncControlsUI();
                render();
            }, 90);
        });

        syncControlsUI();
    }

    function syncControlsUI() {
        scopeTabsEl.querySelectorAll("button").forEach((btn) => {
            btn.setAttribute("aria-selected", String(btn.dataset.scope === state.scope));
        });
        if (viewToggleEl) {
            viewToggleEl.querySelectorAll("button").forEach((btn) => {
                btn.setAttribute("aria-pressed", String(btn.dataset.view === state.view));
            });
        }
        const isColorado = state.scope === "colorado";
        spaceWrapEl.hidden = isColorado;
        localOnlyBtn.hidden = !isColorado;
        minObsEl.hidden = !isColorado || Boolean(state.query.trim());
        spaceEl.value = state.space;
        localOnlyBtn.setAttribute("aria-pressed", String(state.localOnly));
        minObsEl.querySelectorAll("button").forEach((btn) => {
            btn.setAttribute("aria-pressed", String(Number(btn.dataset.min) === state.minObs));
        });
        renderGroupToggles();
    }

    function renderGroupToggles() {
        groupsEl.replaceChildren();
        const raw = scopeLinksRaw();
        const present = DATA.groups.filter((g) => raw.some((l) => l.group === g.id));
        const groupsToShow = present.length ? present : DATA.groups.slice(0, 2);
        groupsToShow.forEach((g) => {
            const btn = el("button", "group-toggle");
            btn.type = "button";
            btn.style.setProperty("--net-color", GROUP_COLORS[g.id] || "#7db0ff");
            btn.setAttribute("aria-pressed", String(state.groups.has(g.id)));
            btn.append(el("span", "group-dot"), g.label);
            btn.addEventListener("click", () => {
                if (state.groups.has(g.id)) {
                    const activeShown = groupsToShow.filter((x) => state.groups.has(x.id));
                    if (activeShown.length > 1) state.groups.delete(g.id);
                } else {
                    state.groups.add(g.id);
                }
                state.selected = null;
                renderGroupToggles();
                render();
            });
            groupsEl.appendChild(btn);
        });
    }

    // ---------- Focus matching ----------

    function matchesFocus(link, focus) {
        if (!focus) return true;
        if (focus.type === "insect") return link.insect === focus.id;
        if (focus.type === "plant") return link.plant === focus.id;
        return link.insect === focus.insect && link.plant === focus.plant;
    }

    function nodeMatchesFocus(type, id, focus, links) {
        if (!focus) return true;
        if (focus.type === type && focus.id === id) return true;
        if (focus.type === "link") return (type === "insect" && focus.insect === id) || (type === "plant" && focus.plant === id);
        return links.some((l) => matchesFocus(l, focus) && ((type === "insect" && l.insect === id) || (type === "plant" && l.plant === id)));
    }

    // ---------- SVG Graph (dispatcher) ----------

    let rendered = null;

    function applyHighlight() {
        if (!rendered) return;
        const focus = hovered || state.selected;
        rendered.linkEls.forEach(({ node, link }) => {
            const hit = matchesFocus(link, focus);
            node.classList.toggle("is-active", Boolean(focus && hit));
            node.classList.toggle("is-dim", Boolean(focus && !hit));
        });
        rendered.nodeEls.forEach(({ node, type, id }) => {
            const hit = nodeMatchesFocus(type, id, focus, rendered.links);
            const exact = Boolean(focus && focus.type === type && focus.id === id);
            node.classList.toggle("is-selected", exact);
            node.classList.toggle("is-active", Boolean(focus && hit));
            node.classList.toggle("is-dim", Boolean(focus && !hit));
        });
    }

    function selectTarget(target) {
        const same = state.selected && target &&
            state.selected.type === target.type &&
            state.selected.id === target.id &&
            state.selected.insect === target.insect &&
            state.selected.plant === target.plant;
        state.selected = same ? null : target;
        syncHash(true);
        applyHighlight();
        renderPanel(filteredLinks());
    }

    function renderGraph(result) {
        if (activeSimCancel) {
            activeSimCancel();
            activeSimCancel = null;
        }
        const { shown: links, totalMatching, effectiveMin } = result;
        stageEl.replaceChildren();
        rendered = null;
        lastStageWidth = stageEl.clientWidth || 720;

        if (state.scope === "colorado" && effectiveMin > 1 && totalMatching.length > links.length) {
            const nextHint = effectiveMin >= 3 ? "Use 2+, All, or Search to explore more." : "Use All or Search to explore more.";
            scopeNoteEl.textContent = `Showing ${links.length.toLocaleString()} links with ${effectiveMin}+ observations (of ${totalMatching.length.toLocaleString()} in Colorado${state.localOnly ? " for our spaces' species" : ""}). ${nextHint}`;
            scopeNoteEl.hidden = false;
        } else if (state.query.trim()) {
            scopeNoteEl.textContent = `${links.length.toLocaleString()} matching ${links.length === 1 ? "link" : "links"} for “${state.query.trim()}”.`;
            scopeNoteEl.hidden = false;
        } else {
            scopeNoteEl.hidden = true;
        }

        if (links.length === 0) {
            const empty = el("div", "poll-empty");
            const spc = state.scope === "spaces" && state.space !== "all" ? byId[state.space] : null;
            const unann = spc ? (DATA.unannotated[spc.id] || 0) : totalUnannotated();
            if (state.query.trim()) {
                empty.append(
                    el("h2", "poll-empty-title", `No matches for “${state.query.trim()}”`),
                    el("p", "panel-hint", state.scope === "spaces"
                        ? "Try switching to the All Colorado tab to search across all statewide interactions."
                        : "Try a shorter common or scientific name, or clear the local-species filter.")
                );
            } else {
                empty.append(
                    el("h2", "poll-empty-title", spc ? `No flower interactions recorded at ${shortName(spc)} yet` : "No flower interactions match these filters"),
                    el("p", "panel-hint", unann > 0 && state.scope === "spaces"
                        ? `${unann.toLocaleString()} pollinator ${unann === 1 ? "observation" : "observations"} here still need a flower recorded. Adding one draws the first link on this network.`
                        : "Try lowering the minimum observation threshold or enabling more insect groups.")
                );
                if (spc) {
                    const a = el("a", "panel-explore", `Browse pollinators at ${shortName(spc)} ↗`);
                    a.href = `https://www.inaturalist.org/observations?${spaceAreaQuery(spc)}&taxon_ids=630955,47157&verifiable=true&subview=grid`;
                    a.target = "_blank";
                    a.rel = "noopener";
                    empty.appendChild(a);
                }
            }
            stageEl.appendChild(empty);
            legendEl.replaceChildren();
            return;
        }

        if (state.view === "network") renderForceNetwork(result);
        else renderColumns(result);
    }

    // ---------- View 1: Bipartite Columns ----------

    function renderColumns(result) {
        const { shown: links } = result;
        const { insects, plants, insectTotals, plantTotals } = orderBipartite(links);
        const maxCount = Math.max(...links.map((l) => l.count), 1);

        const width = Math.max(320, stageEl.clientWidth || 720);
        const narrow = width < 560;
        const padX = narrow ? 10 : 18;
        const headerH = 34;
        const padBottom = 20;
        const rows = Math.max(insects.length, plants.length);
        const rowH = rows > 80 ? (narrow ? 28 : 32) : (narrow ? 36 : 40);
        const avatarR = rows > 80 ? (narrow ? 9 : 11) : (narrow ? 11 : 14);
        const labelW = narrow ? Math.round(width * 0.34) : Math.min(255, Math.round(width * 0.29));
        const maxChars = narrow ? 15 : Math.max(20, Math.floor((labelW - avatarR * 2 - 22) / 6.6));

        const innerH = Math.max(rows * rowH, rows === 1 ? 120 : rows * rowH);
        const height = headerH + innerH + padBottom;

        const leftAnchorX = padX + labelW;
        const rightAnchorX = width - padX - labelW;
        const leftAvatarX = leftAnchorX - avatarR - 6;
        const rightAvatarX = rightAnchorX + avatarR + 6;
        const leftTextX = leftAvatarX - avatarR - 8;
        const rightTextX = rightAvatarX + avatarR + 8;

        const yFor = (idx, count) => {
            if (count === 1) return headerH + innerH / 2;
            const step = innerH / count;
            return headerH + step * (idx + 0.5);
        };
        const insectY = new Map(insects.map((id, i) => [id, yFor(i, insects.length)]));
        const plantY = new Map(plants.map((id, i) => [id, yFor(i, plants.length)]));

        const svg = svgEl("svg", {
            class: "poll-svg",
            viewBox: `0 0 ${width} ${height}`,
            width: width,
            height: height,
            role: "img",
            "aria-label": `Bipartite network of ${insects.length} insect taxa visiting ${plants.length} plant taxa across ${links.length} interactions`,
        });

        const bg = svgEl("rect", { x: 0, y: 0, width, height, fill: "transparent" });
        bg.addEventListener("click", () => {
            if (state.selected) {
                state.selected = null;
                syncHash(true);
                applyHighlight();
                renderPanel(result);
            }
        });
        svg.appendChild(bg);

        const leftHdr = svgEl("text", { class: "poll-col-label", x: leftAnchorX, y: 18, "text-anchor": "end" });
        leftHdr.textContent = `INSECTS (${insects.length})`;
        const rightHdr = svgEl("text", { class: "poll-col-label", x: rightAnchorX, y: 18, "text-anchor": "start" });
        rightHdr.textContent = `FLOWERS (${plants.length})`;
        svg.append(leftHdr, rightHdr);

        const defs = svgEl("defs");
        svg.appendChild(defs);

        const linksG = svgEl("g", { class: "poll-links" });
        const linkEls = [];
        const sortedLinks = [...links].sort((a, b) => a.count - b.count);
        const curveOffset = Math.max(40, (rightAnchorX - leftAnchorX) * 0.42);

        sortedLinks.forEach((l) => {
            const y1 = insectY.get(l.insect);
            const y2 = plantY.get(l.plant);
            const d = `M${leftAnchorX},${y1} C${leftAnchorX + curveOffset},${y1} ${rightAnchorX - curveOffset},${y2} ${rightAnchorX},${y2}`;
            const w = strokeWidth(l.count, maxCount);
            const op = strokeOpacity(l.count, maxCount);
            const color = GROUP_COLORS[l.group] || "#7db0ff";

            const g = svgEl("g", {
                class: "poll-link",
                tabindex: "0",
                role: "button",
                "aria-label": `${displayOf(DATA.insects[l.insect]).text} visiting ${displayOf(DATA.plants[l.plant]).text}: ${l.count} ${l.count === 1 ? "observation" : "observations"}`,
            });
            const hit = svgEl("path", { class: "poll-link-hit", d, "stroke-width": Math.max(14, w + 8) });
            const path = svgEl("path", {
                class: "poll-link-stroke",
                d,
                stroke: color,
                "stroke-width": w,
                "stroke-opacity": op,
            });
            const title = svgEl("title");
            title.textContent = `${displayOf(DATA.insects[l.insect]).text} → ${displayOf(DATA.plants[l.plant]).text} (${l.count} ${l.count === 1 ? "observation" : "observations"})`;
            g.append(title, hit, path);

            const target = { type: "link", insect: l.insect, plant: l.plant };
            g.addEventListener("pointerenter", () => { hovered = target; applyHighlight(); });
            g.addEventListener("pointerleave", () => { hovered = null; applyHighlight(); });
            g.addEventListener("click", (e) => { e.stopPropagation(); selectTarget(target); });
            g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectTarget(target); } });

            linksG.appendChild(g);
            linkEls.push({ node: g, link: l });
        });
        svg.appendChild(linksG);

        const nodesG = svgEl("g", { class: "poll-nodes" });
        const nodeEls = [];

        function drawNode(type, id, xAvatar, xText, y, anchor, total, ringColor, dashed) {
            const taxon = type === "insect" ? DATA.insects[id] : DATA.plants[id];
            const disp = displayOf(taxon);
            const g = svgEl("g", {
                class: "poll-node poll-node-" + type,
                tabindex: "0",
                role: "button",
                "aria-label": `${disp.text} (${total} ${total === 1 ? "interaction" : "interactions"})`,
            });

            const hitX = type === "insect" ? padX : rightAnchorX;
            g.appendChild(svgEl("rect", {
                class: "poll-node-hit",
                x: hitX,
                y: y - rowH / 2 + 2,
                width: labelW,
                height: rowH - 4,
                rx: 6,
            }));

            const clipId = `clip-${type}-${id}`;
            const clip = svgEl("clipPath", { id: clipId });
            clip.appendChild(svgEl("circle", { cx: xAvatar, cy: y, r: avatarR - 1 }));
            defs.appendChild(clip);

            g.appendChild(svgEl("circle", {
                class: "poll-avatar-bg",
                cx: xAvatar,
                cy: y,
                r: avatarR,
                stroke: ringColor,
                "stroke-dasharray": dashed ? "3 2" : "",
            }));
            if (taxon?.photo) {
                g.appendChild(svgEl("image", {
                    href: taxon.photo,
                    x: xAvatar - avatarR + 1,
                    y: y - avatarR + 1,
                    width: (avatarR - 1) * 2,
                    height: (avatarR - 1) * 2,
                    "clip-path": `url(#${clipId})`,
                    preserveAspectRatio: "xMidYMid slice",
                }));
            } else {
                g.appendChild(svgEl("circle", { cx: xAvatar, cy: y, r: 4, fill: ringColor }));
            }

            const text = svgEl("text", {
                class: "poll-node-label" + (disp.scientific ? " scientific" : ""),
                x: xText,
                y: y,
                "text-anchor": anchor,
                "dominant-baseline": "central",
            });
            text.textContent = truncate(disp.text, maxChars);
            if (!narrow && total > 1) {
                const badge = svgEl("tspan", { class: "poll-node-count" });
                badge.textContent = ` · ${total}`;
                text.appendChild(badge);
            }
            const title = svgEl("title");
            title.textContent = `${disp.text}${taxon?.common_name && taxon?.name ? ` (${taxon.name})` : ""} — ${total} ${total === 1 ? "interaction" : "interactions"}`;
            g.append(title, text);

            const target = { type, id };
            g.addEventListener("pointerenter", () => { hovered = target; applyHighlight(); });
            g.addEventListener("pointerleave", () => { hovered = null; applyHighlight(); });
            g.addEventListener("click", (e) => { e.stopPropagation(); selectTarget(target); });
            g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectTarget(target); } });

            nodesG.appendChild(g);
            nodeEls.push({ node: g, type, id });
        }

        insects.forEach((id) => {
            const grp = DATA.insects[id]?.group || "other";
            drawNode("insect", id, leftAvatarX, leftTextX, insectY.get(id), "end", insectTotals.get(id), GROUP_COLORS[grp] || "#7db0ff", false);
        });
        plants.forEach((id) => {
            const intro = Boolean(DATA.plants[id]?.introduced);
            drawNode("plant", id, rightAvatarX, rightTextX, plantY.get(id), "start", plantTotals.get(id), intro ? PLANT_INTRO_COLOR : PLANT_NATIVE_COLOR, intro);
        });
        svg.appendChild(nodesG);
        stageEl.appendChild(svg);

        rendered = { links, linkEls, nodeEls };
        applyHighlight();
        renderLegend(maxCount, plants.some((id) => DATA.plants[id]?.introduced), "columns");
    }

    // ---------- View 2: Force-Directed Network (Clustered) ----------

    // Minimal Barnes-Hut quadtree for fast O(N log N) repulsive forces at any node count
    function buildQuadtree(nodes) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < nodes.length; i++) {
            const n = nodes[i];
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
        }
        const size = Math.max(maxX - minX, maxY - minY, 10) + 2;
        const root = { x: minX - 1, y: minY - 1, size, mass: 0, cx: 0, cy: 0, body: null, kids: null };

        function insert(cell, body, depth) {
            if (cell.mass === 0) {
                cell.body = body;
                cell.mass = body.mass;
                cell.cx = body.x;
                cell.cy = body.y;
                return;
            }
            if (!cell.kids) {
                if (depth >= 12) {
                    const m = cell.mass + body.mass;
                    cell.cx = (cell.cx * cell.mass + body.x * body.mass) / m;
                    cell.cy = (cell.cy * cell.mass + body.y * body.mass) / m;
                    cell.mass = m;
                    cell.body = null;
                    return;
                }
                const hs = cell.size * 0.5;
                cell.kids = [
                    { x: cell.x, y: cell.y, size: hs, mass: 0, cx: 0, cy: 0, body: null, kids: null },
                    { x: cell.x + hs, y: cell.y, size: hs, mass: 0, cx: 0, cy: 0, body: null, kids: null },
                    { x: cell.x, y: cell.y + hs, size: hs, mass: 0, cx: 0, cy: 0, body: null, kids: null },
                    { x: cell.x + hs, y: cell.y + hs, size: hs, mass: 0, cx: 0, cy: 0, body: null, kids: null },
                ];
                const prev = cell.body;
                cell.body = null;
                if (prev) insert(cell.kids[quadIdx(cell, prev)], prev, depth + 1);
            }
            const m = cell.mass + body.mass;
            cell.cx = (cell.cx * cell.mass + body.x * body.mass) / m;
            cell.cy = (cell.cy * cell.mass + body.y * body.mass) / m;
            cell.mass = m;
            insert(cell.kids[quadIdx(cell, body)], body, depth + 1);
        }

        function quadIdx(cell, b) {
            const mx = cell.x + cell.size * 0.5;
            const my = cell.y + cell.size * 0.5;
            return (b.x >= mx ? 1 : 0) + (b.y >= my ? 2 : 0);
        }

        for (let i = 0; i < nodes.length; i++) insert(root, nodes[i], 0);
        return root;
    }

    function applyRepulsion(cell, node, strength, softSq, theta) {
        if (cell.mass === 0 || cell.body === node) return;
        const dx = node.x - cell.cx;
        const dy = node.y - cell.cy;
        const distSq = dx * dx + dy * dy;
        if (!cell.kids || (cell.size * cell.size) / (distSq + 1) < theta * theta) {
            const dist = Math.sqrt(distSq + softSq);
            const f = (strength * cell.mass) / (distSq + softSq);
            node.vx += (dx / dist) * f;
            node.vy += (dy / dist) * f;
        } else {
            for (let i = 0; i < 4; i++) applyRepulsion(cell.kids[i], node, strength, softSq, theta);
        }
    }

    function renderForceNetwork(result) {
        const { shown: links } = result;
        const maxCount = Math.max(...links.map((l) => l.count), 1);

        // Build node list and adjacency
        const nodeMap = new Map();
        const adj = new Map();
        function ensureNode(type, id) {
            const key = type[0] + ":" + id;
            if (!nodeMap.has(key)) {
                const taxon = type === "insect" ? DATA.insects[id] : DATA.plants[id];
                nodeMap.set(key, {
                    key, type, id, taxon,
                    total: 0, degree: 0, comp: 0, compSize: 1,
                    x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null,
                    r: 13, mass: 1,
                });
                adj.set(key, []);
            }
            return nodeMap.get(key);
        }

        const edges = links.map((l) => {
            const a = ensureNode("insect", l.insect);
            const b = ensureNode("plant", l.plant);
            a.total += l.count; a.degree += 1;
            b.total += l.count; b.degree += 1;
            adj.get(a.key).push(b);
            adj.get(b.key).push(a);
            return { a, b, link: l };
        });

        const nodes = [...nodeMap.values()];
        const N = nodes.length;
        const width = Math.max(320, stageEl.clientWidth || 720);
        const narrow = width < 560;
        const height = narrow
            ? Math.max(420, Math.min(520, Math.round(width * 1.18)))
            : Math.max(480, Math.min(590, Math.round(width * 0.62)));

        nodes.forEach((n) => {
            if (narrow) {
                n.r = N > 60 ? 6.5 + Math.min(4.5, Math.sqrt(n.total) * 0.9) : 8.5 + Math.min(6.5, Math.sqrt(n.total) * 1.15);
            } else if (N > 140) {
                n.r = 7.5 + Math.min(7, Math.sqrt(n.total) * 1.25);
            } else if (N > 55) {
                n.r = 10 + Math.min(9.5, Math.sqrt(n.total) * 1.6);
            } else {
                n.r = 12 + Math.min(11.5, Math.sqrt(n.total) * 1.9);
            }
            n.mass = 1 + Math.min(2.2, Math.log1p(n.degree) * 0.45);
        });

        // Connected components: place main web at center, smaller islands on an elliptical ring matching aspect ratio
        const seen = new Set();
        const components = [];
        nodes.forEach((start) => {
            if (seen.has(start.key)) return;
            const comp = [];
            const q = [start];
            seen.add(start.key);
            while (q.length) {
                const cur = q.shift();
                comp.push(cur);
                adj.get(cur.key).forEach((nb) => {
                    if (!seen.has(nb.key)) { seen.add(nb.key); q.push(nb); }
                });
            }
            comp.sort((x, y) => y.degree - x.degree || y.total - x.total || x.id - y.id);
            components.push(comp);
        });
        components.sort((a, b) => b.length - a.length || b[0].total - a[0].total);

        const aspect = width / height;
        const golden = Math.PI * (3 - Math.sqrt(5));
        const mainSpread = Math.sqrt(Math.max(1, components[0].length)) * 46;
        components.forEach((comp, ci) => {
            const ringR = mainSpread + 125 + Math.sqrt(ci) * 44;
            const cx = ci === 0 ? 0 : Math.cos(ci * golden) * ringR * Math.max(1, aspect * 0.92);
            const cy = ci === 0 ? 0 : Math.sin(ci * golden) * ringR * 0.85;
            comp.forEach((n, ni) => {
                n.comp = ci;
                n.compSize = comp.length;
                const ang = ni * golden + ((n.id * 2654435761) % 360) * 0.0005;
                const rad = ni === 0 ? 0 : Math.sqrt(ni) * 34;
                n.x = cx + Math.cos(ang) * rad * Math.max(1, aspect * 0.85);
                n.y = cy + Math.sin(ang) * rad;
            });
        });

        const baseRepulse = N > 140 ? 2200 : (N > 55 ? 5800 : 8200);
        const baseRest = N > 140 ? 34 : (N > 55 ? 58 : 74);
        const collPad = narrow ? 7 : (N > 140 ? 8 : 16);

        function collide(pad) {
            if (N <= 220) {
                for (let i = 0; i < N; i++) {
                    const a = nodes[i];
                    for (let j = i + 1; j < N; j++) {
                        const b = nodes[j];
                        let dx = b.x - a.x;
                        let dy = b.y - a.y;
                        let d = Math.hypot(dx, dy);
                        const minD = a.r + b.r + pad;
                        if (d < minD) {
                            if (d < 0.01) { dx = 0.5; dy = 0.5; d = 0.707; }
                            const push = (minD - d) * 0.52 / d;
                            if (a.fx === null) { a.x -= dx * push; a.y -= dy * push; }
                            if (b.fx === null) { b.x += dx * push; b.y += dy * push; }
                        }
                    }
                }
            } else {
                const cell = 42;
                const grid = new Map();
                for (let i = 0; i < N; i++) {
                    const n = nodes[i];
                    const gx = Math.floor(n.x / cell);
                    const gy = Math.floor(n.y / cell);
                    const k = gx + "," + gy;
                    if (!grid.has(k)) grid.set(k, []);
                    grid.get(k).push(n);
                }
                for (let i = 0; i < N; i++) {
                    const a = nodes[i];
                    const gx = Math.floor(a.x / cell);
                    const gy = Math.floor(a.y / cell);
                    for (let ox = -1; ox <= 1; ox++) {
                        for (let oy = -1; oy <= 1; oy++) {
                            const bucket = grid.get((gx + ox) + "," + (gy + oy));
                            if (!bucket) continue;
                            for (let k = 0; k < bucket.length; k++) {
                                const b = bucket[k];
                                if (b.key <= a.key) continue;
                                let dx = b.x - a.x, dy = b.y - a.y;
                                let d = Math.hypot(dx, dy);
                                const minD = a.r + b.r + pad;
                                if (d < minD) {
                                    if (d < 0.01) { dx = 0.5; dy = 0.5; d = 0.707; }
                                    const push = (minD - d) * 0.5 / d;
                                    if (a.fx === null) { a.x -= dx * push; a.y -= dy * push; }
                                    if (b.fx === null) { b.x += dx * push; b.y += dy * push; }
                                }
                            }
                        }
                    }
                }
            }
        }

        function stepSim(alpha, repulse, restGap, centerX, centerY, gravX, gravY, pad, clampBox) {
            const tree = buildQuadtree(nodes);
            for (let i = 0; i < N; i++) {
                const n = nodes[i];
                applyRepulsion(tree, n, repulse * alpha, 44, 0.75);
                const mult = n.compSize <= 3 ? 1.45 : 1.0;
                n.vx += (centerX - n.x) * gravX * mult * alpha;
                n.vy += (centerY - n.y) * gravY * mult * alpha;
            }
            for (let i = 0; i < edges.length; i++) {
                const e = edges[i];
                const dx = e.b.x - e.a.x;
                const dy = e.b.y - e.a.y;
                const d = Math.hypot(dx, dy) || 0.01;
                const wFactor = 1 + 0.45 * Math.log1p(e.link.count);
                const ideal = (e.a.r + e.b.r) + restGap / (1 + 0.25 * Math.log1p(e.link.count));
                const f = ((d - ideal) / d) * 0.095 * wFactor * alpha;
                e.a.vx += dx * f; e.a.vy += dy * f;
                e.b.vx -= dx * f; e.b.vy -= dy * f;
            }
            for (let i = 0; i < N; i++) {
                const n = nodes[i];
                if (n.fx !== null) {
                    n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0;
                    continue;
                }
                n.vx *= 0.78;
                n.vy *= 0.78;
                const spd = Math.hypot(n.vx, n.vy);
                if (spd > 32) { n.vx = (n.vx / spd) * 32; n.vy = (n.vy / spd) * 32; }
                n.x += n.vx;
                n.y += n.vy;
            }
            collide(pad);
            if (clampBox) {
                for (let i = 0; i < N; i++) {
                    const n = nodes[i];
                    if (n.fx !== null) continue;
                    const m = n.r + 10;
                    n.x = Math.max(m, Math.min(width - m, n.x));
                    n.y = Math.max(m, Math.min(height - m - 16, n.y));
                }
            }
        }

        // Anisotropic gravity spreads clusters across the full horizontal width of the stage
        const gxPre = narrow ? 0.016 : 0.0085;
        const gyPre = narrow ? 0.014 : 0.0165;
        const preTicks = N > 220 ? 150 : 240;
        for (let t = 0; t < preTicks; t++) {
            const alpha = Math.max(0.03, 1 - t / preTicks);
            stepSim(alpha, baseRepulse, baseRest, 0, 0, gxPre, gyPre, collPad, false);
        }

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        nodes.forEach((n) => {
            minX = Math.min(minX, n.x - n.r - 14);
            maxX = Math.max(maxX, n.x + n.r + 14);
            minY = Math.min(minY, n.y - n.r - 10);
            maxY = Math.max(maxY, n.y + n.r + 20);
        });
        const padX = narrow ? 20 : 48;
        const padY = narrow ? 20 : 30;
        const spanX = Math.max(120, maxX - minX);
        const spanY = Math.max(100, maxY - minY);
        const fitScale = Math.min(1.45, (width - padX * 2) / spanX, (height - padY * 2) / spanY);
        const midX = (minX + maxX) * 0.5;
        const midY = (minY + maxY) * 0.5;
        nodes.forEach((n) => {
            n.x = width * 0.5 + (n.x - midX) * fitScale;
            n.y = height * 0.5 + (n.y - midY) * fitScale;
            n.vx = 0; n.vy = 0;
        });
        // Post-fit de-overlap passes guarantee avatars never stack, even on 390px phone screens
        const postPad = narrow ? 4 : 8;
        for (let pass = 0; pass < 10; pass++) {
            collide(postPad);
            for (let i = 0; i < N; i++) {
                const n = nodes[i];
                const m = n.r + 8;
                n.x = Math.max(m, Math.min(width - m, n.x));
                n.y = Math.max(m, Math.min(height - m - 16, n.y));
            }
        }

        // Collision-free default labels: show highest-importance hubs & cluster heads without overlapping text or photos
        const maxLabelChars = narrow ? 15 : 22;
        const labelCharW = narrow ? 5.6 : 6.1;
        const primaryLabelKeys = new Set();
        const placedBoxes = [];
        const rankedNodes = [...nodes].sort((a, b) =>
            (b.degree * 3.5 + Math.log1p(b.total) * 1.6) - (a.degree * 3.5 + Math.log1p(a.total) * 1.6)
        );
        const maxPrimary = narrow ? 16 : 34;
        rankedNodes.forEach((n) => {
            if (primaryLabelKeys.size >= maxPrimary) return;
            const text = truncate(displayOf(n.taxon).text, maxLabelChars);
            const hw = Math.max(24, text.length * labelCharW * 0.5) + 4;
            const bx1 = n.x - hw, bx2 = n.x + hw;
            const by1 = n.y + n.r + 2, by2 = n.y + n.r + 16;
            if (bx1 < 2 || bx2 > width - 2 || by2 > height - 2) return;
            // Reject if it overlaps an already-placed label
            for (let i = 0; i < placedBoxes.length; i++) {
                const b = placedBoxes[i];
                if (bx1 < b.x2 && bx2 > b.x1 && by1 < b.y2 && by2 > b.y1) return;
            }
            // Reject if it sits directly on top of another node's photo
            for (let i = 0; i < N; i++) {
                const o = nodes[i];
                if (o === n) continue;
                const cx = Math.max(bx1, Math.min(o.x, bx2));
                const cy = Math.max(by1, Math.min(o.y, by2));
                if (Math.hypot(o.x - cx, o.y - cy) < o.r + 1) return;
            }
            placedBoxes.push({ x1: bx1, y1: by1, x2: bx2, y2: by2 });
            primaryLabelKeys.add(n.key);
        });

        // Build SVG
        const svg = svgEl("svg", {
            class: "poll-svg poll-net-svg",
            viewBox: `0 0 ${width} ${height}`,
            width, height,
            role: "img",
            "aria-label": `Force-directed network showing species clusters across ${N} taxa and ${links.length} interactions`,
        });

        const bg = svgEl("rect", { x: 0, y: 0, width, height, fill: "transparent" });
        bg.addEventListener("click", () => {
            if (state.selected) {
                state.selected = null;
                syncHash(true);
                applyHighlight();
                renderPanel(result);
            }
        });
        svg.appendChild(bg);

        const defs = svgEl("defs");
        svg.appendChild(defs);

        const linksG = svgEl("g", { class: "poll-links" });
        const linkEls = [];
        const edgeDom = [];
        const sortedEdges = [...edges].sort((a, b) => a.link.count - b.link.count);

        sortedEdges.forEach((e) => {
            const l = e.link;
            const w = Math.max(1.5, +(strokeWidth(l.count, maxCount) * 0.72).toFixed(2));
            const op = strokeOpacity(l.count, maxCount);
            const color = GROUP_COLORS[l.group] || "#7db0ff";

            const g = svgEl("g", {
                class: "poll-link",
                tabindex: "0",
                role: "button",
                "aria-label": `${displayOf(DATA.insects[l.insect]).text} visiting ${displayOf(DATA.plants[l.plant]).text}: ${l.count} ${l.count === 1 ? "observation" : "observations"}`,
            });
            const hit = svgEl("line", { class: "poll-link-hit", "stroke-width": Math.max(12, w + 8) });
            const line = svgEl("line", {
                class: "poll-link-stroke",
                stroke: color,
                "stroke-width": w,
                "stroke-opacity": op,
            });
            const title = svgEl("title");
            title.textContent = `${displayOf(DATA.insects[l.insect]).text} → ${displayOf(DATA.plants[l.plant]).text} (${l.count} ${l.count === 1 ? "observation" : "observations"})`;
            g.append(title, hit, line);

            const target = { type: "link", insect: l.insect, plant: l.plant };
            g.addEventListener("pointerenter", () => { hovered = target; applyHighlight(); });
            g.addEventListener("pointerleave", () => { hovered = null; applyHighlight(); });
            g.addEventListener("click", (ev) => { ev.stopPropagation(); selectTarget(target); });
            g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectTarget(target); } });

            linksG.appendChild(g);
            linkEls.push({ node: g, link: l });
            edgeDom.push({ edge: e, hit, line });
        });
        svg.appendChild(linksG);

        const nodesG = svgEl("g", { class: "poll-nodes" });
        const nodeEls = [];
        const nodeDom = [];
        let suppressClickUntil = 0;
        let rafId = null;
        let liveAlpha = 0;

        const liveRepulse = baseRepulse * Math.max(0.25, fitScale * fitScale);
        const liveRest = baseRest * Math.max(0.55, fitScale);
        const livePad = Math.max(4, collPad * Math.max(0.6, fitScale));

        function paintPositions() {
            for (let i = 0; i < edgeDom.length; i++) {
                const { edge, hit, line } = edgeDom[i];
                const x1 = edge.a.x.toFixed(1), y1 = edge.a.y.toFixed(1);
                const x2 = edge.b.x.toFixed(1), y2 = edge.b.y.toFixed(1);
                hit.setAttribute("x1", x1); hit.setAttribute("y1", y1);
                hit.setAttribute("x2", x2); hit.setAttribute("y2", y2);
                line.setAttribute("x1", x1); line.setAttribute("y1", y1);
                line.setAttribute("x2", x2); line.setAttribute("y2", y2);
            }
            for (let i = 0; i < nodeDom.length; i++) {
                const { n, g } = nodeDom[i];
                g.setAttribute("transform", `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`);
            }
        }

        function runLiveLoop() {
            if (rafId !== null) return;
            const tick = () => {
                stepSim(liveAlpha, liveRepulse, liveRest, width * 0.5, height * 0.5, gxPre * 0.7, gyPre * 0.7, livePad, true);
                paintPositions();
                liveAlpha *= 0.94;
                if (liveAlpha > 0.012 || nodes.some((n) => n.fx !== null)) {
                    rafId = requestAnimationFrame(tick);
                } else {
                    rafId = null;
                }
            };
            rafId = requestAnimationFrame(tick);
        }

        activeSimCancel = () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = null;
        };

        function svgPoint(ev) {
            const pt = svg.createSVGPoint();
            pt.x = ev.clientX;
            pt.y = ev.clientY;
            const ctm = svg.getScreenCTM();
            return ctm ? pt.matrixTransform(ctm.inverse()) : { x: width * 0.5, y: height * 0.5 };
        }

        nodes.forEach((n) => {
            const disp = displayOf(n.taxon);
            const isPlant = n.type === "plant";
            const intro = isPlant && Boolean(n.taxon?.introduced);
            const ringColor = isPlant
                ? (intro ? PLANT_INTRO_COLOR : PLANT_NATIVE_COLOR)
                : (GROUP_COLORS[n.taxon?.group] || "#7db0ff");

            const g = svgEl("g", {
                class: "poll-net-node poll-node-" + n.type,
                tabindex: "0",
                role: "button",
                "aria-label": `${disp.text} (${n.total} ${n.total === 1 ? "interaction" : "interactions"})`,
            });

            const clipId = `nclip-${n.type}-${n.id}`;
            const clip = svgEl("clipPath", { id: clipId });
            const r = n.r;
            if (isPlant) {
                const s = (r - 1) * 2;
                clip.appendChild(svgEl("rect", { x: -(r - 1), y: -(r - 1), width: s, height: s, rx: 5 }));
                g.appendChild(svgEl("rect", {
                    class: "poll-avatar-bg",
                    x: -r, y: -r, width: r * 2, height: r * 2, rx: 6,
                    stroke: ringColor,
                    "stroke-dasharray": intro ? "3 2" : "",
                }));
            } else {
                clip.appendChild(svgEl("circle", { cx: 0, cy: 0, r: r - 1 }));
                g.appendChild(svgEl("circle", {
                    class: "poll-avatar-bg",
                    cx: 0, cy: 0, r,
                    stroke: ringColor,
                }));
            }
            defs.appendChild(clip);

            if (n.taxon?.photo) {
                g.appendChild(svgEl("image", {
                    href: n.taxon.photo,
                    x: -(r - 1), y: -(r - 1),
                    width: (r - 1) * 2, height: (r - 1) * 2,
                    "clip-path": `url(#${clipId})`,
                    preserveAspectRatio: "xMidYMid slice",
                }));
            } else {
                g.appendChild(svgEl("circle", { cx: 0, cy: 0, r: 4, fill: ringColor }));
            }

            const isPrimary = primaryLabelKeys.has(n.key);
            const label = svgEl("text", {
                class: "poll-net-label" + (disp.scientific ? " scientific" : "") + (isPrimary ? "" : " is-secondary"),
                x: 0,
                y: r + 12,
                "text-anchor": "middle",
            });
            label.textContent = truncate(disp.text, narrow ? 16 : 22);
            const title = svgEl("title");
            title.textContent = `${disp.text}${n.taxon?.common_name && n.taxon?.name ? ` (${n.taxon.name})` : ""} — ${n.total} ${n.total === 1 ? "interaction" : "interactions"}`;
            g.append(title, label);

            const target = { type: n.type, id: n.id };
            g.addEventListener("pointerenter", () => { hovered = target; applyHighlight(); });
            g.addEventListener("pointerleave", () => { hovered = null; applyHighlight(); });
            g.addEventListener("click", (ev) => {
                ev.stopPropagation();
                if (performance.now() < suppressClickUntil) return;
                selectTarget(target);
            });
            g.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); selectTarget(target); }
            });

            // Interactive drag to tug clusters apart and explore
            g.addEventListener("pointerdown", (ev) => {
                if (ev.button !== 0) return;
                ev.stopPropagation();
                const startX = ev.clientX, startY = ev.clientY;
                let dragging = false;

                const onMove = (me) => {
                    if (!dragging && Math.hypot(me.clientX - startX, me.clientY - startY) > 4) {
                        dragging = true;
                        g.classList.add("is-dragging");
                    }
                    if (!dragging) return;
                    const p = svgPoint(me);
                    const m = n.r + 8;
                    n.fx = Math.max(m, Math.min(width - m, p.x));
                    n.fy = Math.max(m, Math.min(height - m - 14, p.y));
                    liveAlpha = Math.max(liveAlpha, 0.24);
                    runLiveLoop();
                };
                const onUp = () => {
                    window.removeEventListener("pointermove", onMove);
                    window.removeEventListener("pointerup", onUp);
                    window.removeEventListener("pointercancel", onUp);
                    if (dragging) {
                        g.classList.remove("is-dragging");
                        n.fx = null;
                        n.fy = null;
                        liveAlpha = Math.max(liveAlpha, 0.14);
                        suppressClickUntil = performance.now() + 90;
                    }
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
                window.addEventListener("pointercancel", onUp);
            });

            nodesG.appendChild(g);
            nodeEls.push({ node: g, type: n.type, id: n.id });
            nodeDom.push({ n, g });
        });

        svg.appendChild(nodesG);
        paintPositions();
        stageEl.appendChild(svg);

        rendered = { links, linkEls, nodeEls };
        applyHighlight();
        renderLegend(maxCount, nodes.some((n) => n.type === "plant" && n.taxon?.introduced), "network");
    }

    function renderLegend(maxCount, hasIntro, view) {
        legendEl.replaceChildren();
        const scale = el("span", "poll-legend-item");
        scale.append("Line width = observations");
        const samples = maxCount <= 1 ? [1] : maxCount === 2 ? [1, 2] : [1, Math.round((1 + maxCount) / 2), maxCount];
        samples.forEach((n) => {
            const chip = el("span", "poll-legend-sample");
            const bar = el("span", "poll-legend-bar");
            bar.style.height = Math.min(12, Math.max(2, strokeWidth(n, maxCount))) + "px";
            chip.append(bar, `${n}×`);
            scale.appendChild(chip);
        });
        legendEl.appendChild(scale);

        if (view === "network") {
            const shapes = el("span", "poll-legend-item");
            shapes.append(
                el("span", "poll-legend-shape"), "Insect",
                el("span", "poll-legend-shape is-plant"), hasIntro ? "Native / unknown flower" : "Flower"
            );
            if (hasIntro) shapes.append(el("span", "poll-legend-shape is-intro"), "Introduced in CO");
            legendEl.appendChild(shapes);
            legendEl.appendChild(el("span", "poll-legend-item", "Drag nodes to explore clusters"));
        } else if (hasIntro) {
            const nat = el("span", "poll-legend-item");
            const d1 = el("span", "poll-legend-ring is-native");
            const d2 = el("span", "poll-legend-ring is-intro");
            nat.append(d1, "Native / unknown plant", d2, "Introduced in CO");
            legendEl.appendChild(nat);
        }
    }

    // ---------- Side Panel ----------

    function totalUnannotated() {
        return topSpaces.reduce((sum, s) => sum + (DATA.unannotated[s.id] || 0), 0);
    }

    function taxonBadge(taxon, ringColor) {
        const wrap = el("span", "poll-thumb");
        wrap.style.borderColor = ringColor;
        if (taxon?.photo) {
            const img = el("img");
            img.src = taxon.photo;
            img.alt = "";
            img.loading = "lazy";
            wrap.appendChild(img);
        }
        return wrap;
    }

    function renderPanel(result) {
        const { shown: links, totalMatching } = result;
        panelEl.replaceChildren();
        if (state.selected) {
            const pool = links.some((l) => matchesFocus(l, state.selected)) ? links : totalMatching;
            if (state.selected.type === "link") renderLinkDetail(pool, state.selected.insect, state.selected.plant);
            else renderNodeDetail(pool, state.selected.type, state.selected.id);
            return;
        }

        const uniqueInsects = new Set(totalMatching.map((l) => l.insect)).size;
        const uniquePlants = new Set(totalMatching.map((l) => l.plant)).size;
        const totalObs = state.scope === "colorado" && !state.localOnly && !state.query.trim() && state.groups.size === allGroupIds.length
            ? (DATA.co_observations || 0)
            : totalMatching.reduce((s, l) => s + l.count, 0);

        const stats = el("dl", "poll-stats");
        [
            [totalObs, totalObs === 1 ? "Observation" : "Observations"],
            [uniqueInsects, uniqueInsects === 1 ? "Insect" : "Insects"],
            [uniquePlants, uniquePlants === 1 ? "Flower" : "Flowers"],
        ].forEach(([val, label]) => {
            const div = el("div");
            div.append(el("dd", null, val.toLocaleString()), el("dt", null, label));
            stats.appendChild(div);
        });
        panelEl.appendChild(stats);

        if (totalMatching.length > 0) {
            panelEl.appendChild(el("h2", "panel-heading", state.scope === "colorado" ? "Most Observed in Colorado" : "Most Observed Pairs"));
            const ul = el("ul", "poll-pair-list");
            [...totalMatching].sort((a, b) => b.count - a.count || displayOf(DATA.insects[a.insect]).text.localeCompare(displayOf(DATA.insects[b.insect]).text))
                .slice(0, 8)
                .forEach((l) => {
                    const ins = DATA.insects[l.insect];
                    const plt = DATA.plants[l.plant];
                    const li = el("li");
                    const btn = el("button", "poll-pair-btn");
                    btn.type = "button";
                    const thumbs = el("span", "poll-pair-thumbs");
                    thumbs.append(
                        taxonBadge(ins, GROUP_COLORS[l.group] || "#7db0ff"),
                        taxonBadge(plt, plt?.introduced ? PLANT_INTRO_COLOR : PLANT_NATIVE_COLOR)
                    );
                    const text = el("span", "poll-pair-text");
                    const insD = displayOf(ins);
                    const pltD = displayOf(plt);
                    const line = el("span", "poll-pair-names");
                    line.append(
                        el("span", insD.scientific ? "scientific" : null, insD.text),
                        " → ",
                        el("span", pltD.scientific ? "scientific" : null, pltD.text)
                    );
                    const localBit = state.scope === "colorado" && l.localCount > 0 ? ` · ${l.localCount} local` : "";
                    text.append(line, el("span", "poll-pair-meta", `${l.count} ${l.count === 1 ? "observation" : "observations"}${localBit}`));
                    btn.append(thumbs, text);
                    btn.addEventListener("click", () => selectTarget({ type: "link", insect: l.insect, plant: l.plant }));
                    li.appendChild(btn);
                    ul.appendChild(li);
                });
            panelEl.appendChild(ul);
        }

        const spc = state.scope === "spaces" && state.space !== "all" ? byId[state.space] : null;
        const unannTotal = spc ? (DATA.unannotated[spc.id] || 0) : totalUnannotated();
        panelEl.appendChild(el("h2", "panel-heading", "Grow This Network"));
        const lede = el("p", "panel-lede", unannTotal > 0
            ? `${unannTotal.toLocaleString()} bee & butterfly observations ${spc ? `at ${shortName(spc)}` : "in our spaces"} don't have a flower recorded yet.`
            : "Add the flower on any pollinator photo to grow this graph.");
        const how = el("p", "poll-how", 'Open a pollinator on iNaturalist, choose "Add a Field", search for "Nectar / Pollen delivering plant", and enter the flower.');
        panelEl.append(lede, how);

        const targetSpaces = spc
            ? [spc]
            : topSpaces.filter((s) => (DATA.unannotated[s.id] || 0) > 0)
                .sort((a, b) => (DATA.unannotated[b.id] || 0) - (DATA.unannotated[a.id] || 0))
                .slice(0, 5);

        if (targetSpaces.length) {
            const list = el("ul", "poll-help-spaces");
            targetSpaces.forEach((s) => {
                const n = DATA.unannotated[s.id] || 0;
                const li = el("li");
                const a = el("a", "poll-help-link");
                a.href = `https://www.inaturalist.org/observations?${spaceAreaQuery(s)}&taxon_ids=630955,47157&verifiable=true&subview=grid`;
                a.target = "_blank";
                a.rel = "noopener";
                a.append(el("span", null, shortName(s)), el("span", "poll-help-count", `${n.toLocaleString()} to annotate ↗`));
                li.appendChild(a);
                list.appendChild(li);
            });
            panelEl.appendChild(list);
        }
    }

    function backButton() {
        const btn = el("button", "poll-back-btn", "← All interactions");
        btn.type = "button";
        btn.addEventListener("click", () => {
            state.selected = null;
            syncHash(true);
            applyHighlight();
            renderPanel(filteredLinks());
        });
        return btn;
    }

    function renderNodeDetail(links, type, id) {
        const taxon = type === "insect" ? DATA.insects[id] : DATA.plants[id];
        const disp = displayOf(taxon);
        const matching = links.filter((l) => (type === "insect" ? l.insect === id : l.plant === id))
            .sort((a, b) => b.count - a.count);

        panelEl.appendChild(backButton());

        const head = el("div", "poll-detail-head");
        const ring = type === "insect"
            ? (GROUP_COLORS[taxon?.group] || "#7db0ff")
            : (taxon?.introduced ? PLANT_INTRO_COLOR : PLANT_NATIVE_COLOR);
        head.appendChild(taxonBadge(taxon, ring));
        const titles = el("div", "poll-detail-titles");
        const h2 = el("h2", "panel-title");
        const a = el("a", disp.scientific ? "scientific" : null, disp.text);
        a.href = "https://www.inaturalist.org/taxa/" + id;
        a.target = "_blank";
        a.rel = "noopener";
        h2.appendChild(a);
        titles.appendChild(h2);
        if (taxon?.common_name && taxon?.name) titles.appendChild(el("p", "panel-subtitle scientific", taxon.name));
        if (type === "plant" && taxon?.introduced) titles.appendChild(el("p", "poll-tag", "Introduced in Colorado"));
        if (state.scope === "colorado" && taxon?.in_spaces) titles.appendChild(el("p", "poll-tag is-local", "Recorded in our spaces"));
        head.appendChild(titles);
        panelEl.appendChild(head);

        const totalObs = matching.reduce((s, l) => s + l.count, 0);
        const scopeWord = state.scope === "colorado" ? " across Colorado" : "";
        panelEl.appendChild(el("p", "panel-lede",
            type === "insect"
                ? `Observed visiting ${matching.length} ${matching.length === 1 ? "flower" : "flowers"} (${totalObs} ${totalObs === 1 ? "observation" : "observations"}${scopeWord}).`
                : `Visited by ${matching.length} ${matching.length === 1 ? "insect" : "insects"} (${totalObs} ${totalObs === 1 ? "observation" : "observations"}${scopeWord}).`
        ));

        panelEl.appendChild(el("h3", "panel-heading", type === "insect" ? "Flowers Visited" : "Visiting Insects"));
        const ul = el("ul", "poll-pair-list");
        matching.forEach((l) => {
            const partnerId = type === "insect" ? l.plant : l.insect;
            const partner = type === "insect" ? DATA.plants[partnerId] : DATA.insects[partnerId];
            const pDisp = displayOf(partner);
            const pRing = type === "insect"
                ? (partner?.introduced ? PLANT_INTRO_COLOR : PLANT_NATIVE_COLOR)
                : (GROUP_COLORS[l.group] || "#7db0ff");
            const li = el("li");
            const btn = el("button", "poll-pair-btn");
            btn.type = "button";
            const text = el("span", "poll-pair-text");
            const localBit = state.scope === "colorado" && l.localCount > 0 ? ` · ${l.localCount} local` : "";
            text.append(
                el("span", "poll-pair-names" + (pDisp.scientific ? " scientific" : ""), pDisp.text),
                el("span", "poll-pair-meta", `${l.count} ${l.count === 1 ? "observation" : "observations"}${localBit}`)
            );
            btn.append(taxonBadge(partner, pRing), text);
            btn.addEventListener("click", () => selectTarget({ type: "link", insect: l.insect, plant: l.plant }));
            li.appendChild(btn);
            ul.appendChild(li);
        });
        panelEl.appendChild(ul);
    }

    function renderLinkDetail(links, insectId, plantId) {
        const link = links.find((l) => l.insect === insectId && l.plant === plantId);
        const ins = DATA.insects[insectId];
        const plt = DATA.plants[plantId];
        const insD = displayOf(ins);
        const pltD = displayOf(plt);

        panelEl.appendChild(backButton());

        const head = el("div", "poll-link-detail");
        const thumbs = el("div", "poll-pair-thumbs is-large");
        thumbs.append(
            taxonBadge(ins, GROUP_COLORS[ins?.group] || "#7db0ff"),
            taxonBadge(plt, plt?.introduced ? PLANT_INTRO_COLOR : PLANT_NATIVE_COLOR)
        );
        const h2 = el("h2", "panel-title");
        h2.append(
            el("span", insD.scientific ? "scientific" : null, insD.text),
            " → ",
            el("span", pltD.scientific ? "scientific" : null, pltD.text)
        );
        head.append(thumbs, h2);
        panelEl.appendChild(head);

        const count = link ? link.count : 0;
        const obsIds = link ? link.obs : [];
        const seenSpaces = topSpaces.filter((s) => (link?.by_space?.[s.id] || []).length > 0);
        let summary;
        if (state.scope === "colorado") {
            summary = `Observed ${count} ${count === 1 ? "time" : "times"} in Colorado`;
            if (seenSpaces.length) summary += ` (including ${link.localCount} in ${seenSpaces.map((s) => shortName(s)).join(", ")})`;
            summary += ".";
        } else {
            const where = seenSpaces.length ? " across " + seenSpaces.map((s) => shortName(s)).join(", ") : "";
            summary = `Observed ${count} ${count === 1 ? "time" : "times"}${where}.`;
        }
        panelEl.appendChild(el("p", "panel-lede", summary));

        if (state.scope === "colorado" && !seenSpaces.length && ins?.in_spaces && plt?.in_spaces) {
            panelEl.appendChild(el("p", "poll-tag is-local", "Both species occur in our spaces — not annotated here yet"));
        }
        if (plt?.introduced) panelEl.appendChild(el("p", "poll-tag", "Plant is listed as introduced in Colorado"));

        const chips = el("div", "poll-jump-row");
        const bIns = el("button", "poll-jump-btn", `All flowers for ${insD.text}`);
        bIns.type = "button";
        bIns.addEventListener("click", () => selectTarget({ type: "insect", id: insectId }));
        const bPlt = el("button", "poll-jump-btn", `All insects on ${pltD.text}`);
        bPlt.type = "button";
        bPlt.addEventListener("click", () => selectTarget({ type: "plant", id: plantId }));
        chips.append(bIns, bPlt);
        panelEl.appendChild(chips);

        if (obsIds.length) {
            const localIds = new Set();
            topSpaces.forEach((s) => (link?.by_space?.[s.id] || []).forEach((id) => localIds.add(id)));
            const orderedObs = [
                ...Array.from(localIds).sort((a, b) => b - a),
                ...obsIds.filter((id) => !localIds.has(id)),
            ].slice(0, Math.max(obsIds.length, localIds.size));
            const showingNote = count > orderedObs.length ? ` (recent ${orderedObs.length} of ${count})` : ` (${orderedObs.length})`;
            panelEl.appendChild(el("h3", "panel-heading", `iNaturalist Observations${showingNote}`));
            const ul = el("ul", "poll-obs-list");
            orderedObs.forEach((oid) => {
                const li = el("li");
                const a = el("a", "poll-obs-link");
                a.href = "https://www.inaturalist.org/observations/" + oid;
                a.target = "_blank";
                a.rel = "noopener";
                const spNames = topSpaces.filter((s) => (link?.by_space?.[s.id] || []).includes(oid)).map((s) => shortName(s));
                a.append(
                    el("span", "poll-obs-id", `Observation #${oid}`),
                    el("span", "poll-obs-where" + (spNames.length ? " is-local" : ""), (spNames.join(", ") || "Colorado") + " ↗")
                );
                li.appendChild(a);
                ul.appendChild(li);
            });
            panelEl.appendChild(ul);
        }
    }

    // ---------- Main render ----------

    function render() {
        const result = filteredLinks();
        renderGraph(result);
        renderPanel(result);
    }

    parseHash();
    buildControls();
    render();

    if (creditsEl) {
        const link = (text, href) => Object.assign(el("a", null, text), { href, target: "_blank", rel: "noopener" });
        const updated = DATA.updated ? ` · Updated ${DATA.updated}` : "";
        creditsEl.append("Flower interactions from ", link("iNaturalist", "https://www.inaturalist.org/"),
            " observation fields (open-coordinate verifiable observations)", updated);
    }

    let resizeTimer = null;
    if (typeof ResizeObserver === "function") {
        new ResizeObserver(() => {
            const w = stageEl.clientWidth || 720;
            if (Math.abs(w - lastStageWidth) < 4) return;
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => renderGraph(filteredLinks()), 80);
        }).observe(stageEl);
    }
})();
