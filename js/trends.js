// Cumulative trends in the space's area: total observations, and distinct species and observers,
// as of the end of each year. Completed years come from the space's trends_cache.js
// (built by scripts/update_trends_cache.py); only years it doesn't cover are fetched live.
// The current year's value is just today's all-time total, so a fresh cache costs one
// request per metric.
const trend_params = {
    "verifiable" : true,
    ...AREA_PARAMS,
};
const trend_metrics = {
    observations: { singular: "observation", plural: "observations", path: "observations" },
    species: { singular: "species", plural: "species", path: "observations/species_counts" },
    observers: { singular: "observer", plural: "observers", path: "observations/observers" },
};
const CHART_HEIGHT = 280;
const CHART_MARGIN = { top: 24, right: 56, bottom: 28, left: 44 };
const SVG_NS = "http://www.w3.org/2000/svg";
const this_year = new Date().getFullYear();

const trend_chart = document.getElementById("trend-chart");
const trend_tooltip = document.getElementById("trend-tooltip");
const trend_status = document.getElementById("trend-status");
const trend_table = document.getElementById("trend-table");
const trend_buttons = document.querySelectorAll("#trend-metric button");

let trend_metric = "observations";
let trend_years = [];          // every year from the first observation to now
const trend_data = {};         // metric -> { year: cumulative count at year end }
let trend_request_id = 0;
let trend_focus = -1;          // index of the year under the crosshair
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// Seed from the static cache when it was built for this same area
const trend_cache = typeof TRENDS_CACHE !== "undefined" && TRENDS_CACHE.area_key === AREA_KEY ? TRENDS_CACHE : null;
let trend_load_failed = false;
// A bounding-box stand-in cache (place not indexed yet) counts the same box live
if (trend_cache && trend_cache.bbox) {
    delete trend_params["place_id"];
    Object.assign(trend_params, trend_cache.bbox);
}
if (trend_cache) {
    Object.keys(trend_metrics).forEach((metric) => {
        trend_data[metric] = {};
        Object.entries(trend_cache[metric] || {}).forEach(([y, v]) => { trend_data[metric][Number(y)] = v; });
    });
}

function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

// Round the axis up to a clean step of 1, 2 or 5 x 10^n
function niceScale(max) {
    const rough = Math.max(1, max / 4);
    const pow = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough);
    return { step: step, top: Math.max(step, Math.ceil(max / step) * step) };
}

function yearLabel(year) {
    return year === this_year ? year + " (so far)" : "End of " + year;
}

function countLabel(value) {
    const m = trend_metrics[trend_metric];
    return value.toLocaleString() + " " + (value === 1 ? m.singular : m.plural);
}

function renderChart() {
    const data = trend_data[trend_metric];
    if (!data || trend_years.length === 0 || !trend_years.every((y) => y in data)) return;
    const values = trend_years.map((y) => data[y]);

    const width = trend_chart.clientWidth;
    const plot_w = width - CHART_MARGIN.left - CHART_MARGIN.right;
    const plot_h = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
    const scale = niceScale(Math.max(...values));
    const last = trend_years.length - 1;
    const x_of = (i) => CHART_MARGIN.left + (last === 0 ? plot_w / 2 : (i / last) * plot_w);
    const y_of = (v) => CHART_MARGIN.top + plot_h - (v / scale.top) * plot_h;
    const base = y_of(0);

    const root = svg("svg", { width: width, height: CHART_HEIGHT, viewBox: `0 0 ${width} ${CHART_HEIGHT}` });

    // Gridlines and y ticks
    for (let t = 0; t <= scale.top; t += scale.step) {
        const y = y_of(t);
        root.appendChild(svg("line", { class: "trend-grid", x1: CHART_MARGIN.left, x2: CHART_MARGIN.left + plot_w, y1: y, y2: y }));
        const label = svg("text", { class: "trend-tick", x: CHART_MARGIN.left - 8, y: y, "text-anchor": "end", "dominant-baseline": "middle" });
        label.textContent = compact.format(t);
        root.appendChild(label);
    }

    // Year labels, thinned when points get close; always keep the latest
    const label_every = Math.ceil(36 / Math.max(1, plot_w / Math.max(1, last)));
    trend_years.forEach((year, i) => {
        if ((last - i) % label_every !== 0) return;
        const label = svg("text", { class: "trend-tick", x: x_of(i), y: CHART_HEIGHT - 8, "text-anchor": "middle" });
        label.textContent = year;
        root.appendChild(label);
    });
    root.appendChild(svg("line", { class: "trend-axis", x1: CHART_MARGIN.left, x2: CHART_MARGIN.left + plot_w, y1: base, y2: base }));

    // Area wash and line; the current year's segment is dashed because it's still in progress
    const points = values.map((v, i) => [x_of(i), y_of(v)]);
    const complete = trend_years[last] === this_year ? points.slice(0, -1) : points;
    const line_d = (pts) => pts.map(([x, y], i) => (i ? "L" : "M") + x + "," + y).join("");
    root.appendChild(svg("path", { class: "trend-area", d: line_d(points) + `L${points[last][0]},${base}L${points[0][0]},${base}Z` }));
    if (complete.length > 1) root.appendChild(svg("path", { class: "trend-line", d: line_d(complete) }));
    if (complete.length < points.length && points.length > 1) {
        root.appendChild(svg("path", { class: "trend-line partial", d: line_d(points.slice(-2)) }));
    }

    // End dot and direct label on the latest value
    const [end_x, end_y] = points[last];
    root.appendChild(svg("circle", { class: "trend-dot", cx: end_x, cy: end_y, r: 4 }));
    const end_label = svg("text", { class: "trend-value", x: end_x + 10, y: end_y, "dominant-baseline": "middle" });
    end_label.textContent = compact.format(values[last]);
    root.appendChild(end_label);

    // Crosshair snaps to the nearest year; the whole plot is the hit target
    const crosshair = svg("g", { class: "trend-crosshair", visibility: "hidden" });
    const cross_line = svg("line", { y1: CHART_MARGIN.top, y2: base });
    const cross_dot = svg("circle", { class: "trend-dot", r: 4 });
    crosshair.append(cross_line, cross_dot);
    root.appendChild(crosshair);

    const show = (i) => {
        trend_focus = i;
        const [x, y] = points[i];
        cross_line.setAttribute("x1", x);
        cross_line.setAttribute("x2", x);
        cross_dot.setAttribute("cx", x);
        cross_dot.setAttribute("cy", y);
        crosshair.setAttribute("visibility", "visible");

        trend_tooltip.replaceChildren();
        const v = document.createElement("strong");
        v.textContent = countLabel(values[i]);
        const label = document.createElement("span");
        label.textContent = yearLabel(trend_years[i]);
        trend_tooltip.append(v, label);
        trend_tooltip.hidden = false;
        const max_left = width - trend_tooltip.offsetWidth;
        trend_tooltip.style.left = Math.max(0, Math.min(max_left, x - trend_tooltip.offsetWidth / 2)) + "px";
    };
    const hide = () => {
        crosshair.setAttribute("visibility", "hidden");
        trend_tooltip.hidden = true;
    };

    const hit = svg("rect", { class: "trend-hit", x: CHART_MARGIN.left - 12, y: 0, width: plot_w + 24, height: CHART_HEIGHT,
        tabindex: "0", role: "img", "aria-label": `Cumulative ${trend_metrics[trend_metric].plural}: ${countLabel(values[last])} as of ${yearLabel(trend_years[last])}. Use arrow keys to step through years.` });
    const nearest = (evt) => {
        const box = root.getBoundingClientRect();
        const px = evt.clientX - box.left;
        return Math.max(0, Math.min(last, Math.round(last === 0 ? 0 : ((px - CHART_MARGIN.left) / plot_w) * last)));
    };
    hit.addEventListener("pointermove", (evt) => show(nearest(evt)));
    hit.addEventListener("pointerleave", hide);
    hit.addEventListener("focus", () => show(trend_focus >= 0 ? Math.min(trend_focus, last) : last));
    hit.addEventListener("blur", hide);
    hit.addEventListener("keydown", (evt) => {
        if (evt.key !== "ArrowLeft" && evt.key !== "ArrowRight") return;
        evt.preventDefault();
        show(Math.max(0, Math.min(last, trend_focus + (evt.key === "ArrowRight" ? 1 : -1))));
    });
    root.appendChild(hit);

    trend_chart.querySelector("svg")?.remove();
    trend_chart.prepend(root);
    renderTable(values);
}

function renderTable(values) {
    const m = trend_metrics[trend_metric];
    const head = document.createElement("tr");
    ["Year", "Total " + m.plural].forEach((t) => {
        const th = document.createElement("th");
        th.textContent = t;
        head.appendChild(th);
    });
    const rows = trend_years.map((year, i) => {
        const tr = document.createElement("tr");
        [yearLabel(year), values[i].toLocaleString()].forEach((t) => {
            const td = document.createElement("td");
            td.textContent = t;
            tr.appendChild(td);
        });
        return tr;
    });
    trend_table.replaceChildren(head, ...rows);
}

// With excluded boxes, every year's totals come from the area's individual observations,
// since distinct species and observers can't be subtracted from the API's counts
async function loadFromObservations() {
    const all = await allAreaObservations();
    if (!all) return false;
    const dated = all.filter((obs) => obs.observed_on).sort((a, b) => a.observed_on.localeCompare(b.observed_on));
    if (dated.length === 0) return true;
    if (trend_years.length === 0) {
        for (let y = parseInt(dated[0].observed_on, 10); y <= this_year; y++) trend_years.push(y);
    }
    Object.keys(trend_metrics).forEach((m) => { trend_data[m] = trend_data[m] || {}; });
    const taxa = new Set(), users = new Set();
    let i = 0;
    trend_years.forEach((year) => {
        while (i < dated.length && parseInt(dated[i].observed_on, 10) <= year) {
            if (isSpeciesLevel(dated[i].taxon)) taxa.add(dated[i].taxon.id);
            if (dated[i].user?.login) users.add(dated[i].user.login);
            i++;
        }
        trend_data.observations[year] = i;
        trend_data.species[year] = taxa.size;
        trend_data.observers[year] = users.size;
    });
    return true;
}

// Without a cache, one histogram request gives the year range and cumulative observations
async function loadYears() {
    if (AREA_EXCLUDE.length > 0 && !trend_cache) {
        if (!(await loadFromObservations())) trend_load_failed = true;
        return;
    }
    if (trend_cache && trend_cache.observations && Object.keys(trend_cache.observations).length > 0) {
        const first = Math.min(...Object.keys(trend_cache.observations).map(Number));
        for (let y = first; y <= this_year; y++) trend_years.push(y);
        return;
    }
    const json_obj = await inat_request("observations/histogram", {}, {...trend_params, "interval" : "year", "date_field" : "observed"});
    if (!json_obj) {
        trend_load_failed = true;
        return;
    }
    const per_year = {};
    Object.entries(json_obj?.results?.year || {}).forEach(([date, count]) => { per_year[parseInt(date, 10)] = count; });
    const years = Object.keys(per_year).map(Number);
    if (years.length === 0) return;
    const counts = (trend_data.observations = {});
    let total = 0;
    for (let y = Math.min(...years); y <= this_year; y++) {
        trend_years.push(y);
        total += per_year[y] || 0;
        counts[y] = total;
    }
}

// Fetch each missing year's cumulative count (observed up to Dec 31; no limit for this year).
// Stops early if the toggle changes; years already fetched are kept for next time.
async function loadMissing(metric, request_id) {
    if (AREA_EXCLUDE.length > 0) return loadFromObservations();
    const counts = trend_data[metric] || (trend_data[metric] = {});
    const missing = trend_years.filter((y) => !(y in counts));
    for (const [n, year] of missing.entries()) {
        if (request_id !== trend_request_id) return false;
        if (missing.length > 1) trend_status.textContent = `Loading ${trend_metrics[metric].plural}… ${n + 1} of ${missing.length} years`;
        const params = {...trend_params, "per_page" : 0};
        if (year !== this_year) params["d2"] = year + "-12-31";
        const json_obj = await inat_request(trend_metrics[metric].path, {}, params);
        if (!json_obj) return false;
        counts[year] = json_obj.total_results;
    }
    return true;
}

async function selectMetric(metric) {
    const request_id = ++trend_request_id;
    trend_metric = metric;
    trend_buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.metric === metric)));

    if (!trend_years.every((y) => y in (trend_data[metric] || {}))) {
        trend_chart.setAttribute("aria-busy", "true"); // keep the previous chart, dimmed, while loading
        const ok = await loadMissing(metric, request_id);
        if (request_id !== trend_request_id) return;
        trend_chart.removeAttribute("aria-busy");
        if (!ok) {
            trend_status.textContent = "Couldn't load this trend right now.";
            return;
        }
    }
    trend_status.textContent = "";
    renderChart();
}

trend_buttons.forEach((button) => {
    button.addEventListener("click", () => {
        if (button.dataset.metric !== trend_metric) selectMetric(button.dataset.metric);
    });
});

new ResizeObserver(() => renderChart()).observe(trend_chart);

loadYears().then(() => {
    if (trend_years.length === 0) {
        const msg = document.createElement("p");
        msg.className = "empty";
        msg.textContent = trend_load_failed ? "Couldn't load trends right now. Please try again later." : "No observations found.";
        document.getElementById("trend-body").replaceWith(msg);
        return;
    }
    selectMetric(trend_metric);
});
