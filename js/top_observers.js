// Top three observers at PLACE_ID, ranked by number of verifiable observations
const observer_fields = {
    "observation_count" : true,
    "user" : {
        "login" : true,
        "icon_url" : true
    }
};
const observer_params = {
    "verifiable" : true,
    "place_id" : PLACE_ID,
    "per_page" : 3,
};

function makeObserver(result) {
    const user = result.user || {};
    const li = document.createElement("li");
    li.className = "observer";

    const a = document.createElement("a");
    a.href = "https://www.inaturalist.org/observations?verifiable=true&place_id=" + PLACE_ID + "&user_id=" + encodeURIComponent(user.login || "");
    a.target = "_blank";
    a.rel = "noopener";

    // Users without a profile photo get their initial, as on the mosaic tiles
    const avatar = document.createElement("span");
    avatar.className = "observer-avatar";
    if (user.icon_url) {
        const icon = document.createElement("img");
        icon.src = user.icon_url;
        icon.alt = "";
        avatar.appendChild(icon);
    } else {
        avatar.textContent = (user.login || "?").charAt(0).toUpperCase();
    }
    a.appendChild(avatar);

    const name = document.createElement("span");
    name.className = "observer-name";
    name.textContent = user.login || "Unknown";
    a.appendChild(name);

    const count = document.createElement("span");
    count.className = "observer-count";
    const num = document.createElement("strong");
    num.textContent = result.observation_count.toLocaleString();
    count.append(num, result.observation_count === 1 ? " observation" : " observations");
    a.appendChild(count);

    li.appendChild(a);
    return li;
}

inat_request("observations/observers", observer_fields, observer_params).then((json_obj) => {
    const list = document.getElementById("observers");
    if (!json_obj || json_obj.results.length === 0) {
        const msg = document.createElement("p");
        msg.className = "empty";
        msg.innerHTML = "No observers found.";
        list.replaceWith(msg);
        return;
    }
    list.replaceChildren(...json_obj.results.slice(0, 3).map(makeObserver));
});
