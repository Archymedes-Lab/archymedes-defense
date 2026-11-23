import type { ReactNode } from "react";
import type { Status } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/format";

export function PageHeader({ eyebrow, title, lede, children }: { eyebrow: string; title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid gap-5 border-b border-line pt-12 pb-10 sm:pt-16">
      <div className="eyebrow">{eyebrow}</div>
      <h1 className="max-w-[20ch] text-[36px] font-medium leading-[1.02] sm:text-[56px]">{title}</h1>
      {lede ? <p className="max-w-[64ch] text-[16px] leading-relaxed text-fg-2 sm:text-[17px]">{lede}</p> : null}
      {children}
    </div>
  );
}

export function Section({ eyebrow, title, description, children, id }: { eyebrow?: string; title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="grid gap-6 py-12">
      <div className="grid gap-2 border-t border-line pt-5">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h2 className="text-[24px] font-medium leading-tight sm:text-[30px]">{title}</h2>
        {description ? <p className="max-w-[68ch] text-fg-2">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel min-w-0 ${className}`}>{children}</div>;
}

export function Stat({ value, label, hint }: { value: ReactNode; label: string; hint?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-1.5 border-l border-line-strong pl-3">
      <div className="num font-mono text-[28px] font-medium leading-none tracking-tight sm:text-[32px]">{value}</div>
      <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fg-2">{label}</div>
      {hint ? <div className="font-mono text-[11px] text-fg-3">{hint}</div> : null}
    </div>
  );
}

const STATUS_DOT: Record<Status, string> = { built: "var(--c3)", partial: "var(--c4)", data: "var(--c1)", research: "var(--fg-3)" };
export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 tag">
      <span className="h-1.5 w-1.5 " style={{ background: STATUS_DOT[status] }} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Legend({ items }: { items: { label: string; color?: string; swatch?: ReactNode }[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-fg-2">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-2">
          {it.swatch ?? <span className="h-2.5 w-2.5 " style={{ background: it.color }} />}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="eyebrow text-fg-3">{label}</dt>
      <dd className="m-0 text-[14.5px] leading-relaxed">{children}</dd>
    </div>
  );
}
