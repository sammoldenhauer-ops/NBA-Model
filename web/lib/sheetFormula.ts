// Spreadsheet formula engine for the Model sheet (browser-safe, no imports).
//
// Supports what Google Sheets does for this kind of model:
//   cell refs A1, $A$1, A$1   ranges B9:B12   numbers, "text", TRUE/FALSE
//   + - * / ^ & = <> < > <= >=   lists {40,25,30,5}
//   SUMPRODUCT SUM AVERAGE MIN MAX ROUND ROUNDUP ROUNDDOWN MROUND ABS IF IFERROR ISNUMBER VLOOKUP
//   stat references [Home YTD Points/Game], [Away H/A EFG%], [League Home Points/Game], [Home Team]
//
// Like Sheets: an empty cell is 0 in math; text (e.g. "--" for a window with no games)
// in + - * / gives #VALUE!; SUMPRODUCT and SUM treat text as 0.

export type Scalar = number | string | boolean | null;
export type Val = Scalar | Scalar[];

export class SheetError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

// ---- addresses -------------------------------------------------------------

export function colName(i: number): string {
  let s = "";
  i += 1;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

export function colIndex(name: string): number {
  let n = 0;
  for (const ch of name.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const addr = (col: number, row: number) => `${colName(col)}${row + 1}`;

export function parseAddr(a: string): { col: number; row: number } | null {
  const m = /^\$?([A-Za-z]{1,2})\$?(\d+)$/.exec(a.trim());
  return m ? { col: colIndex(m[1]), row: Number(m[2]) - 1 } : null;
}

// ---- tokenizer / parser ------------------------------------------------------

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "stat"; v: string }
  | { t: "cell"; col: number; row: number }
  | { t: "id"; v: string }
  | { t: "op"; v: string };

export type Node =
  | { k: "lit"; v: Scalar }
  | { k: "stat"; v: string }
  | { k: "cell"; col: number; row: number }
  | { k: "range"; c1: number; r1: number; c2: number; r2: number }
  | { k: "call"; f: string; args: Node[] }
  | { k: "arr"; items: Node[] }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "neg"; a: Node };

const CELL_RE = /^\$?([A-Za-z]{1,2})\$?(\d+)(?![A-Za-z0-9_(])/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const rest = src.slice(i);
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest))) {
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (c === '"') {
      const j = src.indexOf('"', i + 1);
      if (j < 0) throw new SheetError("#ERROR!", "Missing closing quote");
      out.push({ t: "str", v: src.slice(i + 1, j) });
      i = j + 1;
    } else if (c === "[") {
      const j = src.indexOf("]", i);
      if (j < 0) throw new SheetError("#ERROR!", "Missing ] in a stat reference");
      out.push({ t: "stat", v: src.slice(i + 1, j).trim() });
      i = j + 1;
    } else if ((m = CELL_RE.exec(rest))) {
      out.push({ t: "cell", col: colIndex(m[1]), row: Number(m[2]) - 1 });
      i += m[0].length;
    } else if ((m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest))) {
      out.push({ t: "id", v: m[0].toUpperCase() });
      i += m[0].length;
    } else if ((m = /^(<=|>=|<>)/.exec(rest))) {
      out.push({ t: "op", v: m[0] });
      i += 2;
    } else if ("+-*/^&=<>(){},;:".includes(c)) {
      out.push({ t: "op", v: c === ";" ? "," : c });
      i++;
    } else {
      throw new SheetError("#ERROR!", `Unexpected "${c}"`);
    }
  }
  return out;
}

export function parseFormula(src: string): Node {
  const toks = tokenize(src);
  if (!toks.length) throw new SheetError("#ERROR!", "Empty formula");
  let p = 0;
  const isOp = (...v: string[]) => toks[p]?.t === "op" && v.includes((toks[p] as { v: string }).v);
  const expect = (v: string) => {
    if (!isOp(v)) throw new SheetError("#ERROR!", `Expected "${v}"`);
    p++;
  };
  const left = (next: () => Node, ...ops: string[]) => (): Node => {
    let a = next();
    while (isOp(...ops)) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: next() };
    }
    return a;
  };
  const unary = (): Node => {
    if (isOp("-")) {
      p++;
      return { k: "neg", a: unary() };
    }
    if (isOp("+")) {
      p++;
      return unary();
    }
    return primary();
  };
  const power = left(unary, "^");
  const term = left(power, "*", "/");
  const sum = left(term, "+", "-");
  const concat = left(sum, "&");
  const compare = left(concat, "=", "<>", "<", ">", "<=", ">=");
  const expr = compare;
  const list = (close: string): Node[] => {
    const items: Node[] = [];
    if (isOp(close)) {
      p++;
      return items;
    }
    items.push(expr());
    while (isOp(",")) {
      p++;
      items.push(expr());
    }
    expect(close);
    return items;
  };
  const primary = (): Node => {
    const t = toks[p++];
    if (!t) throw new SheetError("#ERROR!", "Formula ends too early");
    switch (t.t) {
      case "num":
        return { k: "lit", v: t.v };
      case "str":
        return { k: "lit", v: t.v };
      case "stat":
        return { k: "stat", v: t.v };
      case "cell":
        if (isOp(":")) {
          p++;
          const e = toks[p++];
          if (e?.t !== "cell") throw new SheetError("#ERROR!", "Bad range");
          return { k: "range", c1: Math.min(t.col, e.col), r1: Math.min(t.row, e.row), c2: Math.max(t.col, e.col), r2: Math.max(t.row, e.row) };
        }
        return { k: "cell", col: t.col, row: t.row };
      case "id":
        if (isOp("(")) {
          p++;
          return { k: "call", f: t.v, args: list(")") };
        }
        if (t.v === "TRUE" || t.v === "FALSE") return { k: "lit", v: t.v === "TRUE" };
        throw new SheetError("#NAME?", `Unknown name ${t.v}`);
      case "op":
        if (t.v === "(") {
          const e = expr();
          expect(")");
          return e;
        }
        if (t.v === "{") return { k: "arr", items: list("}") };
    }
    throw new SheetError("#ERROR!", `Unexpected "${"v" in t ? t.v : ""}"`);
  };
  const node = expr();
  if (p < toks.length) throw new SheetError("#ERROR!", "Unexpected text after the formula");
  return node;
}

// ---- evaluation --------------------------------------------------------------

export type Ctx = {
  cell: (col: number, row: number) => Scalar; // throws SheetError if that cell has an error
  stat: (ref: string) => Scalar; // number, text ("--" when blank), throws for unknown refs
};

const num = (v: Scalar): number => {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  if (v.trim() !== "" && Number.isFinite(n)) return n;
  throw new SheetError("#VALUE!", `"${v}" is text, not a number`);
};
const numOr0 = (v: Scalar): number => (typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : 0);
const one = (v: Val): Scalar => {
  if (!Array.isArray(v)) return v;
  if (v.length === 1) return v[0];
  throw new SheetError("#VALUE!", "Expected one value, got a range");
};
const flat = (vals: Val[]): Scalar[] => vals.flatMap((v) => (Array.isArray(v) ? v : [v]));

function roundTo(x: number, digits: number, mode: "half" | "up" | "down"): number {
  const f = 10 ** digits;
  const a = Math.abs(x) * f;
  const r = mode === "half" ? Math.floor(a + 0.5 + 1e-9) : mode === "up" ? Math.ceil(a - 1e-9) : Math.floor(a + 1e-9);
  return (Math.sign(x) * r) / f;
}

export function mround(x: number, m: number): number {
  if (m === 0) return 0;
  if (Math.sign(x) * Math.sign(m) < 0) throw new SheetError("#NUM!", "MROUND: number and multiple must have the same sign");
  return Math.sign(x) * Math.floor(Math.abs(x / m) + 0.5 + 1e-9) * Math.abs(m);
}

function binop(op: string, a: Scalar, b: Scalar): Scalar {
  switch (op) {
    case "&":
      return `${a ?? ""}${b ?? ""}`;
    case "=":
      return a === b || (a ?? "") === (b ?? "");
    case "<>":
      return !(a === b || (a ?? "") === (b ?? ""));
    case "<":
    case ">":
    case "<=":
    case ">=": {
      const x = typeof a === "string" || typeof b === "string" ? String(a ?? "") : numOr0(a);
      const y = typeof a === "string" || typeof b === "string" ? String(b ?? "") : numOr0(b);
      return op === "<" ? x < y : op === ">" ? x > y : op === "<=" ? x <= y : x >= y;
    }
  }
  const x = num(a);
  const y = num(b);
  switch (op) {
    case "+":
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      if (y === 0) throw new SheetError("#DIV/0!", "Dividing by zero");
      return x / y;
    case "^":
      return x ** y;
  }
  throw new SheetError("#ERROR!", `Unknown operator ${op}`);
}

function elementwise(op: string, a: Val, b: Val): Val {
  if (!Array.isArray(a) && !Array.isArray(b)) return binop(op, a, b);
  const A = Array.isArray(a) ? a : null;
  const B = Array.isArray(b) ? b : null;
  if (A && B && A.length !== B.length) throw new SheetError("#VALUE!", `Ranges of different sizes (${A.length} and ${B.length})`);
  const n = (A ?? B)!.length;
  return Array.from({ length: n }, (_, i) => binop(op, A ? A[i] : (a as Scalar), B ? B[i] : (b as Scalar)));
}

export function evaluate(node: Node, ctx: Ctx): Val {
  const ev = (n: Node) => evaluate(n, ctx);
  switch (node.k) {
    case "lit":
      return node.v;
    case "stat":
      return ctx.stat(node.v);
    case "cell":
      return ctx.cell(node.col, node.row);
    case "range": {
      const out: Scalar[] = [];
      for (let r = node.r1; r <= node.r2; r++) for (let c = node.c1; c <= node.c2; c++) out.push(ctx.cell(c, r));
      return out;
    }
    case "arr":
      return flat(node.items.map(ev));
    case "neg":
      return elementwise("*", ev(node.a), -1);
    case "bin":
      return elementwise(node.op, ev(node.a), ev(node.b));
    case "call":
      return call(node.f, node.args, ctx);
  }
}

function call(f: string, argNodes: Node[], ctx: Ctx): Val {
  if (f === "IFERROR") {
    try {
      return one(evaluate(argNodes[0], ctx));
    } catch (e) {
      if (e instanceof SheetError) return argNodes[1] ? one(evaluate(argNodes[1], ctx)) : "";
      throw e;
    }
  }
  if (f === "VLOOKUP") {
    // VLOOKUP(key, range, column, [sorted=TRUE]): sorted = last row whose first
    // column is <= key (Sheets' approximate match); FALSE = exact match.
    const key = one(evaluate(argNodes[0], ctx));
    const rng = argNodes[1];
    if (rng?.k !== "range") throw new SheetError("#VALUE!", "VLOOKUP needs a range like $O$8:$S$17");
    const col = num(one(evaluate(argNodes[2], ctx)));
    if (col < 1 || col > rng.c2 - rng.c1 + 1) throw new SheetError("#REF!", "VLOOKUP column is outside the range");
    const sorted = argNodes[3] ? Boolean(numOr0(one(evaluate(argNodes[3], ctx)))) : true;
    let hit = -1;
    for (let r = rng.r1; r <= rng.r2; r++) {
      const v = ctx.cell(rng.c1, r);
      if (v == null || v === "") continue;
      if (sorted) {
        if (typeof v === "number" && typeof key === "number" ? v <= key : String(v) <= String(key)) hit = r;
        else break;
      } else if (v === key || String(v).toLowerCase() === String(key).toLowerCase()) {
        hit = r;
        break;
      }
    }
    if (hit < 0) throw new SheetError("#N/A", `VLOOKUP: no match for ${key}`);
    return ctx.cell(rng.c1 + col - 1, hit);
  }
  if (f === "IF") {
    const cond = one(evaluate(argNodes[0], ctx));
    const pick = typeof cond === "string" ? cond !== "" : Boolean(numOr0(cond as Scalar) || cond === true);
    const n = pick ? argNodes[1] : argNodes[2];
    return n ? one(evaluate(n, ctx)) : pick;
  }
  const args = argNodes.map((n) => evaluate(n, ctx));
  if (f === "ISNUMBER") {
    const a = args[0] ?? null;
    return Array.isArray(a) ? a.map((x) => typeof x === "number") : typeof a === "number";
  }
  const arg = (i: number, name: string): number => {
    if (args[i] === undefined) throw new SheetError("#N/A", `${name} is missing an argument`);
    return num(one(args[i]));
  };
  switch (f) {
    case "SUMPRODUCT": {
      if (!args.length) throw new SheetError("#N/A", "SUMPRODUCT needs at least one range");
      const lists = args.map((a) => (Array.isArray(a) ? a : [a]));
      const n = lists[0].length;
      if (lists.some((l) => l.length !== n)) throw new SheetError("#VALUE!", "SUMPRODUCT ranges must be the same size");
      let total = 0;
      for (let i = 0; i < n; i++) total += lists.reduce((prod, l) => prod * numOr0(l[i]), 1);
      return total;
    }
    case "SUM":
      return flat(args).reduce<number>((s, x) => s + numOr0(x), 0);
    case "AVERAGE": {
      const xs = flat(args).filter((x): x is number => typeof x === "number");
      if (!xs.length) throw new SheetError("#DIV/0!", "AVERAGE of no numbers");
      return xs.reduce((s, x) => s + x, 0) / xs.length;
    }
    case "MIN":
    case "MAX": {
      const xs = flat(args).filter((x): x is number => typeof x === "number");
      if (!xs.length) return 0;
      return f === "MIN" ? Math.min(...xs) : Math.max(...xs);
    }
    case "ABS":
      return Math.abs(arg(0, "ABS"));
    case "ROUND":
      return roundTo(arg(0, "ROUND"), args[1] === undefined ? 0 : arg(1, "ROUND"), "half");
    case "ROUNDUP":
      return roundTo(arg(0, "ROUNDUP"), args[1] === undefined ? 0 : arg(1, "ROUNDUP"), "up");
    case "ROUNDDOWN":
      return roundTo(arg(0, "ROUNDDOWN"), args[1] === undefined ? 0 : arg(1, "ROUNDDOWN"), "down");
    case "MROUND":
      return mround(arg(0, "MROUND"), arg(1, "MROUND"));
  }
  throw new SheetError("#NAME?", `Unknown function ${f}`);
}

export const FUNCTIONS = ["SUMPRODUCT", "SUM", "AVERAGE", "MIN", "MAX", "ROUND", "ROUNDUP", "ROUNDDOWN", "MROUND", "ABS", "IF", "IFERROR", "ISNUMBER", "VLOOKUP"];

// ---- copy / paste: shift relative references --------------------------------

// Shift every relative cell reference (the parts without $) by dRow/dCol, skipping
// text in quotes and stat references in [ ].
export function shiftFormula(src: string, dRow: number, dCol: number): string {
  if (!src.startsWith("=")) return src;
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "[") {
      const close = c === '"' ? '"' : "]";
      const j = src.indexOf(close, i + 1);
      const end = j < 0 ? src.length : j + 1;
      out += src.slice(i, end);
      i = end;
      continue;
    }
    const prev = i > 0 ? src[i - 1] : "";
    const m = /^(\$?)([A-Za-z]{1,2})(\$?)(\d+)(?![A-Za-z0-9_(])/.exec(src.slice(i));
    if (m && !/[A-Za-z0-9_.]/.test(prev)) {
      const col = m[1] ? colIndex(m[2]) : colIndex(m[2]) + dCol;
      const row = m[3] ? Number(m[4]) : Number(m[4]) + dRow;
      if (col < 0 || row < 1) out += "#REF!";
      else out += `${m[1]}${colName(col)}${m[3]}${row}`;
      i += m[0].length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
