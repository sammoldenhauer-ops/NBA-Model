"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DatePicker({ current, dates }: { current: string; dates: string[] }) {
  const router = useRouter();
  const [missing, setMissing] = useState<string | null>(null);
  const i = dates.indexOf(current);
  const prev = i > 0 ? dates[i - 1] : null;
  const next = i >= 0 && i < dates.length - 1 ? dates[i + 1] : null;

  return (
    <div className="datepicker">
      {prev ? (
        <Link className="btn" href={`/slate/${prev}`} aria-label="Previous slate">
          ←
        </Link>
      ) : (
        <span className="btn disabled">←</span>
      )}
      <input
        type="date"
        value={current}
        min={dates[0]}
        max={dates[dates.length - 1]}
        aria-label="Choose slate date"
        onChange={(e) => {
          const d = e.target.value;
          if (dates.includes(d)) {
            setMissing(null);
            router.push(`/slate/${d}`);
          } else {
            setMissing(d);
          }
        }}
      />
      {next ? (
        <Link className="btn" href={`/slate/${next}`} aria-label="Next slate">
          →
        </Link>
      ) : (
        <span className="btn disabled">→</span>
      )}
      {missing && <span className="muted small">No slate for {missing}</span>}
    </div>
  );
}
