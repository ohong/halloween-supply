import Negotiator from "negotiator";

type Representation = "html" | "markdown";

export function negotiateDocument(accept: string | null): Representation | null {
  // Keep HTML as the server preference for absent headers and wildcard ties.
  const selected = new Negotiator({ headers: { accept: accept?.trim() || "*/*" } }).mediaType([
    "text/html; charset=utf-8",
    "text/markdown; charset=utf-8",
  ]);
  if (selected?.startsWith("text/markdown")) return "markdown";
  if (selected?.startsWith("text/html")) return "html";
  return null;
}
