import Link from "next/link";
import { Nav } from "./nav";

const ENGINE = process.env.NEXT_PUBLIC_ENGINE === "static" ? "STATIC RUNS" : "LIVE ENGINE";

export function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
      <div className="container-page flex flex-wrap items-stretch justify-between sm:h-12 sm:flex-nowrap">
        <Link href="/" className="flex h-12 items-center gap-2.5 font-mono text-[12px] font-medium uppercase tracking-[0.18em]">
          <Mark /> Archymedes<span className="text-fg-3">/</span><span className="text-fg-2">Defense</span>
        </Link>
        <div className="order-3 -mx-4 w-[calc(100%+2rem)] border-t border-line sm:order-none sm:mx-0 sm:w-auto sm:border-t-0"><Nav /></div>
        <div className="flex items-center gap-3 sm:order-last">
          <span className="hidden items-center gap-1.5 font-mono text-[10.5px] tracking-[0.14em] text-fg-3 lg:inline-flex">
            <span className="h-1.5 w-1.5 bg-good" />{ENGINE}
          </span>
          {process.env.NEXT_PUBLIC_ENGINE === "static" && (
            <form method="post" action="/api/logout">
              <button type="submit" className="h-8 border border-line-strong px-2.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-2 transition-colors hover:border-accent hover:text-accent">Sign out</button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}

/** Three ascending bars: the moat climbing from prototype to earned assets. Square, no radius. */
export function Mark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="0" y="9" width="4" height="7" fill="var(--fg-3)" />
      <rect x="6" y="5" width="4" height="11" fill="var(--fg-2)" />
      <rect x="12" y="0" width="4" height="16" fill="var(--accent)" />
    </svg>
  );
}

export function Footer({ children }: { children?: React.ReactNode }) {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="container-page grid gap-2 py-8 font-mono text-[11px] uppercase leading-relaxed tracking-[0.08em] text-fg-3 sm:grid-cols-[1fr_auto]">
        {children}
        <p>Research prototypes · No partner, customer or contract exists · Synthetic results are labelled</p>
        <p className="sm:text-right">Archymedes Defense · Build 2026-11-18</p>
      </div>
    </footer>
  );
}
