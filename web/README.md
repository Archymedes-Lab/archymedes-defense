# Archymedes Defense — web app

Next.js 16 (App Router, Turbopack), React 19, three.js via @react-three/fiber and drei, Tailwind v4.
One design system (`app/globals.css` tokens + `components/ui`) shared by every page.

| Route | What it is |
|---|---|
| `/` | Seven projects: 3D towers (prototype score vs score after assets) and the defensibility chart |
| `/sitewatch` | Real app. Runs the Python Sitewatch engine on the server: synthetic seeds or your own inventory + telemetry files. 3D site, timeline, evidence per alarm |
| `/battery` | Real data. ISU-ILCC aging data (251 cells, 63 conditions, CC BY 4.0): 3D stress space, fade curves, rank correlations |
| `/ai-evaluation`, `/subsea`, `/provenance`, `/qualification`, `/fleet` | Concepts: illustrative 3D scene, first step, dossier. No data |

## Run

```bash
bun install
bun run data      # rebuild lib/data/*.json from the recorded sources (hashes in provenance.json)
bun run build && bun run start   # http://127.0.0.1:3310 (loopback only)
```

## Engine route

`POST /api/sitewatch` spawns `python3 -I scripts/sitewatch_run.py` with `execFile` (no shell).
Same-origin check, integer bounds, 256 KB / 32 MB upload caps, 0600 temp files removed after,
60 s timeout, two concurrent runs, reduced environment. Measured refusals: 403 foreign or missing
origin, 400 bad seed/hours, 415 wrong content type, 422 malformed telemetry with line number.

**Sign-in.** `proxy.ts` gates every page, API route and public file (including `/runs/*.json`) behind one
shared password. Exempt: `/login`, `/api/login`, `/api/logout`, `/icon.svg` and hashed `/_next/static` assets;
`scripts/check_bundle.py` fails the build if data from `lib/data` reaches those assets, and data modules
import `server-only`.

- Password: scrypt hash in `SITE_PASSWORD_HASH`; session HMAC key from `SESSION_SECRET` plus that hash, so
  changing either revokes every session. Cookie `__Host-ad_session`, Secure, HttpOnly, SameSite=Lax, 7 days.
- Rotate: `bun scripts/set_password.ts | vercel env add SITE_PASSWORD_HASH production` (after `vercel env rm`),
  then redeploy. The new password is written only to `~/.config/archymedes-defense/login-password` (0600).
- Hosted without both values: every route answers 503. Local without them: open (loopback only).
- Known limits: throttling is per serverless instance; one shared password, no per-user identity or audit
  (Jev 1.14.0 ranked per-user identity first at 0.53; adequacy 0.53, i.e. uncertain).
- The Python engine route never runs hosted (501); the local server (127.0.0.1:3310) still runs it.

Tests: `bun run test` (auth unit tests). Build: `bun run build` (includes the bundle leak gate).
