import Link from "next/link";
import { costumes } from "@/lib/costumes";
import { homepageIntroduction } from "@/lib/agent/documents";

export function CostumeGuideDirectory() {
  return <details className="costume-guide-directory">
    <summary>Costume ideas and piece guides</summary>
    <section aria-labelledby="costume-guide-title">
      <h2 id="costume-guide-title">Halloween costume ideas from Halloween Supply</h2>
      {homepageIntroduction.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <ul className="costume-guide-list">{costumes.map((costume) => <li key={costume.slug}>
        <h3><Link href={`/costumes/${costume.slug}`}>{costume.name}</Link></h3>
        <p>{costume.description}</p>
        <p>Pieces: {costume.pieces.join("; ")}.</p>
        <p>Styling tip: {costume.tip}</p>
      </li>)}</ul>
    </section>
  </details>;
}
