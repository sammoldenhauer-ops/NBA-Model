import SlateView from "@/components/SlateView";
import { getConfidenceGames, getDates, getTracking, getLatest, getStatList } from "@/lib/data";
import { getModel, getModelHash } from "@/lib/modelFile";
import { readRows } from "@/lib/tracking";

const trackingRows = () => { const f = getTracking(); return f ? readRows(f) : []; };

export default function Home() {
  const slate = getLatest();
  if (!slate) return <p className="muted">No games yet. The daily job hasn’t written any data.</p>;
  return <SlateView slate={slate} dates={getDates()} model={getModel()} statLabels={getStatList().map((s) => s.label)} confidence={getConfidenceGames()} modelHash={getModelHash()} tracking={trackingRows()} />;
}
