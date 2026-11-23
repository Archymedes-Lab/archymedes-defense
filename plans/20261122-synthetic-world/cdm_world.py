"""CDM over (1) the site plan and (2) the viewer stack. Advisory (Jev judgments, maths in code).
Run: ~/creative-decision/.venv/bin/python -P cdm_world.py with TYPESAFE_API_KEY in the environment (never printed)."""
import asyncio, json
from pathlib import Path
from cdm import Constraint, Dimension, JevJudge, Option, Problem, decide, judge_problem
ROOT = Path(__file__).resolve().parent
EVID = (ROOT / 'context.txt').read_text()
L5 = lambda *xs: tuple(xs)  # noqa: E731
CTX = {'company': 'Archymedes: small team, simulation prototypes on public data, no customers or proprietary data', 'evidence': EVID}
PREC = ['Battery thermal-runaway simulator calibrated on published experiments', 'Aero estimates with error bars from NASA data',
        'Sitewatch sensor-fault diagnosis validated on synthetic traces']
COMMON_DIMS = lambda use: [  # noqa: E731
    Dimension('moat', 'Once built out, how hard would it be for a competitor to copy the advantage `option` creates?',
              L5('Trivial to copy', 'Easy to copy', 'Takes some effort', 'Hard: proprietary data or relationships', 'Very hard: compounding advantage'), 0.25),
    Dimension('usefulness', f'How much would `option` help {use}?', L5('Barely', 'A little', 'Noticeably', 'Substantially', 'Decisively'), 0.30),
    Dimension('feasible', 'How much of `option` can this team build and validate on a 4-core, 7 GB, no-GPU machine within 30 days?',
              L5('Almost nothing', 'A thin demo', 'A credible prototype', 'A validated prototype', 'A near-product'), 0.25),
    Dimension('realism', 'How well does `option` let us measure how close the synthetic world is to reality?',
              L5('Not at all', 'Weakly', 'Partly', 'Well', 'Rigorously'), 0.20),
]
SITE = Problem(
    goal='Choose which real places the first synthetic world is rebuilt from, for testing drones, robot dogs and vehicles.',
    context=CTX, precedents=PREC,
    options=[
        Option('ch-then-us', 'Swiss Lauterbrunnen tile first (LoD2 truth), then a US Boulder tile through the same pipeline.', baseline=True),
        Option('both-now', 'Swiss and US Boulder tiles built in parallel from day one.'),
        Option('us-only', 'US Boulder tile only (3DEP lidar, NAIP, lidar as building truth).'),
        Option('nl-only', 'Netherlands tile only (AHN lidar + 3DBAG LoD2, flat terrain).'),
        Option('kigali', 'Kigali tile only (30 m DEM, Sentinel-2, Google Open Buildings 2.5D).'),
    ],
    dimensions=COMMON_DIMS('autonomy engineers test drones, robot dogs and vehicles in realistic places'),
    constraints=[Constraint('sensitive', 'rebuild a military installation or other sensitive real site', hard=True),
                 Constraint('licence', 'depend on data whose licence forbids derived simulation use', hard=False)],
    niches={'truth': 'Ground truth to measure realism', 'variety': 'Varied terrain for many missions', 'market': 'Closeness to buyers'},
)
VIEWER = Problem(
    goal='Choose the viewer and rendering stack for the synthetic world.',
    context=CTX, precedents=PREC,
    options=[
        Option('r3f-3dtiles', 'three.js + NASA-AMMOS 3DTilesRendererJS inside the existing Next.js/react-three-fiber app; world stored as OGC 3D Tiles 1.1 (glTF).', baseline=True),
        Option('cesiumjs', 'CesiumJS globe viewer as a separate page, loading the same 3D Tiles.'),
        Option('deckgl', 'deck.gl Tile3DLayer over a map, loading the same 3D Tiles.'),
        Option('unreal', 'Unreal Engine 5 + Cesium for Unreal with pixel streaming from a rented GPU.'),
        Option('custom-glb', 'Hand-rolled glb per tile in three.js without the 3D Tiles standard.'),
    ],
    dimensions=COMMON_DIMS('engineers inspect the world and watch agents run missions'),
    constraints=[Constraint('gpu', 'need a local GPU to develop or run', hard=True),
                 Constraint('lockin', 'lock the world data into one vendor format', hard=False)],
    niches={'web': 'Runs in the existing web app', 'photoreal': 'Photoreal rendering', 'geo': 'Global geospatial accuracy'},
)
async def run(problem):
    judgments = await judge_problem(problem, [JevJudge()])
    d = decide(problem, judgments)
    rows = [{'id': s.id, 'mean': round(s.mean, 3), 'std': round(s.std, 3), 'p_best': round(s.p_best, 3), 'status': s.status, 'niche': s.niche} for s in sorted(d.stats, key=lambda s: -s.mean)]
    viol = {j.option.id: {k: round(float(v), 3) for k, v in j.violations.items()} for j in judgments}
    return {'commit': d.commit, 'innovation': d.innovation, 'evpi': round(d.evpi, 4), 'escalate': d.escalate, 'stats': rows, 'violations': viol}
async def main():
    out = {'site': await run(SITE), 'viewer': await run(VIEWER)}
    (ROOT / 'cdm.json').write_text(json.dumps(out, indent=1) + '\n')
    for k, v in out.items():
        print(k, json.dumps({'commit': v['commit'], 'innovation': v['innovation'], 'evpi': v['evpi'], 'order': [(r['id'], r['mean'], r['p_best']) for r in v['stats']], 'violations': v['violations']}))
asyncio.run(main())
