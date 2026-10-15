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

function makeObserver(result, index) {
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
