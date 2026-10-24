"use client";

import { useEffect, useState } from "react";

const FILES = [
  { file: "team_stats.csv", what: "Every team × window (YTD, L3, Home, Away, Prior), all 33 stats" },
  { file: "league_averages.csv", what: "League average for each window" },
  { file: "team_games.csv", what: "Game log: every team-game this season and last, box score + opponent box + per-game stats" },
  { file: "slate.csv", what: "Today’s games and tip times" },
];

export default function SheetLinks() {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  return (
    <div className="table-wrap">
      <table className="lines files">
        <thead>
          <tr>
            <th className="left">File</th>
            <th className="left">Contents</th>
            <th className="left">Google Sheets formula</th>
          </tr>
        </thead>
        <tbody>
          {FILES.map((f) => {
            const url = `${origin}/data/stats/${f.file}`;
            const formula = `=IMPORTDATA("${url}")`;
            return (
              <tr key={f.file}>
                <td className="left">
                  <a href={`/data/stats/${f.file}`} download>
                    {f.file}
                  </a>
                </td>
                <td className="left muted wrap">{f.what}</td>
                <td className="left">
                  <button
                    className="copy"
                    onClick={() => {
                      navigator.clipboard?.writeText(formula);
                      setCopied(f.file);
                    }}
                  >
                    {copied === f.file ? "Copied" : "Copy"}
                  </button>{" "}
                  <code className="small">{formula}</code>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
