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

// The space's area as an inaturalist.org query string: its place, or its bounding box (the
// site can't apply `exclude` boxes, so links for those spaces include the excluded corner)
function spaceAreaQuery(spc) {
    if (!spc.bbox) return "place_id=" + encodeURIComponent(spc.place_id);
    const [[lat1, lng1], [lat2, lng2]] = spc.bbox;
    return new URLSearchParams({
        nelat: Math.max(lat1, lat2), nelng: Math.max(lng1, lng2),
        swlat: Math.min(lat1, lat2), swlng: Math.min(lng1, lng2),
    }).toString();
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

// "Signature Species" heading, one-line explanation and ranked list (the first `limit` of it)
function signatureSection(spc, heading_tag = "h3", limit = Infinity) {
    const parts = [el(heading_tag, "panel-heading", "Signature Species")];
    const list = FEATURED.by_space[spc.id] || [];
    if (list.length === 0) {
        parts.push(el("p", "panel-hint", "Not enough observations here yet."));
        return parts;
    }
    parts.push(el("p", "panel-lede", "Species seen here more than at other spaces."));
    const ol = el("ol", "featured-species");
    list.slice(0, limit).forEach((sp) => {
        // Its iNaturalist observations at this site; an eBird-only bird has none, so its species page
        const a = el("a");
        a.href = sp.ebird_only
            ? "https://www.inaturalist.org/taxa/" + sp.taxon_id
            : `https://www.inaturalist.org/observations?${spaceAreaQuery(spc)}&taxon_id=${sp.taxon_id}&verifiable=true`;
        a.target = "_blank";
        a.rel = "noopener";
        // A bird seen here only on eBird gets the eBird logo on its photo
        const photo = el("span", "featured-photo");
        photo.appendChild(speciesPhoto(sp.photo, sp.attribution));
        if (sp.ebird_only) {
            const badge = el("img", "ebird-badge");
            badge.src = "images/logos/ebird.png";
            badge.alt = "Observed only on eBird";
            badge.title = "Observed only on eBird";
            photo.appendChild(badge);
        }
        a.appendChild(photo);
        const text = el("span", "featured-text");
        const display = taxonDisplayName({ preferred_common_name: sp.common_name, name: sp.name });
        const common = el("span", "featured-common", display.text);
        if (display.scientific) common.classList.add("scientific");
        text.appendChild(common);
        if (sp.common_name) text.appendChild(el("span", "featured-sci", sp.name));
        const where = sp.spaces === 1 ? "only here" : `in ${sp.spaces} of ${FEATURED.spaces_compared} spaces`;
        // Counts: iNaturalist observations, eBird records, or (for birds on both) records of either
        const n = sp.count.toLocaleString();
        const counted = sp.ebird_only ? `${n} eBird ${sp.count === 1 ? "record" : "records"}`
            : sp.ebird_count ? `${n} records`
            : `${n} ${sp.count === 1 ? "observation" : "observations"}`;
        const meta = el("span", "featured-meta", `${counted} · ${where}`);
        if (sp.ebird_count && !sp.ebird_only) {
            const inat = sp.count - sp.ebird_count;
            meta.title = `${inat.toLocaleString()} iNaturalist ${inat === 1 ? "observation" : "observations"} and ${sp.ebird_count.toLocaleString()} eBird ${sp.ebird_count === 1 ? "record" : "records"}`;
        }
        text.appendChild(meta);
        a.appendChild(text);
        const li = el("li");
        li.appendChild(a);
        ol.appendChild(li);
    });
    parts.push(ol);
    return parts;
}

// One species (from js/species_network.js) as a small photo + name link
// Species recorded at the space only on eBird, not iNaturalist
function ebirdOnly(space_id, group_id, id) {
    return (NETWORK_DATA.ebird_only?.[space_id]?.[group_id] || []).includes(Number(id));
}

// With a space, the link opens the species' iNaturalist observations there (unless only
// eBird has recorded it there, which leaves the species page)
function networkSpeciesItem(id, tag = "li", note = "", spc = null, group_id = null) {
    const sp = NETWORK_DATA.species[id] || { name: "Taxon " + id, common_name: "", photo: "" };
    const item = el(tag, "network-species");
    const a = el("a");
    a.href = spc && !ebirdOnly(spc.id, group_id, id)
        ? `https://www.inaturalist.org/observations?${spaceAreaQuery(spc)}&taxon_id=${id}&verifiable=true`
        : "https://www.inaturalist.org/taxa/" + id;
    a.target = "_blank";
    a.rel = "noopener";
    a.appendChild(speciesPhoto(sp.photo));
    const display = taxonDisplayName({ preferred_common_name: sp.common_name, name: sp.name });
    const name = el("span", null, display.text);
    if (display.scientific) name.classList.add("scientific");
    if (note) {
        const wrap = el("span", "network-species-text");
        wrap.append(name, el("span", "network-species-note", note));
        a.appendChild(wrap);
    } else {
        a.appendChild(name);
    }
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
    const ul = el("ul", "connections net-" + group_id);
    connectionsOf(spc, spaces, group_id).forEach(({ other, link }) => {
        // Every comparable pair opens its comparison; with nothing on either side, help instead
        const row = el("a", "connection" + (link.gap ? " is-gap" : ""));
        row.href = link.selectable ? hrefFor(other) : helpHref(thinnerSpace(link, group_id));
        row.dataset.space = other.id; // hovering the row highlights that space on the landing map
        row.appendChild(el("span", "connection-name", shortName(other)));
        // Short details (the view already names the group); every row keeps a bar, gray when the
        // pair needs more records before its similarity means much
        const pct = link.similarity === null ? 0 : Math.round(link.similarity * 100);
        let detail;
        if (link.similarity === null) detail = "No records yet";
        else if (link.shared === 0) detail = "None shared yet";
        else if (link.thin) detail = `${link.shared} shared · few records`; // no percentage from a handful of records
        else detail = `${link.shared} shared · ${pct}% alike`;
        row.appendChild(el("span", "connection-detail", detail));
        const bar = el("span", "connection-bar" + (link.gap ? " is-muted-bar" : ""));
        bar.style.setProperty("--pct", (link.thin ? 0 : pct) + "%");
        bar.setAttribute("aria-hidden", "true");
        row.appendChild(bar);
        const li = el("li");
        li.appendChild(row);
        ul.appendChild(li);
    });
    return ul;
}

// "More data needed →" for a thinly observed group at a space, or an invitation when it has none
function dataFlag(spc, group_id, obs) {
    const flag = el("a", "network-flag", obs === 0 ? `Be the first to record ${groupLabel(group_id).toLowerCase()} here →` : "More data needed →");
    flag.href = helpHref(spc);
    return flag;
}

// How well surveyed: five bars, one more for every tenfold step in records (under 30, 30+,
// 300+, 3,000+, 30,000+). Site record counts span four orders of magnitude, so a plain bar
// would show one site and six slivers.
function effortMeter(obs) {
    const level = obs === 0 ? 0 : 1 + [30, 300, 3000, 30000].filter((n) => obs >= n).length;
    const meter = el("span", "effort-meter");
    meter.setAttribute("role", "img");
    meter.setAttribute("aria-label", `Survey effort ${level} of 5`);
    for (let i = 1; i <= 5; i++) meter.appendChild(el("span", i <= level ? "is-on" : null));
    return meter;
}

// "N species · N records" with the effort meter, and a flag when the group is thinly observed
function effortLine(spc, group_id) {
    const n = (NETWORK_DATA.by_space[spc.id]?.[group_id] || []).length;
    const { obs, low } = spaceEffort(NETWORK_DATA, spc.id, group_id);
    const p = el("p", "effort-line");
    p.append(effortMeter(obs), `${n} native species · ${obs.toLocaleString()} ${obs === 1 ? "record" : "records"}`);
    if (low) p.appendChild(dataFlag(spc, group_id, obs));
    return p;
}

// Species of a group recorded at this space and at no other
function onlyHere(spc, spaces, group_id) {
    const elsewhere = new Set(spaces.filter((o) => o.id !== spc.id).flatMap((o) => NETWORK_DATA.by_space[o.id]?.[group_id] || []));
    return (NETWORK_DATA.by_space[spc.id]?.[group_id] || []).filter((id) => !elsewhere.has(id));
}

// A collapsed species list: "<summary> (n)" that opens to photo + name rows
function speciesDetails(summary, ids, spc, group_id) {
    const details = el("details", "species-details");
    details.appendChild(el("summary", null, `${summary} (${ids.length})`));
    const ul = el("ul", "species-grid");
    sortedSpecies(ids).forEach((id) => ul.appendChild(networkSpeciesItem(id, "li", spc && ebirdOnly(spc.id, group_id, id) ? "eBird only" : "", spc, group_id)));
    details.appendChild(ul);
    return details;
}

// Source credit for both pages; eBird's records are CC BY and reach GBIF about a year behind
function creditsLine() {
    const p = el("p", "credits");
    const link = (text, href) => Object.assign(el("a", null, text), { href, target: "_blank", rel: "noopener" });
    const through = NETWORK_DATA.ebird_through ? `, through ${NETWORK_DATA.ebird_through}` : "";
    p.append("Bird records: ", link("eBird", "https://ebird.org/"), " (Cornell Lab of Ornithology) via ", link("GBIF.org", "https://www.gbif.org/dataset/4fa7b334-ce0d-4e88-aaae-2e0c138d049e"),
        `${through} · Other records: `, link("iNaturalist", "https://www.inaturalist.org/"));
    return p;
}
