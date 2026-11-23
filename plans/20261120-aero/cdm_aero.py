"""CDM over aerodynamics directions plus the status quo. Advisory (Jev judgments, maths in code).
Run: ~/creative-decision/.venv/bin/python -P cdm_aero.py with TYPESAFE_API_KEY in the environment (never printed)."""
import asyncio, json
from pathlib import Path
from cdm import Constraint, Dimension, JevJudge, Option, Problem, decide, judge_problem
ROOT = Path(__file__).resolve().parent
EVID = (ROOT / 'context.txt').read_text()
options = [
    Option('status-quo', 'Keep improving the battery thermal-runaway and armor screening prototypes instead of starting aerodynamics.', baseline=True),
    Option('vortex-lift', 'Browser vortex-lattice solver with leading-edge vortex lift and breakdown limits, validated on NASA delta-wing and F/A-18 high-alpha data.'),
    Option('uq-aero', 'Low-fidelity aerodynamic estimates that ship with error bars measured against a public validation corpus of NASA wind-tunnel and flight data.'),
    Option('uav-sysid', 'Fixed-wing drone aerodynamic model identified from PX4/ArduPilot flight logs, compared with vortex-lattice predictions.'),
    Option('tunnel-plan', 'Wind-tunnel test planner that picks the fewest runs to pin down lift, drag and moment curves using a physics prior and Bayesian design.'),
    Option('multifi', 'Multi-fidelity aerodynamic database: vortex-lattice sweeps corrected by a few CFD runs through Gaussian-process fusion, with uncertainty.'),
]
L5 = lambda *xs: tuple(xs)  # noqa: E731
problem = Problem(
    goal='Choose the aerodynamics project for a small startup: useful to aircraft and drone engineers, hard to copy once built out, startable from public data.',
    context={'company': 'Archymedes: small team, simulation prototypes on public data, no customers or proprietary data', 'evidence': EVID},
    precedents=['Battery thermal-runaway simulator calibrated on published experiments', 'Soft-armor V50 screening with a Bayesian test planner'],
    options=options,
    dimensions=[
        Dimension('moat', 'Once built out with users and data, how hard would it be for a competitor to copy the advantage `option` creates?',
                  L5('Trivial to copy', 'Easy to copy', 'Takes some effort', 'Hard: proprietary data or relationships', 'Very hard: compounding advantage'), 0.30),
        Dimension('usefulness', 'How much would `option` help aircraft and drone engineers make better, safer designs?',
                  L5('Barely', 'A little', 'Noticeably', 'Substantially', 'Decisively'), 0.30),
        Dimension('feasible', 'How much of `option` can a small team build and validate from public data within 60 days?',
                  L5('Almost nothing', 'A thin demo', 'A credible prototype', 'A validated prototype', 'A near-product'), 0.20),
        Dimension('demand', 'How strongly do engineers or labs already pay for what `option` delivers?',
                  L5('No buyer', 'Speculative', 'Some budgets exist', 'Clear budgets and buyers', 'Urgent, funded demand'), 0.20),
    ],
    constraints=[
        Constraint('combat', 'improve the combat capability of a military aircraft, such as stealth, weapons or air-combat manoeuvring', hard=True),
        Constraint('export', 'require export-controlled technical data to build the first prototype', hard=False),
    ],
    niches={'solver': 'A faster or better aerodynamic solver', 'trust': 'Trust in predictions: validation and uncertainty', 'data': 'Data from flight or test campaigns', 'test': 'Cheaper physical testing'},
)
async def main():
    judgments = await judge_problem(problem, [JevJudge()])
    d = decide(problem, judgments)
    rows = [{'id': s.id, 'mean': round(s.mean, 3), 'std': round(s.std, 3), 'p_best': round(s.p_best, 3), 'status': s.status, 'niche': s.niche, 'reliable': s.reliable} for s in sorted(d.stats, key=lambda s: -s.mean)]
    dims = {j.option.id: {k: [round(float(x), 3) for x in v] for k, v in j.dims.items()} for j in judgments}
    viol = {j.option.id: {k: round(float(v), 3) for k, v in j.violations.items()} for j in judgments}
    out = {'commit': d.commit, 'innovation': d.innovation, 'evpi': round(d.evpi, 4), 'escalate': d.escalate, 'stats': rows, 'dims': dims, 'violations': viol}
    (ROOT / 'cdm.json').write_text(json.dumps(out, indent=1) + '\n')
    print(json.dumps({'commit': d.commit, 'innovation': d.innovation, 'evpi': out['evpi'], 'order': [(r['id'], r['mean'], r['p_best'], r['status']) for r in rows], 'violations': viol}))
asyncio.run(main())
