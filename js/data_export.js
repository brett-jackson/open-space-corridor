// Space page: the Data section's "Export Observations" button. Builds a CSV of every
// verifiable observation in the space's area in the browser, paging through the iNaturalist
// API within the same 1 request/second throttle as the rest of the page (js/queries.js).
// Pages skip the sessionStorage cache, since a full export would fill it. Spaces with
// `exclude` boxes drop the observations inside them, as the other sections do (js/area.js).

const EXPORT_PER_PAGE = 200; // the API's maximum
const EXPORT_FIELDS = {
    "id" : true,
    "observed_on" : true,
    "time_observed_at" : true,
    "created_at" : true,
    "quality_grade" : true,
    "geojson" : true,
    "positional_accuracy" : true,
    "obscured" : true,
    "geoprivacy" : true,
    "taxon_geoprivacy" : true,
    "place_guess" : true,
    "license_code" : true,
    "user" : { "login" : true },
    "taxon" : {
        "id" : true,
        "name" : true,
        "preferred_common_name" : true,
        "rank" : true,
        "iconic_taxon_name" : true,
    },
};

// CSV columns: header and how to read each one from an observation
const EXPORT_COLUMNS = [
    ["id", (o) => o.id],
    ["url", (o) => "https://www.inaturalist.org/observations/" + o.id],
    ["observed_on", (o) => o.observed_on],
    ["time_observed_at", (o) => o.time_observed_at],
    ["created_at", (o) => o.created_at],
    ["user_login", (o) => o.user?.login],
    ["quality_grade", (o) => o.quality_grade],
    ["taxon_id", (o) => o.taxon?.id],
    ["scientific_name", (o) => o.taxon?.name],
    ["common_name", (o) => o.taxon?.preferred_common_name],
    ["taxon_rank", (o) => o.taxon?.rank],
    ["iconic_taxon_name", (o) => o.taxon?.iconic_taxon_name],
    ["latitude", (o) => o.geojson?.coordinates?.[1]],
    ["longitude", (o) => o.geojson?.coordinates?.[0]],
    ["positional_accuracy", (o) => o.positional_accuracy],
    ["coordinates_obscured", (o) => o.obscured],
    ["geoprivacy", (o) => o.geoprivacy],
    ["taxon_geoprivacy", (o) => o.taxon_geoprivacy],
    ["place_guess", (o) => o.place_guess],
    ["license", (o) => o.license_code],
];

function csvCell(value) {
    if (value === null || value === undefined) return "";
    if (typeof value !== "string") return String(value);
    // Text that starts like a formula would run as one in a spreadsheet
    if (/^[=+\-@\t\r]/.test(value)) value = "'" + value;
    return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

function csvRow(cells) {
    return cells.map(csvCell).join(",") + "\r\n";
}

// One page of observations after the given id, or undefined on error
async function exportPage(id_above) {
    const url = new URL("observations", base_url);
    url.searchParams.append("fields", encode_rison(EXPORT_FIELDS));
    Object.entries({
        ...AREA_PARAMS, "verifiable" : true, "order_by" : "id", "order" : "asc",
        "per_page" : EXPORT_PER_PAGE, "id_above" : id_above,
    }).forEach(([key, value]) => url.searchParams.append(key, value));
    await throttle();
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(response.status + ": " + response.statusText);
        return await response.json();
    } catch (err) {
        console.error(err);
    }
}

(function () {
    const body = document.getElementById("data-body");
    if (!body) return;

    const lede = document.createElement("p");
    lede.className = "panel-lede";
    lede.textContent = "Download every verifiable iNaturalist observation from " + SPACE_NAME +
        " as a spreadsheet (CSV). Coordinates the observer or iNaturalist has obscured stay obscured.";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "panel-explore data-export";
    button.textContent = "Export Observations";

    const status = document.createElement("p");
    status.className = "trend-note data-status";
    status.setAttribute("aria-live", "polite");

    body.append(lede, button, status);

    let running = false;
    let cancelled = false;

    function download(text) {
        const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }); // the BOM tells Excel it's UTF-8
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = SPACE.id + "-observations-" + new Date().toISOString().slice(0, 10) + ".csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    async function exportObservations() {
        running = true;
        cancelled = false;
        button.textContent = "Cancel";
        status.textContent = "Starting…";

        const parts = [csvRow(EXPORT_COLUMNS.map(([name]) => name))];
        let kept = 0;
        let fetched = 0;
        let total = null;
        let id_above = 0;
        let failed = false;
        while (!cancelled) {
            const json_obj = await exportPage(id_above);
            if (cancelled) break;
            if (!json_obj) { failed = true; break; }
            if (total === null) total = json_obj.total_results; // later pages count only what's left
            const results = json_obj.results || [];
            results.forEach((obs) => {
                if (isExcluded(obs)) return;
                parts.push(csvRow(EXPORT_COLUMNS.map(([, read]) => read(obs))));
                kept++;
            });
            fetched += results.length;
            if (results.length < EXPORT_PER_PAGE) break;
            id_above = results[results.length - 1].id;
            const seconds = Math.ceil((total - fetched) / EXPORT_PER_PAGE); // one request a second
            status.textContent = `Fetched ${fetched.toLocaleString()} of ${total.toLocaleString()} observations` +
                (seconds > 5 ? `, about ${seconds.toLocaleString()} seconds left…` : "…");
        }

        running = false;
        button.textContent = "Export Observations";
        if (cancelled) {
            status.textContent = "Export cancelled.";
        } else if (failed) {
            status.textContent = "Couldn't reach iNaturalist, so the export stopped. Try again in a minute.";
        } else if (kept === 0) {
            status.textContent = "No observations here yet.";
        } else {
            download(parts.join(""));
            status.textContent = `Downloaded ${kept.toLocaleString()} ${kept === 1 ? "observation" : "observations"}.`;
        }
    }

    button.addEventListener("click", () => {
        if (running) cancelled = true;
        else exportObservations();
    });
})();
