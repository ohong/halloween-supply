import type { MetadataRoute } from "next";
import { costumes } from "@/lib/costumes";
import { site } from "@/lib/agent/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...["", "/about", "/contact", "/privacy", "/screenshot"].map((path) => ({ url: `${site.url}${path || "/"}`, lastModified: site.contentUpdated })),
    ...costumes.map(({ slug }) => ({ url: `${site.url}/costumes/${slug}`, lastModified: site.catalogUpdated })),
  ];
}
