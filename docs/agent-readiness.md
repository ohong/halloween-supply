# Agent access and verification

Public pages negotiate HTML and UTF-8 Markdown at the same URL. Next.js Proxy serves Markdown directly; the storefront keeps its existing React navigation and shopping behavior. The pinned negotiator package handles quality weights, wildcard ranges, exclusions and representation preference. Unsupported document media types return 406. API calls, private workflows and static files bypass document negotiation.

Markdown responses include `Content-Type: text/markdown; charset=utf-8`, `Vary: Accept`, and `Cache-Control: private, no-store`. Unknown document routes receive a real 404 with recovery links. Requests without an Accept preference receive HTML.

## Verify

1. Run `bun install --frozen-lockfile`.
2. Run `bun run typecheck` and `bun run build`.
3. Run `bun run start --port 3100`.
4. Run `bun scripts/verify-agent-readiness.ts http://localhost:3100`.
5. After deployment, run `bun scripts/verify-agent-readiness.ts https://halloween.supply`.

The HTTP/browser checks cover negotiated types and q-values, 404 and 406 status, HEAD, static/API bypasses, all sitemap pages, JSON-LD, canonical URLs, Open Graph images, llms.txt, robots.txt, native guide disclosure without JavaScript, and hydrated gallery/footer navigation. Set `AGENT_VERIFICATION_OUTPUT` to save the result as JSON. Playwright Chromium must be installed to run browser checks.

## Content and identity

The collapsed guide directory is server-rendered, uses the same editorial data as the gallery, and works through native HTML details/summary without scripts. HTML and Markdown share introduction and trust-page content. Organization and WebSite JSON-LD identify the site without inventing a physical business address or support inbox.

Sitemap dates describe the editorial guides and information pages, rather than claiming that changing merchant prices are fixed at those dates. Update the dates in lib/agent/site.ts when those pages change. The sitemap includes all 50 public costume guides, the homepage, three information pages, and screenshot entry page. It excludes private/generated sessions and API routes.

## Remaining limits

- Confirm a public support email and business mailing address before adding those fields to Organization schema. Contact URLs do not substitute for verified email/phone and PostalAddress in the audit's completeness check.
- Search ranking depends on indexing, independent links and search systems. Titles, headings, canonical URLs and sitemap improve source clarity; they do not guarantee a top-ten result. A verified Search Console property would permit direct submission and indexing diagnostics.
- Next.js 16.4.3 replaces Proxy's Vary header when rendering cached HTML with its framework-specific Vary fields. Declaring Vary through next.config headers did not retain Accept locally either. Markdown responses retain Accept and are not cached. The verification suite checks the required Markdown Vary header; it does not claim the HTML response preserves it. A framework report draft records this limitation.
- Audit reports are snapshots. Check scanned_at before interpreting a score as a post-deployment scan.

Protocols: https://acceptmarkdown.com/start ; https://llmstxt.org/ ; https://www.sitemaps.org/protocol.html ; https://schema.org/Organization .
