#!/usr/bin/env python3
"""Save each space's native species in a few groups to js/species_network.js for the corridor
network views, which compare which species neighboring spaces share.

Groups (GROUPS below): native bees (Anthophila), native butterflies and moths (order
Lepidoptera) and native birds (class Aves). "Native" means not listed by iNaturalist as
introduced in Colorado, matching the signature species. Observations identified below
species (subspecies, varieties) count toward their species, so two spaces' lists compare
like with like. Each space's species come from the same full species list the signature
species use (shared through the request cache in areas.py); spaces with excluded boxes are
counted from their individual observations.

It also records each space's verifiable observation count per group, counted the same way
for every space: all observations in the group, whatever rank they're identified to. The
map uses it to flag spaces where more observations are needed.

Groups that data/gbif_records.json also covers (birds: eBird records via GBIF, from
scripts/update_gbif.py) add eBird's records: their native species join the space's list
(listed in "ebird_only" when iNaturalist hasn't recorded them there), and their records join
its count. Everything else comes from iNaturalist.

Sites differ hugely in how much they've been surveyed, and a longer survey finds more species,
so raw lists mostly compare effort. Two numbers correct for that, both by rarefaction (the
species expected from a random subset of a site's records, from its records per species):
"equal_effort" is each site's expected species count at the same number of records (the
least-surveyed site that still has enough), and "similarity" is each pair's Sørensen
similarity with the better-surveyed site cut down to the other's number of records.

    python3 scripts/update_species_network.py
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for areas.py, even under python -I
from areas import (ROOT, all_observations, area_for, count_observations, exclusions, inat_get,  # noqa: E402
                   introduced_species, is_hybrid, read_json, read_spaces, species_counts)

USER_AGENT = "open-space-corridor species network (iNaturalist user: brettjackson)"
GROUPS = [  # in display order: birds first
    {"id": "birds", "label": "Birds", "taxon_id": 3},                          # Aves
    {"id": "bees", "label": "Bees", "taxon_id": 630955},                       # Anthophila
    {"id": "lepidoptera", "label": "Butterflies & Moths", "taxon_id": 47157},  # Lepidoptera
]
OUT = ROOT / "js" / "species_network.js"
LOW_EFFORT = 30  # matches NETWORK_LOW_EFFORT in js/network.js: fewer records than this is too few to compare


def species_id(taxon):
    """The species a taxon belongs to: itself at species rank, or its species ancestor below it."""
    rank = taxon.get("rank_level", 100)
    if rank == 10:
        return taxon["id"]
    if rank < 10 and len(taxon.get("ancestor_ids") or []) >= 2:
        return taxon["ancestor_ids"][-2]  # ancestor_ids ends with the taxon itself
    return None


def chance_seen(count, total, sample):
    """Chance a species with `count` of a site's `total` records turns up in `sample` of them."""
    if sample >= total or total - count < sample:
        return 1.0
    return 1 - math.exp(math.lgamma(total - count + 1) - math.lgamma(total - count - sample + 1)
                        - math.lgamma(total + 1) + math.lgamma(total - sample + 1))


def round_down(n):
    """n rounded down to one significant figure (1,119 -> 1,000), for a baseline that reads cleanly."""
    step = 10 ** (len(str(n)) - 1)
    return n // step * step


def effort_corrected(counts):
    """From {space: {species: records}} for one group: the equal-effort baseline and each
    site's expected species at it, and every pair's equal-effort similarity."""
    totals = {s: sum(c.values()) for s, c in counts.items()}
    enough = [n for n in totals.values() if n >= LOW_EFFORT]
    equal = None
    if len(enough) >= 2:
        base = round_down(min(enough))
        equal = {"records": base, "species": {
            s: round(sum(chance_seen(n, totals[s], base) for n in c.values()), 1)
            for s, c in counts.items() if totals[s] >= base}}
    similarity = {}
    ids = sorted(counts)
    for i, a in enumerate(ids):
        for b in ids[i + 1:]:
            sample = min(totals[a], totals[b])
            if sample == 0:
                continue
            pa = {k: chance_seen(n, totals[a], sample) for k, n in counts[a].items()}
            pb = {k: chance_seen(n, totals[b], sample) for k, n in counts[b].items()}
            shared = sum(p * pb[k] for k, p in pa.items() if k in pb)
            similarity[f"{a}|{b}"] = round(2 * shared / (sum(pa.values()) + sum(pb.values())), 3)
    return equal, similarity


def describe(taxon):
    photo = taxon.get("default_photo") or {}
    return {
        "name": taxon["name"],
        "common_name": taxon.get("preferred_common_name") or "",
        "photo": photo.get("square_url") or "",
    }


def in_group(taxon, group):
    return group["taxon_id"] in (taxon.get("ancestor_ids") or [])


def main():
    spaces = read_spaces()
    introduced = introduced_species(spaces, USER_AGENT)
    print(f"{len(introduced)} introduced species around the corridor (excluded)")

    species = {}          # species id -> display info
    needs_lookup = set()  # species reached only through a subspecies
    needs_photo = set()   # species known only from eBird records
    by_space = {}
    effort = {}           # space -> group -> observation count (any rank)
    records = {}          # group -> space -> species id -> records of it (for the equal-effort numbers)
    for spc in spaces:
        area, _ = area_for(spc)
        if exclusions(spc):
            observed = [o["taxon"] for o in all_observations(spc, USER_AGENT, area) if o.get("taxon")]
            seen = {}
            for t in observed:
                if t.get("rank_level", 100) <= 10:
                    seen[t["id"]] = (seen.get(t["id"], (0, t))[0] + 1, t)
        else:
            observed = None
            seen = species_counts(area, USER_AGENT)
        taxa_seen = [(n, t) for n, t in seen.values() if not is_hybrid(t)]
        by_space[spc["id"]] = {}
        effort[spc["id"]] = {}
        for group in GROUPS:
            if observed is not None:
                effort[spc["id"]][group["id"]] = sum(1 for t in observed if in_group(t, group))
            else:
                effort[spc["id"]][group["id"]] = count_observations(area, USER_AGENT, taxon_id=group["taxon_id"])
            ids = set()
            tally = records.setdefault(group["id"], {}).setdefault(spc["id"], {})
            for n, taxon in ((n, t) for n, t in taxa_seen if in_group(t, group)):
                sid = species_id(taxon)
                if sid is None or sid in introduced or taxon["id"] in introduced:
                    continue
                ids.add(sid)
                tally[sid] = tally.get(sid, 0) + n
                if sid == taxon["id"]:
                    species.setdefault(sid, describe(taxon))
                elif sid not in species:
                    needs_lookup.add(sid)
            by_space[spc["id"]][group["id"]] = sorted(ids)
        print(f"{spc['id']}: " + ", ".join(
            f"{len(by_space[spc['id']][g['id']])} {g['id']} ({effort[spc['id']][g['id']]} obs.)" for g in GROUPS))

    # Species seen only as subspecies need their own names and photos
    missing = sorted(needs_lookup - set(species))
    for i in range(0, len(missing), 30):
        data = inat_get("https://api.inaturalist.org/v1/taxa/" + ",".join(map(str, missing[i:i + 30])), USER_AGENT, {})
        for taxon in data["results"]:
            species[taxon["id"]] = describe(taxon)

    # eBird records (via GBIF) for groups data/gbif_records.json covers
    gbif = read_json(ROOT / "data" / "gbif_records.json") or {}
    ebird_only = {}  # space -> group -> species only eBird has recorded there
    ebird_years = [int(y) for taxa in (gbif.get("by_space") or {}).values() for rec in taxa.values() for y in rec.get("years", {})]
    for space_id, taxa in (gbif.get("by_space") or {}).items():
        for group_id, rec in taxa.items():
            if space_id not in by_space or group_id not in by_space[space_id]:
                continue
            ids = set(by_space[space_id][group_id])
            added = set()
            for key, n, inat_n in rec["species"]:
                if key.startswith("gbif-"):
                    continue  # no iNaturalist species to compare with
                sid = int(key)
                info = (gbif.get("species") or {}).get(key) or {}
                if sid in introduced or is_hybrid(info) or not n:
                    continue
                tally = records[group_id][space_id]
                tally[sid] = tally.get(sid, 0) + n
                if sid in ids:
                    continue
                added.add(sid)
                if sid not in species:
                    species[sid] = {"name": info.get("name", key), "common_name": info.get("common_name", ""), "photo": ""}
                    needs_photo.add(sid)
            by_space[space_id][group_id] = sorted(ids | added)
            ebird_only.setdefault(space_id, {})[group_id] = sorted(added)
            effort[space_id][group_id] += rec["total"]
            print(f"{space_id} {group_id}: +{len(added)} species and +{rec['total']} records from eBird")

    # Species known only from eBird need iNaturalist's photo (and preferred name)
    photo_ids = sorted(needs_photo)
    for i in range(0, len(photo_ids), 30):
        data = inat_get("https://api.inaturalist.org/v1/taxa/" + ",".join(map(str, photo_ids[i:i + 30])), USER_AGENT, {})
        for taxon in data["results"]:
            species[taxon["id"]] = describe(taxon)

    used = {sid for groups in by_space.values() for ids in groups.values() for sid in ids}
    equal_effort, similarity = {}, {}
    for group in GROUPS:
        equal, similarity[group["id"]] = effort_corrected(records[group["id"]])
        if equal:
            equal_effort[group["id"]] = equal
            print(f"{group['id']}: at {equal['records']} records, " + ", ".join(f"{s} {n}" for s, n in equal["species"].items()))
    OUT.write_text(
        "// Generated by scripts/update_species_network.py: native species per space for the map's network overlays\n"
        "window.SPECIES_NETWORK = " + json.dumps({
            "groups": [{"id": g["id"], "label": g["label"]} for g in GROUPS],
            "species": {str(k): species[k] for k in sorted(used) if k in species},
            "by_space": by_space,
            "observations": effort,  # iNaturalist observations plus eBird records, per space and group
            "ebird_only": ebird_only,
            "ebird_through": max(ebird_years, default=None),  # eBird reaches GBIF about a year behind
            "equal_effort": equal_effort,  # group -> {records, species: {space: expected species at that many records}}
            "similarity": similarity,      # group -> {"a|b" (ids sorted): equal-effort Sørensen similarity}
        }, separators=(",", ":")) + ";\n"
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({len(used)} species)")


if __name__ == "__main__":
    main()
