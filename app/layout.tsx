import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { CartProvider } from "@/lib/cart/context";
import { CartDrawer } from "@/components/store/cart-drawer";
import { SiteHeader } from "@/components/store/site-header";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://halloween.supply"),
  title: "Halloween Supply — costumes built from pieces",
  description: "Halloween costumes built from individual pieces, sourced from independent and Bay Area shops. One checkout.",
  openGraph: { title: "Halloween Supply", description: "Halloween costumes built from individual pieces.", type: "website" },
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
          <footer className="site-footer page">© 2026 halloween.supply</footer>
          <CartDrawer />
        </CartProvider>
      </body>
    </html>
  );
}
