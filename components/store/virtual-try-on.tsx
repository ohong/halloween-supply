"use client";

/* Photos and generated images are temporary browser memory, never localStorage. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { formatPrice } from "@/lib/cart/context";
import { costumes } from "@/lib/costumes";
import { composeShareCard, lookUrl } from "@/lib/share-card";
import "./virtual-try-on.css";

type Selection = { pieceId: string; productId: string }[];

// Re-encode camera and library images the browser can decode as JPEGs under 3 MB.
async function preparePhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a photo.");
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); } catch { throw new Error("This photo could not be opened. Try another one."); }
  try {
    if (Math.min(image.width, image.height) < 256) throw new Error("This photo is too small. Try a larger one.");
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare your photo. Try another browser.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .88));
    if (!blob || blob.size > 3 * 1024 * 1024) throw new Error("This photo is too large. Try another one.");
    return blob;
  } finally { image.close(); }
}

const Icon = ({ d, size = 22 }: { d: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const CAMERA = "M3 8.5A2.5 2.5 0 0 1 5.5 6h2l1.5-2h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5zM12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z";
const SPARKLE = "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z";
const SAVE = "M12 4v11m0 0l-4-4m4 4l4-4M5 20h14";
const CLOSE = "M6 6l12 12M18 6L6 18";
const SHARE = "M12 15V4m0 0L8 8m4-4l4 4M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5";

export function VirtualTryOn({ costumeSlug, selection = [], ownedPieceIds = [], skippedPieceIds = [], totalCents = 0 }: {
  costumeSlug: string; selection?: Selection; ownedPieceIds?: string[]; skippedPieceIds?: string[]; totalCents?: number;
}) {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ image: string; key: string } | null>(null);
  const [peek, setPeek] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const uploadVersion = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const costume = costumes.find((item) => item.slug === costumeSlug)!;
  const outfitKey = JSON.stringify([costumeSlug, selection, ownedPieceIds, skippedPieceIds]);
  const current = result?.key === outfitKey ? result : null;
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  // Compose the card as soon as the preview lands. Safari drops the tap's share
  // permission if the canvas work happens after the tap.
  const [card, setCard] = useState<{ file: File; key: string } | null>(null);
  const [shareNote, setShareNote] = useState("");
  const detail = totalCents > 0 ? `The whole look · ${formatPrice(totalCents)}` : "The whole look";
  useEffect(() => {
    if (!current) return;
    let live = true;
    composeShareCard(current.image, { name: costume.name, detail })
      .then((file) => { if (live) setCard({ file, key: current.key }); })
      .catch(() => { if (live) setCard(null); });
    return () => { live = false; };
  }, [current, costume.name, detail]);
  const readyCard = card && current && card.key === current.key ? card.file : null;

  async function share() {
    if (!readyCard) return;
    const url = lookUrl(location.origin, costumeSlug, selection.map((item) => item.productId));
    const data = { files: [readyCard], title: costume.name, text: `Me as the ${costume.name}`, url };
    if (navigator.canShare?.(data)) {
      try { await navigator.share(data); } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setShareNote("Sharing did not work. Save the image instead.");
      }
      return;
    }
    // Desktop browsers rarely share files: save the card and copy the look link.
    const link = document.createElement("a");
    link.href = URL.createObjectURL(readyCard);
    link.download = readyCard.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    try { await navigator.clipboard.writeText(url); setShareNote("Card saved. Link copied."); }
    catch { setShareNote("Card saved."); }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const version = ++uploadVersion.current;
    controller.current?.abort();
    setBusy(false); setPreparing(true); setError(""); setResult(null); setPeek(false);
    try {
      const prepared = await preparePhoto(file);
      if (version !== uploadVersion.current) return;
      setPhoto(prepared);
      setPhotoUrl(URL.createObjectURL(prepared));
    } catch (caught) { if (version === uploadVersion.current) setError(caught instanceof Error ? caught.message : "This photo could not be opened."); }
    finally { if (version === uploadVersion.current) setPreparing(false); }
  }

  function reset() {
    uploadVersion.current++;
    controller.current?.abort();
    setPhoto(null); setPhotoUrl(""); setResult(null); setBusy(false); setPreparing(false); setError(""); setPeek(false);
  }

  // Tapping the primary button is the consent; the disclosure sits directly under it.
  async function generate() {
    if (!photo || busy) return;
    const requestController = new AbortController();
    controller.current = requestController;
    setBusy(true); setError(""); setShareNote("");
    const form = new FormData();
    form.set("photo", photo, "photo.jpg"); form.set("costumeSlug", costumeSlug); form.set("consent", "true");
    form.set("selection", JSON.stringify(selection));
    form.set("ownedPieceIds", JSON.stringify(ownedPieceIds));
    form.set("skippedPieceIds", JSON.stringify(skippedPieceIds));
    try {
      const response = await fetch("/api/try-on", { method: "POST", body: form, signal: requestController.signal });
      const data: unknown = await response.json().catch(() => null);
      if (data && typeof data === "object" && "error" in data && typeof data.error === "string") throw new Error(data.error);
      if (!response.ok || !data || typeof data !== "object" || !("image" in data) || typeof data.image !== "string" || !data.image.startsWith("data:image/jpeg;base64,")) throw new Error("The preview could not be created. Please try again.");
      if (!requestController.signal.aborted) setResult({ image: data.image, key: outfitKey });
    } catch (caught) { if (!requestController.signal.aborted) setError(caught instanceof Error ? caught.message : "The preview could not be created. Please try again."); }
    finally { if (controller.current === requestController) setBusy(false); }
  }

  const showResult = current && !peek;
  return <section className="try-on" aria-label={`Try on ${costume.name}`}>
    <input ref={fileInput} className="try-on-file" type="file" accept="image/*" onChange={upload} tabIndex={-1} aria-hidden="true" />
    <input ref={cameraInput} className="try-on-file" type="file" accept="image/*" capture="environment" onChange={upload} tabIndex={-1} aria-hidden="true" />
    {!photoUrl ? (
      <button type="button" className="try-on-stage try-on-empty" onClick={() => fileInput.current?.click()} disabled={preparing} aria-label="Add a full-body photo of yourself">
        <img src={costume.image} alt="" className="try-on-ghost" />
        <span className="try-on-cta"><Icon d={CAMERA} size={30} /></span>
        <span className="try-on-title">See yourself in it</span>
      </button>
    ) : (
      <figure className={`try-on-stage${busy ? " is-busy" : ""}`}
        onPointerDown={() => current && setPeek(true)} onPointerUp={() => setPeek(false)} onPointerLeave={() => setPeek(false)} onPointerCancel={() => setPeek(false)}
        onContextMenu={(event) => current && event.preventDefault()}>
        <img src={showResult ? current.image : photoUrl} alt={showResult ? `You in ${costume.name}, AI preview` : "Your photo"} draggable={false} />
        {busy && <span className="try-on-progress" role="status" aria-label="Creating your preview"><span /></span>}
        {current && <span className={`try-on-badge${peek ? " is-on" : ""}`} aria-hidden="true">{peek ? "Before" : "After"}</span>}
        <button type="button" className="try-on-close" onClick={reset} aria-label="Remove photo"><Icon d={CLOSE} size={18} /></button>
      </figure>
    )}
    {!busy && <>
      <div className="try-on-actions try-on-photo-actions">
        <button type="button" className="btn btn-ghost try-on-camera" onClick={() => cameraInput.current?.click()} disabled={preparing}><Icon d={CAMERA} size={18} />{photoUrl ? "Retake photo" : "Take photo"}</button>
        <button type="button" className="btn btn-ghost" onClick={() => fileInput.current?.click()} disabled={preparing}>{photoUrl ? "Change photo" : "Upload photo"}</button>
      </div>
      {!photoUrl && <p className="try-on-fine" role="status">{preparing ? "Preparing your photo…" : "Use a full-body photo with just you in the frame."}</p>}
    </>}
    {photoUrl && <div className="try-on-actions">
      {current ? <>
        <button type="button" className="btn try-on-primary" onClick={share} disabled={!readyCard}><Icon d={SHARE} size={18} />Share</button>
        <a className="btn btn-ghost try-on-icon" href={current.image} download={`${costumeSlug}-try-on.jpg`} aria-label="Save preview"><Icon d={SAVE} size={18} /></a>
        <button type="button" className="btn btn-ghost" aria-pressed={peek} onClick={() => setPeek((value) => !value)}>{peek ? "Show preview" : "Show original"}</button>
      </> : busy ? (
        <button type="button" className="btn btn-ghost btn-block" onClick={() => { controller.current?.abort(); setBusy(false); }}>Cancel</button>
      ) : (
        <button type="button" className="btn btn-block try-on-primary" onClick={generate} disabled={preparing}><Icon d={SPARKLE} size={18} />{preparing ? "Preparing photo…" : "Try it on"}</button>
      )}
    </div>}
    {current && shareNote && <p className="try-on-fine" role="status">{shareNote}</p>}
    {error && <p className="try-on-error" role="alert">{error}</p>}
    {photoUrl && !current && !busy && <p className="try-on-fine">Tapping sends your photo to OpenAI for a preview. This app does not save your photo or preview. OpenAI processes uploads under its API data policies.</p>}
  </section>;
}
