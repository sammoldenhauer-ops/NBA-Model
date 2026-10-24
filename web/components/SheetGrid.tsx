// Spreadsheet grid. Presentational only (no hooks), so the read-only game page can
// render it on the server and the Model editor can drive it from the client.

import type { KeyboardEvent, MouseEvent, ReactNode, RefObject } from "react";
import { addr, colName } from "@/lib/sheetFormula";
import type { SheetModel } from "@/lib/sheet";

export type CellView = { text: string; error?: string; numeric?: boolean };
export type Rect = { r1: number; c1: number; r2: number; c2: number };

type Props = {
  model: SheetModel;
  view: (a: string) => CellView;
  selection?: Rect | null;
  active?: { row: number; col: number } | null;
  editing?: { row: number; col: number; text: string; inputRef: RefObject<HTMLInputElement | null>; onChange: (t: string) => void; onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void } | null;
  refHighlight?: Rect | null;
  onCellMouseDown?: (row: number, col: number, e: MouseEvent) => void;
  onCellMouseEnter?: (row: number, col: number, e: MouseEvent) => void;
  onCellDoubleClick?: (row: number, col: number) => void;
  maxHeight?: string;
  children?: ReactNode;
};

const inRect = (r: Rect | null | undefined, row: number, col: number) =>
  !!r && row >= r.r1 && row <= r.r2 && col >= r.c1 && col <= r.c2;

export default function SheetGrid({
  model, view, selection, active, editing, refHighlight, onCellMouseDown, onCellMouseEnter, onCellDoubleClick, maxHeight,
}: Props) {
  const cols = Array.from({ length: model.cols }, (_, i) => i);
  const rows = Array.from({ length: model.rows }, (_, i) => i);
  const width = (c: number) => model.widths[colName(c)] ?? 84;

  return (
    <div className="sheet-wrap" style={maxHeight ? { maxHeight } : undefined}>
      <table className="sheet">
        <colgroup>
          <col style={{ width: 40 }} />
          {cols.map((c) => (
            <col key={c} style={{ width: width(c) }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className="corner" />
            {cols.map((c) => (
              <th key={c} className={selection && c >= selection.c1 && c <= selection.c2 ? "hl" : undefined}>
                {colName(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const style = model.styles[String(r + 1)];
            return (
              <tr key={r} className={style ? `row-${style}` : undefined}>
                <th className={selection && r >= selection.r1 && r <= selection.r2 ? "rownum hl" : "rownum"}>{r + 1}</th>
                {cols.map((c) => {
                  const a = addr(c, r);
                  const isEditing = editing && editing.row === r && editing.col === c;
                  const v = isEditing ? null : view(a);
                  const cls = [
                    v?.numeric ? "num" : "",
                    v?.error ? "err" : "",
                    inRect(selection, r, c) ? "sel" : "",
                    active && active.row === r && active.col === c ? "active" : "",
                    inRect(refHighlight, r, c) ? "refhl" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <td
                      key={c}
                      className={cls || undefined}
                      title={v?.error}
                      onMouseDown={onCellMouseDown ? (e) => onCellMouseDown(r, c, e) : undefined}
                      onMouseEnter={onCellMouseEnter ? (e) => onCellMouseEnter(r, c, e) : undefined}
                      onDoubleClick={onCellDoubleClick ? () => onCellDoubleClick(r, c) : undefined}
                    >
                      {isEditing ? (
                        <input
                          ref={editing.inputRef}
                          className="cell-edit"
                          value={editing.text}
                          onChange={(e) => editing.onChange(e.target.value)}
                          onKeyDown={editing.onKeyDown}
                          spellCheck={false}
                          autoFocus
                        />
                      ) : (
                        v?.text
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
