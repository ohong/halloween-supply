import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";
import { getCostume } from "@/lib/catalog";
import { costumes } from "@/lib/costumes";
import { CostumeExperience } from "@/components/store/costume-experience";
import { CostumePreview } from "@/components/store/costume-preview";

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return costumes.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const costume = costumes.find((item) => item.slug === slug);
  if (!costume) return { title: "Costume not found" };
  // Shared look links unfurl with the costume's own image, not the store default.
  const images = [{ url: costume.image, alt: costume.alt }];
  return {
    title: `${costume.name} — Halloween Supply`,
    description: costume.description,
    alternates: { canonical: `/costumes/${slug}` },
    openGraph: { title: costume.name, description: costume.description, type: "website", images },
    twitter: { card: "summary_large_image", title: costume.name, description: costume.description, images },
  };
}

async function CostumeData({ params }: { params: Params }) {
  const { slug } = await params;
  return <CachedCostume slug={slug} />;
}

async function CachedCostume({ slug }: { slug: string }) {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  const inspiration = costumes.find((item) => item.slug === slug);
  if (!inspiration) notFound();
  if (inspiration.status !== "live") return <CostumePreview key={slug} costume={inspiration} />;
  const costume = await getCostume(slug);
  if (!costume || costume.pieces.length === 0 || costume.pieces.every(({ options }) => options.length === 0)) return <CostumePreview key={slug} costume={inspiration} />;
  return <CostumeExperience key={slug} costume={costume} />;
}

export default function CostumePage({ params }: { params: Params }) {
  return <main id="main" className="page costume-page">
    <Suspense fallback={<p className="loading-note">Loading costume…</p>}>
      <CostumeData params={params} />
    </Suspense>
  </main>;
}
