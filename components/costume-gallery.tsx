"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { costumes } from "@/lib/costumes";
import { Arrow } from "./icons";
import { SaveLook, useSavedLooks } from "./saved-looks";

export function CostumeGallery() {
  const [savedOnly, setSavedOnly] = useState(false);
  const { saved } = useSavedLooks();
  const visible = savedOnly ? costumes.filter((costume) => saved.includes(costume.slug)) : costumes;

  return <>
    <header className="site-header shell">
      <Link href="/" className="wordmark" onClick={() => setSavedOnly(false)}>halloween.supply</Link>
      <nav aria-label="Costume views">
        <button aria-pressed={!savedOnly} onClick={() => setSavedOnly(false)}>Costumes</button>
        <button aria-pressed={savedOnly} onClick={() => setSavedOnly(true)}>Saved{saved.length > 0 && <span className="saved-count">{saved.length}</span>}</button>
      </nav>
    </header>
    <main id="main" className="shell">
      <h1 className="gallery-heading">{savedOnly ? "Saved costumes." : "Halloween costume ideas."}</h1>
      <div className="costume-grid" aria-label={savedOnly ? "Saved costumes" : "Costume ideas"}>
        {visible.map((costume, index) => <article className="costume-card" key={costume.slug}>
          <SaveLook slug={costume.slug} name={costume.name} />
          <Link href={`/costumes/${costume.slug}`} className="costume-link" aria-label={`View ${costume.name}`}>
            <div className="card-image"><Image src={costume.image} alt={costume.alt} fill sizes="(max-width: 600px) 100vw, (max-width: 960px) 50vw, 33vw" preload={index === 0} /></div>
            <div className="card-caption"><h2>{costume.name}</h2><Arrow /></div>
          </Link>
        </article>)}
      </div>
      {visible.length === 0 && <div className="empty-state"><p>No saved costumes yet.</p><p>Use the heart on a costume to save it.</p><button className="text-button" onClick={() => setSavedOnly(false)}>Browse costumes <Arrow /></button></div>}
    </main>
    <footer className="site-footer shell">© 2026 halloween.supply</footer>
  </>;
}
