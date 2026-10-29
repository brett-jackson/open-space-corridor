#!/usr/bin/env python3
"""Rank each space's most characteristic species and save them to js/featured_species.js.

The landing page shows these as each space's "Signature Species".

Each species is scored, within each source, by how much more common it is here than in the
rest of the corridor:

    p_here = records of it here / all records here           (from that source)
    p_rest = (records of it elsewhere + 1) / (all records elsewhere + 1)
    score  = p_here * log(p_here / p_rest)                   (0 unless p_here > p_rest)

taking the better of its iNaturalist and (for birds) eBird scores, then multiplied by
IDF ** IDF_POWER, where IDF = log(spaces / spaces where it was recorded by either source).
That last factor sinks widespread species: one found in every space scores 0. Comparing shares within a
source keeps eBird's far larger record counts at birding hotspots from swamping iNaturalist,
and comparing with the rest of the corridor sinks species that are common everywhere (a
Mallard is about as common at every pond). The +1 keeps a species unseen elsewhere from
counting as infinitely rare there. Only species-level (and finer) identifications count, from verifiable
iNaturalist observations plus, for birds, eBird records (js/gbif_records.js), and species iNaturalist lists as introduced in Colorado are left out
(native and unknown-status species stay). To be featured, a species needs at least
MIN_OBSERVATIONS observations in the space, or at least one Research Grade one there;
every species still counts toward the rest-of-corridor totals, so the filter doesn't change what's unique. A space whose trends cache is a bounding-box stand-in (its place isn't
indexed yet) is counted over that same box.

    python3 scripts/update_featured_species.py
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # for areas.py, even under python -I
from areas import (ROOT, API_V1, all_observations, area_for, exclusions, inat_get, introduced_species,  # noqa: E402
                   read_js_object, read_spaces, species_counts)

USER_AGENT = "open-space-corridor featured species (iNaturalist user: brettjackson)"
TOP_N = 10
MIN_OBSERVATIONS = 3  # fewer is fine if any observation is Research Grade
IDF_POWER = 1  # how strongly being widespread lowers a score; lower (e.g. 0.5) lets common species back in
OUT = ROOT / "js" / "featured_species.js"


def counts_from_observations(space, area):
    """Species and Research Grade counts from individual observations, skipping excluded boxes."""
    counts, research = {}, {}
    for obs in all_observations(space, USER_AGENT, area):
        taxon = obs.get("taxon") or {}
        if taxon.get("rank_level", 100) > 10:  # species and finer only
            continue
        n, _ = counts.get(taxon["id"], (0, taxon))
        counts[taxon["id"]] = (n + 1, taxon)
        if obs.get("quality_grade") == "research":
            research[taxon["id"]] = research.get(taxon["id"], 0) + 1
    return counts, research


def main():
    spaces = read_spaces()
    introduced = introduced_species(spaces, USER_AGENT)
    print(f"{len(introduced)} introduced species around the corridor (excluded)")

    by_space = {}
    research = {}    # space -> taxon id -> Research Grade observation count
    inat_total = {}  # space -> iNaturalist observations counted there (the TF denominator)
    ebird_total = {} # space -> eBird records counted there
    for spc in spaces:
        area, label = area_for(spc)
        if exclusions(spc):
            counts, research[spc["id"]] = counts_from_observations(spc, area)
            label += f", minus {len(exclusions(spc))} excluded area(s)"
        else:
            counts = species_counts(area, USER_AGENT)
            research[spc["id"]] = {t: v[0] for t, v in species_counts({**area, "quality_grade": "research"}, USER_AGENT).items()}
        by_space[spc["id"]] = {t: v for t, v in counts.items() if t not in introduced}
        inat_total[spc["id"]] = sum(n for n, _ in counts.values())  # all species-level observations there
        print(f"{spc['id']}: {len(by_space[spc['id']])} native or unknown-status species of {len(counts)} ({label})")

    # Birds: add eBird's records (via GBIF, js/gbif_records.js) to each species' count, so a
    # bird seen there only on eBird can rank too. Records land on the species' existing entry
    # (or a subspecies of it) when iNaturalist has one there.
    ebird = {}  # space -> taxon id -> eBird records added
    needs_taxon = set()
    gbif = read_js_object(ROOT / "js" / "gbif_records.js") or {}
    for space_id, taxa in (gbif.get("by_space") or {}).items():
        if space_id not in by_space:
            continue
        counts = by_space[space_id]
        species_entry = {}  # species id -> the key its observations are counted under
        for key, (_, taxon) in counts.items():
            rank = taxon.get("rank_level", 100)
            ancestors = taxon.get("ancestor_ids") or []
            sid = key if rank == 10 else (ancestors[-2] if rank < 10 and len(ancestors) >= 2 else None)
            if sid is not None:
                species_entry.setdefault(sid, key)
        ebird[space_id] = {}
        ebird_total[space_id] = sum(n for rec in taxa.values() for _, n, _ in rec["species"])
        for rec in taxa.values():
            for gbif_key, n, _ in rec["species"]:
                if gbif_key.startswith("gbif-") or not n:
                    continue
                sid = int(gbif_key)
                if sid in introduced:
                    continue
                key = species_entry.get(sid, sid)
                old_n, taxon = counts.get(key, (0, None))
                if taxon is None:
                    needs_taxon.add(sid)
                counts[key] = (old_n + n, taxon)
                ebird[space_id][key] = ebird[space_id].get(key, 0) + n
        print(f"{space_id}: +{sum(ebird[space_id].values())} eBird records across {len(ebird[space_id])} bird species")

    # Birds known only from eBird need iNaturalist's name and photo
    ids = sorted(needs_taxon)
    found = {}
    for i in range(0, len(ids), 30):
        for taxon in inat_get(API_V1 + "taxa/" + ",".join(map(str, ids[i:i + 30])), USER_AGENT, {})["results"]:
            found[taxon["id"]] = taxon
    for counts in by_space.values():
        for key, (n, taxon) in list(counts.items()):
            if taxon is None:
                if key in found:
                    counts[key] = (n, found[key])
                else:
                    del counts[key]  # couldn't look it up; leave it out rather than show a blank

    # Only spaces with any observations take part
    active = [sid for sid, counts in by_space.items() if counts]
    n = len(active)
    df = {}  # spaces each species was recorded in, by either source (shown as "in N of M spaces")
    inat_corridor, ebird_corridor = {}, {}  # species -> records across every active space, per source
    for sid in active:
        for taxon_id, (count, _) in by_space[sid].items():
            df[taxon_id] = df.get(taxon_id, 0) + 1
            from_ebird = ebird.get(sid, {}).get(taxon_id, 0)
            inat_corridor[taxon_id] = inat_corridor.get(taxon_id, 0) + count - from_ebird
            ebird_corridor[taxon_id] = ebird_corridor.get(taxon_id, 0) + from_ebird
    inat_all = sum(inat_total.get(sid, 0) for sid in active)
    ebird_all = sum(ebird_total.get(sid, 0) for sid in active)

    def characteristic(n_here, total_here, n_corridor, total_corridor):
        """Share here x log(share here / share in the rest of the corridor), within one source."""
        if not n_here or not total_here:
            return 0.0
        p_here = n_here / total_here
        p_rest = (n_corridor - n_here + 1) / (total_corridor - total_here + 1)
        return p_here * math.log(p_here / p_rest) if p_here > p_rest else 0.0

    featured = {}
    for sid in active:
        scored = []
        for taxon_id, (count, taxon) in by_space[sid].items():
            if count < MIN_OBSERVATIONS and not research[sid].get(taxon_id):
                continue  # too few sightings to feature, and none confirmed
            from_ebird = ebird.get(sid, {}).get(taxon_id, 0)
            score = max(
                characteristic(count - from_ebird, inat_total.get(sid, 0), inat_corridor[taxon_id], inat_all),
                characteristic(from_ebird, ebird_total.get(sid, 0), ebird_corridor[taxon_id], ebird_all),
            ) * math.log(n / df[taxon_id]) ** IDF_POWER
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
                "count": count,  # iNaturalist observations plus eBird records
                "ebird_count": ebird.get(sid, {}).get(taxon["id"], 0),
                "ebird_only": ebird.get(sid, {}).get(taxon["id"], 0) == count,
                "research_grade": research[sid].get(taxon["id"], 0),
                "spaces": df[taxon["id"]],
                "score": round(score, 6),
            })

    OUT.write_text(
        "// Generated by scripts/update_featured_species.py: each space's most characteristic species\n"
        f"window.FEATURED_SPECIES = {json.dumps({'spaces_compared': n, 'excludes_introduced_in': 'Colorado', 'by_space': featured}, indent=1)};\n"
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({n} spaces compared)")


if __name__ == "__main__":
    main()
