"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowUpRight, Camera, Heart, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { costumes } from "@/lib/costumes";
import { localSearch, normalizeSearchQuery, type SearchResponse } from "@/lib/costume-search";
import type { CustomLookEvent, CustomPiece } from "@/lib/custom-looks/types";
import { modelImage, useCostumeModel } from "@/lib/model-selection";
import { SaveLook, useSavedLooks } from "./saved-looks";
import "./landing-search.css";

type Refinement = { key: string; response: SearchResponse; failed: boolean };
type Creation = {
  phase: "running" | "error";
  name: string;
  message: string;
  pieces: { piece: CustomPiece; state: "looking" | "found" | "missing" }[];
};

export function CostumeGallery({ pieceCounts }: { pieceCounts: Record<string, number> }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [refinement, setRefinement] = useState<Refinement | null>(null);
  const [creation, setCreation] = useState<Creation | null>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const { model, setModel } = useCostumeModel();
  const { saved } = useSavedLooks();
  const input = useRef<HTMLInputElement>(null);
  const creationAbort = useRef<AbortController | null>(null);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const normalized = normalizeSearchQuery(query);
  const queryKey = normalized.toLowerCase();
  const searchKey = `${queryKey}:${retry}`;
  const local = localSearch(normalized);
  const resolved = refinement?.key === searchKey ? refinement : null;
  const result = resolved?.response ?? local;
  const pending = normalized.length >= 2 && (composing || !resolved);
  const running = creation?.phase === "running";
  const bySlug = new Map(costumes.map((costume) => [costume.slug, costume]));
  // Saved is a view of global results, never evidence that a costume is absent.
  const visible = result.matches.flatMap(({ slug }) => {
    const costume = bySlug.get(slug);
    return costume && (!savedOnly || saved.includes(slug)) ? [costume] : [];
  });
  const offerCreation = !savedOnly && normalized.length >= 3 && !pending && !result.hasStrongMatch;

  useEffect(() => {
    if (composing || normalized.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/costume-search", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: normalized }), signal: controller.signal,
        });
        if (!response.ok) throw new Error("Search is unavailable.");
        const found = await response.json() as SearchResponse;
        if (controller.signal.aborted || normalizeSearchQuery(found.query).toLowerCase() !== queryKey) return;
        setRefinement({ key: searchKey, response: found, failed: found.source === "local" });
      } catch {
        if (!controller.signal.aborted) setRefinement({ key: searchKey, response: localSearch(normalized), failed: true });
      }
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [composing, normalized, queryKey, searchKey]);

  useEffect(() => () => creationAbort.current?.abort(), []);

  function clearSearch() {
    setQuery("");
    setCreation(null);
    input.current?.focus();
  }

  async function createLook() {
    if (creationAbort.current || normalized.length < 3) return;
    const key = `${queryKey}:${model}`;
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    const requestId = attempt.current.id;
    const controller = new AbortController();
    creationAbort.current = controller;
    setCreation({ phase: "running", name: normalized, message: "Planning the pieces…", pieces: [] });
    try {
      const response = await fetch("/api/custom-looks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: normalized, model, requestId }), signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null) as { error?: string; retryWithNewRequestId?: boolean } | null;
        // Only the server can release a failed attempt for a new paid run.
        if (body?.retryWithNewRequestId) attempt.current = null;
        throw new Error(body?.error ?? "This look could not be created. Please try again.");
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let finished = false;
      function receive(raw: string) {
        if (!raw.trim() || controller.signal.aborted) return;
        const event = JSON.parse(raw) as CustomLookEvent;
        if (event.t === "look") setCreation({ phase: "running", name: event.name, message: "Finding the pieces…", pieces: event.pieces.map((piece) => ({ piece, state: "looking" })) });
        else if (event.t === "log") setCreation((current) => current ? { ...current, message: event.text } : current);
        else if (event.t === "piece" || event.t === "miss") setCreation((current) => current ? {
          ...current, pieces: current.pieces.map((piece, i) => i === event.i ? { ...piece, state: event.t === "piece" ? "found" : "missing" } : piece),
        } : current);
        else if (event.t === "error") {
          if (event.retryWithNewRequestId) attempt.current = null;
          throw new Error(event.text);
        }
        else if (event.t === "done") {
          if (!/^\/create\/[0-9a-f-]{36}$/i.test(event.href)) throw new Error("The saved look could not be opened.");
          finished = true;
          setCreation((current) => current ? { ...current, message: "Opening your look…" } : current);
          router.push(event.href);
        }
      }
      while (true) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) return;
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(receive);
      }
      receive(buffer);
      if (!finished) throw new Error("The connection stopped. Try again to check this look.");
    } catch (caught) {
      if (!controller.signal.aborted) setCreation((current) => ({
        phase: "error", name: current?.name ?? normalized, pieces: current?.pieces ?? [],
        message: caught instanceof Error ? caught.message : "This look could not be created. Please try again.",
      }));
    } finally {
      if (creationAbort.current === controller) creationAbort.current = null;
    }
  }

  return <main id="main" className="home-page page">
    <section className="landing-search" aria-labelledby="costume-search-heading">
      <h1 id="costume-search-heading">What will you be?</h1>
      <p className="landing-description">Discover costume ideas, try them on, and shop the whole look.</p>
      <form role="search" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="costume-search" className="sr-only">Search costumes</label>
        <div className="costume-search-field">
          <Search size={19} aria-hidden="true" />
          <input ref={input} id="costume-search" type="search" value={query} maxLength={160} autoComplete="off" spellCheck={false}
            placeholder="Vampire, fairy, space cowboy…" disabled={running} aria-controls="costume-results" aria-describedby="costume-search-status"
            onChange={(event) => { setQuery(event.target.value); setCreation(null); }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => { setQuery(event.currentTarget.value); setComposing(false); }}
            onKeyDown={(event) => { if (event.key === "Escape" && !running && !composing) { event.preventDefault(); clearSearch(); } }} />
          {query && !running && <Button variant="ghost" size="icon" className="search-clear" onClick={clearSearch} aria-label="Clear search"><X aria-hidden="true" /></Button>}
        </div>
      </form>
      <div className="search-hints">
        <div className="search-suggestions" role="group" aria-label="Search ideas"><span>Try</span>{["Vampire", "Space", "Woodland"].map((idea) => <Button key={idea} variant="ghost" size="sm" disabled={running} onClick={() => { setQuery(idea); setCreation(null); }}>{idea}</Button>)}</div>
        <Link href="/screenshot" className="search-screenshot"><Camera size={15} aria-hidden="true" />Use a screenshot<ArrowUpRight size={14} aria-hidden="true" /></Link>
      </div>
    </section>

    <section className="costume-collection" aria-labelledby="costume-collection-heading">
      <div className="gallery-heading">
        <div><h2 id="costume-collection-heading">{savedOnly ? "Your saved looks" : normalized ? "Find your look" : "Explore costumes"}</h2>
          <p id="costume-search-status" className="search-status" role="status" aria-live="polite" aria-atomic="true">
            {visible.length} {visible.length === 1 ? "look" : "looks"}{normalized && <> for “{normalized}”</>}
            {pending && <span> · Finding related looks…</span>}
            {!pending && resolved?.failed && <span> · Local matches</span>}
          </p>
        </div>
        <div className="gallery-controls">
          <div className="gallery-views" role="group" aria-label="Costume views">
            <Button variant="ghost" aria-pressed={!savedOnly} disabled={running} onClick={() => setSavedOnly(false)}>All looks</Button>
            <Button variant="ghost" aria-pressed={savedOnly} disabled={running} onClick={() => setSavedOnly(true)}><Heart aria-hidden="true" />Saved{saved.length > 0 && <span className="saved-count">{saved.length}</span>}</Button>
          </div>
          <div className="gallery-model"><label htmlFor="gallery-model">Model</label><select id="gallery-model" value={model} disabled={running} onChange={(event) => setModel(event.target.value === "male" ? "male" : "female")}><option value="female">Female</option><option value="male">Male</option></select></div>
        </div>
      </div>

    {creation ? <section className="search-creation" aria-label="Creating your costume" aria-busy={running}>
      <div className="search-creation-heading"><h2>{creation.name}</h2>
        <button type="button" className="text-btn" onClick={() => { creationAbort.current?.abort(); creationAbort.current = null; setCreation(null); input.current?.focus(); }}>{running ? "Cancel" : "Dismiss"}</button>
      </div>
      <p className="search-creation-message" role={creation.phase === "error" ? "alert" : "status"}>{creation.message}</p>
      {creation.pieces.length > 0 && <ul className="search-creation-pieces">{creation.pieces.map(({ piece, state }, i) => <li key={`${piece.slot}:${i}`}><span>{piece.name}</span><span>{state === "found" ? "Found" : state === "missing" ? "Not found" : "Searching…"}</span></li>)}</ul>}
      {creation.phase === "error" && <button type="button" className="btn btn-small" onClick={() => void createLook()}>Try again</button>}
    </section> : offerCreation && <div className="search-create-row">
      <div><h3>No exact match yet</h3><p>Try another search, or create a look for “{normalized}”.</p></div>
      <div className="search-create-actions"><Button onClick={() => void createLook()}>Create this look<ArrowRight aria-hidden="true" /></Button>
      {resolved?.failed && <Button variant="outline" onClick={() => setRetry((value) => value + 1)}>Retry search</Button>}</div>
    </div>}

    <ul id="costume-results" className="mosaic" aria-label={savedOnly ? "Saved costumes" : "Costumes"}>
      {visible.map((costume, index) => {
        const live = costume.status === "live";
        const count = pieceCounts[costume.slug];
        const detail = !live ? "Style guide" : count ? `${count} pieces` : "Shop the look";
        return <li className="tile" key={costume.slug}>
          <Link href={`/costumes/${costume.slug}`} className="tile-body" aria-label={`View ${costume.name}${live ? "" : " style guide"}`}>
            <span className="tile-picture"><Image src={modelImage(costume.slug, model)} alt={`${costume.name} worn by our ${model} model. ${costume.alt}`} fill sizes="(min-width: 1360px) 300px, (min-width: 1100px) 25vw, (min-width: 700px) 33vw, 50vw" preload={index === 0} /></span>
            <span className="tile-caption"><span className="tile-name">{costume.name}</span><span className="tile-detail"><span>{detail}</span><ArrowUpRight size={15} aria-hidden="true" /></span></span>
          </Link>
          <SaveLook slug={costume.slug} name={costume.name} />
        </li>;
      })}
    </ul>
    {visible.length === 0 && savedOnly && <div className="empty-state">
      <Heart size={24} aria-hidden="true" />
      <h3>{normalized ? "No saved looks match" : "Keep your favorites here"}</h3>
      <p>{normalized ? "Try a different search, or explore all costumes." : "Tap the heart on a costume to save it for later."}</p>
      <Button variant="outline" onClick={() => setSavedOnly(false)}>{normalized ? "Search all looks" : "Explore costumes"}<ArrowRight aria-hidden="true" /></Button>
    </div>}
    </section>
  </main>;
}
