/* Product images come from merchant hosts or /public/products; next/image would need every host allow-listed. */
/* eslint-disable @next/next/no-img-element */
export function ProductImage({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return <img src={src} alt={alt} className={className} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
}

/** Research imports use the actual merchant photo; legacy products retain their reviewed cutout. */
export const shot = (product: { merchantImage?: string; cutout?: string; image: string }) => product.merchantImage ?? product.cutout ?? product.image;
