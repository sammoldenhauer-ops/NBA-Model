import ModelEditor from "@/components/ModelEditor";
import { getLatest, getStatList } from "@/lib/data";
import { getModel } from "@/lib/modelFile";

export const metadata = { title: "Model · NBA Matchup Model" };

export default function ModelPage() {
  return (
    <>
      <div className="slate-head">
        <div>
          <h1>Model</h1>
          <p className="muted small">
            Build your projection row by row, like a sheet. Every formula runs for every game, with Home and Away swapped in for each
            matchup.
          </p>
        </div>
      </div>
      <ModelEditor published={getModel()} slate={getLatest()} stats={getStatList()} />
    </>
  );
}
