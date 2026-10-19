// Space page: "How to Help" cards. Each card is a bite-sized iNaturalist task for this
// space's area, with a count (js/help_tasks.js) and a link into a filtered iNaturalist view.
// Thinly observed species groups (js/species_network.js) get a "look for them here" card.
// Needs SPACE, js/area.js (AREA_QUERY) and js/panels.js.

(function () {
    const box = document.getElementById("help-cards");
    if (!box) return;
    const counts = window.HELP_TASKS?.by_space?.[SPACE.id] || {};
    const name = shortName(SPACE);
    const inat = (path, params) => `https://www.inaturalist.org/${path}?${AREA_QUERY}&${params}`;

    const tasks = [
        {
            count: counts.phenology,
            unit: "plant observations",
            title: "Record what's blooming",
            text: `These don't yet say whether the plant was flowering or fruiting. Adding the "Flowers and Fruits" annotation builds a bloom calendar for ${name}.`,
            how: "Open each observation in Identify, choose Annotations, and pick Flowers, Flower Buds, Fruits or Seeds, or No Flowers or Fruits.",
            link: inat("observations/identify", "taxon_id=47126&without_term_id=12&quality_grade=needs_id,research&reviewed=any"),
            action: "Add flowering status",
        },
        {
            count: counts.pollinator_plants,
            unit: "bee & butterfly observations",
            title: "Name the flower a pollinator visited",
            text: `These don't record the plant the insect was on. The "Nectar / Pollen delivering plant" field shows which plants feed ${name}'s pollinators.`,
            how: 'Where the plant is visible, open the observation, choose "Add a Field", search for "Nectar / Pollen delivering plant" and enter the plant.',
            link: inat("observations", "taxon_ids=630955,47157&verifiable=true&subview=grid"),
            action: "Browse pollinators",
        },
        {
            count: counts.needs_id,
            unit: "observations need an ID",
            title: "Help confirm identifications",
            text: "A second, agreeing identification moves an observation to Research Grade, so it counts toward this site's species lists and signature species.",
            how: "Start with groups you know well; use the filters in Identify to narrow by taxon.",
            link: inat("observations/identify", "quality_grade=needs_id&reviewed=any"),
            action: "Start identifying",
        },
    ].filter((t) => t.count > 0);

    // Groups with few observations here: an invitation to go and look
    const SINGULAR = { bees: "bee", lepidoptera: "butterfly & moth", birds: "bird" }; // "3 bee observations"
    NETWORK_DATA.groups.forEach((g) => {
        const { obs, low } = spaceEffort(NETWORK_DATA, SPACE.id, g.id);
        if (!low) return;
        tasks.push({
            count: obs,
            unit: `${SINGULAR[g.id] || g.label.toLowerCase()} observations so far`,
            title: `Look for ${g.label.toLowerCase()} at ${name}`,
            text: `With so few records, we can't yet tell how ${name}'s ${g.label.toLowerCase()} connect to its neighbors. New observations fill in the corridor map.`,
            how: "Photograph what you find and upload it with the iNaturalist app; observations here are added to this site automatically.",
            link: "https://www.inaturalist.org/observations/upload",
            action: "Upload observations",
            group: g.id,
        });
    });

    if (tasks.length === 0) {
        box.replaceChildren(el("p", "panel-hint", "No open tasks here right now. Thank you to everyone who's helped!"));
        return;
    }
    box.replaceChildren(...tasks.map((t) => {
        const card = el("article", "help-card" + (t.group ? " net-" + t.group + " is-survey" : ""));
        const figure = el("p", "help-count");
        figure.append(el("strong", null, t.count.toLocaleString()), " " + t.unit);
        const a = el("a", "help-action", t.action + " ↗");
        a.href = t.link;
        a.target = "_blank";
        a.rel = "noopener";
        card.append(figure, el("h3", null, t.title), el("p", "help-text", t.text), el("p", "help-how", t.how), a);
        return card;
    }));

    // Arriving from the landing page's "How to help" link
    if (location.hash === "#how-to-help") requestAnimationFrame(() => document.getElementById("how-to-help")?.scrollIntoView());
})();
