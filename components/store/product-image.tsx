import Image from "next/image";

/** A product photo that fills its (positioned) parent. Remote merchant URLs skip the optimizer. */
export function ProductImage({ src, alt, sizes, className, preload = false }: { src: string; alt: string; sizes: string; className?: string; preload?: boolean }) {
  const remote = /^https?:\/\//i.test(src);
  return <Image src={src} alt={alt} fill sizes={sizes} className={className} unoptimized={remote} preload={preload} />;
}
