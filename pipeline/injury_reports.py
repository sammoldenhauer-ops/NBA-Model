"""Official NBA pregame injury reports, for an honest injury backtest.

    python pipeline/injury_reports.py 2024 2025 2026 2027

For every game, takes the last report published at least an hour before tip-off
(the NBA posts one hourly from ak-static.cms.nba.com), parses the players listed
for each team with their status, and writes
    pipeline/cache/injury_reports_<season>.csv.gz
with one row per listed player: game_id, date, report, team, player, status, reason.
Report text is cached in pipeline/cache/injury_reports/ so each PDF is fetched once.
"""

import csv
import datetime as dt
import gzip
import io
import os
import re
import sys
import time
import urllib.request
from zoneinfo import ZoneInfo

import pypdf

CACHE = os.path.join("pipeline", "cache")
TEXT_DIR = os.path.join(CACHE, "injury_reports")
ET = ZoneInfo("America/New_York")
STATUSES = ("Out", "Doubtful", "Questionable", "Probable", "Available")
ROW = re.compile(r"([A-Z][A-Za-z.'\- ]*?(?:\s+(?:Jr\.|Sr\.|II|III|IV|V))?)\s*,\s*([A-Za-z.'\- ]+?)\s{2,}(" + "|".join(STATUSES) + r")\b\s*(.*)$")
MATCHUP = re.compile(r"\b([A-Z]{2,4})@([A-Z]{2,4})\b")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (nba-model research)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except Exception:
        return None


def schedule(season):
    url = f"https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_schedules/nba_schedule_{season}.csv"
    rows = list(csv.DictReader(io.StringIO(fetch(url).decode("utf-8"))))
    out = []
    for r in rows:
        if r["season_type"] not in ("2", "3", "5"):
            continue
        tip = dt.datetime.strptime(r["date"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc).astimezone(ET)
        out.append({"game_id": r["game_id"], "date": tip.date().isoformat(), "tip": tip,
                    "home": r["home_display_name"], "away": r["away_display_name"]})
    return out


def report_text(date, hour):
    """Text of the report for date at hour (24h), from cache or the NBA site."""
    os.makedirs(TEXT_DIR, exist_ok=True)
    path = os.path.join(TEXT_DIR, f"{date}_{hour:02d}.txt.gz")
    if os.path.exists(path):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            text = f.read()
        return text or None
    h12 = (hour - 1) % 12 + 1
    ampm = "AM" if hour < 12 else "PM"
    text = ""
    for name in (f"{date}_{h12:02d}{ampm}", f"{date}_{h12:02d}_00{ampm}"):
        pdf = fetch(f"https://ak-static.cms.nba.com/referee/injury/Injury-Report_{name}.pdf")
        if pdf and pdf[:4] == b"%PDF":
            reader = pypdf.PdfReader(io.BytesIO(pdf))
            # Layout mode lists each page's rows bottom-up; reverse to read top-down.
            text = "\n".join("\n".join(reversed(p.extract_text(extraction_mode="layout").splitlines())) for p in reader.pages)
            break
        time.sleep(0.2)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        f.write(text)
    return text or None


def parse(text, team_names):
    """[(team, 'First Last', status, reason)] from a report's text.

    Team names are compared with spaces removed (the NBA writes "TrailBlazers")."""
    out = []
    team = None
    names = sorted(team_names, key=len, reverse=True)
    squash = {t: t.replace(" ", "") for t in names}
    for raw in text.splitlines():
        flat = raw.replace(" ", "")
        for t in names:
            if squash[t] in flat:
                team = t
                break
        m = ROW.search(raw.strip())
        if not m or not team:
            continue
        last, first, status, reason = (re.sub(r"\s+", " ", x).strip() for x in m.groups())
        # Columns left of the player name (date, matchup, team) can leak into the
        # last name: keep only the words after the last team name.
        tokens = MATCHUP.sub(" ", last).split()
        cut = 0
        for k in range(len(tokens)):
            if any("".join(tokens[: k + 1]).endswith(squash[t]) for t in names):
                cut = k + 1
        last = " ".join(tokens[cut:])
        if last:
            out.append((team, f"{first} {last}", status, reason))
    return out


def main(seasons):
    for season in seasons:
        games = schedule(season)
        today = dt.datetime.now(ET).date().isoformat()
        games = [g for g in games if g["date"] < today]
        teams = sorted({g["home"] for g in games} | {g["away"] for g in games})
        by_report = {}
        for g in games:
            hour = max(11, min(19, (g["tip"] - dt.timedelta(hours=1)).hour))
            by_report.setdefault((g["date"], hour), []).append(g)
        rows = []
        t0 = time.time()
        for i, ((date, hour), gs) in enumerate(sorted(by_report.items())):
            text = None
            for h in range(hour, 10, -1):  # fall back to earlier reports if one is missing
                text = report_text(date, h)
                if text:
                    break
            if not text:
                continue
            listed = parse(text, teams)
            want = {g["home"]: g for g in gs} | {g["away"]: g for g in gs}
            for team, player, status, reason in listed:
                g = want.get(team)
                if g:
                    rows.append([g["game_id"], date, f"{h:02d}:00", team, player, status, reason])
            if i % 50 == 0:
                print(f"  {season}: {i}/{len(by_report)} reports ({time.time() - t0:.0f}s), {len(rows)} rows", flush=True)
        out = os.path.join(CACHE, f"injury_reports_{season}.csv.gz")
        with gzip.open(out, "wt", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["game_id", "date", "report", "team", "player", "status", "reason"])
            w.writerows(rows)
        print(f"{season}: {len(games)} games, {len(rows)} listed players -> {out}", flush=True)


if __name__ == "__main__":
    main([int(s) for s in sys.argv[1:]] or [2024, 2025, 2026, 2027])
