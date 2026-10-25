import "server-only";

/** Keep provider errors and request contents out of client responses and logs. */
export class PreviewError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function openaiRequest(endpoint: "decisions" | "images/edits", body: object | FormData, signal?: AbortSignal) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new PreviewError(503, "Photo try-on is not available yet. Please try again later.");
  const multipart = body instanceof FormData;
  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, ...(!multipart ? { "Content-Type": "application/json" } : {}) },
    body: multipart ? body : JSON.stringify(body),
    signal: AbortSignal.any([AbortSignal.timeout(endpoint === "decisions" ? 30_000 : 180_000), ...(signal ? [signal] : [])]),
    cache: "no-store",
  });
  if (!response.ok) {
    // Only status is logged: provider messages can contain user input or image data.
    console.warn(`[try-on] OpenAI ${endpoint} returned ${response.status}`);
    if (response.status === 401 || response.status === 403) throw new PreviewError(503, "Photo try-on is temporarily unavailable. Please try again later.");
    if (response.status === 429) throw new PreviewError(429, "Photo try-on is busy or has reached its usage limit. Please try again later.");
    throw new PreviewError(502, "OpenAI could not create this preview. Please try another photo or try again later.");
  }
  return response.json() as Promise<unknown>;
}
