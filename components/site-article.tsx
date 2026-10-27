import Link from "next/link";
import type { SiteArticle as Article } from "@/lib/agent/site";

export function SiteArticle({ article }: { article: Article }) {
  return <main id="main" className="page information-page">
    <Link href="/" className="back-link">Back to costumes</Link>
    <h1>{article.title}</h1>
    <p className="information-intro">{article.description}</p>
    {article.sections.map(({ heading, paragraphs, links }) => <section key={heading}>
      <h2>{heading}</h2>
      {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {links?.map(({ label, href }) => <p key={href}><a href={href}>{label} ↗</a></p>)}
    </section>)}
    <nav aria-label="Site information"><Link href="/about">About</Link><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link></nav>
  </main>;
}
