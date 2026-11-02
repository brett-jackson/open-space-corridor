// Cumulative trends in the space's area: total observations, and distinct species and observers,
// as of the end of each month. Completed months come from the space's trends_cache.js
// (built by scripts/update_trends_cache.py); the current month's value is just today's
// all-time total, so a fresh cache costs one request per metric. The space's bioblitzes
// (js/bioblitzes.js) are marked on the line, which also passes through the totals at the end
// of the day before and of the event day, so each event's jump is drawn on its day. Spaces with exclusions,
// and spaces without a cache, compute their months from the area's individual observations.
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
const today = new Date();
const isoDate = (date) => date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
const this_month = isoDate(today).slice(0, 7);

const trend_chart = document.getElementById("trend-chart");
const trend_tooltip = document.getElementById("trend-tooltip");
const trend_status = document.getElementById("trend-status");
const trend_table = document.getElementById("trend-table");
const trend_buttons = document.querySelectorAll("#trend-metric button");

let trend_metric = "observations";
let trend_months = [];         // every month ("YYYY-MM") from the first observation to now
const trend_data = {};         // metric -> { month or day: cumulative count at its end }
let trend_request_id = 0;
let trend_focus = -1;          // index of the point under the crosshair
const trend_events = ((typeof BIOBLITZES !== "undefined" && BIOBLITZES[SPACE.id]) || []).slice().sort();
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// Seed from the static cache when it was built monthly for this same area
const trend_cache = typeof TRENDS_CACHE !== "undefined" && TRENDS_CACHE.area_key === AREA_KEY
    && TRENDS_CACHE.interval === "month" ? TRENDS_CACHE : null;
// A bounding-box stand-in cache (place not indexed yet) counts the same box live
if (trend_cache && trend_cache.bbox) {
    delete trend_params["place_id"];
    Object.assign(trend_params, trend_cache.bbox);
}
Object.keys(trend_metrics).forEach((metric) => {
    trend_data[metric] = {...(trend_cache?.[metric] || {}), ...(trend_cache?.days?.[metric] || {})};
});

// The days with totals around each bioblitz: the day before and the event day, once they've ended
function eventDays() {
    const days = new Set();
    trend_events.forEach((date) => {
        const [y, m, d] = date.split("-").map(Number);
        [isoDate(new Date(y, m - 1, d - 1)), date].forEach((day) => { if (day < isoDate(today)) days.add(day); });
    });
    return [...days].sort();
}

function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
}

// "YYYY-MM" from first to last, inclusive
function monthsBetween(first, last) {
    const out = [];
    let [y, m] = first.split("-").map(Number);
    for (let key = first; key <= last; key = y + "-" + String(m).padStart(2, "0")) {
        out.push(key);
        [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
    }
    return out;
}

// Round the axis up to a clean step of 1, 2 or 5 x 10^n
function niceScale(max) {
    const rough = Math.max(1, max / 4);
    const pow = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough);
    return { step: step, top: Math.max(step, Math.ceil(max / step) * step) };
}

function monthLabel(month) {
    const [y, m] = month.split("-").map(Number);
    const name = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });
    return month === this_month ? name + " (so far)" : "End of " + name;
}

// "YYYY-MM" is the end of that month (its index in trend_months); "YYYY-MM-DD" the end of that
// day, between its month's point and the one before (this month runs up to today)
function trendPos(key) {
    const i = trend_months.indexOf(key.slice(0, 7));
    if (i < 0) return null;
    if (key.length === 7) return i;
    const [y, m, d] = key.split("-").map(Number);
    const days = key.startsWith(this_month) ? today.getDate() : new Date(y, m, 0).getDate();
    return Math.max(0, i - 1 + Math.min(1, d / days));
}

function pointLabel(key) {
    if (key.length === 7) return monthLabel(key);
    const [y, m, d] = key.split("-").map(Number);
    return "End of " + new Date(y, m - 1, d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function eventLabel(date) {
    const [y, m, d] = date.split("-").map(Number);
    return "Bioblitz " + new Date(y, m - 1, d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function countLabel(value) {
    const m = trend_metrics[trend_metric];
    return value.toLocaleString() + " " + (value === 1 ? m.singular : m.plural);
}

function renderChart() {
    const data = trend_data[trend_metric];
    // Points are the months and bioblitz days with a value, in time order (a month first where a
    // day is its last); a gap (a stale cache) is drawn as a straight segment
    const points = Object.entries(data).map(([key, value]) => ({ key: key, pos: trendPos(key), value: value }))
        .filter((p) => p.pos !== null)
        .sort((a, b) => a.pos - b.pos || a.key.length - b.key.length)
        .filter((p, k, all) => k === 0 || p.pos !== all[k - 1].pos);
    if (points.length === 0) return;
    const values = points.map((p) => p.value);

    const width = trend_chart.clientWidth;
    const plot_w = width - CHART_MARGIN.left - CHART_MARGIN.right;
    const plot_h = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
    const scale = niceScale(Math.max(...values));
    const span = trend_months.length - 1;
    const x_of = (i) => CHART_MARGIN.left + (span === 0 ? plot_w / 2 : (i / span) * plot_w);
    const y_of = (v) => CHART_MARGIN.top + plot_h - (v / scale.top) * plot_h;
    const base = y_of(0);
    points.forEach((p) => { p.x = x_of(p.pos); p.y = y_of(p.value); p.events = []; });
    const last = points.length - 1;

    const root = svg("svg", { width: width, height: CHART_HEIGHT, viewBox: `0 0 ${width} ${CHART_HEIGHT}` });

    // Gridlines and y ticks
    for (let t = 0; t <= scale.top; t += scale.step) {
        const y = y_of(t);
        root.appendChild(svg("line", { class: "trend-grid", x1: CHART_MARGIN.left, x2: CHART_MARGIN.left + plot_w, y1: y, y2: y }));
        const label = svg("text", { class: "trend-tick", x: CHART_MARGIN.left - 8, y: y, "text-anchor": "end", "dominant-baseline": "middle" });
        label.textContent = compact.format(t);
        root.appendChild(label);
    }

    // Year labels at each January, and at the first month unless next January is close; thinned when years get close
    const year_w = span === 0 ? plot_w : (12 / span) * plot_w;
    const label_every = Math.ceil(36 / Math.max(1, year_w));
    const first_year = Number(trend_months[0].slice(0, 4));
    trend_months.forEach((month, i) => {
        const year = Number(month.slice(0, 4));
        const tick = month.endsWith("-01") || (i === 0 && (span < 12 || Number(month.slice(5)) <= 9));
        if (!tick || (year - first_year) % label_every !== 0) return;
        const label = svg("text", { class: "trend-tick", x: x_of(i), y: CHART_HEIGHT - 8, "text-anchor": "middle" });
        label.textContent = year;
        root.appendChild(label);
    });
    root.appendChild(svg("line", { class: "trend-axis", x1: CHART_MARGIN.left, x2: CHART_MARGIN.left + plot_w, y1: base, y2: base }));

    // Area wash and line; the current month's segment is dashed because it's still in progress
    const line_d = (pts) => pts.map((p, i) => (i ? "L" : "M") + p.x + "," + p.y).join("");
    const complete = points[last].key === this_month ? points.slice(0, -1) : points;
    root.appendChild(svg("path", { class: "trend-area", d: line_d(points) + `L${points[last].x},${base}L${points[0].x},${base}Z` }));
    if (complete.length > 1) root.appendChild(svg("path", { class: "trend-line", d: line_d(complete) }));
    if (complete.length < points.length && points.length > 1) {
        root.appendChild(svg("path", { class: "trend-line partial", d: line_d(points.slice(-2)) }));
    }

    // Bioblitzes: a rule up to the line at the end of the event day, or, before that day's
    // totals are in, at its place between the month-end points around it
    trend_events.forEach((date) => {
        const at = points.find((p) => p.key === date) || points.find((p) => p.key.length === 7 && p.pos === trendPos(date));
        if (at) {
            at.events.push(date);
            root.appendChild(svg("line", { class: "trend-event-rule", x1: at.x, x2: at.x, y1: base, y2: at.y }));
            root.appendChild(svg("circle", { class: "trend-event", cx: at.x, cy: at.y, r: 4 }));
            return;
        }
        const i = trend_months.indexOf(date.slice(0, 7));
        const cur = data[trend_months[i]];
        if (i < 0 || cur === undefined) return;
        const [y, m, d] = date.split("-").map(Number);
        const days = trend_months[i] === this_month ? today.getDate() : new Date(y, m, 0).getDate();
        const frac = Math.min(1, d / days);
        const prev = i > 0 ? data[trend_months[i - 1]] : undefined;
        const value = prev === undefined ? cur : prev + (cur - prev) * frac;
        const x = x_of(i === 0 ? 0 : i - 1 + frac);
        points.find((p) => p.key === trend_months[i])?.events.push(date);
        root.appendChild(svg("line", { class: "trend-event-rule", x1: x, x2: x, y1: base, y2: y_of(value) }));
        root.appendChild(svg("circle", { class: "trend-event", cx: x, cy: y_of(value), r: 4 }));
    });

    // End dot and direct label on the latest value
    root.appendChild(svg("circle", { class: "trend-dot", cx: points[last].x, cy: points[last].y, r: 4 }));
    const end_label = svg("text", { class: "trend-value", x: points[last].x + 10, y: points[last].y, "dominant-baseline": "middle" });
    end_label.textContent = compact.format(values[last]);
    root.appendChild(end_label);

    // Crosshair snaps to the nearest point; the whole plot is the hit target
    const crosshair = svg("g", { class: "trend-crosshair", visibility: "hidden" });
    const cross_line = svg("line", { y1: CHART_MARGIN.top, y2: base });
    const cross_dot = svg("circle", { class: "trend-dot", r: 4 });
    crosshair.append(cross_line, cross_dot);
    root.appendChild(crosshair);

    const show = (k) => {
        trend_focus = k;
        const p = points[k];
        cross_line.setAttribute("x1", p.x);
        cross_line.setAttribute("x2", p.x);
        cross_dot.setAttribute("cx", p.x);
        cross_dot.setAttribute("cy", p.y);
        crosshair.setAttribute("visibility", "visible");

        trend_tooltip.replaceChildren();
        const v = document.createElement("strong");
        v.textContent = countLabel(p.value);
        const label = document.createElement("span");
        label.textContent = pointLabel(p.key);
        trend_tooltip.append(v, label);
        p.events.forEach((date) => {
            const event = document.createElement("span");
            event.className = "trend-tooltip-event";
            event.textContent = eventLabel(date);
            trend_tooltip.append(event);
        });
        trend_tooltip.hidden = false;
        const max_left = width - trend_tooltip.offsetWidth;
        trend_tooltip.style.left = Math.max(0, Math.min(max_left, p.x - trend_tooltip.offsetWidth / 2)) + "px";
    };
    const hide = () => {
        crosshair.setAttribute("visibility", "hidden");
        trend_tooltip.hidden = true;
    };

    const hit = svg("rect", { class: "trend-hit", x: CHART_MARGIN.left - 12, y: 0, width: plot_w + 24, height: CHART_HEIGHT,
        tabindex: "0", role: "img", "aria-label": `Cumulative ${trend_metrics[trend_metric].plural}: ${countLabel(values[last])} as of ${pointLabel(points[last].key)}. ${trend_events.length ? ` ${trend_events.length} bioblitzes marked.` : ""} Use arrow keys to step through months.` });
    const nearest = (evt) => {
        const box = root.getBoundingClientRect();
        const px = evt.clientX - box.left;
        let best = 0;
        points.forEach((p, k) => { if (Math.abs(p.x - px) < Math.abs(points[best].x - px)) best = k; });
        return best;
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
    renderTable(points.filter((p) => p.key.length === 7));
}

function renderTable(points) {
    const m = trend_metrics[trend_metric];
    const head = document.createElement("tr");
    ["Month", "Total " + m.plural, ...(trend_events.length ? ["Bioblitz"] : [])].forEach((t) => {
        const th = document.createElement("th");
        th.textContent = t;
        head.appendChild(th);
    });
    const rows = points.map((p) => {
        const tr = document.createElement("tr");
        const events = trend_events.filter((date) => date.startsWith(p.key)).map((date) => eventLabel(date).replace("Bioblitz ", ""));
        [monthLabel(p.key), p.value.toLocaleString(), ...(trend_events.length ? [events.join(", ")] : [])].forEach((t) => {
            const td = document.createElement("td");
            td.textContent = t;
            tr.appendChild(td);
        });
        return tr;
    });
    trend_table.replaceChildren(head, ...rows);
}

// Month-end and bioblitz-day totals from the area's individual observations, for every one the
// cache doesn't already have (with excluded boxes that's just this month; without a cache, all of them)
async function loadFromObservations() {
    const all = await allAreaObservations();
    if (!all) return false;
    const dated = all.filter((obs) => obs.observed_on).sort((a, b) => a.observed_on.localeCompare(b.observed_on));
    if (dated.length === 0) return true;
    if (trend_months.length === 0) trend_months = monthsBetween(dated[0].observed_on.slice(0, 7), this_month);
    const taxa = new Set(), users = new Set();
    let i = 0;
    trend_months.forEach((month) => {
        while (i < dated.length && dated[i].observed_on.slice(0, 7) <= month) {
            if (isSpeciesLevel(dated[i].taxon)) taxa.add(dated[i].taxon.id);
            if (dated[i].user?.login) users.add(dated[i].user.login);
            i++;
        }
        if (!(month in trend_data.observations)) trend_data.observations[month] = i;
        if (!(month in trend_data.species)) trend_data.species[month] = taxa.size;
        if (!(month in trend_data.observers)) trend_data.observers[month] = users.size;
    });
    eventDays().filter((day) => !(day in trend_data.observations)).forEach((day) => {
        const upto = dated.filter((obs) => obs.observed_on <= day);
        trend_data.observations[day] = upto.length;
        trend_data.species[day] = new Set(upto.filter((obs) => isSpeciesLevel(obs.taxon)).map((obs) => obs.taxon.id)).size;
        trend_data.observers[day] = new Set(upto.filter((obs) => obs.user?.login).map((obs) => obs.user.login)).size;
    });
    return true;
}

// This month's value is today's all-time total: one request, or the area's observations
async function loadCurrent(metric) {
    if (AREA_EXCLUDE.length > 0 || !trend_cache) return loadFromObservations();
    const json_obj = await inat_request(trend_metrics[metric].path, {}, {...trend_params, "per_page" : 0});
    if (!json_obj) return false;
    trend_data[metric][this_month] = json_obj.total_results;
    return true;
}

async function selectMetric(metric) {
    const request_id = ++trend_request_id;
    trend_metric = metric;
    trend_buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.metric === metric)));
    renderChart(); // cached months right away

    if (!(this_month in trend_data[metric])) {
        trend_chart.setAttribute("aria-busy", "true"); // keep the cached chart, dimmed, while this month loads
        trend_status.textContent = "Loading this month…";
        const ok = await loadCurrent(metric);
        if (request_id !== trend_request_id) return;
        trend_chart.removeAttribute("aria-busy");
        if (!ok) {
            trend_status.textContent = "Couldn't load this month's totals right now.";
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

document.getElementById("trend-key").hidden = trend_events.length === 0;
new ResizeObserver(() => renderChart()).observe(trend_chart);

(async () => {
    const cached = Object.keys(trend_cache?.observations || {}).sort();
    let failed = false;
    if (cached.length > 0) trend_months = monthsBetween(cached[0], this_month);
    else failed = !(await loadFromObservations());
    if (trend_months.length === 0) {
        const msg = document.createElement("p");
        msg.className = "empty";
        msg.textContent = failed ? "Couldn't load trends right now. Please try again later." : "No observations found.";
        document.getElementById("trend-body").replaceWith(msg);
        return;
    }
    selectMetric(trend_metric);
})();
