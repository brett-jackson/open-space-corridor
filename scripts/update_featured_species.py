#!/usr/bin/env python3
"""Rank each space's most distinctive species with TF-IDF and save them to js/featured_species.js.

Spaces are the documents and species are the terms:

    tf  = log(1 + observations of the species in this space)
    idf = log(number of spaces / number of spaces where the species was observed)
    score = tf * idf

So a species seen in every space scores 0, and one seen often in only one space ranks
highest. Only species-level (and finer) identifications count, from verifiable
observations, and species iNaturalist lists as introduced in Colorado are left out
(native and unknown-status species stay). To be featured, a species needs at least
MIN_OBSERVATIONS observations in the space, or at least one Research Grade one there;
every species still counts toward df, so the filter doesn't change what's unique. A space whose trends cache is a bounding-box stand-in (its place isn't
indexed yet) is counted over that same box.

    python3 scripts/update_featured_species.py
"""
import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.inaturalist.org/v1/observations/species_counts"
USER_AGENT = "open-space-corridor featured species (iNaturalist user: brettjackson)"
MIN_INTERVAL = 1.0  # iNaturalist asks for about 1 request per second
PER_PAGE = 500
TOP_N = 10
MIN_OBSERVATIONS = 3  # fewer is fine if any observation is Research Grade
REFERENCE_PLACE = 34  # Colorado: where establishment means (native vs. introduced) are judged
ROOT = Path(__file__).resolve().parent.parent
SPACES_JS = ROOT / "js" / "spaces.js"
OUT = ROOT / "js" / "featured_species.js"

_last_request = 0.0


def inat(**params):
    global _last_request
    wait = _last_request + MIN_INTERVAL - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.time()
    url = API + "?" + urllib.parse.urlencode({"verifiable": "true", **params})
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.load(resp)


def read_js_object(path, pattern):
    match = re.search(pattern, path.read_text(), re.S) if path.exists() else None
    return json.loads(match.group(1)) if match else None


def area_for(space):
    """The space's place, or the bounding box its trends cache stands in with."""
    cache = read_js_object(ROOT / "spaces" / space["id"] / "trends_cache.js", r"=\s*(\{.*\})\s*;?\s*$")
    if cache and cache.get("bbox") and cache.get("place_id") == space["place_id"]:
        return cache["bbox"], "bounding box"
    return {"place_id": space["place_id"]}, f"place {space['place_id']}"


def species_counts(area):
    """taxon id -> (observation count, taxon) for every species-level taxon in the area."""
    counts, page = {}, 1
    while True:
        data = inat(**area, per_page=PER_PAGE, page=page)
        for r in data["results"]:
            if r["taxon"].get("rank_level", 100) <= 10:  # species and finer
                counts[r["taxon"]["id"]] = (r["count"], r["taxon"])
        if page * PER_PAGE >= data["total_results"] or not data["results"]:
            return counts
        page += 1


def corridor_bbox(spaces):
    """A box around every space's boundary and stand-in box, padded a little."""
    lats, lngs = [], []
    boundaries = read_js_object(ROOT / "js" / "boundaries.js", r"=\s*(\{.*\})\s*;?\s*$") or {}

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


def main():
    spaces = read_js_object(SPACES_JS, r"=\s*(\[.*\])\s*;?\s*$")
    if not spaces:
        raise SystemExit(f"couldn't find the SPACES list in {SPACES_JS}")

    # Every species observed around the corridor that's listed as introduced in Colorado
    introduced = set(species_counts({**corridor_bbox(spaces), "place_id": REFERENCE_PLACE, "introduced": "true"}))
    print(f"{len(introduced)} introduced species around the corridor (excluded)")

    by_space = {}
    research = {}  # space -> taxon id -> Research Grade observation count
    for spc in spaces:
        area, label = area_for(spc)
        counts = species_counts(area)
        by_space[spc["id"]] = {t: v for t, v in counts.items() if t not in introduced}
        research[spc["id"]] = {t: v[0] for t, v in species_counts({**area, "quality_grade": "research"}).items()}
        print(f"{spc['id']}: {len(by_space[spc['id']])} native or unknown-status species of {len(counts)} ({label})")

    # Only spaces with any observations take part, so an empty space doesn't inflate idf
    active = [sid for sid, counts in by_space.items() if counts]
    n = len(active)
    df = {}
    for sid in active:
        for taxon_id in by_space[sid]:
            df[taxon_id] = df.get(taxon_id, 0) + 1

    featured = {}
    for sid in active:
        scored = []
        for taxon_id, (count, taxon) in by_space[sid].items():
            if count < MIN_OBSERVATIONS and not research[sid].get(taxon_id):
                continue  # too few sightings to feature, and none confirmed
            idf = math.log(n / df[taxon_id])
            score = math.log1p(count) * idf
            if score > 0:
                scored.append((score, count, taxon))
        scored.sort(key=lambda s: (-s[0], -s[1], s[2]["name"]))
        featured[sid] = []
        for score, count, taxon in scored[:TOP_N]:
            photo = taxon.get("default_photo") or {}
            featured[sid].append({
                "taxon_id": taxon["id"],
                "name": taxon["name"],
                "common_name": taxon.get("preferred_common_name") or "",
                "photo": photo.get("square_url") or "",
                "attribution": photo.get("attribution") or "",
                "count": count,
                "research_grade": research[sid].get(taxon["id"], 0),
                "spaces": df[taxon["id"]],
                "score": round(score, 4),
            })

    OUT.write_text(
        "// Generated by scripts/update_featured_species.py: each space's most distinctive species by TF-IDF\n"
        f"window.FEATURED_SPECIES = {json.dumps({'spaces_compared': n, 'excludes_introduced_in': 'Colorado', 'by_space': featured}, indent=1)};\n"
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({n} spaces compared)")


if __name__ == "__main__":
    main()
