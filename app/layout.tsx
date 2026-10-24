import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://halloween.supply"),
  title: "Halloween Supply — A little strange. Very well dressed.",
  description: "Five original Halloween costume ideas. Explore the looks, save your favorites, and make your own entrance.",
  openGraph: { title: "Halloween Supply", description: "A little strange. Very well dressed. Five costume ideas for your annual identity crisis.", type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} h-full antialiased`}>
      <body><a className="skip-link" href="#main">Skip to content</a>{children}</body>
    </html>
  );
}
