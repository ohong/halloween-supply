/** The firewall can return HTML; application errors carry more specific JSON. */
export async function readMirrorResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (typeof body?.error === "string") throw new Error(body.error);
    if (response.status === 429) throw new Error("Too many mirror requests from this network. Please try again later.");
    if (response.status === 403) throw new Error("The site blocked this request. Refresh the page and try again.");
    throw new Error("The mirror could not connect. Please try again.");
  }
  if (!body || typeof body !== "object") throw new Error("The mirror returned an unreadable response. Please try again.");
  return body as T;
}
