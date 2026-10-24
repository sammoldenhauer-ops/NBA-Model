import SlateView from "@/components/SlateView";
import { getConfidence, getDates, getLatest, getStatList } from "@/lib/data";
import { getModel, getModelHash } from "@/lib/modelFile";

export default function Home() {
  const slate = getLatest();
  if (!slate) return <p className="muted">No games yet. The daily job hasn’t written any data.</p>;
  return <SlateView slate={slate} dates={getDates()} model={getModel()} statLabels={getStatList().map((s) => s.label)} confidence={getConfidence()} modelHash={getModelHash()} />;
}
