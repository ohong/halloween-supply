import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Image from "next/image";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { AssistantPanel } from "@/components/assistant/panel";
import { SaveLook } from "@/components/saved-looks";
import { Carousel } from "@/components/store/carousel";
import { AddWholeCostume, PieceList } from "@/components/store/piece-list";
import { SelectionProvider } from "@/components/store/selection";
import { getCostume } from "@/lib/catalog";
import { costumes, getLiveCostumeTile, type CostumeTile } from "@/lib/costumes";

// Only live costumes get a shop page; coming-soon tiles never link anywhere.
export function generateStaticParams() {
  return costumes.filter((c) => c.status === "live").map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const tile = getLiveCostumeTile(slug);
  if (!tile) return { title: "Costume not found" };
  return { title: tile.name, description: tile.description };
}

export default function CostumePage({ params }: { params: Promise<{ slug: string }> }) {
  // params is read below the Suspense boundary so the App Shell (skeleton) is instant
  // for every link; the live slug is prerendered, so direct visits get the full page.
  return <main id="main" className="shell">
    <Suspense fallback={<CostumeSkeleton />}><CostumeBySlug params={params} /></Suspense>
  </main>;
}

async function CostumeBySlug({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!getLiveCostumeTile(slug)) notFound();
  return <CostumeContent slug={slug} />;
}

function CostumeSkeleton() {
  return <div className="costume-page" aria-busy="true">
    <div className="costume-gallery-col"><div className="carousel-viewport" /></div>
    <div className="costume-info-col"><div className="costume-head"><span className="back-link">← All costumes</span></div></div>
  </div>;
}

/**
 * The whole costume page body. Cached for an hour so the shell is prerendered from
 * the precomputed catalog (FalkorDB, or the committed snapshot) and serves instantly.
 */
async function CostumeContent({ slug }: { slug: string }) {
  "use cache";
  cacheLife("minutes");

  const tile = getLiveCostumeTile(slug);
  if (!tile) return null;
  const view = await getCostume(slug);

  const head = (
    <div className="costume-head">
      <Link href="/" className="back-link">← All costumes</Link>
      <h1 className="costume-title">{tile.name}</h1>
      <p className="costume-desc">{tile.description}</p>
    </div>
  );

  if (!view || view.pieces.length === 0) {
    return <div className="costume-page">
      <div className="costume-gallery-col"><HeroPanel tile={tile} /></div>
      <div className="costume-info-col">
        {head}
        <SaveLook slug={tile.slug} name={tile.name} showLabel />
        <Sourcing tile={tile} />
      </div>
    </div>;
  }

  // The knolled flat-lay is composed by the sourcing pipeline; until it exists the
  // carousel builds a CSS flat-lay from the current picks.
  const flatlay = existsSync(join(process.cwd(), "public", "products", `${slug}-flatlay.jpg`)) ? `/products/${slug}-flatlay.jpg` : null;

  return <SelectionProvider view={view}>
    <div className="costume-page">
      <div className="costume-gallery-col"><Carousel flatlay={flatlay} flatlayAlt={`${view.costume.name}: every piece laid out together`} /></div>
      <div className="costume-info-col">
        {head}
        <div className="head-actions"><AddWholeCostume /><SaveLook slug={tile.slug} name={tile.name} showLabel /></div>
        <PieceList />
        <section className="assistant-wrap" id="assistant" aria-label="Shopping assistant">
          <h2>Shopping assistant</h2>
          <AssistantPanel costume={view} />
        </section>
      </div>
    </div>
  </SelectionProvider>;
}

function HeroPanel({ tile }: { tile: CostumeTile }) {
  return <div className="carousel-viewport" style={{ overflow: "hidden", position: "relative" }}>
    <div className="slide"><Image src={tile.image} alt={tile.alt} fill sizes="(max-width: 999px) 100vw, 55vw" className="slide-img" preload /></div>
  </div>;
}

function Sourcing({ tile }: { tile: CostumeTile }) {
  return <section className="sourcing" aria-labelledby="sourcing-title">
    <h2 id="sourcing-title">Sourcing in progress</h2>
    <p>We’re choosing each piece from independent shops, vintage stores and Etsy sellers. They’ll appear here, ready to add to your cart, as soon as they’re confirmed.</p>
    <ul className="sourcing-list">
      {tile.pieces.map((name) => <li key={name}><span>{name}</span><span className="mono">Sourcing</span></li>)}
    </ul>
  </section>;
}
