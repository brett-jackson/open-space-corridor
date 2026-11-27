#!/usr/bin/env python3
"""Collect insect-flower interactions from iNaturalist observations and save them to
js/pollinator_network.js for pollinators.html.

Pulls verifiable open-coordinate Colorado (place_id 34) observations carrying any of
iNaturalist's taxon-typed flower-visitation / pollination observation fields, in both
directions:

  Insect observations (class Insecta, taxon 47158) -> Plantae field values:
    - "Nectar / Pollen delivering plant"        (field 4935, used by the How to Help card)
    - "Interaction->Visited flower of"          (field 3126)
    - "Nectar Plant"                            (field 498)
    - "pollinates"                              (field 33)
    - "Nectar  Plant"                           (field 11442)
    - "Observed Species Association: Pollination" (field 4980)

  Plant observations (kingdom Plantae, taxon 47126) -> Insecta field values:
    - "Interaction->Flower visited by"          (field 3125)
    - "Associated Pollinator"                   (field 11364)
    - "Pollinator"                              (field 5923)

Each Colorado observation is also matched against the open spaces in js/spaces.js
(via place_id or bounding box, respecting `exclude` boxes) so pollinators.html can tab
between local open spaces and all of Colorado, and filter Colorado's web to local species.

Subspecies and varieties roll up to their species; genus- or family-level IDs are kept as
recorded. An observation carrying multiple fields pointing to the same pair counts once.

    python3 scripts/update_pollinator_network.py
"""
import datetime
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for areas.py, even under python -I
from areas import (API_V1, OPEN_COORDS, REFERENCE_PLACE, ROOT, area_for, exclusions, inat_get,  # noqa: E402
                   is_excluded, is_hybrid, read_js_object, read_spaces, species_counts)

USER_AGENT = "open-space-corridor pollinator network (iNaturalist user: brettjackson)"
INSECTA = 47158
PLANTAE = 47126
FLOWER_FIELDS = (
    ("Nectar / Pollen delivering plant", 4935),
    ("Interaction->Visited flower of", 3126),
    ("Nectar Plant", 498),
    ("pollinates", 33),
    ("Nectar  Plant", 11442),
    ("Observed Species Association: Pollination", 4980),
)
VISITOR_FIELDS = (
    ("Interaction->Flower visited by", 3125),
    ("Associated Pollinator", 11364),
    ("Pollinator", 5923),
)
FLOWER_FIELD_IDS = {fid for _, fid in FLOWER_FIELDS}
FLOWER_FIELD_NAMES = {name.lower() for name, _ in FLOWER_FIELDS}
VISITOR_FIELD_IDS = {fid for _, fid in VISITOR_FIELDS}
VISITOR_FIELD_NAMES = {name.lower() for name, _ in VISITOR_FIELDS}

INSECT_GROUPS = (
    ("bees", "Bees", 630955),                      # Anthophila
    ("lepidoptera", "Butterflies & Moths", 47157), # Lepidoptera
    ("flies", "Flies", 47822),                     # Diptera
    ("other", "Other Insects", INSECTA),           # remaining Insecta
)
PER_PAGE = 200
MAX_CO_OBS_STORED = 20  # store up to 20 Colorado observation IDs per link to keep the file light
OUT = ROOT / "js" / "pollinator_network.js"


def canonical_taxon_id(taxon):
    """Roll subspecies/varieties (rank_level < 10) up to species; keep species and coarser ranks."""
    if not taxon or not taxon.get("id"):
        return None
    rank = taxon.get("rank_level", 100)
    ancestors = taxon.get("ancestor_ids") or []
    if rank < 10 and len(ancestors) >= 2:
        return ancestors[-2]
    return taxon["id"]


def insect_group(taxon):
    ancestors = set(taxon.get("ancestor_ids") or [])
    ancestors.add(taxon.get("id"))
    for gid, _, tid in INSECT_GROUPS:
        if tid in ancestors:
            return gid
    return "other"


def describe(taxon, extra=None):
    photo = taxon.get("default_photo") or {}
    info = {
        "name": taxon.get("name") or "",
        "common_name": taxon.get("preferred_common_name") or "",
        "rank": taxon.get("rank") or "",
        "photo": photo.get("square_url") or "",
    }
    if extra:
        info.update(extra)
    return info


def fetch_field_observations(area, field_name, taxon_id):
    """Verifiable open-coordinate `taxon_id` observations in `area` with `field_name`, paged via id_above."""
    kept, id_above = [], 0
    while True:
        params = {
            **area, **OPEN_COORDS, "verifiable": "true", "taxon_id": taxon_id,
            "field:" + field_name: "", "order_by": "id", "order": "asc",
            "per_page": PER_PAGE,
        }
        if id_above:
            params["id_above"] = id_above
        data = inat_get(API_V1 + "observations", USER_AGENT, params)
        results = data.get("results") or []
        kept.extend(results)
        if len(results) < PER_PAGE:
            return kept
        id_above = results[-1]["id"]


def extract_field_taxa(obs, field_ids, field_names, required_ancestor):
    """Distinct (canonical_id, raw_taxon_dict) pairs from matching taxon-typed observation fields."""
    found = {}
    for ofv in obs.get("ofvs") or []:
        fid = ofv.get("field_id")
        name = (ofv.get("name") or "").lower()
        if fid not in field_ids and name not in field_names:
            continue
        t = ofv.get("taxon") or {}
        if not t and ofv.get("taxon_id"):
            try:
                t = {"id": int(ofv["taxon_id"])}
            except (TypeError, ValueError):
                continue
        if not t or not t.get("id"):
            continue
        ancestors = t.get("ancestor_ids") or []
        if ancestors and required_ancestor not in ancestors and t.get("id") != required_ancestor:
            continue
        cid = canonical_taxon_id(t)
        if cid:
            found.setdefault(cid, t)
    return list(found.items())


def obs_in_space(obs, area, boxes):
    if boxes and is_excluded(obs, boxes):
        return False
    if "place_id" in area:
        return area["place_id"] in (obs.get("place_ids") or ())
    coords = (obs.get("geojson") or {}).get("coordinates")
    if not coords or len(coords) < 2:
        return False
    lon, lat = coords[0], coords[1]
    return (area["swlng"] <= lon <= area["nelng"] and
            area["swlat"] <= lat <= area["nelat"])


def collect_local_taxa(spaces):
    """Taxon IDs (species + their genus ancestors) already recorded across our top-level spaces."""
    local = set()
    net = read_js_object(ROOT / "js" / "species_network.js") or {}
    for groups in (net.get("by_space") or {}).values():
        for g in ("bees", "lepidoptera"):
            local.update(groups.get(g) or [])
    for spc in spaces:
        if spc.get("parent"):
            continue
        area, _ = area_for(spc)
        for _, (_, taxon) in species_counts(area, USER_AGENT).items():
            cid = canonical_taxon_id(taxon)
            if cid:
                local.add(cid)
            ancestors = taxon.get("ancestor_ids") or []
            if len(ancestors) >= 2:
                local.add(ancestors[-2])
    return local


def colorado_introduced_plants():
    """Plant species IDs iNaturalist lists as introduced in Colorado."""
    return set(species_counts({"place_id": REFERENCE_PLACE, "taxon_id": PLANTAE, "introduced": "true"}, USER_AGENT))


def main():
    spaces = read_spaces()
    space_matchers = [(spc, area_for(spc)[0], exclusions(spc)) for spc in spaces]
    introduced = colorado_introduced_plants()
    local_taxa = collect_local_taxa(spaces)
    help_tasks = (read_js_object(ROOT / "js" / "help_tasks.js") or {}).get("by_space") or {}
    print(f"{len(introduced)} introduced plants in Colorado; {len(local_taxa)} local taxa indexed across spaces")

    insects = {}       # insect taxon id -> metadata
    plants = {}        # plant taxon id -> metadata
    needs_lookup = set()
    edges = {}         # (insect_id, plant_id) -> {"by_space": {sid: set(oids)}, "local_obs": set(oids), "co_obs": set(oids)}
    local_obs_global = set()
    co_obs_global = set()
    space_counts = {spc["id"]: set() for spc in spaces}

    def record_pair(obs, insect_taxon, plant_taxon):
        if not insect_taxon or not plant_taxon or is_hybrid(insect_taxon) or is_hybrid(plant_taxon):
            return
        iid = canonical_taxon_id(insect_taxon)
        pid = canonical_taxon_id(plant_taxon)
        if not iid or not pid:
            return

        grp = insect_group(insect_taxon)
        if iid == insect_taxon.get("id") and insect_taxon.get("name"):
            insects.setdefault(iid, describe(insect_taxon, {"group": grp}))
        else:
            insects.setdefault(iid, {"group": grp})
            needs_lookup.add(iid)

        intro = pid in introduced or plant_taxon.get("id") in introduced
        if pid == plant_taxon.get("id") and plant_taxon.get("name"):
            plants.setdefault(pid, describe(plant_taxon, {"introduced": intro}))
        else:
            plants.setdefault(pid, {"introduced": intro})
            needs_lookup.add(pid)

        oid = obs["id"]
        rec = edges.setdefault((iid, pid), {"by_space": {}, "local_obs": set(), "co_obs": set()})
        rec["co_obs"].add(oid)
        co_obs_global.add(oid)

        for spc, area, boxes in space_matchers:
            if obs_in_space(obs, area, boxes):
                rec["by_space"].setdefault(spc["id"], set()).add(oid)
                space_counts[spc["id"]].add(oid)
                if not spc.get("parent"):
                    rec["local_obs"].add(oid)
                    local_obs_global.add(oid)

    co_area = {"place_id": REFERENCE_PLACE}

    # 1. Insect observations with visited-flower fields
    insect_obs_by_id = {}
    for field_name, _ in FLOWER_FIELDS:
        rows = fetch_field_observations(co_area, field_name, INSECTA)
        print(f"  Colorado Insect->Plant '{field_name}': {len(rows)} observations")
        for obs in rows:
            insect_obs_by_id.setdefault(obs["id"], obs)
    for obs in insect_obs_by_id.values():
        it = obs.get("taxon") or {}
        for _, pt in extract_field_taxa(obs, FLOWER_FIELD_IDS, FLOWER_FIELD_NAMES, PLANTAE):
            record_pair(obs, it, pt)

    # 2. Plant observations with visiting-insect fields
    plant_obs_by_id = {}
    for field_name, _ in VISITOR_FIELDS:
        rows = fetch_field_observations(co_area, field_name, PLANTAE)
        print(f"  Colorado Plant->Insect '{field_name}': {len(rows)} observations")
        for obs in rows:
            plant_obs_by_id.setdefault(obs["id"], obs)
    for obs in plant_obs_by_id.values():
        pt = obs.get("taxon") or {}
        for _, it in extract_field_taxa(obs, VISITOR_FIELD_IDS, VISITOR_FIELD_NAMES, INSECTA):
            record_pair(obs, it, pt)

    for spc in spaces:
        n = len(space_counts[spc["id"]])
        if n:
            print(f"  local {spc['id']}: {n} observations")

    # Fetch missing or subspecies-rolled-up taxon metadata (names + square photos)
    to_fetch = sorted(
        tid for tid in (set(insects) | set(plants))
        if tid in needs_lookup or not (insects.get(tid) or plants.get(tid) or {}).get("photo")
    )
    print(f"  fetching metadata for {len(to_fetch)} taxa")
    for i in range(0, len(to_fetch), 30):
        data = inat_get(API_V1 + "taxa/" + ",".join(map(str, to_fetch[i:i + 30])), USER_AGENT, {})
        for taxon in data.get("results") or []:
            tid = taxon["id"]
            if tid in insects:
                insects[tid] = describe(taxon, {"group": insect_group(taxon)})
            if tid in plants:
                plants[tid] = describe(taxon, {"introduced": tid in introduced})

    # Drop any taxa whose resolved ancestry wasn't actually Insecta / Plantae (rare missing-ancestor field values)
    local_link_insects = {iid for (iid, _), r in edges.items() if r["local_obs"] or r["by_space"]}
    local_link_plants = {pid for (_, pid), r in edges.items() if r["local_obs"] or r["by_space"]}
    for tid, info in insects.items():
        if tid in local_taxa or tid in local_link_insects:
            info["in_spaces"] = True
    for tid, info in plants.items():
        if tid in local_taxa or tid in local_link_plants:
            info["in_spaces"] = True

    links = []
    for (iid, pid), rec in sorted(
        edges.items(),
        key=lambda kv: (-len(kv[1]["local_obs"]), -len(kv[1]["co_obs"]), kv[0][0], kv[0][1]),
    ):
        by_space_obs = {sid: sorted(oids) for sid, oids in sorted(rec["by_space"].items())}
        local_oids = sorted(rec["local_obs"])
        if not local_oids and by_space_obs:
            local_oids = sorted({oid for oids in by_space_obs.values() for oid in oids})
        co_oids = sorted(rec["co_obs"], reverse=True)
        entry = {
            "insect": iid,
            "plant": pid,
            "count": len(local_oids),
            "co_count": len(co_oids),
            "co_obs": co_oids[:MAX_CO_OBS_STORED],
        }
        if local_oids:
            entry["obs"] = local_oids
        if by_space_obs:
            entry["by_space"] = by_space_obs
        links.append(entry)

    unannotated = {
        spc["id"]: int((help_tasks.get(spc["id"]) or {}).get("pollinator_plants") or 0)
        for spc in spaces
    }

    all_fields = (
        [{"name": name, "id": fid, "direction": "insect_to_plant"} for name, fid in FLOWER_FIELDS] +
        [{"name": name, "id": fid, "direction": "plant_to_insect"} for name, fid in VISITOR_FIELDS]
    )
    payload = {
        "updated": datetime.date.today().isoformat(),
        "colorado_place_id": REFERENCE_PLACE,
        "fields": all_fields,
        "groups": [{"id": gid, "label": label} for gid, label, _ in INSECT_GROUPS],
        "insects": {str(k): v for k, v in sorted(insects.items())},
        "plants": {str(k): v for k, v in sorted(plants.items())},
        "links": links,
        "observations": len(local_obs_global),
        "co_observations": len(co_obs_global),
        "unannotated": unannotated,
    }
    OUT.write_text(
        "// Generated by scripts/update_pollinator_network.py: insect-flower interactions from iNaturalist observation fields\n"
        "window.POLLINATOR_NETWORK = " + json.dumps(payload, separators=(",", ":")) + ";\n"
    )
    local_links = sum(1 for l in links if l["count"] > 0)
    print(f"wrote {OUT.relative_to(ROOT)} ({local_links} local links / {len(links)} Colorado links; "
          f"{len(local_obs_global)} local obs / {len(co_obs_global)} Colorado obs; "
          f"{len(insects)} insects, {len(plants)} plants)")


if __name__ == "__main__":
    main()
