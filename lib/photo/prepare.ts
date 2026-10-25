// Re-encode camera and library images the browser can decode as JPEGs under 3 MB.
export async function preparePhoto(file: Blob): Promise<Blob> {
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
