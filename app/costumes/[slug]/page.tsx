import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { costumes } from "@/lib/costumes";
import { Arrow, Star } from "@/components/icons";
import { SaveLook } from "@/components/saved-looks";

export function generateStaticParams() {
  return costumes.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const costume = costumes.find((item) => item.slug === slug);
  return { title: costume ? `${costume.name} — Halloween Supply` : "Look not found", description: costume?.description };
}

export default async function CostumePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const costume = costumes.find((item) => item.slug === slug);
  if (!costume) notFound();
  return <div className="shell detail-shell">
    <header className="detail-header"><Link href="/" className="wordmark"><Star />halloween<span>.supply</span></Link><Link href="/#the-edit" className="back-link">← Back to the edit</Link></header>
    <main id="main" className="detail-layout">
      <div className={`detail-image costume-${costume.slug}`}><Image src={costume.image} alt={costume.alt} fill sizes="(max-width: 760px) 100vw, 55vw" preload /></div>
      <div className="detail-content"><span className="edition">THE HALLOWEEN EDIT / {costume.category.toUpperCase()}</span><h1>{costume.name}</h1><p className="detail-note">{costume.note}</p><p className="detail-description">{costume.description}</p><SaveLook slug={costume.slug} name={costume.name} showLabel /><div className="recipe-heading"><h2>The ingredients</h2><span>{costume.effort}</span></div><ul className="ingredients">{costume.pieces.map((piece) => <li key={piece}><span aria-hidden="true">+</span>{piece}</li>)}</ul><div className="styling-note"><span className="eyebrow">MAKE IT YOUR OWN</span><p>{costume.tip}</p></div><p className="concept-note">An original costume concept. Use the image as inspiration; this is not a product for sale.</p><Link href="/#the-edit" className="text-button">Explore the other looks <Arrow /></Link></div>
    </main>
    <footer className="site-footer"><span>Made for October 31.</span><span>© 2026 Halloween Supply</span></footer>
  </div>;
}
