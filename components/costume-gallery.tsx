"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { costumes } from "@/lib/costumes";
import { Arrow, Heart, Star } from "./icons";
import { SaveLook, useSavedLooks } from "./saved-looks";

const categories = ["All costumes", "The classics", "A little strange", "Into the woods"];

export function CostumeGallery() {
  const [category, setCategory] = useState("All costumes");
  const [savedOnly, setSavedOnly] = useState(false);
  const [sort, setSort] = useState("featured");
  const { saved } = useSavedLooks();
  const filtered = costumes.filter((costume) => (category === "All costumes" || costume.category === category) && (!savedOnly || saved.includes(costume.slug)));
  const visible = sort === "name" ? [...filtered].sort((a, b) => a.name.localeCompare(b.name)) : filtered;

  function showEdit() { setSavedOnly(false); setCategory("All costumes"); }

  return <>
    <header className="site-header shell">
      <Link href="/" className="wordmark" aria-label="Halloween Supply home" onClick={showEdit}><Star />halloween<span>.supply</span></Link>
      <nav aria-label="Main navigation">
        <a href="#the-edit" className={!savedOnly ? "nav-active" : ""} onClick={showEdit}>The edit</a>
        <a href="#about">Our approach</a>
      </nav>
      <a href="#the-edit" className={`saved-nav ${savedOnly ? "nav-active" : ""}`} onClick={() => { setSavedOnly(!savedOnly); setCategory("All costumes"); }}><Heart filled={savedOnly} /><span>Saved</span><span className="saved-count">{saved.length}</span></a>
    </header>

    <main id="main">
      <section className="hero shell" aria-labelledby="hero-title">
        <div className="edition"><span /> THE HALLOWEEN EDIT — 2026</div>
        <h1 id="hero-title">A little strange.<br />Very well dressed.</h1>
        <p>Five costume ideas for your annual identity crisis.<br className="desktop-break" /> Pick a look. Make it your own.</p>
        <a href="#the-edit" className="hero-cta" onClick={showEdit}>Find your alter ego <span aria-hidden="true">↘</span></a>
        <span className="hero-side-note">Good taste. Bad intentions.</span>
      </section>

      <section id="the-edit" className="collection shell" aria-label={savedOnly ? "Saved costume ideas" : "Costume ideas"}>
        <div className="collection-toolbar">
          <div className="filters" aria-label="Filter costumes">{categories.map((item) => <button key={item} aria-pressed={category === item} className={category === item ? "filter-active" : ""} onClick={() => setCategory(item)}>{item}<span>{String(item === "All costumes" ? costumes.length : costumes.filter((costume) => costume.category === item).length).padStart(2, "0")}</span></button>)}</div>
          <label className="sort-control"><span>Sort by:</span><select aria-label="Sort costumes" value={sort} onChange={(event) => setSort(event.target.value)}><option value="featured">Featured</option><option value="name">Name A–Z</option></select></label>
        </div>
        <div className="collection-caption" aria-live="polite"><span>{savedOnly ? "Your saved looks" : "A small collection. A big entrance."}</span><span>{String(visible.length).padStart(2, "0")} {visible.length === 1 ? "LOOK" : "LOOKS"}</span></div>
        <div className="costume-grid">
          {visible.map((costume) => <article className={`costume-card costume-${costume.slug}`} key={costume.slug}>
            <div className="card-visual">
              <span className="card-number">NO. {String(costumes.indexOf(costume) + 1).padStart(2, "0")}</span>
              <SaveLook slug={costume.slug} name={costume.name} />
              <Link className="costume-image-link" href={`/costumes/${costume.slug}`} aria-label={`Explore ${costume.name}`}><Image src={costume.image} alt={costume.alt} fill sizes="(max-width: 600px) 100vw, (max-width: 1000px) 50vw, 33vw" preload={costume.slug === "velvet-vampire"} /></Link>
              <span className="image-hint">MEET YOUR ALTER EGO <Arrow /></span>
            </div>
            <Link href={`/costumes/${costume.slug}`} className="card-caption"><div><span className="card-category">{costume.category}</span><h2>{costume.name}</h2><p>{costume.note}</p></div><Arrow /></Link>
          </article>)}
          {!savedOnly && category === "All costumes" && <aside className="editorial-card"><span className="eyebrow">A NOTE FROM THE OTHER SIDE</span><Star /><h2>One night.<br />Another you.</h2><p>The best costume is the one you can’t wait to put on.</p><a href="#about">A little about us <Arrow /></a></aside>}
        </div>
        {visible.length === 0 && <div className="empty-state"><Heart /><h2>{savedOnly ? "Your next identity is out there." : "No looks in this corner."}</h2><p>{savedOnly ? "Tap the heart on a costume to keep it here." : "Try another category to find your look."}</p><button className="text-button" onClick={showEdit}>Explore all five looks <Arrow /></button></div>}
      </section>

      <section id="about" className="about shell"><div><span className="eyebrow">DRESS UP. SHOW UP.</span><h2>A good excuse to<br />be someone else.</h2></div><div className="about-copy"><p>Halloween Supply is a small edit of costume ideas with a little more character. Familiar favorites, unexpected details, and looks worth making an entrance in.</p><p>These are original concepts to inspire your own outfit. Start with what you own, borrow the good bits, and make the rest your own.</p><a href="#the-edit" onClick={showEdit}>Back to the edit <span aria-hidden="true">↑</span></a></div></section>
    </main>
    <footer className="site-footer shell"><Link href="/" className="footer-brand"><Star />halloween.supply</Link><span>Made for October 31.</span><span>© 2026 Halloween Supply</span></footer>
  </>;
}
