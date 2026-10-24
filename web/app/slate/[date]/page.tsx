import { notFound } from "next/navigation";
import SlateView from "@/components/SlateView";
import { getDates, getSlate } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return getDates().map((date) => ({ date }));
}

export default async function SlatePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const slate = getSlate(date);
  if (!slate) notFound();
  return <SlateView slate={slate} dates={getDates()} />;
}
