import type { Metadata } from "next";
import { SiteArticle } from "@/components/site-article";
import { articles } from "@/lib/agent/site";

export const metadata: Metadata = {
  title: articles.contact.title,
  description: articles.contact.description,
  alternates: { canonical: "/contact" },
};

export default function Page() { return <SiteArticle article={articles.contact} />; }
