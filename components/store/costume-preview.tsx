import Image from "next/image";
import Link from "next/link";
import { SaveLook } from "@/components/saved-looks";
import { liveCostumeSlug } from "@/lib/costumes";

/** Editorial looks remain available without implying that their pieces are for sale. */
export function CostumePreview({ costume }: { costume: {
  slug: string; name: string; description: string; image: string; alt: string;
} }) {
  const isCowboy = costume.slug === liveCostumeSlug;
  return <div className="costume-layout">
    <div className="costume-media"><figure className="slide">
      <Image src={costume.image} alt={costume.alt} fill sizes="(min-width: 960px) 50vw, 100vw" preload />
    </figure></div>
    <div className="costume-info">
      <Link href="/" className="back-link">All costumes</Link>
      <h1 className="costume-title">{costume.name}</h1>
      <p className="preview-status">{isCowboy ? "Picks unavailable" : "Coming soon"}</p>
      <p className="costume-description">{costume.description}</p>
      <p className="sourcing-note">{isCowboy ? "Our saved picks are unavailable right now. Please try again shortly." : "We are finding the right pieces for this look. The cowboy is ready to shop."}</p>
      <Link href={isCowboy ? "/" : `/costumes/${liveCostumeSlug}`} className="btn">{isCowboy ? "Browse costumes" : "Shop the cowboy"}</Link>
      <div className="costume-actions"><SaveLook slug={costume.slug} name={costume.name} showLabel /></div>
    </div>
  </div>;
}
