/* Product images come from merchant hosts or /public/products; next/image would need every host allow-listed. */
/* eslint-disable @next/next/no-img-element */
export function ProductImage({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
}

/** The background-removed cutout when we have one, so every piece sits on the same grey. */
export const shot = (product: { cutout?: string; image: string }) => product.cutout ?? product.image;
