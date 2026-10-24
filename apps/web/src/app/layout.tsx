import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { RoleProvider } from "@/context/RoleContext";
import { AppShell } from "@/components/AppShell";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
  variable: "--font-jetbrains-mono",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-space-grotesk",
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
