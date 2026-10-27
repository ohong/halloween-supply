import type { Metadata } from "next";
import { SiteArticle } from "@/components/site-article";
import { articles } from "@/lib/agent/site";

export const metadata: Metadata = {
  title: articles.privacy.title,
  description: articles.privacy.description,
  alternates: { canonical: "/privacy" },
};

export default function Page() { return <SiteArticle article={articles.privacy} />; }
