"""Does attending a bioblitz change how often people observe on iNaturalist, and does it last?

Run after bioblitz.py: python3 -I analysis/observer_rates.py

One request per observer (~190, throttled and cached): each user's daily observation counts
everywhere on iNaturalist. Bioblitz days are removed from every history. The rate is active days
(days with at least one observation) per 30 days, which a single big upload day can't dominate.

Two comparisons, both against the site's other observers (the controls):
- Trajectory: each participant is aligned on their first bioblitz, each control on their first
  visit to any of the three sites, and rates are taken in bins before and after that day.
  Bins that haven't fully passed yet, or that fall before the account existed, are left out.
- Around each event: active days in the 30 days before and after each bioblitz, for participants
  who already had an account, and for controls over the same dates (so season cancels out).

Writes analysis/out/observer_rates.csv (one row per observer) and prints the summaries.
"""
import csv
import json
import random
import statistics
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import bioblitz as bb  # noqa: E402
from areas import API_V1, inat_get  # noqa: E402

BINS = [(-365, -1), (1, 30), (31, 90), (91, 180), (181, 365), (366, 730)]
AROUND = 30
NEW_ACCOUNT_DAYS = 14


def label(b):
    return f"{b[0]}..{b[1]}"


def daily_counts(login):
    data = inat_get(API_V1 + "observations/histogram", bb.USER_AGENT, {
        "user_login": login, "date_field": "observed", "interval": "day", "d1": "2008-01-01", "d2": bb.TODAY.isoformat(),
    })
    return {date.fromisoformat(d): n for d, n in data["results"]["day"].items() if n}


def active_rate(days, start, end, skip):
    """Active days per 30 days from start to end (inclusive), ignoring the dates in skip."""
    span = [start + timedelta(i) for i in range((end - start).days + 1)]
    span = [d for d in span if d not in skip]
    return 30 * sum(1 for d in span if d in days) / len(span) if span else None


def stats(values):
    """mean, 95% bootstrap interval of the mean, median and n, or None without values."""
    values = [v for v in values if v is not None]
    if not values:
        return None
    rng = random.Random(1)
    boots = sorted(statistics.fmean(rng.choices(values, k=len(values))) for _ in range(2000))
    return {"mean": round(statistics.fmean(values), 3), "lo": round(boots[50], 3), "hi": round(boots[1949], 3),
            "median": round(statistics.median(values), 3), "n": len(values)}


def summary(values):
    s = stats(values)
    if not s:
        return "n=0"
    return f"mean {s['mean']:5.2f} [{s['lo']:.2f}-{s['hi']:.2f}]  median {s['median']:4.2f}  n={s['n']}"


def main():
    with bb.EVENTS_CSV.open() as f:
        event_dates = sorted({datetime.strptime(r["date"], "%m/%d/%Y").date() for r in csv.DictReader(f)})
    skip = set(event_dates)
    attended = defaultdict(set)
    with (bb.OUT / "event_users.csv").open() as f:
        for r in csv.DictReader(f):
            attended[r["login"]].add(date.fromisoformat(r["date"]))

    spaces = {s["id"]: s for s in bb.read_spaces()}
    users, first_visit = {}, {}
    for sid in bb.SITES.values():
        for o in bb.fetch_site(spaces[sid]):
            if o.get("observed_on"):
                u = o["user"]
                users[u["login"]] = u
                d = date.fromisoformat(o["observed_on"])
                first_visit[u["login"]] = min(first_visit.get(u["login"], d), d)

    rows, around = [], defaultdict(list)
    for login, u in sorted(users.items()):
        days = daily_counts(login)
        created = datetime.fromisoformat(u["created_at"]).astimezone(bb.TZ).date()
        participant = login in attended
        anchor = min(attended[login]) if participant else first_visit[login]
        new = 0 <= (anchor - created).days <= NEW_ACCOUNT_DAYS
        group = ("participant" if participant else "control") + (" / new account" if new else " / existing")
        row = {"login": login, "group": group, "anchor": anchor.isoformat(), "account_created": created.isoformat(),
               "bioblitzes": len(attended[login])}
        for b in BINS:
            start, end = anchor + timedelta(b[0]), anchor + timedelta(b[1])
            ok = end <= bb.TODAY and start >= created
            rate = active_rate(days, start, end, skip | {anchor}) if ok else None
            row[label(b)] = round(rate, 2) if rate is not None else ""
        last = max((d for d in days if d not in skip), default=None)
        row["last_observed"] = last.isoformat() if last else ""
        row["active_last_90_days"] = bool(last and (bb.TODAY - last).days <= 90)
        rows.append(row)

        for e in event_dates:
            before = (e - timedelta(AROUND), e - timedelta(1))
            after = (e + timedelta(1), e + timedelta(AROUND))
            if created > before[0] or after[1] > bb.TODAY:
                continue
            if not any(e - timedelta(365) <= d < e for d in days):
                continue  # not an active iNaturalist user going in
            if participant and e not in attended[login]:
                continue
            change = active_rate(days, *after, skip) - active_rate(days, *before, skip)
            around["participant" if participant else "control"].append(change)

    with (bb.OUT / "observer_rates.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {bb.OUT / 'observer_rates.csv'} ({len(rows)} rows)\n")

    trajectory, groups = [], []
    for group in sorted({r["group"] for r in rows}):
        members = [r for r in rows if r["group"] == group]
        groups.append({"group": group, "users": len(members),
                       "active_last_90_days": sum(r["active_last_90_days"] for r in members)})
        for order, b in enumerate(BINS):
            vals = [r[label(b)] for r in members if r[label(b)] != ""]
            s = stats(vals)
            if s:
                trajectory.append({"group": group, "period": label(b), "order": order, "start_day": b[0], "end_day": b[1],
                                   **s, "any_activity": sum(1 for v in vals if v > 0)})
    around_rows = [{"group": g, **stats(around[g])} for g in ("participant", "control")]
    for name, data in [("rate_trajectory", trajectory), ("group_activity", groups), ("around_events", around_rows)]:
        (bb.OUT / f"{name}.json").write_text(json.dumps(data, indent=1))

    print("Active days per 30 days, by days since first bioblitz (participants) or first site visit (controls)")
    for group in sorted({r["group"] for r in rows}):
        members = [r for r in rows if r["group"] == group]
        print(f"\n{group} ({len(members)} users, {sum(r['active_last_90_days'] for r in members)} active in the last 90 days)")
        for b in BINS:
            vals = [r[label(b)] for r in members if r[label(b)] != ""]
            active = sum(1 for v in vals if v > 0)
            print(f"  {label(b):>10}  {summary(vals)}  any activity {active}/{len(vals)}")

    print(f"\nChange in active days, {AROUND} days after minus {AROUND} days before each bioblitz (already-active users)")
    for g in ("participant", "control"):
        print(f"  {g:>11}: {summary(around[g])}")


if __name__ == "__main__":
    main()
