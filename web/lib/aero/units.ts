/**
 * Angle units as branded numbers: a function that takes Rad cannot be given Deg or a bare number by mistake.
 * This file is the only place in lib/aero allowed to cast (checked by scripts/aero_static.ts).
 */
declare const unit: unique symbol;
export type Deg = number & { readonly [unit]: "deg" };
export type Rad = number & { readonly [unit]: "rad" };

export const deg = (x: number): Deg => x as Deg;
export const rad = (x: number): Rad => x as Rad;
export const toRad = (d: Deg): Rad => ((d * Math.PI) / 180) as Rad;
export const toDeg = (r: Rad): Deg => ((r * 180) / Math.PI) as Deg;
