import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { CartProvider } from "@/lib/cart/context";
import { CartDrawer } from "@/components/store/cart-drawer";
import { usesDemoSizes } from "@/lib/checkout/mode";
import { SiteHeader } from "@/components/store/site-header";
import Link from "next/link";
import { site } from "@/lib/agent/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://halloween.supply"),
  title: site.title,
  description: site.description,
  openGraph: { title: site.title, description: site.description, siteName: site.name, type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#fff",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body>
        <CartProvider>
          <a className="skip-link" href="#main">Skip to content</a>
          <SiteHeader />
          {children}
          <footer className="site-footer page"><span>© 2026 halloween.supply</span><nav aria-label="Site information"><Link href="/about">About</Link><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link></nav></footer>
          <Suspense fallback={null}><CartDrawer demoDefaultSizes={usesDemoSizes()} /></Suspense>
        </CartProvider>
      </body>
    </html>
  );
}
