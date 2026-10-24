import TrackingTable from "@/components/TrackingTable";
import { getTracking } from "@/lib/data";

export const metadata = { title: "Tracking · NBA Matchup Model" };

export default function TrackingPage() {
  const file = getTracking();
  if (!file) return <p className="muted">No results yet.</p>;
  return (
    <>
      <div className="slate-head">
        <div>
          <h1>Tracking</h1>
          <p className="muted small">
            Every finished game filed under each team by home/away, whether the model had them favoured or as the underdog, and the size of
            the model&apos;s spread. Past seasons are backtests of the current Model sheet (stats as of each game day). Click a team to expand.
          </p>
        </div>
      </div>
      <TrackingTable file={file} />
    </>
  );
}
