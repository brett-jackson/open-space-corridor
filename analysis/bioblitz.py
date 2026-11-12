"""Which iNaturalist users were likely taking part in the bioblitzes in js/bioblitzes.js?

Run: python3 -I analysis/bioblitz.py

Fetches every observation (casual included) at the three sites once (~30 requests, through
scripts/areas.py:inat_get, so throttled and cached), plus the member lists of the Broomfield
bioblitz projects on iNaturalist. Everything else is computed locally:

- Event window: observers are binned into 15-minute slots (one count per user per slot). The
  window is the span that best concentrates the day's observers (Kulldorff's Poisson scan
  statistic, conditioned on the day's total), and its p-value compares the observers in it
  with a Poisson baseline from the same weekday at the same site within 8 weeks, non-event days.
- Users: each observer on an event day gets points for observing inside the window, attending
  other bioblitzes, a new account, and the event being their first visit; and loses points for
  visiting the site often on ordinary days. Project membership is reported but kept out of the
  score so it can be used to check it.

Writes analysis/out/event_windows.csv, event_users.csv and participants.csv.
"""
import csv
import math
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))
from areas import API_V1, API_V2, OBS_PER_PAGE, area_for, exclusions, inat_get, is_excluded, read_js_object, read_spaces  # noqa: E402

USER_AGENT = "open-space-corridor bioblitz analysis"
EVENTS_CSV = HERE / "bioblitz_events.csv"      # head counts, where one was recorded
BIOBLITZES_JS = HERE.parent / "js" / "bioblitzes.js"  # the one list of event dates (the site uses it too)
OUT = HERE / "out"
SITES = {"Commons": "broomfield", "Metzger": "metzger", "The Field": "the-field"}
PROJECTS = [174523, 283372, 287720, 310536]  # Broomfield bioblitz projects (only partly joined)
TZ = ZoneInfo("America/Denver")
BIN_MIN = 15
DAY_START, DAY_END = 5, 21  # hours scanned for the window
N_BINS = (DAY_END - DAY_START) * 60 // BIN_MIN
WINDOW_BINS = range(2, 6 * 60 // BIN_MIN + 1)  # 30 min to 6 h
CONTROL_WEEKS = 8
SLACK_MIN = 30  # observations this close to the window count as inside it
TODAY = date(2026, 11, 1)


def fetch_site(space):
    """Every observation (casual included) in the space's area, minus its excluded boxes."""
    fields = ("(id:!t,observed_on:!t,time_observed_at:!t,created_at:!t,geojson:!t,quality_grade:!t,"
              "user:(id:!t,login:!t,created_at:!t,observations_count:!t))")
    area, _ = area_for(space)
    boxes = exclusions(space)
    kept, id_above = [], 0
    while True:
        data = inat_get(API_V2 + "observations", USER_AGENT, {
            **area, "order_by": "id", "order": "asc", "id_above": id_above,
            "per_page": OBS_PER_PAGE, "fields": fields,
        })
        kept += [o for o in data["results"] if not is_excluded(o, boxes)]
        if len(data["results"]) < OBS_PER_PAGE:
            return kept
        id_above = data["results"][-1]["id"]


def project_members():
    """login -> titles of the bioblitz projects they joined."""
    members = defaultdict(list)
    for pid in PROJECTS:
        title = inat_get(API_V1 + f"projects/{pid}", USER_AGENT, {})["results"][0]["title"]
        page = 1
        while True:
            data = inat_get(API_V1 + f"projects/{pid}/members", USER_AGENT, {"per_page": 100, "page": page})
            for m in data["results"]:
                members[m["user"]["login"]].append(title)
            if page * 100 >= data["total_results"]:
                break
            page += 1
    return members


def local_time(obs):
    t = obs.get("time_observed_at")
    return datetime.fromisoformat(t).astimezone(TZ) if t else None


def slot(t):
    """15-minute slot of a local time within the scanned hours, or None."""
    minutes = (t.hour - DAY_START) * 60 + t.minute
    return minutes // BIN_MIN if 0 <= minutes < N_BINS * BIN_MIN else None


def user_slots(observations):
    """Per-slot count of distinct observers."""
    seen = set()
    for o in observations:
        t = local_time(o)
        s = slot(t) if t else None
        if s is not None:
            seen.add((o["user"]["id"], s))
    counts = [0] * N_BINS
    for _, s in seen:
        counts[s] += 1
    return counts


def poisson_sf(k, mu):
    """P(X >= k) for X ~ Poisson(mu), summed over the upper tail so tiny values keep their precision."""
    if k <= 0:
        return 1.0
    term = math.exp(k * math.log(mu) - mu - math.lgamma(k + 1))
    total, i = 0.0, k
    while term > total * 1e-12:
        total += term
        i += 1
        term *= mu / i
    return total


def scan_window(counts):
    """(start slot, end slot exclusive, observers in window) maximizing Kulldorff's likelihood ratio."""
    total = sum(counts)
    if total == 0:
        return None
    best, best_llr = None, -1.0
    for length in WINDOW_BINS:
        expected = total * length / N_BINS
        for start in range(N_BINS - length + 1):
            c = sum(counts[start:start + length])
            if c <= expected:
                continue
            out, out_exp = total - c, total - expected
            llr = c * math.log(c / expected) + (out * math.log(out / out_exp) if out else 0.0)
            if llr > best_llr:
                best, best_llr = (start, start + length, c), llr
    return best


def load_events():
    """Every bioblitz, oldest first. Dates and sites come from js/bioblitzes.js, so an event is
    entered once for the site and the analysis; bioblitz_events.csv only adds its head count."""
    known = {}
    with EVENTS_CSV.open() as f:
        for r in csv.DictReader(f):
            key = (datetime.strptime(r["date"], "%m/%d/%Y").date(), SITES[r["site"]])
            known[key] = int(r["participants"]) if r["participants"].strip() else None
    names = {space: site for site, space in SITES.items()}
    events = [{"date": date.fromisoformat(day), "site": names[space], "space": space,
               "known": known.get((date.fromisoformat(day), space))}
              for space, days in (read_js_object(BIOBLITZES_JS) or {}).items() if space in names for day in days]
    for day, space in sorted(set(known) - {(e["date"], e["space"]) for e in events}):
        print(f"warning: {day} at {space} is in {EVENTS_CSV.name} but not in js/bioblitzes.js; left out", file=sys.stderr)
    return sorted(events, key=lambda e: (e["date"], e["space"]))


def slot_time(s):
    m = DAY_START * 60 + s * BIN_MIN
    return f"{m // 60:02d}:{m % 60:02d}"


def main():
    spaces = {s["id"]: s for s in read_spaces()}
    events = load_events()
    event_dates = defaultdict(set)
    for e in events:
        event_dates[e["space"]].add(e["date"])
    any_event_day = {(e["space"], e["date"]) for e in events}

    obs_by_space, by_day, users = {}, defaultdict(list), {}
    for sid in SITES.values():
        obs_by_space[sid] = fetch_site(spaces[sid])
        for o in obs_by_space[sid]:
            if o.get("observed_on"):
                by_day[(sid, date.fromisoformat(o["observed_on"]))].append(o)
            users[o["user"]["id"]] = o["user"]
        print(f"{sid}: {len(obs_by_space[sid])} observations")
    members = project_members()

    # Each user's days at each site, and their first day at any of them.
    user_days = defaultdict(lambda: defaultdict(set))
    first_day = {}
    for (sid, d), obs in by_day.items():
        for o in obs:
            uid = o["user"]["id"]
            user_days[uid][sid].add(d)
            first_day[uid] = min(first_day.get(uid, d), d)

    window_rows, user_rows = [], []
    for e in events:
        sid, d = e["space"], e["date"]
        day_obs = by_day.get((sid, d), [])
        counts = user_slots(day_obs)
        controls = [d + timedelta(weeks=w) for w in range(-CONTROL_WEEKS, CONTROL_WEEKS + 1)
                    if w and d + timedelta(weeks=w) <= TODAY and d + timedelta(weeks=w) not in event_dates[sid]]
        control_slots = sum(sum(user_slots(by_day.get((sid, c), []))) for c in controls)
        control_users = [len({o["user"]["id"] for o in by_day.get((sid, c), [])}) for c in controls]
        rate = max(control_slots / (len(controls) * N_BINS), 0.002) if controls else 0.002
        mean_control_users = sum(control_users) / len(control_users) if control_users else 0.0

        win = scan_window(counts)
        if win:
            start, end, c = win
            expected = rate * (end - start)
            w_lo = datetime.combine(d, datetime.min.time(), TZ) + timedelta(minutes=DAY_START * 60 + start * BIN_MIN - SLACK_MIN)
            w_hi = datetime.combine(d, datetime.min.time(), TZ) + timedelta(minutes=DAY_START * 60 + end * BIN_MIN + SLACK_MIN)
        day_users = sorted({o["user"]["id"] for o in day_obs})
        window_rows.append({
            "date": d.isoformat(), "weekday": d.strftime("%a"), "site": e["site"],
            "known_participants": e["known"] if e["known"] is not None else "",
            "observers": len(day_users), "observations": len(day_obs),
            "window": f"{slot_time(start)}-{slot_time(end)}" if win else "",
            "observer_slots_in_window": c if win else "", "expected_slots_normal_day": round(expected, 2) if win else "",
            "p_value": f"{poisson_sf(c, expected):.1e}" if win else "",
            "control_days": len(controls), "mean_observers_control_day": round(mean_control_users, 2),
        })

        for uid in day_users:
            u = users[uid]
            mine = [o for o in day_obs if o["user"]["id"] == uid]
            times = [t for t in map(local_time, mine) if t]
            in_win = sum(1 for t in times if win and w_lo <= t <= w_hi)
            frac = in_win / len(times) if times else None
            other_events = sorted({f"{x['date']} {x['site']}" for x in events
                                   if (x["space"], x["date"]) != (sid, d) and x["date"] in user_days[uid][x["space"]]})
            created = datetime.fromisoformat(u["created_at"]).astimezone(TZ).date()
            new_account = -14 <= (created - d).days <= 1
            ordinary_days = {x for x in user_days[uid][sid] if (sid, x) not in any_event_day}
            weeks_active = max((TODAY - created).days, 30) / 7
            visits_per_week = len(ordinary_days) / weeks_active
            first_visit = first_day[uid] == d

            score, why = 0, []
            if frac is None:
                why.append("no times")
            elif frac >= 0.75:
                score += 2; why.append("in window")
            elif frac >= 0.4:
                score += 1; why.append("partly in window")
            else:
                score -= 2; why.append("outside window")
            if other_events:
                score += min(len(other_events), 3); why.append(f"{len(other_events)} other bioblitz(es)")
            if new_account:
                score += 2; why.append("new account")
            if first_visit and u["observations_count"] < 100:
                score += 1; why.append("first visit")
            if visits_per_week >= 1:
                score -= 2; why.append("weekly regular")
            elif visits_per_week >= 0.5:
                score -= 1; why.append("frequent visitor")
            label = "likely" if score >= 3 else "possible" if score >= 1 else "incidental"

            user_rows.append({
                "date": d.isoformat(), "site": e["site"], "login": u["login"], "label": label, "score": score,
                "reasons": "; ".join(why), "observations": len(mine), "in_window": in_win,
                "first_time": min(times).strftime("%H:%M") if times else "",
                "last_time": max(times).strftime("%H:%M") if times else "",
                "other_bioblitzes": " | ".join(other_events), "account_created": created.isoformat(),
                "new_account": new_account, "first_visit": first_visit,
                "ordinary_days_at_site": len(ordinary_days), "visits_per_week": round(visits_per_week, 3),
                "total_inat_observations_now": u["observations_count"],
                "project_member": " | ".join(members.get(u["login"], [])),
            })

    by_user = defaultdict(list)
    for r in user_rows:
        by_user[r["login"]].append(r)
    participant_rows = sorted(({
        "login": login, "likely_events": sum(r["label"] == "likely" for r in rows),
        "possible_events": sum(r["label"] == "possible" for r in rows),
        "event_days_observed": len(rows), "best_score": max(r["score"] for r in rows),
        "events": " | ".join(f"{r['date']} {r['site']} ({r['label']})" for r in rows),
        "project_member": rows[0]["project_member"],
    } for login, rows in by_user.items()), key=lambda r: (-r["likely_events"], -r["possible_events"], -r["best_score"], r["login"]))

    OUT.mkdir(exist_ok=True)
    for name, rows in [("event_windows", window_rows), ("event_users", user_rows), ("participants", participant_rows)]:
        with (OUT / f"{name}.csv").open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        print(f"wrote {OUT / name}.csv ({len(rows)} rows)")


if __name__ == "__main__":
    main()
