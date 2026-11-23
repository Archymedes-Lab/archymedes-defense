"use client";

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex border border-line-strong">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={`h-8 border-r border-line-strong px-3 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors last:border-r-0 ${o.value === value ? "bg-accent text-accent-ink" : "text-fg-2 hover:bg-surface hover:text-fg"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
