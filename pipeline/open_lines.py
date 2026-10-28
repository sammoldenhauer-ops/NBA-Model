"""Opening and closing lines from ESPN's public odds API (free).

    python pipeline/open_lines.py 2024 2025 2026 2027

For every game: the sportsbook's opening and closing home spread, total and home
moneyline. Cached in pipeline/cache/open_lines.csv; each game is fetched once
after it finishes (unfinished games are refetched each run so "close" stays current).
"""

import csv
import io
import json
import os
import sys
import time
import urllib.request

CACHE = os.path.join("pipeline", "cache", "open_lines.csv")
COLS = ["game_id", "provider", "spread_open", "spread_close", "total_open", "total_close", "ml_open", "ml_close", "final"]
PREFER = ["DraftKings", "ESPN BET", "BetfairSportsbook", "Caesars Sportsbook (Colorado)"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (nba-model research)"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except Exception:
        return None


def num(x):
    """'+3.5', '-110', 'o224.5', 'EVEN', 224.5 -> float or None."""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().lower().lstrip("ou")
    if s in ("even", "ev", "pk", "pick"):
        return 0.0 if s in ("pk", "pick") else 100.0
    try:
        return float(s)
    except ValueError:
        return None


def american(d, *path):
    for p in path:
        d = d.get(p) if isinstance(d, dict) else None
    if isinstance(d, dict):
        return num(d.get("american") if d.get("american") is not None else d.get("value"))
    return num(d)


def fetch(game_id):
    raw = get(f"https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/{game_id}/competitions/{game_id}/odds")
    if not raw:
        return None
    items = json.loads(raw).get("items", [])
    items = [i for i in items if "Live" not in i.get("provider", {}).get("name", "")]
    if not items:
        return None
    items.sort(key=lambda i: PREFER.index(i["provider"]["name"]) if i.get("provider", {}).get("name") in PREFER else 99)
    it = items[0]
    h = it.get("homeTeamOdds", {})
    return {
        "game_id": game_id,
        "provider": it.get("provider", {}).get("name", ""),
        "spread_open": american(h, "open", "pointSpread"),
        "spread_close": american(h, "close", "pointSpread") if h.get("close") else american(h, "current", "pointSpread"),
        "total_open": american(it, "open", "total"),
        "total_close": american(it, "close", "total") if it.get("close") else american(it, "current", "total"),
        "ml_open": american(h, "open", "moneyLine"),
        "ml_close": american(h, "close", "moneyLine") if h.get("close") else american(h, "current", "moneyLine"),
    }


def schedule(season):
    url = f"https://github.com/sportsdataverse/sportsdataverse-data/releases/download/espn_nba_schedules/nba_schedule_{season}.csv"
    rows = list(csv.DictReader(io.StringIO(get(url).decode("utf-8"))))
    return [(r["game_id"], r["status_type_completed"].upper() == "TRUE") for r in rows if r["season_type"] in ("2", "3", "5")]


def main(seasons):
    cache = {}
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            cache = {r["game_id"]: r for r in csv.DictReader(f)}
    todo = []
    for s in seasons:
        for gid, done in schedule(s):
            if gid not in cache or cache[gid].get("final") != "1":
                todo.append((gid, done))
    print(f"Fetching odds for {len(todo)} games", flush=True)
    t0 = time.time()
    for i, (gid, done) in enumerate(todo):
        r = fetch(gid)
        if r:
            r["final"] = "1" if done else "0"
            cache[gid] = r
        if i % 200 == 0 or i == len(todo) - 1:
            with open(CACHE, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=COLS)
                w.writeheader()
                for k in sorted(cache):
                    w.writerow({c: cache[k].get(c, "") for c in COLS})
            print(f"  {i + 1}/{len(todo)} ({time.time() - t0:.0f}s)", flush=True)
        time.sleep(0.05)


if __name__ == "__main__":
    main([int(s) for s in sys.argv[1:]] or [2024, 2025, 2026, 2027])
