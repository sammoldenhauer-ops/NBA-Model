import type { StatFormat } from "./data";

const DIGITS: Record<StatFormat, number> = { dec1: 1, dec2: 2, dec3: 3, pct: 1 };

export function fmtStat(v: number | null | undefined, fmt: StatFormat): string {
  if (v == null) return "—";
  return fmt === "pct" ? `${(v * 100).toFixed(1)}%` : v.toFixed(DIGITS[fmt]);
}

export function fmtDiff(v: number | null | undefined, fmt: StatFormat): string {
  if (v == null) return "—";
  const x = fmt === "pct" ? v * 100 : v;
  const s = x.toFixed(DIGITS[fmt]);
  return x > 0 ? `+${s}` : s;
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  return v == null ? "—" : v.toFixed(digits);
}

export function fmtSpread(v: number): string {
  if (v === 0) return "PK";
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

export function fmtTip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    }).format(d) + " ET"
  );
}

export function fmtDateLong(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function teamColor(hex: string | null): string {
  return hex && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : "var(--muted)";
}
