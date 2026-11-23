"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Overview" },
  { href: "/sitewatch", label: "Sitewatch" },
  { href: "/battery", label: "Battery" },
  { href: "/concepts", label: "Concepts" },
  { href: "/armor", label: "Armor" },
  { href: "/aero", label: "Aero" },
  { href: "/world", label: "World" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="grid grid-cols-4 sm:flex sm:h-full">
      {ITEMS.map((item) => {
        const active = item.href === "/" ? path === "/" : path.startsWith(item.href) ||
          (item.href === "/concepts" && /^\/(ai-evaluation|subsea|provenance|qualification|fleet)/.test(path));
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}
            className={`relative flex h-10 items-center justify-center whitespace-nowrap border-r border-b border-line px-1 sm:h-auto sm:border-b-0 font-mono text-[10px] uppercase tracking-[0.06em] sm:text-[11px] sm:tracking-[0.14em] transition-colors [&:nth-child(4n)]:border-r-0 sm:[&:nth-child(4n)]:border-r-0 sm:border-r-0 sm:border-l sm:px-4 sm:last:border-r ${active ? "bg-accent-soft text-accent after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-accent" : "text-fg-2 hover:bg-surface hover:text-fg"}`}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
