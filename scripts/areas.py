"""Shared helpers for the update scripts: reading js/spaces.js and resolving each space's area.

A space's area is its iNaturalist `place_id`, or a `bbox` of two opposite [lat, lng] corners,
minus any `exclude` boxes in the same format. The API can filter to a box but not subtract
one, so spaces with exclusions are counted from their individual observations
(all_observations) instead of the API's summary endpoints.
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPACES_JS = ROOT / "js" / "spaces.js"
API_V2 = "https://api.inaturalist.org/v2/"
MIN_INTERVAL = 1.0  # iNaturalist asks for about 1 request per second
OBS_PER_PAGE = 200

_last_request = 0.0


def inat_get(url, user_agent, params):
    """GET an iNaturalist API URL as JSON, at most one request per MIN_INTERVAL across all callers."""
    global _last_request
    wait = _last_request + MIN_INTERVAL - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.time()
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": user_agent})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def read_spaces():
    """The site's spaces from js/spaces.js, in order."""
    match = re.search(r"=\s*(\[.*\])\s*;?\s*$", SPACES_JS.read_text(), re.S)
    if not match:
        raise SystemExit(f"couldn't find the SPACES list in {SPACES_JS}")
    return json.loads(match.group(1))


def box_params(corners):
    """Two opposite [lat, lng] corners -> iNaturalist's nelat/nelng/swlat/swlng parameters."""
    (lat1, lng1), (lat2, lng2) = corners
    return {"nelat": max(lat1, lat2), "nelng": max(lng1, lng2), "swlat": min(lat1, lat2), "swlng": min(lng1, lng2)}


def area_params(space):
    """API filter for the space: its bounding box if it has one, otherwise its place."""
    return box_params(space["bbox"]) if space.get("bbox") else {"place_id": space["place_id"]}


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
