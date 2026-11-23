import type { Metadata } from "next";
import { authConfig, safeNext } from "@/lib/auth/config";
import { Mark } from "@/components/ui/shell";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  "1": "That password is not right.",
  throttled: "Too many attempts. Wait ten minutes and try again.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : "/");
  const error = typeof sp.error === "string" ? MESSAGES[sp.error] : undefined;
  const cfg = authConfig();
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="panel w-full max-w-[400px]">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="flex items-center gap-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.18em]">
            <Mark /> Archymedes<span className="text-fg-3">/</span><span className="text-fg-2">Defense</span>
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-3">Restricted</span>
        </div>
        <div className="p-5 sm:p-6">
          <div className="eyebrow">Access control</div>
          <h1 className="mt-3 text-[28px] font-medium leading-tight">Sign in</h1>
          <p className="mt-2 text-[14px] text-fg-2">This workspace is private. Enter the shared password to continue.</p>
          {cfg.state === "misconfigured" ? (
            <p role="alert" className="mt-6 border border-critical/50 bg-critical/10 p-4 text-[13.5px] text-fg">Sign-in is not configured on this deployment.</p>
          ) : (
            <form method="post" action="/api/login" className="mt-6 grid gap-2.5">
              <input type="hidden" name="next" value={next} />
              <label htmlFor="password" className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-fg-2">Password</label>
              <input id="password" name="password" type="password" required autoFocus autoComplete="current-password" maxLength={256}
                aria-invalid={error ? true : undefined} aria-describedby={error ? "login-error" : undefined}
                className={`field h-11 ${error ? "border-critical" : ""}`} />
              {error && <p id="login-error" role="alert" className="flex items-center gap-2 font-mono text-[12px] text-critical"><span className="h-1.5 w-1.5 bg-critical" />{error}</p>}
              {sp.signedout && !error && <p role="status" className="font-mono text-[12px] text-fg-2">Signed out.</p>}
              <button type="submit" className="btn-primary mt-3 h-11 w-full">Continue</button>
            </form>
          )}
        </div>
        <div className="border-t border-line px-5 py-3 font-mono text-[10.5px] uppercase tracking-[0.1em] text-fg-3">Research prototypes · No contract exists</div>
      </div>
    </main>
  );
}
