import type { Metadata } from "next";
import { SiteArticle } from "@/components/site-article";
import { articles } from "@/lib/agent/site";

export const metadata: Metadata = {
  title: articles.about.title,
  description: articles.about.description,
  alternates: { canonical: "/about" },
};

export default function Page() { return <SiteArticle article={articles.about} />; }
