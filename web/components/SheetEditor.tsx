"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { Slate, StatMeta, StatsData } from "@/lib/data";
import { fmtSpread } from "@/lib/format";
import { evaluator, formatCell, rebaseModel, scoreGame, slateSource, statsSource, type CellFormat, type SheetModel } from "@/lib/sheet";
import { addr, FUNCTIONS, parseAddr, shiftFormula } from "@/lib/sheetFormula";
import { WINDOWS } from "@/lib/windows";
import SheetGrid, { type CellView, type Rect } from "./SheetGrid";

// v3 drafts remember the published version they started from (base).
const DRAFT_KEY = "nba-model-sheet-draft-v3";
const UPLOAD_URL = "https://github.com/sammoldenhauer-ops/NBA-Model/upload/main/web";
const FORMATS: { f: CellFormat; label: string }[] = [
  { f: "general", label: "Auto" },
  { f: "int", label: "0" },
  { f: "dec1", label: "0.0" },
  { f: "dec2", label: "0.00" },
  { f: "dec3", label: "0.000" },
  { f: "dec4", label: "0.0000" },
  { f: "pct", label: "%" },
];

type Pos = { row: number; col: number };
type Editing = { row: number; col: number; text: string; where: "cell" | "bar" };

type Draft = { base: SheetModel; model: SheetModel };
function readDraft(): Draft | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY);
    const d = s ? (JSON.parse(s) as Draft) : null;
    return d?.model?.version === 2 && d.base?.version === 2 ? d : null;
  } catch {
    return null;
  }
}
function writeDraft(d: Draft | null) {
  try {
    if (d) localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* storage unavailable: edits still work for this visit */
  }
}

const rectOf = (a: Pos, b: Pos): Rect => ({
  r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col),
});

export default function SheetEditor({ published, stats, slate }: { published: SheetModel; stats: StatsData | null; slate: Slate | null }) {
  const labels = useMemo(() => (stats?.stats ?? []).map((s: StatMeta) => s.label), [stats]);
  const teams = useMemo(() => {
    const seen = new Map<string, { id: string; abbr: string; name: string }>();
    for (const r of stats?.team_stats ?? []) seen.set(String(r.team_id), { id: String(r.team_id), abbr: String(r.team), name: String(r.team_name) });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [stats]);

  const [model, setModel] = useState<SheetModel>(published);
  const [loaded, setLoaded] = useState(false);
  const [rebased, setRebased] = useState<number | null>(null);
  const history = useRef<SheetModel[]>([]);
  const [active, setActive] = useState<Pos>({ row: 3, col: 1 });
  const [anchor, setAnchor] = useState<Pos>({ row: 3, col: 1 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [refRect, setRefRect] = useState<Rect | null>(null);
  const [homeId, setHomeId] = useState(slate?.games[0]?.home.id ?? teams[0]?.id ?? "");
  const [awayId, setAwayId] = useState(slate?.games[0]?.away.id ?? teams[1]?.id ?? "");
  const [side, setSide] = useState("Home");
  const [win, setWin] = useState("YTD");
  const [stat, setStat] = useState(labels[0] ?? "Games");

  const gridRef = useRef<HTMLDivElement>(null);
  const cellInput = useRef<HTMLInputElement>(null);
  const barInput = useRef<HTMLInputElement>(null);
  const dragging = useRef<null | { kind: "select" } | { kind: "ref"; start: number; end: number; from: Pos }>(null);
  const clipboard = useRef<{ r1: number; c1: number; cells: string[][] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const d = readDraft();
    if (d) {
      if (JSON.stringify(d.base) === JSON.stringify(published)) {
        setModel(d.model);
      } else {
        // The published sheet changed since this draft started: carry the edits over.
        const r = rebaseModel(d.base, d.model, published);
        setModel(r.model);
        setRebased(r.changed);
      }
    }
    setLoaded(true);
  }, [published]);
  const dirty = JSON.stringify(model) !== JSON.stringify(published);
  useEffect(() => {
    if (loaded) writeDraft(dirty ? { base: published, model } : null);
  }, [model, dirty, loaded, published]);

  const src = useMemo(() => (stats ? statsSource(stats, homeId, awayId) : null), [stats, homeId, awayId]);
  const get = useMemo(() => (src ? evaluator(model, src, labels) : null), [model, src, labels]);
  const view = useCallback(
    (a: string): CellView => {
      if (!get) return { text: model.cells[a] ?? "" };
      const r = get(a);
      return {
        text: formatCell(r, model.formats[a]),
        error: r.error ? `${r.error.code}: ${r.error.message}` : undefined,
        numeric: typeof r.value === "number" || !!r.error,
      };
    },
    [get, model],
  );

  // ---- edits ----------------------------------------------------------------
  const change = (fn: (m: SheetModel) => SheetModel) => {
    setModel((m) => {
      history.current.push(m);
      if (history.current.length > 200) history.current.shift();
      return fn(m);
    });
  };
  const setCells = (patch: Record<string, string>) =>
    change((m) => {
      const cells = { ...m.cells };
      for (const [a, v] of Object.entries(patch)) {
        if (v === "") delete cells[a];
        else cells[a] = v;
      }
      return { ...m, cells };
    });
  const undo = () => {
    const prev = history.current.pop();
    if (prev) setModel(prev);
  };

  const sel = rectOf(anchor, active);
  const raw = (p: Pos) => model.cells[addr(p.col, p.row)] ?? "";

  const moveTo = (p: Pos, extend = false) => {
    const q = { row: Math.max(0, Math.min(model.rows - 1, p.row)), col: Math.max(0, Math.min(model.cols - 1, p.col)) };
    setActive(q);
    if (!extend) setAnchor(q);
  };
  const startEdit = (text: string, where: "cell" | "bar" = "cell") => setEditing({ row: active.row, col: active.col, text, where });
  const commit = (next?: Pos) => {
    if (!editing) return;
    const a = addr(editing.col, editing.row);
    if ((model.cells[a] ?? "") !== editing.text) setCells({ [a]: editing.text });
    setEditing(null);
    setRefRect(null);
    if (next) moveTo(next);
    requestAnimationFrame(() => gridRef.current?.focus());
  };
  const cancel = () => {
    setEditing(null);
    setRefRect(null);
    gridRef.current?.focus();
  };

  const currentInput = () => (editing?.where === "bar" ? barInput.current : cellInput.current);
  const insertText = (text: string) => {
    if (!editing) {
      const cur = raw(active);
      startEdit(cur.startsWith("=") ? cur + text : "=" + text);
      return;
    }
    const el = currentInput();
    const start = el?.selectionStart ?? editing.text.length;
    const end = el?.selectionEnd ?? editing.text.length;
    const t = editing.text.slice(0, start) + text + editing.text.slice(end);
    setEditing({ ...editing, text: t });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const copy = () => {
    const cells: string[][] = [];
    for (let r = sel.r1; r <= sel.r2; r++) {
      const row: string[] = [];
      for (let c = sel.c1; c <= sel.c2; c++) row.push(model.cells[addr(c, r)] ?? "");
      cells.push(row);
    }
    clipboard.current = { r1: sel.r1, c1: sel.c1, cells };
    navigator.clipboard?.writeText(cells.map((r) => r.join("\t")).join("\n")).catch(() => {});
  };
  const paste = () => {
    const cb = clipboard.current;
    if (!cb) return;
    const patch: Record<string, string> = {};
    const h = cb.cells.length;
    const w = cb.cells[0].length;
    // A single copied cell fills the whole selection; otherwise paste the block at the top-left.
    const rows = h === 1 && w === 1 ? sel.r2 - sel.r1 + 1 : h;
    const cols = h === 1 && w === 1 ? sel.c2 - sel.c1 + 1 : w;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const s = cb.cells[i % h][j % w];
        const r = sel.r1 + i;
        const c = sel.c1 + j;
        if (r >= model.rows || c >= model.cols) continue;
        patch[addr(c, r)] = shiftFormula(s, r - (cb.r1 + (i % h)), c - (cb.c1 + (j % w)));
      }
    }
    setCells(patch);
  };
  const clearSel = () => {
    const patch: Record<string, string> = {};
    for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) patch[addr(c, r)] = "";
    setCells(patch);
  };
  const setFormat = (f: CellFormat) =>
    change((m) => {
      const formats = { ...m.formats };
      for (let r = sel.r1; r <= sel.r2; r++) for (let c = sel.c1; c <= sel.c2; c++) {
        if (f === "general") delete formats[addr(c, r)];
        else formats[addr(c, r)] = f;
      }
      return { ...m, formats };
    });
  const toggleRowStyle = (s: "bold" | "header") =>
    change((m) => {
      const styles = { ...m.styles };
      const on = styles[String(sel.r1 + 1)] !== s;
      for (let r = sel.r1; r <= sel.r2; r++) {
        if (on) styles[String(r + 1)] = s;
        else delete styles[String(r + 1)];
      }
      return { ...m, styles };
    });

  // ---- keyboard ---------------------------------------------------------------
  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[k]) {
      e.preventDefault();
      moveTo({ row: active.row + arrows[k][0], col: active.col + arrows[k][1] }, e.shiftKey);
    } else if (k === "Tab") {
      e.preventDefault();
      moveTo({ row: active.row, col: active.col + (e.shiftKey ? -1 : 1) });
    } else if (k === "Enter" || k === "F2") {
      e.preventDefault();
      startEdit(raw(active));
    } else if (k === "Delete" || k === "Backspace") {
      e.preventDefault();
      clearSel();
    } else if (mod && k.toLowerCase() === "c") {
      e.preventDefault();
      copy();
    } else if (mod && k.toLowerCase() === "v") {
      e.preventDefault();
      paste();
    } else if (mod && k.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if (k.length === 1 && !mod && !e.altKey) {
      e.preventDefault();
      startEdit(k);
    }
  };
  const onEditKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit({ row: active.row + (e.shiftKey ? -1 : 1), col: active.col });
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit({ row: active.row, col: active.col + (e.shiftKey ? -1 : 1) });
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  // ---- mouse ----------------------------------------------------------------
  useEffect(() => {
    const up = () => (dragging.current = null);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);
  const onCellMouseDown = (row: number, col: number, e: MouseEvent) => {
    if (editing && editing.text.startsWith("=") && !(row === editing.row && col === editing.col)) {
      // Building a formula: clicking a cell inserts its reference (drag for a range).
      e.preventDefault();
      const el = currentInput();
      const start = el?.selectionStart ?? editing.text.length;
      const end = el?.selectionEnd ?? editing.text.length;
      const a = addr(col, row);
      setEditing({ ...editing, text: editing.text.slice(0, start) + a + editing.text.slice(end) });
      dragging.current = { kind: "ref", start, end: start + a.length, from: { row, col } };
      setRefRect(rectOf({ row, col }, { row, col }));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + a.length, start + a.length);
      });
      return;
    }
    if (editing) commit();
    moveTo({ row, col }, e.shiftKey);
    dragging.current = { kind: "select" };
  };
  const onCellMouseEnter = (row: number, col: number) => {
    const d = dragging.current;
    if (!d) return;
    if (d.kind === "select") {
      setActive({ row, col });
      return;
    }
    if (!editing) return;
    const r = rectOf(d.from, { row, col });
    const text = r.r1 === r.r2 && r.c1 === r.c2 ? addr(r.c1, r.r1) : `${addr(r.c1, r.r1)}:${addr(r.c2, r.r2)}`;
    const t = editing.text.slice(0, d.start) + text + editing.text.slice(d.end);
    dragging.current = { ...d, end: d.start + text.length };
    setEditing({ ...editing, text: t });
    setRefRect(r);
  };

  // ---- file -----------------------------------------------------------------
  const download = () => {
    const blob = new Blob([JSON.stringify(model, null, 1) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "model.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const load = async (file: File) => {
    try {
      const m = JSON.parse(await file.text()) as SheetModel;
      if (m.version !== 2 || typeof m.cells !== "object") throw new Error();
      change(() => m);
    } catch {
      alert("That file isn't a model.json from this page.");
    }
  };

  const allGames = useMemo(
    () => (slate ? slate.games.map((g) => ({ g, r: scoreGame(model, slateSource(slate, g), labels) })) : []),
    [model, slate, labels],
  );

  const activeAddr = addr(active.col, active.row);
  const selLabel = sel.r1 === sel.r2 && sel.c1 === sel.c2 ? activeAddr : `${addr(sel.c1, sel.r1)}:${addr(sel.c2, sel.r2)}`;
  const statRef = side === "League" ? `[League ${win} ${stat}]` : `[${side} ${win} ${stat}]`;
  const outputOk = (a: string) => !!parseAddr(a);

  return (
    <>
      <div className="toolbar">
        <label className="small">
          Home{" "}
          <select value={homeId} onChange={(e) => setHomeId(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="small">
          Away{" "}
          <select value={awayId} onChange={(e) => setAwayId(e.target.value)}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {slate && (
          <label className="small muted">
            or a game on {slate.date}{" "}
            <select
              value=""
              onChange={(e) => {
                const g = slate.games.find((x) => x.game_id === e.target.value);
                if (g) {
                  setHomeId(g.home.id);
                  setAwayId(g.away.id);
                }
              }}
            >
              <option value="">Pick…</option>
              {slate.games.map((g) => <option key={g.game_id} value={g.game_id}>{g.away.abbr} @ {g.home.abbr}</option>)}
            </select>
          </label>
        )}
        <span className="muted small">Stats as of {stats?.as_of ?? "—"}</span>
      </div>

      <div className="toolbar">
        <button className="btn-primary" onClick={download}>Download model.json</button>
        <button className="tab" onClick={() => fileInput.current?.click()}>Load file…</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        <button className="tab" onClick={undo} disabled={!history.current.length}>Undo</button>
        {dirty && <button className="tab" onClick={() => confirm("Discard your changes and go back to the published model?") && change(() => published)}>Discard changes</button>}
        <span className={dirty ? "notice-inline" : "muted small"}>
          {dirty ? (
            <>Unpublished changes (kept in this browser). To publish: download, then <a href={UPLOAD_URL} target="_blank" rel="noreferrer">upload to the web folder on GitHub</a> and commit.</>
          ) : (
            "Matches the published model."
          )}
        </span>
      </div>

      {rebased != null && (
        <p className="notice small">
          The published sheet changed since you started editing. Your {rebased} edited cell{rebased === 1 ? "" : "s"} were carried over
          onto the latest version.
        </p>
      )}

      <div className="formula-bar">
        <span className="addr-box">{selLabel}</span>
        <span className="fx">fx</span>
        <input
          ref={barInput}
          value={editing ? editing.text : raw(active)}
          onFocus={() => !editing && setEditing({ row: active.row, col: active.col, text: raw(active), where: "bar" })}
          onChange={(e) => setEditing((ed) => (ed ? { ...ed, text: e.target.value } : { row: active.row, col: active.col, text: e.target.value, where: "bar" }))}
          onKeyDown={onEditKey}
          onBlur={() => editing?.where === "bar" && !dragging.current && commit()}
          spellCheck={false}
          placeholder="Type a number, text, or =formula"
        />
      </div>

      <div className="toolbar compact">
        <span className="small muted">Format</span>
        {FORMATS.map((f) => <button key={f.f} className="tab" onClick={() => setFormat(f.f)}>{f.label}</button>)}
        <button className="tab" onClick={() => toggleRowStyle("bold")}>Bold row</button>
        <button className="tab" onClick={() => toggleRowStyle("header")}>Header row</button>
        <button className="tab" onClick={() => change((m) => ({ ...m, rows: m.rows + 10 }))}>+10 rows</button>
        <button className="tab" onClick={() => change((m) => ({ ...m, cols: m.cols + 1 }))}>+1 column</button>
      </div>

      <div className="editor-grid">
        <div ref={gridRef} tabIndex={0} onKeyDown={onGridKey} className="grid-focus">
          <SheetGrid
            model={model}
            view={view}
            selection={sel}
            active={active}
            refHighlight={refRect}
            editing={editing?.where === "cell" ? { row: editing.row, col: editing.col, text: editing.text, inputRef: cellInput, onChange: (t) => setEditing({ ...editing, text: t }), onKeyDown: onEditKey } : null}
            onCellMouseDown={onCellMouseDown}
            onCellMouseEnter={onCellMouseEnter}
            onCellDoubleClick={(row, col) => {
              moveTo({ row, col });
              setEditing({ row, col, text: model.cells[addr(col, row)] ?? "", where: "cell" });
            }}
            maxHeight="70vh"
          />
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
          <code className="ref">{statRef}</code>
          <button className="btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => insertText(statRef)}>
            Insert into {editing ? "formula" : selLabel}
          </button>

          <h3>Slate reads</h3>
          <label className="small muted">Home score cell</label>
          <input className={outputOk(model.outputs.home_score) ? "cell-input" : "cell-input bad"} value={model.outputs.home_score} onChange={(e) => change((m) => ({ ...m, outputs: { ...m.outputs, home_score: e.target.value.toUpperCase() } }))} />
          <label className="small muted">Away score cell</label>
          <input className={outputOk(model.outputs.away_score) ? "cell-input" : "cell-input bad"} value={model.outputs.away_score} onChange={(e) => change((m) => ({ ...m, outputs: { ...m.outputs, away_score: e.target.value.toUpperCase() } }))} />

          <h3>Tips</h3>
          <ul className="small help">
            <li>Click a cell, type, Enter. Double-click or F2 to edit.</li>
            <li>While typing a formula, click a cell to insert it; drag for a range.</li>
            <li><code>$D$8</code> stays fixed when copied; Ctrl+C / Ctrl+V adjusts the rest, like Sheets. Copy one cell and paste over a range to fill.</li>
            <li><code>[Home Team]</code> = team name. <b>H/A</b> = home team&apos;s home games / away team&apos;s away games.</li>
            <li><code>--</code> = no games in that window. It&apos;s 0 inside SUMPRODUCT and <code>#VALUE!</code> in + − × ÷, like your sheet.</li>
            <li>Functions: {FUNCTIONS.join(", ")}</li>
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
                </tr>
              </thead>
              <tbody>
                {allGames.map(({ g, r }) => (
                  <tr key={g.game_id}>
                    <td className="left">{g.away.abbr} @ {g.home.abbr}</td>
                    <td>{r.away_score ?? "—"}</td>
                    <td>{r.home_score ?? "—"}</td>
                    <td>{r.home_spread == null ? "—" : fmtSpread(r.home_spread)}</td>
                    <td>{r.total ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
