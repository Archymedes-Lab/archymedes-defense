# Archymedes Defense

Research prototypes for protective and monitoring work, built from open data and published papers. Nothing here
describes a real facility, partner, customer or contract.

| Folder | What it is |
|---|---|
| `world/` | An open-data synthetic 3D world (swisstopo terrain, imagery, buildings; OpenStreetMap ways) exported as OGC 3D Tiles, and a discrete-event site simulation on it: guards, a robot dog, a patrol vehicle, a drone and camera masts at a notional warehouse, with drills, 30-day equipment runs, camera coverage and ORION-ranked improvements. Python, run with `uv`. |
| `web/` | The Next.js viewer and prototype pages: the synthetic world, soft-armor test planning (NIST/NIJ published models), wing aerodynamics (NASA public reports), battery thermal runaway, subsea cable monitoring and site watch. |
| `datascope/`, `evalevidence/` | Small stdlib Python CLIs: dataset purpose and lineage checks, and version-bound AI evaluation receipts. |
| `sitewatch/` | Site-change monitoring prototype. |
| `plans/` | Build plans and the ORION/CDM/Jev reviews behind each design call. |
| `reports/` | A generated site assessment for the notional warehouse. |
| `docs/` | Engineering process: VV&A, hazard log, roadmap. |

## How it is engineered

US DoD practice, tailored: M&S VV&A (DoDI 5000.61, MIL-STD-3022), system safety (MIL-STD-882E), the Software
Acquisition Pathway (DoDI 5000.87) and DevSecOps gates. See [docs/ENGINEERING.md](docs/ENGINEERING.md).

## Scope

Guards and machines observe, detect, report and respond by moving. There are no weapon effects, targeting or
engagement, no route planner for avoiding detection, and no military or sensitive real sites; protected zones are
declared notional. The rule is enforced in code (`world/archworld/sim/scope.py`) and tested.

## Run

    cd world && uv run pytest                       # invariants, sim and operations tests
    world/scripts/run_flow.sh ch-lauterbrunnen      # fetch open data, build the world, run the sim, ORION, report
    cd web && bun install && bun test && bun run dev

The world data is downloaded and built locally (several GB) and is not in git. The web tests under "world files"
need that build.

Data licences: swisstopo open government data; OpenStreetMap ODbL 1.0 (kept in separate files); Poly Haven CC0;
Microsoft Rocketbox avatars, MIT. See `web/public/world/models/CREDITS.json` after a build.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
