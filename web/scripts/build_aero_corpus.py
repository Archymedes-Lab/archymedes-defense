"""Build lib/data/aero-corpus.json: digitized public NASA data with provenance and digitizing error.

Points were found by ring-template marker detection on calibrated page renders (axes calibrated from frame lines or
the PDF's OCR label positions, checked by overlaying the predicted grid). False hits on figure text were removed by
inspection of the overlays. Points marked manual=True were read from the calibrated image where detection missed them.
Sources are U.S. government works (NASA, NACA) and are public.
"""
import json
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
OUT = WEB / 'lib/data/aero-corpus.json'

# Digitizing error (1 sigma): calibration plus marker centring; manual points carry more.
SIG = {'polhamus': (0.15, 0.008), 'wk': (0.3, 0.010), 'hatp': (0.4, 0.015), 'manual': (0.4, 0.015)}


def wing(id_, sweep, source, figure, refs, pts, sig, cond, manual=()):
    sa, sc = SIG[sig]
    rows = [{'alphaDeg': a, 'cl': c, 'sigmaAlphaDeg': sa, 'sigmaCl': sc} for a, c in pts]
    ma, mc = SIG['manual']
    rows += [{'alphaDeg': a, 'cl': c, 'sigmaAlphaDeg': ma, 'sigmaCl': mc, 'manual': True} for a, c in manual]
    rows.sort(key=lambda r: r['alphaDeg'])
    return {'id': id_, 'kind': 'delta', 'sweepDeg': sweep, 'source': source, 'figure': figure, 'refs': refs,
            'conditions': cond, 'points': rows}


POL = 'Polhamus 1966, NASA TN D-3767'
WK = 'Wentz & Kohlman 1968, NASA CR-98737 (NTRS 19690005430)'
WK_COND = 'Wichita State 7x10 ft tunnel, q = 30 psf, Re about 1.0e6 per ft, thin flat wings, sharp bevelled edges'

cases = [
    wing('pol-A0.5', 82.87, POL, 'Fig. 12, A = 0.5', 'Tosti 1947, NACA TN 1468', [
        (3.94, .079), (10.02, .232), (14.98, .385), (19.94, .586), (25.02, .71)], 'polhamus', 'low speed'),
    wing('pol-A0.7', 79.92, POL, 'Fig. 12, A = 0.7', 'Fink 1956', [
        (2.94, .069), (4.94, .117), (7.91, .214), (10.02, .292), (11.98, .367), (15.02, .484), (17.98, .589),
        (20.06, .693), (23.06, .789)], 'polhamus', 'low speed'),
    wing('pol-A1.0', 75.96, POL, 'Fig. 12, A = 1.0', 'Peckham 1961, R&M 3186; Tosti 1947', [
        (0.93, .019), (1.96, .039), (3.04, .066), (5.04, .127), (6.07, .165), (7.07, .194), (8.11, .234), (9.89, .30),
        (12.33, .388), (14.3, .469), (14.93, .49), (16.33, .562), (18.41, .649), (20.44, .743), (25.0, .928)],
        'polhamus', 'low speed'),
    wing('pol-A1.5', 69.44, POL, 'Fig. 12, A = 1.5', 'Bartlett & Vidal 1955', [
        (5.93, .214), (8.97, .341), (12.12, .481), (15.09, .629), (18.12, .781), (21.2, .959), (24.46, 1.08)],
        'polhamus', 'low speed', manual=[(0.9, .025), (1.9, .055), (2.85, .085)]),
    wing('pol-A2.0', 63.43, POL, 'Fig. 12, A = 2.0', 'Bartlett & Vidal 1955', [
        (1.98, .065), (2.95, .096), (6.02, .244), (8.99, .387), (12.14, .555), (15.55, .717), (18.44, .885),
        (21.44, .987), (24.52, 1.097)], 'polhamus', 'low speed'),
    wing('wk-50', 50.0, WK, 'Fig. 5.2.1', 'Wentz & Kohlman', [
        (1.61, .087), (5.75, .304), (7.69, .421), (9.97, .48), (14.18, .666), (18.39, .844), (22.61, .952),
        (23.95, .977), (26.89, .977), (31.24, .894), (35.38, .816), (39.6, .705), (43.61, .67)], 'wk', WK_COND),
    wing('wk-55', 55.0, WK, 'Fig. 5.3.1', 'Wentz & Kohlman', [
        (1.14, .069), (5.35, .258), (9.36, .459), (13.58, .624), (17.73, .82), (21.81, .974), (26.09, 1.068),
        (30.23, 1.01), (35.18, .914), (38.86, .783), (43.14, .709)], 'wk', WK_COND),
    wing('wk-60', 60.0, WK, 'Fig. 5.4.1', 'Wentz & Kohlman', [
        (3.68, .186), (5.75, .294), (7.96, .39), (9.9, .46), (12.17, .566), (14.31, .636), (15.45, .697),
        (16.32, .726), (17.53, .771), (18.66, .802), (19.67, .87), (20.8, .899), (22.81, .958), (24.95, 1.032),
        (27.09, 1.091), (29.23, 1.133), (31.3, 1.149), (33.44, 1.125), (35.59, 1.099), (37.59, .969), (41.81, .819),
        (43.75, .778)], 'wk', WK_COND, manual=[(1.9, .10), (39.7, .875)]),
    wing('wk-65', 65.0, WK, 'Fig. 5.5.1', 'Wentz & Kohlman', [
        (1.61, .074), (3.68, .13), (5.89, .245), (7.96, .334), (10.17, .433), (12.24, .513), (14.38, .607),
        (16.39, .705), (18.6, .778), (20.74, .855), (21.81, .932), (22.81, .949), (24.15, .982), (24.88, 1.015),
        (27.02, 1.099), (29.23, 1.149), (31.44, 1.198), (33.51, 1.24), (35.65, 1.237), (37.79, 1.235), (39.73, 1.2),
        (41.94, 1.129), (44.01, 1.041)], 'wk', WK_COND),
    wing('wk-70', 70.0, WK, 'Fig. 5.7.1', 'Wentz & Kohlman', [
        (1.4, .045), (3.48, .119), (5.55, .194), (7.63, .272), (9.7, .353), (11.91, .444), (13.85, .538),
        (16.05, .635), (18.06, .728), (20.13, .831), (22.34, .925), (24.41, 1.022), (26.49, 1.118), (29.5, 1.239),
        (31.91, 1.288), (35.18, 1.306), (39.53, 1.257), (41.61, 1.231), (43.48, 1.181), (48.03, .954), (49.23, .923)],
        'wk', WK_COND),
    wing('wk-75', 75.0, WK, 'Fig. 5.9.1', 'Wentz & Kohlman', [
        (0.74, .026), (2.88, .077), (5.02, .142), (7.29, .224), (9.3, .293), (11.57, .367), (13.71, .454),
        (15.79, .536), (17.99, .637), (20.13, .742), (22.27, .817), (24.48, .91), (26.56, .978), (28.56, 1.066),
        (30.77, 1.147), (32.98, 1.227), (35.52, 1.295), (37.12, 1.295), (38.06, 1.212), (39.26, 1.186),
        (45.48, 1.076), (47.63, 1.029), (49.77, .948)], 'wk', WK_COND),
    wing('wk-80', 80.0, WK, 'Fig. 5.11.1', 'Wentz & Kohlman', [
        (2.27, .034), (4.41, .072), (6.42, .13), (8.7, .186), (10.84, .248), (12.91, .314), (14.98, .384),
        (17.19, .455), (19.2, .526), (21.4, .601), (23.48, .685), (25.62, .719), (27.76, .803), (29.83, .847),
        (31.84, .923), (34.05, .966), (36.12, 1.034), (38.13, 1.073), (40.4, 1.123), (42.54, 1.046), (44.55, 1.003),
        (46.69, .956), (48.9, .92)], 'wk', WK_COND),
]

# Fighter-class reference (outside the engine's validated domain: fuselage, tails, flaps, Reynolds effects).
ha, hc = SIG['hatp']
hatp = {
    'id': 'fa18-hatp', 'kind': 'aircraft', 'source': 'Banks, Fisher et al. 1996, NASA TM-112360 (HATP baseline F/A-18)',
    'figure': 'Fig. 28 (wind-tunnel CL)', 'refs': 'Ames 80x120 ft full scale; Langley 30x60 ft 0.16 scale',
    'reference': {'sRefFt2': 400.0, 'spanFt': 37.417, 'macFt': 11.517, 'cgFracMac': 0.25},
    'conditions': 'full scale M 0.15 Re 12.4e6 (filled diamonds); 0.16 scale M 0.08 Re 1.0e6 (circles)',
    'points': sorted([
        *({'alphaDeg': a, 'cl': c, 'sigmaAlphaDeg': ha, 'sigmaCl': hc, 'series': 'full-scale 80x120'} for a, c in [
            (17.9, 1.108), (19.9, 1.213), (24.9, 1.486), (29.9, 1.684), (34.8, 1.798), (40.1, 1.833), (44.8, 1.745),
            (49.9, 1.648)]),
        *({'alphaDeg': a, 'cl': c, 'sigmaAlphaDeg': ha, 'sigmaCl': hc, 'series': '0.16-scale 30x60'} for a, c in [
            (5.1, .137), (10.1, .522), (15.0, .879), (55.0, 1.448), (60.0, 1.202), (70.0, .858)]),
    ], key=lambda r: r['alphaDeg']),
}

# Vortex breakdown: angle of attack at which breakdown sits at a given fraction of centreline chord measured from the
# trailing edge (0) to the apex (1). Read from the faired curves of Wentz & Kohlman Fig. 4.1.1 (sigma about 1 deg).
breakdown = {
    'source': WK, 'figure': 'Fig. 4.1.1', 'sigmaAlphaDeg': 1.0,
    'positions': [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
    'rows': [
        {'sweepDeg': 55.0, 'alphaDeg': [None, None, None, 13.5, 19.0, 27.5]},
        {'sweepDeg': 60.0, 'alphaDeg': [14.5, 14.6, 15.5, 19.0, 25.6, 33.0]},
        {'sweepDeg': 65.0, 'alphaDeg': [19.5, 20.0, 21.0, 24.5, 30.0, 38.0]},
        {'sweepDeg': 70.0, 'alphaDeg': [29.0, 29.0, 29.5, 31.0, 39.5, 47.0]},
        {'sweepDeg': 75.0, 'alphaDeg': [35.0, 36.0, 36.5, 39.0, 45.0, 55.0]},
        {'sweepDeg': 80.0, 'alphaDeg': [38.5, 39.0, 40.0, 44.0, 55.5, 62.0]},
    ],
}

out = {'version': 1, 'note': __doc__.strip().splitlines()[0], 'cases': cases + [hatp], 'breakdown': breakdown}
n = sum(len(c['points']) for c in out['cases'])
OUT.write_text(json.dumps(out, indent=1) + '\n')
print(f'wrote {OUT.relative_to(WEB)}: {len(out["cases"])} cases, {n} points')
