/**
 * Compile-time proofs (checked by `tsc --noEmit` and `next build`): each line marked @ts-expect-error must fail to
 * type-check. If a refactor makes unit mixing legal again, the directive itself becomes an error and the build fails.
 */
import { breakdownAlpha } from "./vortex";
import { type Deg, type Rad, deg, rad, toDeg, toRad } from "./units";

const d: Deg = deg(10);
const r: Rad = rad(0.2);

// @ts-expect-error degrees are not radians
const wrong1: Rad = d;
// @ts-expect-error radians are not degrees
const wrong2: Deg = r;
// @ts-expect-error a bare number is neither unit
const wrong3: Rad = 0.5;
// @ts-expect-error toDeg takes radians only
const wrong4 = toDeg(d);
// @ts-expect-error toRad takes degrees only
const wrong5 = toRad(r);
// @ts-expect-error the breakdown map wants a sweep in radians
const wrong6 = breakdownAlpha(d, 0.5);

export const UNIT_PROOFS = [wrong1, wrong2, wrong3, wrong4, wrong5, wrong6, breakdownAlpha(toRad(d), 0.5)] as const;
