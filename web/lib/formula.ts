// A small spreadsheet-style formula language for the Model page.
//
//   =SUMPRODUCT({40,25,30,5}, {[Home YTD Points/Game], [Home L3 Points/Game],
//                              [Home H/A Points/Game], [Home Prior Points/Game]}) / 100
//
// Stat references:  [Side Window Stat]
//   Side:    Home | Away | League
//   Window:  YTD | L3 | Home | Away | Prior | H/A (team's own split: Home team -> Home, Away team -> Away)
//   Stat:    any stat name from the Team stats page, or Games
// Row references: another row's name, e.g. home_pts_w
// Operators: + - * / ^ and parentheses. Lists: {a, b, c}
// Functions: SUMPRODUCT, SUM, AVERAGE, MIN, MAX, ROUND(x, digits), MROUND(x, multiple), ABS
//
// A missing stat (e.g. no away games yet) counts as 0, like a blank cell.

export type Value = number | number[];

export class FormulaError extends Error {}

type Tok = { t: "num"; v: number } | { t: "ref"; v: string } | { t: "id"; v: string } | { t: "op"; v: string };

export type Node =
  | { k: "num"; v: number }
  | { k: "ref"; v: string }
  | { k: "name"; v: string }
  | { k: "call"; f: string; args: Node[] }
  | { k: "arr"; items: Node[] }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "neg"; a: Node };

function tokenize(src: string): Tok[] {
  const s = src.trim().replace(/^=/, "");
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s.slice(i));
      if (!m) throw new FormulaError(`Bad number near "${s.slice(i, i + 8)}"`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if (c === "[") {
      const j = s.indexOf("]", i);
      if (j < 0) throw new FormulaError("Missing ] in a stat reference");
      out.push({ t: "ref", v: s.slice(i + 1, j).trim() });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))!;
      out.push({ t: "id", v: m[0] });
      i += m[0].length;
    } else if ("+-*/^(){},".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new FormulaError(`Unexpected "${c}"`);
    }
  }
  return out;
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  if (!toks.length) throw new FormulaError("Empty formula");
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.t === "op" && peek()!.v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected "${v}"`);
    p++;
  };

  const expr = (): Node => {
    let a = term();
    while (isOp("+") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: term() };
    }
    return a;
  };
  const term = (): Node => {
    let a = power();
    while (isOp("*") || isOp("/")) {
      const op = (toks[p++] as { v: string }).v;
      a = { k: "bin", op, a, b: power() };
    }
    return a;
  };
  const power = (): Node => {
    let a = unary();
    while (isOp("^")) {
      p++;
      a = { k: "bin", op: "^", a, b: unary() };
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
    const t = peek();
    if (!t) throw new FormulaError("Formula ends too early");
    p++;
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "ref") return { k: "ref", v: t.v };
    if (t.t === "id") {
      if (isOp("(")) {
        p++;
        return { k: "call", f: t.v.toUpperCase(), args: list(")") };
      }
      return { k: "name", v: t.v };
    }
    if (t.v === "(") {
      const e = expr();
      expect(")");
      return e;
    }
    if (t.v === "{") return { k: "arr", items: list("}") };
    throw new FormulaError(`Unexpected "${t.v}"`);
  };

  const node = expr();
  if (p < toks.length) throw new FormulaError(`Unexpected "${(toks[p] as { v: unknown }).v}"`);
  return node;
}

// Names a formula refers to: stat references and other rows.
export function references(node: Node, acc = { refs: new Set<string>(), names: new Set<string>() }) {
  switch (node.k) {
    case "ref":
      acc.refs.add(node.v);
      break;
    case "name":
      acc.names.add(node.v.toUpperCase());
      break;
    case "call":
    case "arr":
      (node.k === "call" ? node.args : node.items).forEach((n) => references(n, acc));
      break;
    case "bin":
      references(node.a, acc);
      references(node.b, acc);
      break;
    case "neg":
      references(node.a, acc);
  }
  return acc;
}

export type EvalContext = {
  stat: (ref: string) => number | null; // throws FormulaError for an unknown reference
  row: (name: string) => number; // throws FormulaError for unknown / broken rows
  onMissing?: (ref: string) => void;
};

// Sheets MROUND: nearest multiple, halves away from zero.
export function mround(x: number, m: number): number {
  if (m === 0) return 0;
  if (Math.sign(x) * Math.sign(m) < 0) throw new FormulaError("MROUND: number and multiple must have the same sign");
  const q = Math.floor(Math.abs(x / m) + 0.5 + 1e-9);
  return Math.sign(x) * q * Math.abs(m);
}

function roundSheets(x: number, digits: number): number {
  const f = 10 ** digits;
  return (Math.sign(x) * Math.floor(Math.abs(x) * f + 0.5 + 1e-9)) / f;
}

const flat = (vals: Value[]): number[] => vals.flatMap((v) => (Array.isArray(v) ? v : [v]));
const scalar = (v: Value, what: string): number => {
  if (Array.isArray(v)) {
    if (v.length === 1) return v[0];
    throw new FormulaError(`${what} needs a single number, not a list`);
  }
  return v;
};

function binop(op: string, a: Value, b: Value): Value {
  const f = (x: number, y: number): number => {
    switch (op) {
      case "+":
        return x + y;
      case "-":
        return x - y;
      case "*":
        return x * y;
      case "/":
        if (y === 0) throw new FormulaError("#DIV/0! (dividing by zero)");
        return x / y;
      default:
        return x ** y;
    }
  };
  if (!Array.isArray(a) && !Array.isArray(b)) return f(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) throw new FormulaError(`Lists of different lengths (${a.length} and ${b.length})`);
    return a.map((x, i) => f(x, b[i]));
  }
  return Array.isArray(a) ? a.map((x) => f(x, b as number)) : (b as number[]).map((y) => f(a as number, y));
}

export function evaluate(node: Node, ctx: EvalContext): Value {
  const ev = (n: Node) => evaluate(n, ctx);
  switch (node.k) {
    case "num":
      return node.v;
    case "ref": {
      const v = ctx.stat(node.v);
      if (v == null || !Number.isFinite(v)) {
        ctx.onMissing?.(node.v);
        return 0;
      }
      return v;
    }
    case "name":
      return ctx.row(node.v.toUpperCase());
    case "neg":
      return binop("*", ev(node.a), -1);
    case "bin":
      return binop(node.op, ev(node.a), ev(node.b));
    case "arr":
      return flat(node.items.map(ev));
    case "call": {
      const args = node.args.map(ev);
      switch (node.f) {
        case "SUMPRODUCT": {
          if (!args.length) throw new FormulaError("SUMPRODUCT needs at least one list");
          const lists = args.map((a) => (Array.isArray(a) ? a : [a]));
          const n = lists[0].length;
          if (lists.some((l) => l.length !== n)) throw new FormulaError("SUMPRODUCT lists must be the same length");
          let total = 0;
          for (let i = 0; i < n; i++) total += lists.reduce((prod, l) => prod * l[i], 1);
          return total;
        }
        case "SUM":
          return flat(args).reduce((s, x) => s + x, 0);
        case "AVERAGE": {
          const xs = flat(args);
          if (!xs.length) throw new FormulaError("AVERAGE of nothing");
          return xs.reduce((s, x) => s + x, 0) / xs.length;
        }
        case "MIN":
          return Math.min(...flat(args));
        case "MAX":
          return Math.max(...flat(args));
        case "ABS":
          return Math.abs(scalar(args[0] ?? 0, "ABS"));
        case "ROUND":
          return roundSheets(scalar(args[0] ?? 0, "ROUND"), args[1] == null ? 0 : scalar(args[1], "ROUND"));
        case "MROUND":
          if (args.length !== 2) throw new FormulaError("MROUND needs (number, multiple)");
          return mround(scalar(args[0], "MROUND"), scalar(args[1], "MROUND"));
        default:
          throw new FormulaError(`Unknown function ${node.f}`);
      }
    }
  }
}

export const FUNCTIONS = ["SUMPRODUCT", "SUM", "AVERAGE", "MIN", "MAX", "ROUND", "MROUND", "ABS"];
