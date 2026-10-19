"""Shared helpers for the update scripts: iNaturalist requests, reading the site's data files,
and resolving each space's area.

A space's area is its iNaturalist `place_id`, or a `bbox` of two opposite [lat, lng] corners,
minus any `exclude` boxes in the same format. The API can filter to a box but not subtract
one, so spaces with exclusions are counted from their individual observations
(all_observations) instead of the API's summary endpoints.

Every request goes through inat_get, which keeps all scripts to one request per second and
caches responses on disk for CACHE_MINUTES, so scripts run back to back (as in the hourly
workflow) share identical requests instead of repeating them.
"""
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPACES_JS = ROOT / "js" / "spaces.js"
CACHE_DIR = ROOT / ".cache" / "inat"
API_V1 = "https://api.inaturalist.org/v1/"
API_V2 = "https://api.inaturalist.org/v2/"
MIN_INTERVAL = 1.0  # iNaturalist asks for about 1 request per second
CACHE_MINUTES = 30
OBS_PER_PAGE = 200
SPECIES_PER_PAGE = 500
REFERENCE_PLACE = 34  # Colorado: where establishment means (native vs. introduced) are judged

_last_request = 0.0


def inat_get(url, user_agent, params):
    """GET an iNaturalist API URL as JSON: cached for CACHE_MINUTES, else at most one request per second."""
    full = url + "?" + urllib.parse.urlencode(params)
    cached = CACHE_DIR / (hashlib.sha1(full.encode()).hexdigest() + ".json")
    if cached.exists() and time.time() - cached.stat().st_mtime < CACHE_MINUTES * 60:
        return json.loads(cached.read_text())

    global _last_request
    wait = _last_request + MIN_INTERVAL - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.time()
    req = urllib.request.Request(full, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.load(resp)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(data))
    return data


def read_js_object(path, pattern=r"=\s*(\{.*\})\s*;?\s*$"):
    """The JSON value assigned in one of the site's generated .js data files, or None."""
    match = re.search(pattern, path.read_text(), re.S) if path.exists() else None
    return json.loads(match.group(1)) if match else None


def read_spaces():
    """The site's spaces from js/spaces.js, in order."""
    spaces = read_js_object(SPACES_JS, r"=\s*(\[.*\])\s*;?\s*$")
    if not spaces:
        raise SystemExit(f"couldn't find the SPACES list in {SPACES_JS}")
    return spaces


def box_params(corners):
    """Two opposite [lat, lng] corners -> iNaturalist's nelat/nelng/swlat/swlng parameters."""
    (lat1, lng1), (lat2, lng2) = corners
    return {"nelat": max(lat1, lat2), "nelng": max(lng1, lng2), "swlat": min(lat1, lat2), "swlng": min(lng1, lng2)}


def area_params(space):
    """API filter for the space: its bounding box if it has one, otherwise its place."""
    return box_params(space["bbox"]) if space.get("bbox") else {"place_id": space["place_id"]}


def area_for(space):
    """The area to count, with a label: the space's own box or place, or the box its trends
    cache stands in with while iNaturalist hasn't indexed the place yet."""
    if space.get("bbox"):
        return box_params(space["bbox"]), "bounding box"
    cache = read_js_object(ROOT / "spaces" / space["id"] / "trends_cache.js")
    if cache and cache.get("bbox") and cache.get("place_id") == space["place_id"]:
        return cache["bbox"], "stand-in bounding box"
    return {"place_id": space["place_id"]}, f"place {space['place_id']}"


def exclusions(space):
    return [box_params(b) for b in space.get("exclude") or []]


def area_key(space):
    """Identifies the area (matches AREA_KEY in js/area.js), so caches for another area are ignored."""
    return json.dumps({"area": area_params(space), "exclude": exclusions(space)}, separators=(",", ":"))


def is_excluded(obs, boxes):
    coords = (obs.get("geojson") or {}).get("coordinates")
    if not coords or not boxes:
        return False
    lng, lat = coords
    return any(b["swlat"] <= lat <= b["nelat"] and b["swlng"] <= lng <= b["nelng"] for b in boxes)


def all_observations(space, user_agent, area=None):
    """Every verifiable observation in the space's area (or `area`), minus its excluded boxes."""
    fields = (
        "(id:!t,observed_on:!t,geojson:!t,quality_grade:!t,user:(login:!t),"
        "taxon:(id:!t,name:!t,rank_level:!t,ancestor_ids:!t,preferred_common_name:!t,default_photo:(square_url:!t,attribution:!t)))"
    )
    boxes = exclusions(space)
    kept, page = [], 1
    while True:
        data = inat_get(API_V2 + "observations", user_agent, {
            **(area or area_params(space)), "verifiable": "true", "order_by": "id", "order": "asc",
            "per_page": OBS_PER_PAGE, "page": page, "fields": fields,
        })
        kept += [obs for obs in data["results"] if not is_excluded(obs, boxes)]
        if len(data["results"]) < OBS_PER_PAGE or page * OBS_PER_PAGE >= data["total_results"]:
            return kept
        page += 1


def species_counts(area, user_agent):
    """taxon id -> (observation count, taxon) for every species-level (or finer) taxon in the
    area, from verifiable observations. Taxa include ancestor_ids, so callers can group them."""
    counts, page = {}, 1
    while True:
        data = inat_get(API_V1 + "observations/species_counts", user_agent,
                        {**area, "verifiable": "true", "per_page": SPECIES_PER_PAGE, "page": page})
        for r in data["results"]:
            if r["taxon"].get("rank_level", 100) <= 10:  # species and finer
                counts[r["taxon"]["id"]] = (r["count"], r["taxon"])
        if page * SPECIES_PER_PAGE >= data["total_results"] or not data["results"]:
            return counts
        page += 1


def count_observations(area, user_agent, **params):
    """Number of verifiable observations in the area matching params (one request, no paging)."""
    return inat_get(API_V1 + "observations", user_agent, {**area, "verifiable": "true", "per_page": 0, **params})["total_results"]


def corridor_bbox(spaces):
    """A box around every space's boundary, location and box, padded a little."""
    lats, lngs = [], []
    boundaries = read_js_object(ROOT / "js" / "boundaries.js") or {}

    def walk(coords):
        if isinstance(coords[0], (int, float)):
            lngs.append(coords[0])
            lats.append(coords[1])
        else:
            for c in coords:
                walk(c)

    for spc in spaces:
        if spc["id"] in boundaries:
            walk(boundaries[spc["id"]]["coordinates"])
        if spc.get("location"):
            lats.append(spc["location"][0])
            lngs.append(spc["location"][1])
        area, _ = area_for(spc)
        if "nelat" in area:
            lats += [area["nelat"], area["swlat"]]
            lngs += [area["nelng"], area["swlng"]]
    pad = 0.005
    return {"nelat": max(lats) + pad, "nelng": max(lngs) + pad, "swlat": min(lats) - pad, "swlng": min(lngs) - pad}


def introduced_species(spaces, user_agent):
    """Ids of every species observed around the corridor that iNaturalist lists as introduced in Colorado."""
    return set(species_counts({**corridor_bbox(spaces), "place_id": REFERENCE_PLACE, "introduced": "true"}, user_agent))
