"use client";

import { useMemo, useState } from "react";
import type { StatFormat, StatsData, StatsRow } from "@/lib/data";
import { fmtStat } from "@/lib/format";

type SortKey = { col: string; dir: 1 | -1 };

export default function StatsTable({ data }: { data: StatsData }) {
  const [win, setWin] = useState(data.windows[0]);
  const [sort, setSort] = useState<SortKey>({ col: "team", dir: 1 });

  const rows = useMemo(() => {
    const r = data.team_stats.filter((x) => x.window === win);
    return [...r].sort((a, b) => compare(a[sort.col], b[sort.col]) * sort.dir);
  }, [data, win, sort]);
  const league = data.league_averages.find((x) => x.window === win);

  const clickSort = (col: string) =>
    setSort((s) => (s.col === col ? { col, dir: (-s.dir as 1 | -1) } : { col, dir: col === "team" ? 1 : -1 }));
  const arrow = (col: string) => (sort.col === col ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  return (
    <>
      <div className="tabs" role="tablist">
        {data.windows.map((w) => (
          <button key={w} role="tab" aria-selected={w === win} className={w === win ? "tab active" : "tab"} onClick={() => setWin(w)}>
            {w}
          </button>
        ))}
      </div>
      <div className="table-wrap stats-wrap">
        <table className="stats">
          <thead>
            <tr>
              <th className="left sticky-col sortable" onClick={() => clickSort("team")}>Team{arrow("team")}</th>
              <th className="sortable" onClick={() => clickSort("games")}>G{arrow("games")}</th>
              {data.stats.map((s) => (
                <th key={s.id} className="sortable" onClick={() => clickSort(s.label)}>
                  {s.label}
                  {arrow(s.label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.team_id)}>
                <td className="left sticky-col strong" title={String(r.team_name)}>{r.team}</td>
                <td className="muted">{r.games}</td>
                {data.stats.map((s) => (
                  <td key={s.id}>{cell(r[s.label], s.fmt)}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {league && (
            <tfoot>
              <tr className="weighted">
                <td className="left sticky-col">League avg</td>
                <td />
                {data.stats.map((s) => (
                  <td key={s.id}>{cell(league[s.label], s.fmt)}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

function cell(v: StatsRow[string], fmt: StatFormat): string {
  return typeof v === "number" ? fmtStat(v, fmt) : "—";
}

function compare(a: StatsRow[string], b: StatsRow[string]): number {
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}
