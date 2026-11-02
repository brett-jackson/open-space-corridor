// Bioblitz events at each space, by space id (see js/spaces.js), as YYYY-MM-DD dates.
// Maintained by hand; marked on each space's Trends chart. scripts/update_trends_cache.py reads it
// too (adding exact totals around each event), so keep it valid JSON: no trailing commas.
window.BIOBLITZES = {
    "broomfield": ["2023-07-29", "2023-09-10", "2024-05-18", "2024-07-13", "2025-05-17", "2025-07-19", "2025-09-13", "2026-05-31", "2026-07-19", "2026-10-07"],
    "metzger": ["2026-05-25", "2026-07-15", "2026-10-14"],
    "the-field": ["2025-05-17", "2025-07-19", "2025-09-13", "2026-05-27", "2026-07-22", "2026-10-11"]
};
