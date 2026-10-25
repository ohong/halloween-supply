"use client";

/* Photos and generated images are temporary browser memory, never localStorage. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { costumes } from "@/lib/costumes";
import "./virtual-try-on.css";

type Selection = { pieceId: string; productId: string }[];
type Result = { image: string; label: string; slug: string; key: string };

async function preparePhoto(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP photo.");
  if (file.size > 15 * 1024 * 1024) throw new Error("Choose a photo smaller than 15 MB.");
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 32_000_000 || Math.min(image.width, image.height) < 256) throw new Error("Choose a photo at least 256 pixels wide and tall, and no larger than 32 megapixels.");
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare your photo. Try another browser.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .9));
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error("This photo is too large. Please choose a smaller one.");
    return blob;
  } finally { image.close(); }
}

export function VirtualTryOn({ costumeSlug, selection = [], ownedPieceIds = [], skippedPieceIds = [] }: {
  costumeSlug: string; selection?: Selection; ownedPieceIds?: string[]; skippedPieceIds?: string[];
}) {
  const [slug, setSlug] = useState(costumeSlug);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [showOriginal, setShowOriginal] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const uploadVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const ownSelection = slug === costumeSlug;
  const outfitKey = JSON.stringify([slug, ownSelection ? selection : [], ownSelection ? ownedPieceIds : [], ownSelection ? skippedPieceIds : []]);
  const selectedCostume = costumes.find((item) => item.slug === slug)!;
  const result = results.find((item) => item.key === outfitKey);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const version = ++uploadVersion.current;
    controller.current?.abort();
    setBusy(false); setPreparing(true); setError(""); setResults([]); setConsent(false); setPhoto(null); setPhotoUrl("");
    try {
      const prepared = await preparePhoto(file);
      if (version !== uploadVersion.current) return;
      setPhoto(prepared);
      setPhotoUrl(URL.createObjectURL(prepared));
    } catch (caught) { if (version === uploadVersion.current) setError(caught instanceof Error ? caught.message : "This photo could not be opened."); }
    finally { if (version === uploadVersion.current) setPreparing(false); }
  }

  function removePhoto() {
    uploadVersion.current++;
    controller.current?.abort();
    setPhoto(null); setPhotoUrl(""); setResults([]); setConsent(false); setBusy(false); setPreparing(false); setError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function generate() {
    if (!photo || !consent || busy) return;
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true); setError(""); setShowOriginal(false);
    const form = new FormData();
    form.set("photo", photo, "photo.jpg"); form.set("costumeSlug", slug); form.set("consent", "true");
    form.set("selection", JSON.stringify(ownSelection ? selection : []));
    form.set("ownedPieceIds", JSON.stringify(ownSelection ? ownedPieceIds : []));
    form.set("skippedPieceIds", JSON.stringify(ownSelection ? skippedPieceIds : []));
    try {
      const response = await fetch("/api/try-on", { method: "POST", body: form, signal: requestController.signal });
      const data: unknown = await response.json();
      if (!data || typeof data !== "object") throw new Error("The preview could not be read. Please try again.");
      if ("error" in data && typeof data.error === "string") throw new Error(data.error);
      if (!response.ok || !("image" in data) || typeof data.image !== "string" || !data.image.startsWith("data:image/jpeg;base64,")) throw new Error("The preview could not be created. Please try again.");
      if (requestController.signal.aborted) return;
      setResults((current) => [{ image: data.image as string, label: selectedCostume.name, slug, key: outfitKey }, ...current.filter((item) => item.key !== outfitKey)].slice(0, 6));
    } catch (caught) { if (!requestController.signal.aborted) setError(caught instanceof Error ? caught.message : "The preview could not be created. Please try again."); }
    finally { if (controller.current === requestController) setBusy(false); }
  }

  return <section className={"virtual-try-on-tryOn"} aria-labelledby={`try-on-${costumeSlug}`}>
    <div className={"virtual-try-on-heading"}><h2 id={`try-on-${costumeSlug}`}>See yourself in it.</h2><span className="pill">Virtual try-on</span></div>
    <p className={"virtual-try-on-note"}>One full-body photo. A different costume, still you.</p>
    <label className={"virtual-try-on-upload"}>Your full-body photo<input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload} disabled={preparing} /><span>JPEG, PNG or WebP · up to 15 MB. Include your head and feet, with only you in the photo.</span></label>
    {preparing && <p role="status" className={"virtual-try-on-note"}>Preparing your photo…</p>}
    {photoUrl && <>
      <figure className={"virtual-try-on-preview"} aria-busy={busy}><img src={result && !showOriginal ? result.image : photoUrl} alt={result && !showOriginal ? `Generated preview of you in ${result.label}` : "Your uploaded full-body photo"} /><figcaption>{result && !showOriginal ? `${result.label} · AI preview` : "Your original photo"}</figcaption></figure>
      {result && <div className={"virtual-try-on-actions"}><button className="text-btn" type="button" onClick={() => setShowOriginal((value) => !value)}>{showOriginal ? "Show costume" : "Show original"}</button><a className="text-btn" href={result.image} download={`${slug}-try-on.jpg`}>Download preview ↓</a></div>}
      <label className={"virtual-try-on-costume"}>Try a costume<select value={slug} disabled={busy} onChange={(event) => { setSlug(event.target.value); setError(""); setShowOriginal(false); }}>{costumes.map((costume) => <option key={costume.slug} value={costume.slug}>{costume.name}{costume.status !== "live" ? " · inspiration" : ""}</option>)}</select></label>
      <p className={"virtual-try-on-note"}>{ownSelection && selection.length ? "Uses your selected products and wardrobe choices." : "Uses the costume inspiration image. This look may include pieces that are not for sale yet."} An appearance preview; fit, fabric and product details can differ.</p>
      <label className={"virtual-try-on-consent"}><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>This is my photo. I agree to send it to OpenAI to create a costume preview.</span></label>
      <button className="btn btn-block" type="button" disabled={!consent || busy || preparing} onClick={generate}>{busy ? "Creating your preview…" : result ? "Create another preview" : "Try this costume on"}</button>
      {busy && <p role="status" className={"virtual-try-on-note"}>Checking your photo, then dressing you in the look. This can take a few minutes. Keep this page open.</p>}
      <div className={"virtual-try-on-actions"}>{busy && <button className="text-btn" type="button" onClick={() => { controller.current?.abort(); setBusy(false); }}>Cancel</button>}<button className="text-btn" type="button" onClick={removePhoto}>Remove photo & previews</button></div>
      {results.length > 1 && <div className={"virtual-try-on-gallery"} aria-label="Your costume previews">{results.map((item, index) => <a key={`${item.key}-${index}`} href={item.image} download={`${item.slug}-try-on.jpg`}><img src={item.image} alt={`Download your ${item.label} preview`} /><span>{item.label} ↓</span></a>)}</div>}
    </>}
    {error && <p className={"virtual-try-on-error"} role="alert">{error}</p>}
    <p className={"virtual-try-on-privacy"}>Your photo is sent only when you request a preview. This app does not save photos or previews to its database. Remove them here or reload to clear them. OpenAI processes uploads under its API data policies.</p>
  </section>;
}
