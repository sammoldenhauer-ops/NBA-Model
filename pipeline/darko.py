"""Archive DARKO's daily player board (darko.app, free).

    python pipeline/darko.py

DARKO publishes only the current board (no history), so we keep one snapshot per
day in pipeline/cache/darko/<date>.csv.gz. Once a few weeks accumulate, the
injury/strength backtests can use DARKO ratings as they stood before each game.
This reads the same data as the site's "Download CSV" button, once a day.
"""

import csv
import datetime as dt
import gzip
import json
import os
import re
import urllib.request
from zoneinfo import ZoneInfo

OUT = os.path.join("pipeline", "cache", "darko")
KEEP = ["nba_id", "player_name", "team_name", "tm_id", "position", "age", "career_game_num",
        "dpm", "o_dpm", "d_dpm", "box_dpm", "on_off_dpm", "x_minutes", "x_pace", "season_games"]


def balanced(text, start):
    """The bracketed JSON array starting at text[start] == '['."""
    depth, i, in_str = 0, start, False
    while i < len(text):
        c = text[i]
        if in_str:
            if c == "\\":
                i += 1
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True
        elif c == "[":
            depth += 1
        elif c == "]":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
        i += 1
    raise ValueError("unbalanced array")


def main():
    req = urllib.request.Request("https://darko.app", headers={"User-Agent": "Mozilla/5.0 (nba-model; daily snapshot)"})
    html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "ignore")
    i = html.index("data:{players:{keys:")
    keys = json.loads(balanced(html, html.index("[", i)))
    j = html.index("values:", i)
    raw = balanced(html, html.index("[", j))
    raw = re.sub(r"\bundefined\b|\bvoid 0\b", "null", raw)
    raw = re.sub(r"(?<=[\[,])(-?)\.(\d)", r"\g<1>0.\2", raw)  # JS allows .5 and -.5
    cols = json.loads(raw)
    rows = list(zip(*cols))
    date = dt.datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, f"{date}.csv.gz")
    idx = [keys.index(k) for k in KEEP if k in keys]
    with gzip.open(path, "wt", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([keys[k] for k in idx])
        for r in rows:
            w.writerow([r[k] for k in idx])
    print(f"DARKO: {len(rows)} players -> {path}")


if __name__ == "__main__":
    main()
