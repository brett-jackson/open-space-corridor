// Panel pieces shared by the landing page and space pages: signature species lists, species
// rows, and a space's corridor connections. Needs js/names.js, and js/network.js for the
// connection helpers. Every builder returns DOM nodes; callers decide where they go.

const FEATURED = window.FEATURED_SPECIES || { by_space: {}, spaces_compared: 0 };
const NETWORK_DATA = window.SPECIES_NETWORK || { groups: [], species: {}, by_space: {}, observations: {} };

function shortName(spc) {
    return spc.title.replace(/ Open Space$/, "");
}

function spaceHref(spc) {
    return "space.html?id=" + encodeURIComponent(spc.id);
}

function groupLabel(group_id) {
    return NETWORK_DATA.groups.find((g) => g.id === group_id)?.label || group_id;
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function speciesPhoto(url, credit) {
    if (!url) return el("span", "placeholder");
    const img = el("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    if (credit) img.title = credit; // iNaturalist photo credit
    return img;
}

// "Signature Species" heading, one-line explanation, ranked list and method note
function signatureSection(spc, heading_tag = "h3") {
    const parts = [el(heading_tag, "panel-heading", "Signature Species")];
    const list = FEATURED.by_space[spc.id] || [];
    if (list.length === 0) {
        parts.push(el("p", "panel-hint", "Not enough observations here yet."));
        return parts;
    }
    parts.push(el("p", "panel-lede", "Species seen here more than at other spaces."));
    const ol = el("ol", "featured-species");
    list.forEach((sp) => {
        const a = el("a");
        a.href = "https://www.inaturalist.org/taxa/" + sp.taxon_id;
        a.target = "_blank";
        a.rel = "noopener";
        a.appendChild(speciesPhoto(sp.photo, sp.attribution));
        const text = el("span", "featured-text");
        const common = el("span", "featured-common", sp.common_name ? formatCommonName(sp.common_name) : sp.name);
        if (!sp.common_name) common.classList.add("scientific");
        text.appendChild(common);
        if (sp.common_name) text.appendChild(el("span", "featured-sci", sp.name));
        const where = sp.spaces === 1 ? "only here" : `in ${sp.spaces} of ${FEATURED.spaces_compared} spaces`;
        text.appendChild(el("span", "featured-meta", `${sp.count.toLocaleString()} ${sp.count === 1 ? "observation" : "observations"} · ${where}`));
        a.appendChild(text);
        const li = el("li");
        li.appendChild(a);
        ol.appendChild(li);
    });
    parts.push(ol);
    parts.push(el("p", "panel-note",
        "Ranked by TF-IDF, which weighs how often a species is observed here against how many of the other spaces it appears in. " +
        "Species introduced to Colorado are left out. Photos from iNaturalist; hover a photo for its credit."));
    return parts;
}

// One species (from js/species_network.js) as a small photo + name link
function networkSpeciesItem(id, tag = "li") {
    const sp = NETWORK_DATA.species[id] || { name: "Taxon " + id, common_name: "", photo: "" };
    const item = el(tag, "network-species");
    const a = el("a");
    a.href = "https://www.inaturalist.org/taxa/" + id;
    a.target = "_blank";
    a.rel = "noopener";
    a.appendChild(speciesPhoto(sp.photo));
    const name = el("span", null, sp.common_name ? formatCommonName(sp.common_name) : sp.name);
    if (!sp.common_name) name.classList.add("scientific");
    a.appendChild(name);
    item.appendChild(a);
    return item;
}

function sortedSpecies(ids) {
    const label = (id) => {
        const sp = NETWORK_DATA.species[id];
        return sp ? (sp.common_name || sp.name).toLowerCase() : "";
    };
    return [...ids].sort((x, y) => label(x).localeCompare(label(y)));
}

// A space's links in one group, most similar first: [{ other, link }]
function connectionsOf(spc, spaces, group_id) {
    return corridorLinks(spaces, NETWORK_DATA, group_id)
        .filter((l) => l.a.id === spc.id || l.b.id === spc.id)
        .map((l) => ({ other: l.a.id === spc.id ? l.b : l.a, link: l }))
        .sort((x, y) => (y.link.similarity ?? -1) - (x.link.similarity ?? -1));
}

// List of a space's neighbors in one group with a similarity bar; `hrefFor(other)` gives
// each row's link (or null for a plain row), so pages decide where a row goes
function connectionsList(spc, spaces, group_id, hrefFor) {
    const label = groupLabel(group_id).toLowerCase();
    const ul = el("ul", "connections net-" + group_id);
    connectionsOf(spc, spaces, group_id).forEach(({ other, link }) => {
        const href = link.gap ? null : hrefFor(other);
        const row = el(href ? "a" : "div", "connection" + (link.gap ? " is-gap" : ""));
        if (href) row.href = href;
        row.appendChild(el("span", "connection-name", shortName(other)));
        if (link.similarity === null) {
            row.appendChild(el("span", "connection-detail", "More observations needed to compare"));
        } else if (link.shared === 0) {
            row.appendChild(el("span", "connection-detail", `No shared ${label} recorded yet`));
        } else {
            const pct = Math.round(link.similarity * 100);
            row.appendChild(el("span", "connection-detail", `${link.shared} shared · ${pct}% similar`));
            const bar = el("span", "connection-bar");
            bar.style.setProperty("--pct", pct + "%");
            bar.setAttribute("aria-hidden", "true");
            row.appendChild(bar);
        }
        const li = el("li");
        li.appendChild(row);
        ul.appendChild(li);
    });
    return ul;
}

// "N species · N obs." with a flag when the group is thinly observed at the space
function effortLine(spc, group_id) {
    const n = (NETWORK_DATA.by_space[spc.id]?.[group_id] || []).length;
    const { obs, low } = spaceEffort(NETWORK_DATA, spc.id, group_id);
    const p = el("p", "effort-line", `${n} native species · ${obs.toLocaleString()} observations`);
    if (low) p.appendChild(el("span", "network-flag", "More observations needed"));
    return p;
}
