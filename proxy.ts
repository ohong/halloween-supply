import { NextResponse, type NextRequest } from "next/server";
import { documentMarkdown } from "./lib/agent/documents";
import { negotiateDocument } from "./lib/agent/negotiate";

export function proxy(request: NextRequest) {
  const html = NextResponse.next();
  html.headers.set("Vary", "Accept");
  // React navigation and writes retain the framework's own representation.
  if (!["GET", "HEAD"].includes(request.method) || request.headers.get("rsc") === "1" || request.headers.get("accept")?.includes("text/x-component")) return html;
  const representation = negotiateDocument(request.headers.get("accept"));
  if (representation === "html") return html;
  const result = representation === "markdown" ? documentMarkdown(request.nextUrl.pathname) : {
    status: 406,
    body: "This page is available as text/html or text/markdown. Send one of those media types in Accept.\n",
  };
  return new NextResponse(request.method === "HEAD" ? null : result.body, {
    status: result.status,
    headers: {
      "Content-Type": `${representation === "markdown" ? "text/markdown" : "text/plain"}; charset=utf-8`,
      "Vary": "Accept",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next(?:/|$)|create(?:/|$)|success(?:/|$)|.*\\.[^/]+$).*)"],
};
