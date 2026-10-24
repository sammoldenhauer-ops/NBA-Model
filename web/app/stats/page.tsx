import SheetLinks from "@/components/SheetLinks";
import StatsTable from "@/components/StatsTable";
import { getStats } from "@/lib/data";
import { fmtDateLong } from "@/lib/format";

export const metadata = { title: "Team Stats · NBA Matchup Model" };

export default function StatsPage() {
  const data = getStats();
  if (!data) return <p className="muted">No stats yet. The daily job hasn’t written any data.</p>;

  return (
    <>
      <div className="slate-head">
        <div>
          <h1>Team stats</h1>
          <p className="muted small">
            Games before {fmtDateLong(data.as_of)} · updated{" "}
            {new Date(data.generated_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET · prior ={" "}
            {data.season - 2}-{String(data.season - 1).slice(2)} season
          </p>
        </div>
      </div>

      <h2>Data files</h2>
      <p className="muted small">
        Updated every morning. Paste a formula into a Google Sheet cell and the table stays in sync; rates are decimals
        (0.523 = 52.3%).
      </p>
      <SheetLinks />

      <h2>By window</h2>
      <p className="muted small">Click a column to sort. League average is the mean of the 30 teams.</p>
      <StatsTable data={data} />
    </>
  );
}
