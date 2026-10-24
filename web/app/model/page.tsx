import SheetEditor from "@/components/SheetEditor";
import { getInjuries, getLatest, getStats, getTracking } from "@/lib/data";
import { getModel } from "@/lib/modelFile";

export const metadata = { title: "Model · NBA Matchup Model" };

export default function ModelPage() {
  return (
    <div className="sheet-page">
      <div className="slate-head">
        <div>
          <h1>Model</h1>
          <p className="muted small">
            Your Team v Team sheet. Pick the two teams and every stat cell fills in; the slate runs the same sheet for every game.
          </p>
        </div>
      </div>
      <SheetEditor published={getModel()} stats={getStats()} slate={getLatest()} injuries={getInjuries()} tracking={getTracking()} />
    </div>
  );
}
