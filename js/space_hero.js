// Space page: the photo of the place and its headline numbers, from the space's generated
// cache (js/area.js: SPACE_CACHE), so they appear without a request.
(function () {
    const hero = document.getElementById("space-hero");
    if (!hero) return;
    if (SPACE.image) {
        const img = document.createElement("img");
        img.src = SPACE.image;
        img.alt = "";
        hero.appendChild(img);
    }
    const latest = SPACE_CACHE?.latest;
    if (latest) {
        const stats = document.createElement("dl");
        stats.className = "space-stats";
        [["species", "Species"], ["observations", "Observations"], ["observers", "Observers"]].forEach(([key, label]) => {
            const item = document.createElement("div");
            const value = document.createElement("dd");
            value.textContent = latest[key].toLocaleString();
            const name = document.createElement("dt");
            name.textContent = label;
            item.append(name, value); // shown number first (css)
            stats.appendChild(item);
        });
        hero.appendChild(stats);
    }
    if (!hero.firstChild) hero.remove();
})();
