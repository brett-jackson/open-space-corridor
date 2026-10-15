const resp_params = {
    "id" : true,
    "species_guess" : true,
    "observed_on" : true,
    "user" : {
        "login" : true,
        "icon_url" : true
    },
    "observation_photos" : "all"
};
const params = {
    "verifiable" : true,
    "order_by" : "observed_on",
    "order" : "desc",
    "place_id" : PLACE_ID,
    "per_page" : 80,
};
const ROW_COUNT = 3;
const GAP_AR = 0.03; // the gap between tiles, as a fraction of row height

document.title = SPACE_NAME + " Open Space";
document.getElementById("space-title").textContent = "Activity at " + SPACE_NAME;

const grid = document.getElementById("grid");
grid.setAttribute("aria-label", "Activity at " + SPACE_NAME);
const prev = document.getElementById("prev");
const next = document.getElementById("next");

// One flex row per strip; row lengths are tracked in units of row height
const rows = [];
const rowLengths = [];
for (let i = 0; i < ROW_COUNT; i++) {
    const row = document.createElement("div");
    row.className = "mosaic-row";
    grid.appendChild(row);
    rows.push(row);
    rowLengths.push(0);
}

let shown = 0;
let page = 0;
let done = false;
let loading = false;

function mainPhoto(obs) {
    return obs.observation_photos?.[0]?.photo;
}

function aspectRatio(photo) {
    const dims = photo.original_dimensions;
    return dims && dims.width && dims.height ? dims.width / dims.height : 1;
}

function makeTile(obs, ar) {
    const photo = mainPhoto(obs);

    const a = document.createElement("a");
    a.className = "tile";
    a.href = "https://www.inaturalist.org/observations/" + obs.id;
    a.target = "_blank";
    a.rel = "noopener";
    a.style.setProperty("--ar", ar.toFixed(4));

    // iNat returns the square thumbnail; swap to large so tiles stay sharp
    const img = document.createElement("img");
    img.src = photo.url.replace("/square.", "/large.");
    img.alt = obs.species_guess || "";
    img.loading = "lazy";
    a.appendChild(img);

    const info = document.createElement("div");
    info.className = "tile-info";
    const h2 = document.createElement("h2");
    h2.textContent = obs.species_guess || "Unknown species";
    info.appendChild(h2);
    const p = document.createElement("p");
    p.textContent = [obs.user?.login && "Observed by " + obs.user.login, obs.observed_on]
        .filter(Boolean).join(" · ");
    info.appendChild(p);
    a.appendChild(info);

    // Observer avatar, always visible; users without a profile photo get their initial
    const avatar = document.createElement("span");
    avatar.className = "tile-avatar";
    avatar.title = obs.user?.login || "";
    if (obs.user?.icon_url) {
        const icon = document.createElement("img");
        icon.src = obs.user.icon_url;
        icon.alt = "";
        icon.loading = "lazy";
        avatar.appendChild(icon);
    } else {
        avatar.textContent = (obs.user?.login || "?").charAt(0).toUpperCase();
    }
    a.appendChild(avatar);
    return a;
}

// Add each tile to whichever row is currently shortest, keeping the strip's right edge even
function addTile(obs) {
    const ar = aspectRatio(mainPhoto(obs));
    const i = rowLengths.indexOf(Math.min(...rowLengths));
    rows[i].appendChild(makeTile(obs, ar));
    rowLengths[i] += ar + GAP_AR;
    shown += 1;
}

async function loadMore() {
    if (loading || done) return;
    loading = true;
    const json_obj = await inat_request("observations", resp_params, {...params, "page" : page + 1});
    if (!json_obj || json_obj.results.length === 0) {
        done = true; // stop paging if the API runs dry or errors
    } else {
        page += 1;
        json_obj.results.filter((obs) => mainPhoto(obs)?.url).forEach(addTile);
        if (page * params.per_page >= json_obj.total_results) done = true;
    }
    loading = false;
    update();
}

function nearEnd() {
    return grid.scrollLeft + grid.clientWidth > grid.scrollWidth - grid.clientWidth;
}

// Fade an edge only when there is more tapestry beyond it, and keep a screen of tiles buffered ahead
function update() {
    const atStart = grid.scrollLeft <= 1;
    const atEnd = grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 1;
    grid.classList.toggle("fade-left", !atStart);
    grid.classList.toggle("fade-right", !atEnd || !done);
    prev.disabled = atStart;
    next.disabled = atEnd && done;
    if (nearEnd()) loadMore();
}

grid.addEventListener("scroll", update, { passive: true });
window.addEventListener("resize", update);
prev.addEventListener("click", () => grid.scrollBy({ left: -grid.clientWidth * 0.8, behavior: "smooth" }));
next.addEventListener("click", () => grid.scrollBy({ left: grid.clientWidth * 0.8, behavior: "smooth" }));

loadMore().then(() => {
    if (shown === 0) {
        const msg = document.createElement("p");
        msg.className = "empty";
        msg.innerHTML = "No observations found.";
        document.getElementById("carousel").replaceWith(msg);
    }
});
