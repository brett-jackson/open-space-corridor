// Top three observers in the space's area, ranked by number of verifiable observations or species
const observer_fields = {
    "observation_count" : true,
    "species_count" : true,
    "user" : {
        "login" : true,
        "icon_url" : true
    }
};
const observer_params = {
    "verifiable" : true,
    ...AREA_PARAMS,
    "per_page" : 3,
};
const observer_metrics = {
    observations: { field: "observation_count", singular: " observation", plural: " observations", params: {}, view: "" },
    species: { field: "species_count", singular: " species", plural: " species", params: { "order_by" : "species_count" }, view: "&view=species" },
};
let observer_metric = "observations";
let observer_request_id = 0;

function makeObserver(result, index) {
    const metric = observer_metrics[observer_metric];
    const user = result.user || {};
    const li = document.createElement("li");
    li.className = "observer";

    const a = document.createElement("a");
    a.href = "https://www.inaturalist.org/observations?verifiable=true&" + AREA_QUERY + "&user_id=" + encodeURIComponent(user.login || "") + metric.view;
    a.target = "_blank";
    a.rel = "noopener";

    // Users without a profile photo get their initial, as on the mosaic tiles
    const avatar = document.createElement("span");
    avatar.className = "observer-avatar";
    if (user.icon_url) {
        const icon = document.createElement("img");
        // The API gives the medium (300px) icon; large (500px) stays sharp at this size
        icon.src = user.icon_url.replace("/medium.", "/large.");
        icon.onerror = () => { icon.onerror = null; icon.src = user.icon_url; };
        icon.alt = "";
        avatar.appendChild(icon);
    } else {
        avatar.textContent = (user.login || "?").charAt(0).toUpperCase();
    }
    // Wrapper lets the medal overlap the avatar's edge, which clips its own contents
    const avatar_wrap = document.createElement("span");
    avatar_wrap.className = "observer-avatar-wrap";
    avatar_wrap.appendChild(avatar);
    const medal = document.createElement("span");
    medal.className = "medal medal-" + (index + 1);
    medal.textContent = index + 1;
    medal.setAttribute("aria-hidden", "true"); // the <ol> already conveys rank
    avatar_wrap.appendChild(medal);
    a.appendChild(avatar_wrap);

    const name = document.createElement("span");
    name.className = "observer-name";
    name.textContent = user.login || "Unknown";
    a.appendChild(name);

    const count = document.createElement("span");
    count.className = "observer-count";
    const num = document.createElement("strong");
    const value = result[metric.field] || 0;
    num.textContent = value.toLocaleString();
    count.append(num, value === 1 ? metric.singular : metric.plural);
    a.appendChild(count);

    li.appendChild(a);
    return li;
}

const observer_list = document.getElementById("observers");
const metric_buttons = document.querySelectorAll("#observer-metric button");

// With excluded boxes, rank from the area's individual observations instead of the API's totals
async function observersFromObservations(metric) {
    const all = await allAreaObservations();
    if (!all) return null;
    const by_user = {};
    all.forEach((obs) => {
        const login = obs.user?.login;
        if (!login) return;
        const u = by_user[login] || (by_user[login] = { user: obs.user, observation_count: 0, taxa: new Set() });
        u.observation_count += 1;
        if (isSpeciesLevel(obs.taxon)) u.taxa.add(obs.taxon.id);
    });
    const results = Object.values(by_user).map((u) => ({ user: u.user, observation_count: u.observation_count, species_count: u.taxa.size }));
    results.sort((a, b) => b[metric.field] - a[metric.field]);
    return { results: results.slice(0, 3) };
}

async function loadObservers() {
    const request_id = ++observer_request_id;
    const metric = observer_metrics[observer_metric];
    const json_obj = AREA_EXCLUDE.length > 0
        ? await observersFromObservations(metric)
        : await inat_request("observations/observers", observer_fields, {...observer_params, ...metric.params});
    if (request_id !== observer_request_id) return; // a newer toggle superseded this request

    if (!json_obj || json_obj.results.length === 0) {
        const msg = document.createElement("li");
        msg.className = "empty";
        msg.textContent = "No observers found.";
        observer_list.replaceChildren(msg);
        return;
    }
    observer_list.replaceChildren(...json_obj.results.slice(0, 3).map(makeObserver));
}

metric_buttons.forEach((button) => {
    button.addEventListener("click", () => {
        if (button.dataset.metric === observer_metric) return;
        observer_metric = button.dataset.metric;
        metric_buttons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
        observer_list.setAttribute("aria-busy", "true");
        loadObservers().finally(() => observer_list.removeAttribute("aria-busy"));
    });
});

loadObservers();
