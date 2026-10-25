import { cacheLife, cacheTag } from "next/cache";
import { CostumeGallery } from "@/components/costume-gallery";
import { readCatalogs } from "@/lib/catalog";

export default async function Home() {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  // Editorial styling notes can combine products. Count the actual shopping pieces.
  const { snapshots } = await readCatalogs();
  const pieceCounts = Object.fromEntries(snapshots.map(({ costume, pieces }) => [costume.slug, pieces.length]));
  return <CostumeGallery pieceCounts={pieceCounts} />;
}
