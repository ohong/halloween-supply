import { cacheLife, cacheTag } from "next/cache";
import { CostumeGallery } from "@/components/costume-gallery";
import { readCatalogs } from "@/lib/catalog";
import type { Metadata } from "next";
import { CostumeGuideDirectory } from "@/components/costume-guide-directory";
import { organizationSchema, site } from "@/lib/agent/site";
import { listKits, summarizeCostumes } from "@/lib/kits";

export const metadata: Metadata = { alternates: { canonical: "/" } };

export default async function Home() {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  // Editorial styling notes can combine products. Count the actual shopping pieces.
  const { snapshots } = await readCatalogs();
  const pieceCounts = Object.fromEntries(snapshots.map(({ costume, pieces }) => [costume.slug, pieces.length]));
  const kits = listKits(snapshots);
  const priceSummaries = summarizeCostumes(snapshots);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      organizationSchema(),
      { "@type": "WebSite", "@id": `${site.url}/#website`, url: site.url, name: site.name, description: site.description, inLanguage: "en", publisher: { "@id": `${site.url}/#organization` } },
    ],
  };
  return <>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }} />
    <CostumeGallery pieceCounts={pieceCounts} kits={kits} priceSummaries={priceSummaries}><CostumeGuideDirectory /></CostumeGallery>
  </>;
}
