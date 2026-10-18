// Where a space's observations come from: its iNaturalist place or its bounding box,
// minus any `exclude` boxes (see js/spaces.js). Loaded on space.html after SPACE is set.
//
// iNaturalist can filter to a box but can't subtract one, and distinct species or observer
// counts can't be subtracted after the fact (a species in the excluded corner may also be
// seen elsewhere). So for spaces with exclusions, the page sections fetch every observation
// once (allAreaObservations) and compute their numbers from what's left.

// Two opposite [lat, lng] corners -> iNaturalist's bounding-box parameters
function boxParams(corners) {
    const [[lat1, lng1], [lat2, lng2]] = corners;
    return {
        "nelat" : Math.max(lat1, lat2),
        "nelng" : Math.max(lng1, lng2),
        "swlat" : Math.min(lat1, lat2),
        "swlng" : Math.min(lng1, lng2),
    };
}

const AREA_PARAMS = SPACE.bbox ? boxParams(SPACE.bbox) : { "place_id" : SPACE.place_id };
const AREA_EXCLUDE = (SPACE.exclude || []).map(boxParams);
// Identifies the area, so a trends cache built for a different area is ignored
const AREA_KEY = JSON.stringify({ area: AREA_PARAMS, exclude: AREA_EXCLUDE });

// The same area as an inaturalist.org/observations query string, for links out
const AREA_QUERY = Object.entries(AREA_PARAMS).map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&");

function isExcluded(obs) {
    const coords = obs.geojson?.coordinates;
    if (!coords || AREA_EXCLUDE.length === 0) return false;
    const [lng, lat] = coords;
    return AREA_EXCLUDE.some((b) => lat <= b.nelat && lat >= b.swlat && lng <= b.nelng && lng >= b.swlng);
}

// Species-level or finer, the same rule the featured-species script uses
function isSpeciesLevel(taxon) {
    return taxon && (taxon.rank_level ?? 100) <= 10;
}

const AREA_OBS_FIELDS = {
    "id" : true,
    "observed_on" : true,
    "geojson" : true,
    "quality_grade" : true,
    "user" : { "login" : true, "icon_url" : true },
    "taxon" : { "id" : true, "rank_level" : true },
};
const AREA_OBS_PER_PAGE = 200;
let area_observations = null;

// Every verifiable observation in the area outside the excluded boxes, fetched once per page view
function allAreaObservations() {
    if (!area_observations) {
        area_observations = (async () => {
            const kept = [];
            for (let page = 1; ; page++) {
                const json_obj = await inat_request("observations", AREA_OBS_FIELDS, {
                    ...AREA_PARAMS, "verifiable" : true, "order_by" : "id", "order" : "asc",
                    "per_page" : AREA_OBS_PER_PAGE, "page" : page,
                });
                if (!json_obj) return null;
                json_obj.results.forEach((obs) => { if (!isExcluded(obs)) kept.push(obs); });
                if (json_obj.results.length < AREA_OBS_PER_PAGE || page * AREA_OBS_PER_PAGE >= json_obj.total_results) break;
            }
            return kept;
        })();
    }
    return area_observations;
}
