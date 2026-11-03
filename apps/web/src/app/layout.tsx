import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { RoleProvider } from "@/context/RoleContext";
import { AppShell } from "@/components/AppShell";

// The font files are local (src/app/fonts, SIL Open Font License) so a build
// never fetches from a font CDN. See docs/ARCHITECTURE.md D-25.
const inter = localFont({
  src: "./fonts/inter.woff2",
  weight: "300 700",
  style: "normal",
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [
    {
      path: "./fonts/jetbrains-mono.woff2",
      weight: "400 700",
      style: "normal",
    },
    {
      path: "./fonts/jetbrains-mono-italic.woff2",
      weight: "400 700",
      style: "italic",
    },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const spaceGrotesk = localFont({
  src: "./fonts/space-grotesk.woff2",
  weight: "500 700",
  style: "normal",
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VELARIS // Unified Spatial Operations Platform",
  description: "Intelligent Customer Operations Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const htmlClass =
    inter.variable + " " + jetbrainsMono.variable + " " + spaceGrotesk.variable;
  const bodyClass =
    inter.className +
    " bg-slate-950 text-slate-100 min-h-screen flex flex-col relative";

  return (
    <html lang="en" className={htmlClass} data-theme="dark">
      <body className={bodyClass}>
        <RoleProvider>
          <AppShell>{children}</AppShell>
        </RoleProvider>
      </body>
    </html>
  );
}
