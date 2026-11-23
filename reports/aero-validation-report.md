# Vortex-lift estimates for slender-wing aircraft: validation record, version 1.0

Archymedes Defense, aerodynamics. Open source (Apache-2.0): https://github.com/Archymedes-Lab/archymedes-defense

## What this record is for

It says how far to trust a fast, low-order estimate of lift at high angle of attack, and where not to. Every comparison below is against data NASA published. The wind-tunnel criteria (C1 to C4) were written down before any score was known; the flight criteria (F1 to F4) were written after the unfitted model had first been compared and before the rounded edge was fitted. The misses are listed with the hits. Nothing here is a design clearance, and nothing concerns weapons, signatures or manoeuvre optimisation.

## Summary

- **5 of 8 criteria met.** Misses: C1, C2, F3; each is detailed below.
- **Wind-tunnel wings.** 200 digitized points on 13 cases from three NASA reports. On wings the model never saw (leave-one-wing-out), 90% of points fall inside the stated 90% band.
- **Real aircraft (F-106B).** At NASA's published trim point the lift error is 3% (63% for a bare sharp-edged wing), and the trim elevon is predicted within 0.469°. Across 27 flight runs the weight the model implies varies by 4% within a flight (11% for the sharp-edged wing); 5.8% on flights held out of the fit.
- **Use it for:** relative comparisons and first estimates of lift for thin, highly swept wings below Mach 0.6, with the band as the error to carry forward. **Do not use it for:** absolute performance of a real aircraft outside the cases checked here, anything above Mach 0.6, lateral behaviour, or loads.

## Method

- Planar vortex lattice for attached (potential) lift; leading-edge suction converted to vortex lift by the Polhamus analogy; vortex-breakdown loss from the Wentz and Kohlman breakdown map with one calibrated parameter (the share of vortex lift kept behind a burst, 0.37).
- Error band: split-conformal intervals of scaled residuals per flow regime, widened by a factor 1.35 chosen by nested leave-one-wing-out, so reported coverage is out of sample.
- Real aircraft: geometry only from NASA tables and figures; elevon lift and trim from the same lattice; a rounded leading edge modelled as a smooth onset of vortex lift between two angles.

## Aircraft and sources

| Aircraft | Airframe | Published geometry read from |
|---|---|---|
| F/A-18 HARV | NASA 840, the F/A-18 High Alpha Research Vehicle (unarmed, flown 1987–1996) | NASA TP-1999-206573 (Fig. 2 and Table 3); NASA TM-110216 (Table 2.3); NASA TM-112360 (Fig. 28) |
| F-16XL-1 | F-16XL ship 1 (NASA 849), the single-seat cranked-arrow research aircraft | NASA TP-2001-210629 (Table 3 and Fig. 2) |
| F-106B | F-106B Delta Dart, NASA 816 (two-seat), the vortex-flap research aircraft | NASA TP-3374 (p. 3, Fig. 1 and Table I); NASA TP-2747 (Table I and Table III) |

## Part 1: wind-tunnel wings

Criteria written 2026-11-20, before the first run, and not changed since.

| | Criterion | Result | Detail |
|---|---|---|---|
| C1 | attached-regime RMS(CL) ≤ 0.05 on every in-domain wing | **missed** | misses: wk-60, wk-65, wk-80 |
| C2 | |CLmax error| ≤ 0.15 and |α at CLmax error| ≤ 5° where the data pass CLmax | **missed** | misses: wk-60, wk-65, wk-70, wk-80 |
| C3 | pooled leave-one-wing-out coverage of the 90% band within [0.80, 0.97] | met | 89.8% |
| C4 | out-of-domain cases flagged as extrapolation at every point | met | all cases |

| Wing | Source figure | Points | RMS error before breakdown | RMS error, all | Maximum lift: data → model | Inside the band |
|---|---|---:|---:|---:|---|---:|
| 79.92° delta | Fig. 12, A = 0.7 | 9 | 0.032 | 0.032 | data stop before the peak | 100% |
| 75.96° delta | Fig. 12, A = 1.0 | 15 | 0.015 | 0.015 | data stop before the peak | 100% |
| 69.44° delta | Fig. 12, A = 1.5 | 10 | 0.012 | 0.012 | data stop before the peak | 100% |
| 63.43° delta | Fig. 12, A = 2.0 | 9 | 0.028 | 0.041 | data stop before the peak | 100% |
| 60° delta | Fig. 5.4.1 | 24 | 0.053 | 0.230 | 1.15 at 31.3° → 1.39 at 42.25° | 83% |
| 65° delta | Fig. 5.5.1 | 23 | 0.058 | 0.073 | 1.24 at 33.51° → 1.14 at 41.5° | 87% |
| 70° delta | Fig. 5.7.1 | 21 | 0.041 | 0.119 | 1.31 at 35.18° → 1.29 at 28.75° | 95% |
| 75° delta | Fig. 5.9.1 | 23 | 0.046 | 0.093 | 1.29 at 35.52° → 1.38 at 35° | 100% |
| 80° delta | Fig. 5.11.1 | 23 | 0.135 | 0.131 | 1.12 at 40.4° → 1.33 at 38.5° | 65% |
| 82.87° delta | Fig. 12, A = 0.5 | 5 | outside the validated range | 0.028 | n/a | 100% (band doubled) |
| 50° delta | Fig. 5.2.1 | 13 | outside the validated range | 0.433 | n/a | 100% (band doubled) |
| 55° delta | Fig. 5.3.1 | 11 | outside the validated range | 0.331 | n/a | 100% (band doubled) |
| F/A-18 HARV (wind tunnel) | Fig. 28 (wind-tunnel CL) | 14 | outside the validated range | 0.097 | n/a | 100% (band doubled) |

Validated range: sharp-edged, pointed delta wings with 60° to 80° leading-edge sweep, to 50° angle of attack. Outside it every point is labelled an extrapolation and the band is doubled.

## Part 2: a real aircraft, the F-106B

### Trim point (absolute)

NASA TP-2747, Tables I and III: the basic aircraft at 11.3° angle of attack. Weight, speed, flight-path angle and thrust are published, so the lift coefficient required is 0.342. Assumed: sea-level standard density; velocity taken as true airspeed. This point was not used to fit anything.

| Model | Lift coefficient | Error | Elevon |
|---|---:|---:|---:|
| Bare wing, sharp edge (the engine before this work) | 0.559 | +63% | n/a |
| With the elevon at its published angle, sharp edge | 0.478 | +40% | -4.13° |
| With the elevon at its published angle, attached edge | 0.363 | +6% | -4.13° |
| Trimmed by the model, rounded edge fitted to the flight table | 0.353 | +3% | -4.60° |

Published elevon -4.13°; predicted -4.60°.

### Flight table (shape of the lift curve)

NASA TP-3374, Table I: 27 runs on 5 flights with published angle of attack, altitude, Mach number and load factor (7 more excluded: Mach ≥ 0.6 (no compressibility model)). The weight of each run is not published. In steady flight, load factor × weight = lift, so each run gives the weight the model implies; a correct lift curve gives one weight per flight.

| Leading-edge model | Spread of implied weight within a flight | Mean implied weight |
|---|---:|---:|
| Sharp edge (the engine's assumption) | 10.7% | 35,413 lb |
| Attached edge (no vortex lift) | 10.5% | 26,976 lb |
| Rounded edge, fitted | 4.3% | 30,545 lb |

The fitted rounded edge starts shedding a vortex at 14° and is fully formed by 21°. Fitted on four flights and scored on the fifth, in turn:

| Flight held out | Runs | Fitted onset → full | Spread on the held-out flight |
|---|---:|---|---:|
| 91-13 | 8 | 16° → 19° | 8.2% |
| 91-14 | 6 | 12° → 22° | 5.7% |
| 91-15 | 7 | 12° → 21° | 5.0% |
| 91-16 | 3 | 14° → 21° | 2.0% |
| 91-17 | 3 | 14° → 21° | 0.6% |

Criteria written 2026-11-23, after the first comparison of the unfitted variants and before the fit.

| | Criterion | Result | Value |
|---|---|---|---:|
| F1 | Trim point: fitted model's lift within 5% of the lift the published condition requires | met | 3.2% |
| F2 | Trim point: predicted elevon within 1.0° of the published angle | met | 0.469° |
| F3 | Flight table: held-out spread of implied weight within a flight at most 5% | **missed** | 5.8% |
| F4 | Flight table: mean implied weight between 27,400 lb (NASA's simulation weight) and 38,360 lb | met | 30,545 lb |

## Known misses and limits

- **C1 missed:** attached-regime RMS(CL) ≤ 0.05 on every in-domain wing.
- **C2 missed:** |CLmax error| ≤ 0.15 and |α at CLmax error| ≤ 5° where the data pass CLmax.
- **F3 missed:** Flight table: held-out spread of implied weight within a flight at most 5%.
- The flight weight of each run is not published: the flight table tests the shape of the lift curve and gives only a plausibility check on its level.
- Fuel burned between runs of one flight lowers the true weight by an unknown amount, which the within-flight spread includes.
- The trim point is NASA's simulation model (from 0.15-scale wind-tunnel tests), gear down and speed brakes out; density is assumed sea-level standard.
- The centre of gravity in flight is taken as the 28% of the simulation report.
- No fuselage, fin, camber or compressibility in the model.
- The F-16XL-1 and the F/A-18 HARV have no flight comparison yet; both are outside the validated range of wing shapes.
- Thin flat wings only: no thickness, camber, fuselage, tails, flaps, compressibility or Reynolds-number effects in the lift model.

## Data and reproduction

| File | SHA-256 (first 16) |
|---|---|
| `web/lib/data/aero-corpus.json` | `816a75a4e9f9edab` |
| `web/lib/data/aero-validation.json` | `02d02c1bf5444d74` |
| `web/lib/data/aero-flight.json` | `46c8b20bfd231492` |

Reproduce: `cd web && bun scripts/validate_aero.ts && bun scripts/validate_flight.ts && bun scripts/make_aero_report.ts`; tests: `bun test tests/aero*.test.ts`.

## How to cite

Archymedes Defense (2026). *Vortex-lift estimates for slender-wing aircraft: validation record*, version 1.0. https://github.com/Archymedes-Lab/archymedes-defense (data digests above).

## Sources

- Polhamus 1966, NASA TN D-3767 (suction analogy; delta-wing lift data)
- Wentz & Kohlman 1968, NASA CR-98737 (vortex-breakdown map; lift curves)
- NASA TM-112360, 1996 (F/A-18 wind-tunnel lift)
- NASA TP-2001-210629, 2001 (F-16XL-1 geometry)
- NASA TP-3374, 1993 (F-106B geometry and flight table)
- NASA TP-2747, 1987 (F-106B mass and trim table)
- Vovk, Gammerman & Shafer 2005 (conformal intervals)
