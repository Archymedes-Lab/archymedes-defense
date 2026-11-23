"""Per-cell thermal-runaway distributions from the Battery Failure Databank v2 (NREL/NASA).

Source: Zenodo record 10.5281/zenodo.13125063 (NREL/battery-heat-output v1, CC BY 4.0), which ships
data/BatteryFailureDatabankV2.xlsx. Only 100 %-SOC tests are kept (the pack-safety case). Each test stays a paired
row [total kJ, body %, body time constant s, onset °C or null], so correlations between heat and venting survive.
Onset is kept only for heater-triggered tests: nail tests start at room temperature and say nothing about onset.

Output: lib/data/thermal-runaway.json
"""
import hashlib
import json
import statistics as st
import sys
import zipfile
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
SRC = WEB.parent / '.feasibility/20261119/battery/zenodo'
sys.path.insert(0, str(Path(__file__).resolve().parent))
from xlsx_read import read  # noqa: E402

FORMATS = {18650: (0.018, 0.065), 21700: (0.021, 0.070), 'D-cell': (0.034, 0.061)}


def num(v):
    return v if isinstance(v, float) else None


def main() -> None:
    xlsx = SRC / 'BatteryFailureDatabankV2.xlsx'
    if not xlsx.exists():
        with zipfile.ZipFile(SRC / 'bho.zip') as z:
            xlsx.write_bytes(z.read('NREL-battery-heat-output-b73639b/data/BatteryFailureDatabankV2.xlsx'))
    wb = read(str(xlsx))
    rows = wb['Fractional-Calorimetry-Data']
    hdr = rows[1]
    ix = {h: i for i, h in enumerate(hdr) if h}
    g = lambda r, k: num(r[ix[k]]) if ix[k] < len(r) else None  # noqa: E731
    chars = {}
    for r in wb['Cell-Characteristics'][2:]:
        if r and len(r) > 6 and r[1]:
            chars[r[1]] = {'format': r[2], 'ah': num(r[3]), 'v': num(r[4]), 'wh': num(r[5])}
    cells: dict[str, dict] = {}
    for r in rows[2:]:
        if not r or len(r) <= ix['Corrected-Total-Energy-Yield-kJ']:
            continue
        name, soc, total = r[ix['Cell-Description']], g(r, 'Pre-Test-State-of-Charge-%'), g(r, 'Corrected-Total-Energy-Yield-kJ')
        body, tau, mass = g(r, 'Energy-Percent-Cell-Body-%'), g(r, 'Ƭ-Cell-Body'), g(r, 'Pre-Test-Cell-Mass-g')
        if not name or soc != 100.0 or not total or body is None or not tau or not mass:
            continue
        trig = str(r[ix['Trigger-Mechanism']])
        onset = g(r, 'Avg-Cell-Temp-At-Trigger-degC') if trig.startswith('Heater') else None
        c = cells.setdefault(name, {'name': name, 'tests': [], 'mass': []})
        c['tests'].append([round(total, 2), round(body, 1), round(tau, 2), None if onset is None else round(onset, 1)])
        c['mass'].append(mass)
    out = []
    for name, c in cells.items():
        ch = chars.get(name, {})
        fmt = ch.get('format')
        fmt = int(fmt) if isinstance(fmt, float) else fmt
        if fmt not in FORMATS or len(c['tests']) < 4:
            continue
        onsets = [t[3] for t in c['tests'] if t[3] is not None]
        out.append({'name': name, 'format': str(fmt), 'diameter': FORMATS[fmt][0], 'length': FORMATS[fmt][1], 'ah': ch.get('ah'), 'wh': ch.get('wh'),
                    'massG': round(st.mean(c['mass']), 2), 'n': len(c['tests']), 'onsetN': len(onsets),
                    'meanKj': round(st.mean(t[0] for t in c['tests']), 2), 'meanBody': round(st.mean(t[1] for t in c['tests']), 1),
                    'tests': c['tests']})
    out.sort(key=lambda c: (c['format'], -c['n']))
    data = {'source': {'title': 'Battery Failure Databank, revision 2 (NREL and NASA)', 'via': 'Zenodo 10.5281/zenodo.13125063 (NREL/battery-heat-output v1)',
                       'license': 'CC BY 4.0 (Zenodo record)', 'sha256': hashlib.sha256(xlsx.read_bytes()).hexdigest()[:16],
                       'filter': '100 % SOC; onset only from heater-triggered tests; cells with ≥ 4 tests'},
            'cells': out}
    path = WEB / 'lib/data/thermal-runaway.json'
    path.write_text(json.dumps(data, separators=(',', ':')))
    print(len(out), 'cells', sum(c['n'] for c in out), 'tests', path.stat().st_size, 'bytes')
    for c in out:
        print(f"  {c['name'][:32]:32} {c['format']:6} n={c['n']:2} onsetN={c['onsetN']:2} {c['meanKj']:6.1f} kJ body {c['meanBody']:4.1f}% {c['massG']} g")


if __name__ == '__main__':
    main()
