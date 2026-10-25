"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { costumes } from "@/lib/costumes";
import { modelImage, useCostumeModel } from "@/lib/model-selection";
import { SaveLook, useSavedLooks } from "./saved-looks";

export function CostumeGallery() {
  const [savedOnly, setSavedOnly] = useState(false);
  const { model, setModel } = useCostumeModel();
  const { saved } = useSavedLooks();
  const visible = [...costumes].filter((costume) => !savedOnly || saved.includes(costume.slug))
    .sort((a, b) => Number(b.status === "live") - Number(a.status === "live"));

  return <main id="main">
    <div className="page home-bar">
      <h1 className="home-title">{savedOnly ? "Saved costumes" : "Halloween costumes, built from pieces."}</h1>
      <div className="home-controls">
        <Link href="/screenshot" className="btn btn-small">Turn a screenshot into a costume</Link>
        <div className="view-toggle" role="group" aria-label="Model">
          <button type="button" aria-pressed={model === "male"} onClick={() => setModel("male")}>Male</button>
          <button type="button" aria-pressed={model === "female"} onClick={() => setModel("female")}>Female</button>
        </div>
        <nav className="view-toggle" aria-label="Costume views">
          <button type="button" aria-pressed={!savedOnly} onClick={() => setSavedOnly(false)}>All</button>
          <button type="button" aria-pressed={savedOnly} onClick={() => setSavedOnly(true)}>Saved{saved.length > 0 && <span className="saved-count">{saved.length}</span>}</button>
        </nav>
      </div>
    </div>
    <div className="mosaic page" aria-label={savedOnly ? "Saved costumes" : "Costumes"}>
      {visible.map((costume, index) => {
        const live = costume.status === "live";
        const picture = <>
          <span className="tile-picture">
            <Image src={modelImage(costume.slug, model)} alt={`${costume.name} worn by our ${model} model. ${costume.alt}`} fill sizes="(min-width: 1200px) 20vw, (min-width: 768px) 33vw, 50vw" preload={index === 0} />
          </span>
          <span className="tile-caption">
            <span className="tile-name">{costume.name}</span>
            {!live && <span className="tile-kind">Style guide</span>}
          </span>
        </>;
        return <div className="tile" key={costume.slug}>
          <Link href={`/costumes/${costume.slug}`} className="tile-body" aria-label={`View ${costume.name}${live ? "" : " style guide"}`}>{picture}</Link>
          <SaveLook slug={costume.slug} name={costume.name} />
        </div>;
      })}
    </div>
    {visible.length === 0 && <div className="empty-state page"><p>No saved costumes yet.</p><p>Use the heart on a tile to save it.</p><button type="button" className="btn" onClick={() => setSavedOnly(false)}>Browse costumes</button></div>}
  </main>;
}
