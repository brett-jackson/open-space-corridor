#!/usr/bin/env python3
"""Save each space's eBird records, from GBIF, to js/gbif_records.js for the site's bird
statistics (the corridor network and signature species).

GBIF (gbif.org) gathers records from many sources into one free API with no key. Only its
copy of the eBird Observation Dataset is used (shared to GBIF about once a year): every other
record on the site comes straight from iNaturalist. One eBird record is one species on one
checklist, so counts aren't directly comparable with iNaturalist's observation counts.

Which taxa: TAXA below, by GBIF backbone taxon key; add a row to cover another group.
Which areas: every space in js/spaces.js, as the shape it has in js/boundaries.js; spaces
given by a `bbox` use that box. GBIF can't subtract an area, so a space's `exclude` boxes are
counted separately and their records subtracted (they're assumed to lie inside the space).

For each space and taxon it records the total, records per year, records per source
dataset, and records per species, along with how many iNaturalist observations of each species
the space has (so the page can point out species nobody has recorded there on iNaturalist).
Those come from iNaturalist itself, any quality grade or license, not from GBIF's copy, which
holds only openly licensed research-grade observations and lags behind.

Species follow iNaturalist's taxonomy, so they read and count the same as in the site's other
sections. Each GBIF species is matched to an iNaturalist species: from the site's own data
files, else from the last js/gbif_records.js, else with the iNaturalist taxa API (which also
matches GBIF synonyms and nominate subspecies; a subspecies match counts as its species).
GBIF species that land on the same iNaturalist species are merged (GBIF's Audubon's Warbler
into Yellow-rumped Warbler), and species are keyed by iNaturalist taxon id. A GBIF species
iNaturalist can't match keeps its GBIF name, keyed "gbif-<key>", and is tried again next run.

    python3 scripts/update_gbif.py
"""
import hashlib
import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for areas.py, even under python -I
from areas import API_V1, ROOT, all_observations, area_for, exclusions, inat_get, read_js_object, read_spaces, species_counts  # noqa: E402

USER_AGENT = "open-space-corridor GBIF records (iNaturalist user: brettjackson)"
API = "https://api.gbif.org/v1/"
CACHE_DIR = ROOT / ".cache" / "gbif"
CACHE_MINUTES = 30
MIN_INTERVAL = 0.5  # GBIF has no fixed limit for light use; stay polite anyway
FACET_LIMIT = 2000  # more than any space's species or years
TAXA = [  # in display order; taxon_key is GBIF's backbone key, inat_taxon_id iNaturalist's id
    {"id": "birds", "label": "Birds", "singular": "Bird", "taxon_key": 212, "inat_taxon_id": 3},  # Aves
]
INATURALIST = "50c9509d-22c7-4a22-a47d-8c48425ef4a7"  # iNaturalist research-grade observations
EBIRD = "4fa7b334-ce0d-4e88-aaae-2e0c138d049e"        # eBird Observation Dataset
SHORT_NAMES = {INATURALIST: "iNaturalist", EBIRD: "eBird"}
# Every query: eBird records only, actually present (not absences), without known location problems
BASE_PARAMS = {"datasetKey": EBIRD, "occurrenceStatus": "PRESENT", "hasGeospatialIssue": "false"}
OUT = ROOT / "js" / "gbif_records.js"
# GBIF backbone name -> iNaturalist scientific name, for GBIF taxonomy errors the taxa API can't match
INAT_OVERRIDES = {
    "Falco atricapillus": "Astur atricapillus",  # American Goshawk, which GBIF misfiles under Falco
}

_last_request = 0.0


def gbif_get(path, params=None):
    """GET a GBIF API path as JSON: cached for CACHE_MINUTES, else spaced MIN_INTERVAL apart."""
    full = API + path + ("?" + urllib.parse.urlencode(params, doseq=True) if params else "")
    cached = CACHE_DIR / (hashlib.sha1(full.encode()).hexdigest() + ".json")
    if cached.exists() and time.time() - cached.stat().st_mtime < CACHE_MINUTES * 60:
        return json.loads(cached.read_text())

    global _last_request
    wait = _last_request + MIN_INTERVAL - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.time()
    req = urllib.request.Request(full, headers={"User-Agent": USER_AGENT})
    for attempt in range(4):  # GBIF sometimes drops connections; retry those, not 4xx errors
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.load(resp)
            break
        except (urllib.error.URLError, ssl.SSLError, ConnectionError, TimeoutError) as err:
            if isinstance(err, urllib.error.HTTPError) and 400 <= err.code < 500 or attempt == 3:
                raise
            time.sleep(2 ** attempt)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(data))
    return data


def ring_wkt(ring, counterclockwise):
    """One ring as WKT, wound the way GBIF expects: outer rings counterclockwise, holes clockwise."""
    area2 = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:]))
    if (area2 > 0) != counterclockwise:
        ring = ring[::-1]
    return "(" + ",".join(f"{round(x, 6)} {round(y, 6)}" for x, y in ring) + ")"


def geojson_wkt(geometry):
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    return "MULTIPOLYGON(" + ",".join(
        "(" + ",".join(ring_wkt(ring, i == 0) for i, ring in enumerate(polygon)) + ")" for polygon in polygons
    ) + ")"


def box_wkt(corners):
    """Two opposite [lat, lng] corners as a WKT polygon."""
    (lat1, lng1), (lat2, lng2) = corners
    s, n, w, e = min(lat1, lat2), max(lat1, lat2), min(lng1, lng2), max(lng1, lng2)
    return "POLYGON(" + ring_wkt([[w, s], [e, s], [e, n], [w, n], [w, s]], True) + ")"


def space_shapes(space, boundaries):
    """(WKT of the space's area, [WKT of each box to subtract]), or None if it has no shape yet."""
    if space.get("bbox"):
        area = box_wkt(space["bbox"])
    elif space["id"] in boundaries:
        area = geojson_wkt(boundaries[space["id"]])
    else:
        return None
    return area, [box_wkt(b) for b in space.get("exclude") or []]


def facets(wkt, taxon_key, **params):
    """Total records in the shape, with counts per species, year and dataset."""
    data = gbif_get("occurrence/search", {
        **BASE_PARAMS, "geometry": wkt, "taxonKey": taxon_key, "limit": 0,
        "facet": ["speciesKey", "year", "datasetKey"], "facetLimit": FACET_LIMIT, **params,
    })
    out = {"total": data["count"]}
    for facet in data.get("facets", []):
        field = facet["field"].lower().replace("_", "")  # SPECIES_KEY -> specieskey
        out[field] = Counter({c["name"]: c["count"] for c in facet["counts"]})
    for field in ("specieskey", "year", "datasetkey"):
        out.setdefault(field, Counter())
    return out


def area_facets(shapes, taxon_key, **params):
    """facets() for the area minus its excluded boxes."""
    area, excluded = shapes
    result = facets(area, taxon_key, **params)
    for box in excluded:
        cut = facets(box, taxon_key, **params)
        result["total"] -= cut["total"]
        for field in ("specieskey", "year", "datasetkey"):
            result[field].subtract(cut[field])
            result[field] = +result[field]  # drop zeros and negatives
    return result


def english_name(key):
    """The most common English vernacular name GBIF lists for a species, or ""."""
    names = gbif_get(f"species/{key}/vernacularNames", {"limit": 200}).get("results", [])
    english = Counter(n["vernacularName"].strip() for n in names if n.get("language") == "eng" and n.get("vernacularName"))
    if not english:
        return ""
    # Count spellings case-insensitively, then keep the best-capitalized form of the winner
    by_lower = Counter()
    for name, n in english.items():
        by_lower[name.lower()] += n
    winner = by_lower.most_common(1)[0][0]
    return max((name for name in english if name.lower() == winner), key=lambda s: (sum(c.isupper() for c in s), english[s]))


def site_taxa():
    """Scientific name -> iNaturalist species from the site's other data files."""
    taxa = {}
    network = read_js_object(ROOT / "js" / "species_network.js") or {}
    for taxon_id, sp in (network.get("species") or {}).items():
        taxa[sp["name"]] = {"id": int(taxon_id), "name": sp["name"], "common_name": sp.get("common_name") or ""}
    featured = read_js_object(ROOT / "js" / "featured_species.js") or {}
    for spaces in (featured.get("by_space") or {}).values():
        for sp in spaces:
            taxa.setdefault(sp["name"], {"id": sp["taxon_id"], "name": sp["name"], "common_name": sp.get("common_name") or ""})
    return taxa


def inat_species(gbif_name):
    """The iNaturalist species for a GBIF species name as {id, name, common_name}, or None."""
    name = INAT_OVERRIDES.get(gbif_name, gbif_name)
    # Also accept the nominate subspecies form ("Bubulcus ibis ibis"), which is sometimes the
    # only synonym iNaturalist keeps after a split or lump
    names = {name, f"{name} {name.split()[-1]}"}
    params = {"q": name, "rank": "species,subspecies", "per_page": 10}
    for taxon in inat_get(API_V1 + "taxa", USER_AGENT, params).get("results", []):
        if not names & {taxon.get("name"), taxon.get("matched_term")}:
            continue
        if taxon.get("rank") != "species":  # e.g. Setophaga coronata auduboni -> Yellow-rumped Warbler
            full = inat_get(API_V1 + f"taxa/{taxon['id']}", USER_AGENT, {})["results"][0]
            taxon = next((a for a in full.get("ancestors", []) if a.get("rank") == "species"), None)
            if not taxon:
                return None
        return {"id": taxon["id"], "name": taxon["name"], "common_name": taxon.get("preferred_common_name") or ""}
    return None


def inat_species_id(taxon):
    """The iNaturalist species a taxon belongs to: itself at species rank, or its species ancestor."""
    rank = taxon.get("rank_level", 100)
    if rank == 10:
        return taxon["id"]
    if rank < 10 and len(taxon.get("ancestor_ids") or []) >= 2:
        return taxon["ancestor_ids"][-2]  # ancestor_ids ends with the taxon itself
    return None


def inat_counts(space, taxon):
    """iNaturalist species id -> observations of it in the space, for one taxon: any quality
    grade and license, straight from iNaturalist (shared with the other scripts' request cache)."""
    area, _ = area_for(space)
    if exclusions(space):  # count observation by observation, so the excluded boxes drop out
        taxa = [o["taxon"] for o in all_observations(space, USER_AGENT, area) if o.get("taxon")]
        weighted = [(t, 1) for t in taxa]
    else:
        weighted = [(t, n) for n, t in species_counts(area, USER_AGENT).values()]
    counts = Counter()
    for t, n in weighted:
        if taxon["inat_taxon_id"] in (t.get("ancestor_ids") or []):
            sid = inat_species_id(t)
            if sid:
                counts[str(sid)] += n
    return counts


def main():
    spaces = read_spaces()
    boundaries = read_js_object(ROOT / "js" / "boundaries.js") or {}
    by_space, queries, species_keys, dataset_keys = {}, {}, set(), set()
    for spc in spaces:
        shapes = space_shapes(spc, boundaries)
        if not shapes:
            print(f"{spc['id']}: no boundary or box yet (run update_boundaries.py); skipped")
            continue
        queries[spc["id"]] = shapes[0]
        by_space[spc["id"]] = {}
        for taxon in TAXA:
            every = area_facets(shapes, taxon["taxon_key"])
            species = sorted(every["specieskey"].items(), key=lambda kv: (-kv[1], int(kv[0])))
            by_space[spc["id"]][taxon["id"]] = {
                "total": every["total"],
                "years": {y: n for y, n in sorted(every["year"].items())},
                "datasets": dict(every["datasetkey"].most_common()),
                # [GBIF species key, records]; merged and given iNaturalist counts below
                "species": [[int(k), n] for k, n in species],
                "inat": inat_counts(spc, taxon),
            }
            species_keys.update(int(k) for k, _ in species)
            dataset_keys.update(every["datasetkey"])

    known = {name: taxon for name, taxon in site_taxa().items() if name not in INAT_OVERRIDES}
    previous = (read_js_object(OUT) or {}).get("species") or {}
    for taxon_id, sp in previous.items():  # matches from the last run, to skip looking them up again
        if sp.get("source") == "inaturalist":
            for gbif_name in sp.get("gbif_names", []):
                known.setdefault(gbif_name, {"id": int(taxon_id), "name": sp["name"], "common_name": sp["common_name"]})
    species, out_key = {}, {}
    for key in sorted(species_keys):
        info = gbif_get(f"species/{key}")
        name = info.get("canonicalName") or info.get("scientificName") or str(key)
        taxon = known.get(name) or inat_species(name)
        if taxon:
            out_key[key] = str(taxon["id"])
            entry = species.setdefault(out_key[key], {"name": taxon["name"], "common_name": taxon["common_name"],
                                                      "source": "inaturalist", "gbif_names": []})
            entry["gbif_names"].append(name)
        else:
            out_key[key] = f"gbif-{key}"
            species[out_key[key]] = {"name": name, "common_name": english_name(key), "source": "gbif", "gbif_key": key}

    # Merge GBIF species that are one iNaturalist species:
    # [species key, GBIF records, iNaturalist observations of it in the space (any grade)]
    for space_id, taxa in by_space.items():
        for taxon_id, rec in taxa.items():
            inat = rec.pop("inat")
            merged = {}
            for key, n in rec["species"]:
                row = merged.setdefault(out_key[key], [out_key[key], 0, inat.get(out_key[key], 0)])
                row[1] += n
            rec["species"] = sorted(merged.values(), key=lambda r: (-r[1], r[0]))
            missing = sum(1 for row in rec["species"] if not row[2])
            print(f"{space_id} {taxon_id}: {rec['total']} records, {len(rec['species'])} species, "
                  f"{rec['datasets'].get(EBIRD, 0)} from eBird, {missing} not yet on iNaturalist here")
    datasets = {}
    for key in sorted(dataset_keys):
        datasets[key] = SHORT_NAMES.get(key) or gbif_get(f"dataset/{key}").get("title") or key

    OUT.write_text(
        "// Generated by scripts/update_gbif.py: eBird records (via GBIF) per space\n"
        "window.GBIF_RECORDS = " + json.dumps({
            "updated": date.today().isoformat(),
            "taxa": TAXA,
            "inaturalist_dataset": INATURALIST,
            "ebird_dataset": EBIRD,
            "datasets": datasets,
            "species": species,
            "queries": queries,  # each space's area as WKT, for links to the same search on gbif.org
            "by_space": by_space,
        }, separators=(",", ":")) + ";\n"
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({len(species)} species)")


if __name__ == "__main__":
    main()
