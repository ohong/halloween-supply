import Image from "next/image";
import Link from "next/link";
import { SaveLook } from "@/components/saved-looks";
import { VirtualTryOn } from "./virtual-try-on";

/** Editorial style guides provide a practical piece list and styling advice. */
export function CostumePreview({ costume }: { costume: {
  slug: string; name: string; description: string; image: string; alt: string;
  pieces: readonly string[]; tip: string;
} }) {
  return <div className="costume-layout">
    <div className="costume-media"><figure className="slide">
      <Image src={costume.image} alt={costume.alt} fill sizes="(min-width: 960px) 50vw, 100vw" preload />
    </figure></div>
    <div className="costume-info">
      <Link href="/" className="back-link">All costumes</Link>
      <p className="preview-status">Style guide</p>
      <h1 className="costume-title">{costume.name}</h1>
      <p className="costume-description">{costume.description}</p>
      <p className="sourcing-note">Build this look with pieces you own, thrift, or make. The image is AI-generated styling inspiration.</p>
      <ul className="piece-list" aria-label="Pieces for this look">{costume.pieces.map((name) => <li className="piece" key={name}><h2 className="piece-title">{name}</h2></li>)}</ul>
      <p className="sourcing-note">{costume.tip}</p>
      <div className="costume-actions"><SaveLook slug={costume.slug} name={costume.name} showLabel /></div>
      <VirtualTryOn costumeSlug={costume.slug} />
    </div>
  </div>;
}
