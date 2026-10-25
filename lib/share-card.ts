// Share cards are composed in the browser from the in-memory preview, so the
// photo never leaves the device unless the guest shares it themselves.

import type { MirrorMix } from "./live-mirror/types";

const W = 1080;
const H = 1920;
const FOOTER = 300;

export const lookParam = "look";

export function lookUrl(origin: string, costumeSlug: string, productIds: string[], mixes?: MirrorMix[]) {
  const url = new URL(`/costumes/${costumeSlug}`, origin);
  if (productIds.length > 0) url.searchParams.set(lookParam, productIds.join(","));
  if (mixes?.length) url.searchParams.set("mix", JSON.stringify(mixes));
  return url.toString();
}

export function readLook(search: string): string[] {
  return (new URLSearchParams(search).get(lookParam) ?? "").split(",").filter((id) => /^[\w-]{1,80}$/.test(id)).slice(0, 25);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The preview could not be drawn."));
    image.src = src;
  });
}

export async function composeShareCard(preview: string, { name, detail }: { name: string; detail: string }): Promise<File> {
  const image = await loadImage(preview);
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The share card could not be drawn.");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  // Cover-crop the preview into the area above the footer.
  const area = H - FOOTER;
  const scale = Math.max(W / image.width, area / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (W - w) / 2, (area - h) / 2, w, h);

  const sans = getComputedStyle(document.body).fontFamily;
  ctx.fillStyle = "#111";
  ctx.textBaseline = "alphabetic";
  ctx.font = `400 68px ${sans}`;
  ctx.fillText(name, 64, area + 120, W - 128);
  ctx.fillStyle = "#6b6b6b";
  ctx.font = `300 40px ${sans}`;
  ctx.fillText(detail, 64, area + 184, W - 128);
  ctx.fillStyle = "#111";
  ctx.font = `500 34px ${sans}`;
  ctx.textAlign = "right";
  ctx.fillText("halloween.supply", W - 64, area + 254);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("The share card could not be saved.");
  return new File([blob], `${name.toLowerCase().replace(/\s+/g, "-")}-halloween-supply.jpg`, { type: "image/jpeg" });
}
