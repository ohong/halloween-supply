import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { readCustomLook } from "@/lib/custom-looks/store";
import { CustomLookView } from "@/components/store/custom-look";

export const metadata: Metadata = {
  title: "Your costume — Halloween Supply",
  robots: { index: false, follow: false },
};

async function SavedLook({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const look = await readCustomLook(id);
  if (!look) notFound();
  return <CustomLookView look={look} />;
}

export default function CustomCostumePage({ params }: { params: Promise<{ id: string }> }) {
  return <main id="main">
    <Suspense fallback={<p className="loading-note page">Loading your costume…</p>}>
      <SavedLook params={params} />
    </Suspense>
  </main>;
}
