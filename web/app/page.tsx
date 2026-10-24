import SlateView from "@/components/SlateView";
import { getDates, getLatest } from "@/lib/data";

export default function Home() {
  const slate = getLatest();
  if (!slate) return <p className="muted">No projections yet. The daily job hasn’t written any data.</p>;
  return <SlateView slate={slate} dates={getDates()} />;
}
