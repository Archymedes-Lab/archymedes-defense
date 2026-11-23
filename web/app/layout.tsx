import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const viewport = { themeColor: "#07090b", colorScheme: "dark" as const };

export const metadata: Metadata = {
  title: { default: "Archymedes Defense", template: "%s · Archymedes Defense" },
  description: "Seven defense businesses scored on defensibility, with working prototypes for sensor reliability and battery aging.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        {children}
      </body>
    </html>
  );
}
