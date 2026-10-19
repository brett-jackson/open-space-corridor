// Panel pieces shared by the landing page and space pages: signature species lists, species
// rows, and a space's corridor connections. Needs js/names.js, and js/network.js for the
// connection helpers. Every builder returns DOM nodes; callers decide where they go.

const FEATURED = window.FEATURED_SPECIES || { by_space: {}, spaces_compared: 0 };
const NETWORK_DATA = window.SPECIES_NETWORK || { groups: [], species: {}, by_space: {}, observations: {} };
// Birds first (the most complete data), then any other groups in the data file's order
const GROUP_ORDER = ["birds", "bees", "lepidoptera"];
NETWORK_DATA.groups.sort((a, b) => (GROUP_ORDER.indexOf(a.id) + 1 || 99) - (GROUP_ORDER.indexOf(b.id) + 1 || 99));

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
        const display = taxonDisplayName({ preferred_common_name: sp.common_name, name: sp.name });
        const common = el("span", "featured-common", display.text);
        if (display.scientific) common.classList.add("scientific");
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
    const display = taxonDisplayName({ preferred_common_name: sp.common_name, name: sp.name });
    const name = el("span", null, display.text);
    if (display.scientific) name.classList.add("scientific");
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

// A space's links in one group, most similar first and gaps last: [{ other, link }]
function connectionsOf(spc, spaces, group_id) {
    const rank = (link) => (link.gap ? -1 : link.similarity);
    return corridorLinks(spaces, NETWORK_DATA, group_id)
        .filter((l) => l.a.id === spc.id || l.b.id === spc.id)
        .map((l) => ({ other: l.a.id === spc.id ? l.b : l.a, link: l }))
        .sort((x, y) => rank(y.link) - rank(x.link));
}

// The space that most needs observations for a thin or empty link (the one with fewer)
function thinnerSpace(link, group_id) {
    const ea = spaceEffort(NETWORK_DATA, link.a.id, group_id).obs, eb = spaceEffort(NETWORK_DATA, link.b.id, group_id).obs;
    return ea <= eb ? link.a : link.b;
}

// Where to send someone who wants to fill a data gap: that space's How to Help cards
function helpHref(spc) {
    return spaceHref(spc) + "#how-to-help";
}

// List of a space's neighbors in one group with a similarity bar; `hrefFor(other)` gives
// each row's link, so pages decide where a row goes. Rows without enough data link to the
// thinner space's How to Help cards instead.
function connectionsList(spc, spaces, group_id, hrefFor) {
    const label = groupLabel(group_id).toLowerCase();
    const ul = el("ul", "connections net-" + group_id);
    connectionsOf(spc, spaces, group_id).forEach(({ other, link }) => {
        // Every comparable pair opens its comparison; with nothing on either side, help instead
        const row = el("a", "connection" + (link.gap ? " is-gap" : ""));
        row.href = link.selectable ? hrefFor(other) : helpHref(thinnerSpace(link, group_id));
        row.dataset.space = other.id; // hovering the row highlights that space on the landing map
        row.appendChild(el("span", "connection-name", shortName(other)));
        const fewest = thinnerSpace(link, group_id);
        const few = `few records (${spaceEffort(NETWORK_DATA, fewest.id, group_id).obs.toLocaleString()} obs. at ${shortName(fewest)})`;
        if (link.similarity === null) {
            row.appendChild(el("span", "connection-detail", link.selectable ? `Nothing to compare yet · ${few}` : "No observations at either space yet · help add some →"));
        } else if (link.shared === 0) {
            row.appendChild(el("span", "connection-detail", `No shared ${label} recorded yet` + (link.thin ? ` · ${few}` : "")));
        } else {
            const pct = Math.round(link.similarity * 100);
            row.appendChild(el("span", "connection-detail", `${link.shared} shared · ${pct}% similar` + (link.thin ? ` · ${few}` : "")));
            const bar = el("span", "connection-bar" + (link.thin ? " is-thin" : ""));
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
    if (low) {
        const flag = el("a", "network-flag", "More observations needed →");
        flag.href = helpHref(spc);
        p.appendChild(flag);
    }
    return p;
}
