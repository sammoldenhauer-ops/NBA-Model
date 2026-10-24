"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Slate, StatMeta } from "@/lib/data";
import { WINDOWS } from "@/lib/windows";
import { fmtSpread } from "@/lib/format";
import { FUNCTIONS } from "@/lib/formula";
import {
  AWAY_SCORE,
  evaluateGame,
  HOME_SCORE,
  lookupStat,
  NAME_RE,
  parseRef,
  type Model,
  type ModelRow,
} from "@/lib/model";

const DRAFT_KEY = "nba-model-draft-v1";
const UPLOAD_URL = "https://github.com/sammoldenhauer-ops/NBA-Model/upload/main/web";

type EditRow = ModelRow & { key: number };
let nextKey = 1;
const withKeys = (m: Model): EditRow[] => m.rows.map((r) => ({ ...r, key: nextKey++ }));
const strip = (rows: EditRow[]): Model => ({ rows: rows.map(({ key: _k, ...r }) => r) });

const fmtValue = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(2) : v.toFixed(4).replace(/\.?0+$/, ""));

function readDraft(): Model | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY);
    return s ? (JSON.parse(s) as Model) : null;
  } catch {
    return null;
  }
}
function writeDraft(m: Model | null) {
  try {
    if (m) localStorage.setItem(DRAFT_KEY, JSON.stringify(m));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable: edits still work for this visit */
  }
}

export default function ModelEditor({ published, slate, stats }: { published: Model; slate: Slate | null; stats: StatMeta[] }) {
  const labels = useMemo(() => stats.map((s) => s.label), [stats]);
  const [rows, setRows] = useState<EditRow[]>(() => withKeys(published));
  const [loaded, setLoaded] = useState(false);
  const [gameId, setGameId] = useState(slate?.games[0]?.game_id ?? "");
  const [side, setSide] = useState("Home");
  const [win, setWin] = useState("YTD");
  const [stat, setStat] = useState(labels[0] ?? "Games");
  const focused = useRef<{ key: number; el: HTMLTextAreaElement } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Restore this browser's unpublished draft once.
  useEffect(() => {
    const d = readDraft();
    if (d && JSON.stringify(d) !== JSON.stringify(published)) setRows(withKeys(d));
    setLoaded(true);
  }, [published]);

  const model = useMemo(() => strip(rows), [rows]);
  const dirty = JSON.stringify(model) !== JSON.stringify(published);
  useEffect(() => {
    if (loaded) writeDraft(dirty ? model : null);
  }, [model, dirty, loaded]);

  const game = slate?.games.find((g) => g.game_id === gameId) ?? slate?.games[0];
  const result = useMemo(() => (slate && game ? evaluateGame(model, slate, game, labels) : null), [model, slate, game, labels]);
  const allResults = useMemo(
    () => (slate ? slate.games.map((g) => ({ g, r: evaluateGame(model, slate, g, labels) })) : []),
    [model, slate, labels],
  );

  const update = (key: number, patch: Partial<ModelRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (key: number, d: -1 | 1) =>
    setRows((rs) => {
      const i = rs.findIndex((r) => r.key === key);
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const out = [...rs];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  const addRow = () => {
    let n = rows.length + 1;
    while (rows.some((r) => r.name.toUpperCase() === `ROW_${n}`)) n++;
    setRows((rs) => [...rs, { key: nextKey++, name: `row_${n}`, label: "", formula: "", round: false, show: false }]);
  };

  const ref = `[${side} ${win} ${stat}]`;
  let refPreview = "";
  try {
    if (slate && game) {
      const v = lookupStat(slate, game, parseRef(ref.slice(1, -1), labels));
      refPreview = v == null ? "blank (counts as 0)" : fmtValue(v);
    }
  } catch (e) {
    refPreview = (e as Error).message;
  }

  const insert = (text: string) => {
    const f = focused.current;
    const target = f ? rows.find((r) => r.key === f.key) : rows[rows.length - 1];
    if (!target) return;
    const el = f?.el;
    const cur = target.formula;
    const start = el ? el.selectionStart : cur.length;
    const end = el ? el.selectionEnd : cur.length;
    update(target.key, { formula: cur.slice(0, start) + text + cur.slice(end) });
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.selectionStart = el.selectionEnd = start + text.length;
      });
    }
  };
  const windowTemplate = () => {
    const s = side === "League" ? null : side;
    if (!s) return;
    insert(`SUMPRODUCT({40,25,30,5}, {[${s} YTD ${stat}], [${s} L3 ${stat}], [${s} H/A ${stat}], [${s} Prior ${stat}]}) / 100`);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(model, null, 2) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "model.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const load = async (file: File) => {
    try {
      const m = JSON.parse(await file.text()) as Model;
      if (!Array.isArray(m.rows)) throw new Error("no rows");
      setRows(withKeys(m));
    } catch {
      alert("That file isn't a model.json from this page.");
    }
  };

  const names = rows.map((r) => r.name.toUpperCase());
  const nameProblem = (r: EditRow) =>
    !NAME_RE.test(r.name)
      ? "Letters, numbers and _ only; start with a letter"
      : names.filter((n) => n === r.name.toUpperCase()).length > 1
        ? "Name used twice"
        : null;

  return (
    <>
      <div className="toolbar">
        <button className="btn-primary" onClick={download}>Download model.json</button>
        <button className="tab" onClick={() => fileInput.current?.click()}>Load file…</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        {dirty && (
          <button className="tab" onClick={() => confirm("Discard your changes and go back to the published model?") && setRows(withKeys(published))}>
            Discard changes
          </button>
        )}
        <span className={dirty ? "notice-inline" : "muted small"}>
          {dirty ? (
            <>
              Unpublished changes (saved in this browser). To publish: download, then{" "}
              <a href={UPLOAD_URL} target="_blank" rel="noreferrer">upload to the web folder on GitHub</a> and commit.
            </>
          ) : (
            "Matches the published model."
          )}
        </span>
      </div>

      <div className="editor-grid">
        <div>
          <div className="preview-pick">
            <label className="small muted">
              Preview game{" "}
              <select value={game?.game_id} onChange={(e) => setGameId(e.target.value)}>
                {slate?.games.map((g) => (
                  <option key={g.game_id} value={g.game_id}>
                    {g.away.abbr} @ {g.home.abbr}
                  </option>
                ))}
              </select>
            </label>
            {result && (
              <span className="small">
                {game?.away.abbr} <strong>{result.away_score ?? "—"}</strong> @ {game?.home.abbr} <strong>{result.home_score ?? "—"}</strong>
                {result.home_spread != null && <> · {game?.home.abbr} {fmtSpread(result.home_spread)} · total {result.total}</>}
              </span>
            )}
          </div>

          <div className="table-wrap">
            <table className="model-rows">
              <thead>
                <tr>
                  <th className="left">Name</th>
                  <th className="left">Label</th>
                  <th className="left formula-col">Formula</th>
                  <th>Value</th>
                  <th title="Round the result to the nearest 0.5">0.5</th>
                  <th title="Show on the game page">Show</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const res = result?.rows[r.name.toUpperCase()];
                  const np = nameProblem(r);
                  return (
                    <tr key={r.key}>
                      <td className="left">
                        <input className={np ? "cell-input bad" : "cell-input"} value={r.name} title={np ?? undefined} onChange={(e) => update(r.key, { name: e.target.value })} spellCheck={false} />
                      </td>
                      <td className="left">
                        <input className="cell-input" value={r.label} placeholder="Label" onChange={(e) => update(r.key, { label: e.target.value })} />
                      </td>
                      <td className="left formula-col">
                        <textarea
                          className="formula-input"
                          value={r.formula}
                          placeholder="= formula"
                          rows={Math.min(6, Math.max(1, Math.ceil(r.formula.length / 70)))}
                          spellCheck={false}
                          onFocus={(e) => (focused.current = { key: r.key, el: e.currentTarget })}
                          onChange={(e) => update(r.key, { formula: e.target.value })}
                        />
                        {res?.missing.length ? <div className="warn small">Blank, counted as 0: {[...new Set(res.missing)].map((m) => `[${m}]`).join(", ")}</div> : null}
                      </td>
                      <td className={res?.error ? "err small" : "strong"}>
                        {!r.formula.trim() ? <span className="muted">—</span> : res?.error ? res.error : res?.value != null ? fmtValue(res.value) : "—"}
                      </td>
                      <td>
                        <input type="checkbox" checked={r.round} onChange={(e) => update(r.key, { round: e.target.checked })} aria-label="Round to nearest 0.5" />
                      </td>
                      <td>
                        <input type="checkbox" checked={r.show} onChange={(e) => update(r.key, { show: e.target.checked })} aria-label="Show on game page" />
                      </td>
                      <td className="row-actions">
                        <button onClick={() => move(r.key, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                        <button onClick={() => move(r.key, 1)} disabled={i === rows.length - 1} aria-label="Move down">↓</button>
                        <button onClick={() => confirm(`Delete ${r.name}?`) && setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label="Delete">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>
            <button className="tab" onClick={addRow}>+ Add row</button>
          </p>
        </div>

        <aside className="card picker">
          <h3>Insert a stat</h3>
          <label className="small muted">Side</label>
          <select value={side} onChange={(e) => setSide(e.target.value)}>
            {["Home", "Away", "League"].map((s) => <option key={s}>{s}</option>)}
          </select>
          <label className="small muted">Window</label>
          <select value={win} onChange={(e) => setWin(e.target.value)}>
            {[...WINDOWS, ...(side === "League" ? [] : ["H/A"])].map((w) => <option key={w}>{w}</option>)}
          </select>
          <label className="small muted">Stat</label>
          <select value={stat} onChange={(e) => setStat(e.target.value)}>
            {[...(side === "League" ? [] : ["Games"]), ...labels].map((l) => <option key={l}>{l}</option>)}
          </select>
          <code className="ref">{ref}</code>
          <div className="small muted">{game ? `${game.away.abbr} @ ${game.home.abbr}: ` : ""}{refPreview}</div>
          <button className="btn-primary" onClick={() => insert(ref)}>Insert into formula</button>
          <button className="tab" onClick={windowTemplate} disabled={side === "League"} title="Inserts the four windows with placeholder weights">
            Insert 4-window SUMPRODUCT
          </button>

          <h3>How formulas work</h3>
          <ul className="small help">
            <li><code>+ - * / ^</code> and <code>( )</code></li>
            <li>Lists: <code>{"{40,25,30,5}"}</code></li>
            <li><code>SUMPRODUCT(list, list)</code>: multiply pairwise, then add</li>
            <li><code>MROUND(x, 0.5)</code>: nearest 0.5 (or tick <b>0.5</b> on the row)</li>
            <li>Use another row by its name, e.g. <code>home_pts_w * 2</code></li>
            <li><b>H/A</b> = the team&apos;s own split: Home team&apos;s home games, Away team&apos;s away games</li>
            <li>Blank stats (no games in that window) count as 0</li>
            <li>The slate uses <code>{HOME_SCORE}</code> and <code>{AWAY_SCORE}</code>; spread and total come from those</li>
            <li>Also: {FUNCTIONS.filter((f) => !["SUMPRODUCT", "MROUND"].includes(f)).join(", ")}</li>
          </ul>
        </aside>
      </div>

      {slate && (
        <>
          <h2>Every game on {slate.date}</h2>
          <div className="table-wrap">
            <table className="lines">
              <thead>
                <tr>
                  <th className="left">Game</th>
                  <th>Away</th>
                  <th>Home</th>
                  <th>Home spread</th>
                  <th>Total</th>
                  <th className="left">Problems</th>
                </tr>
              </thead>
              <tbody>
                {allResults.map(({ g, r }) => {
                  const errs = Object.entries(r.rows).filter(([, v]) => v.error);
                  return (
                    <tr key={g.game_id}>
                      <td className="left">{g.away.abbr} @ {g.home.abbr}</td>
                      <td>{r.away_score ?? "—"}</td>
                      <td>{r.home_score ?? "—"}</td>
                      <td>{r.home_spread == null ? "—" : fmtSpread(r.home_spread)}</td>
                      <td>{r.total ?? "—"}</td>
                      <td className="left small err">{errs.length ? `${errs.length} row(s) with errors` : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
