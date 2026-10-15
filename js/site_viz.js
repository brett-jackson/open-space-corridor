const resp_params = {
    "id" : true,
    "species_guess" : true,
    "observed_on" : true,
    "user" : {
        "login" : true
    },
    "observation_photos" : "all"
};
const params = {
    "verifiable" : true,
    "order_by" : "observed_on",
    "order" : "desc",
    "place_id" : PLACE_ID,
    "per_page" : 30,
};
const PAGE_SIZE = 3;

document.title = SPACE_NAME + " Open Space";
document.getElementById("space-title").textContent = "Activity at " + SPACE_NAME;

const grid = document.getElementById("grid");
grid.setAttribute("aria-label", "Activity at " + SPACE_NAME);
const prev = document.getElementById("prev");
const next = document.getElementById("next");

let observations = [];
let offset = 0;
let total = 0;
let page = 1;

function makeCard(obs) {
    const a = document.createElement("a");
    a.className = "space";
    a.href = "https://www.inaturalist.org/observations/" + obs.id;
    a.target = "_blank";
    a.rel = "noopener";

    // iNat returns the square thumbnail; swap to medium for a usable card image
    const url = obs.observation_photos?.[0]?.photo?.url;
    if (url) {
        const img = document.createElement("img");
        img.src = url.replace("/square.", "/medium.");
        img.alt = obs.species_guess || "";
        img.loading = "lazy";
        a.appendChild(img);
    } else {
        const ph = document.createElement("div");
        ph.className = "placeholder";
        a.appendChild(ph);
    }

    const body = document.createElement("div");
    body.className = "space-body";
    const h2 = document.createElement("h2");
    h2.textContent = obs.species_guess || "Unknown species";
    body.appendChild(h2);
    const p = document.createElement("p");
    p.textContent = [obs.user?.login && "Observed by " + obs.user.login, obs.observed_on]
        .filter(Boolean).join(" · ");
    body.appendChild(p);
    a.appendChild(body);
    return a;
}

function render() {
    grid.replaceChildren(...observations.slice(offset, offset + PAGE_SIZE).map(makeCard));
    prev.disabled = offset === 0;
    next.disabled = offset + PAGE_SIZE >= total;
}

prev.addEventListener("click", () => {
    offset = Math.max(0, offset - PAGE_SIZE);
    render();
});

next.addEventListener("click", async () => {
    offset += PAGE_SIZE;
    if (offset + PAGE_SIZE > observations.length && observations.length < total) {
        next.disabled = true;
        const json_obj = await inat_request("observations", resp_params, {...params, "page" : page + 1});
        if (json_obj && json_obj.results.length > 0) {
            page += 1;
            observations = observations.concat(json_obj.results);
        } else {
            total = observations.length; // stop paging if the API runs dry or errors
        }
        offset = Math.min(offset, Math.max(0, observations.length - 1));
    }
    render();
});

inat_request("observations",resp_params,params).then((json_obj) => {
    if (!json_obj || json_obj.results.length === 0) {
        const msg = document.createElement("p");
        msg.className = "empty";
        msg.innerHTML = "No observations found.";
        document.getElementById("carousel").replaceWith(msg);
        return;
    }

    observations = json_obj.results;
    total = json_obj.total_results;
    render();
});
