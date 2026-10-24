import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { costumes } from "@/lib/costumes";
import { Arrow } from "@/components/icons";
import { SaveLook } from "@/components/saved-looks";

export function generateStaticParams() {
  return costumes.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const costume = costumes.find((item) => item.slug === slug);
  return { title: costume ? `${costume.name} — Halloween Supply` : "Costume not found", description: costume?.description };
}

export default async function CostumePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const costume = costumes.find((item) => item.slug === slug);
  if (!costume) notFound();

  return <div className="shell">
    <header className="site-header"><Link href="/" className="wordmark">halloween.supply</Link><Link href="/" className="back-link">All costumes</Link></header>
    <main id="main" className="detail-layout">
      <div className="detail-image"><Image src={costume.image} alt={costume.alt} fill sizes="(max-width: 760px) 100vw, 55vw" preload /></div>
      <div className="detail-content">
        <h1>{costume.name}</h1>
        <p className="detail-description">{costume.description}</p>
        <SaveLook slug={costume.slug} name={costume.name} showLabel />
        <h2>What you’ll need</h2>
        <ul className="ingredients">{costume.pieces.map((piece) => <li key={piece}>{piece}</li>)}</ul>
        <p className="styling-note">{costume.tip}</p>
        <Link href="/" className="text-button">All costumes <Arrow /></Link>
      </div>
    </main>
    <footer className="site-footer">© 2026 halloween.supply</footer>
  </div>;
}
