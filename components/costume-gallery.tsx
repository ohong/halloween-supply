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

  return <div className="shell">
    <div className="home-intro">
      <div>
        <h1 className="home-title">{savedOnly ? "Saved costumes." : "Halloween costumes, built from individual pieces."}</h1>
        {!savedOnly && <p className="home-sub">A hat from a western-wear shop, a shirt from a vintage store, boots from a niche bootmaker. One checkout.</p>}
      </div>
      <nav className="view-switch" aria-label="Costume views">
        <button type="button" aria-pressed={!savedOnly} onClick={() => setSavedOnly(false)}>Costumes</button>
        <button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly(true)}>Saved{saved.length > 0 && <span className="saved-count">{saved.length}</span>}</button>
      </nav>
    </div>
    <div className={`mosaic ${savedOnly ? "" : "is-featured"}`} aria-label={savedOnly ? "Saved costumes" : "Costume ideas"}>
      {visible.map((costume, index) => {
        const live = costume.status === "live";
        return <article className={`tile ${live ? "is-live" : "is-soon"}`} key={costume.slug}>
          {live && <Link href={`/costumes/${costume.slug}`} className="tile-link" aria-label={`View ${costume.name}`} />}
          <div className="tile-media"><Image src={costume.image} alt={costume.alt} fill sizes="(max-width: 899px) 50vw, 25vw" preload={index === 0} /></div>
          <div className="tile-caption">
            <h2 className="tile-name">{costume.name}</h2>
            {live ? <Arrow /> : <span className="tile-meta mono">Coming soon</span>}
          </div>
          <SaveLook slug={costume.slug} name={costume.name} />
        </article>;
      })}
    </div>
    {visible.length === 0 && <div className="empty-state"><p>No saved costumes yet.</p><p>Use the heart on a costume to save it.</p><button type="button" className="btn btn-quiet" onClick={() => setSavedOnly(false)}>Browse costumes</button></div>}
  </div>;
}
