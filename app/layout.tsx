import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CartProvider } from "@/lib/cart/context";
import { CartDrawer } from "@/components/store/cart-drawer";
import { SiteHeader } from "@/components/store/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const description =
  "Curated Halloween costumes built from individual pieces: a hat from a western-wear shop, a shirt from a vintage store, boots from a niche bootmaker. One checkout.";

export const metadata: Metadata = {
  metadataBase: new URL("https://halloween.supply"),
  title: { default: "halloween.supply — curated Halloween costumes", template: "%s — halloween.supply" },
  description,
  openGraph: { title: "halloween.supply", description, type: "website" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body>
        <a className="skip-link" href="#main">Skip to content</a>
        <CartProvider>
          <SiteHeader />
          {children}
          <footer className="site-footer shell">© 2026 halloween.supply</footer>
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
