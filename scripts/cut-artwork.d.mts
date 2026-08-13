/**
 * Types for the cutting script, which stays `.mjs` so `node` can run it with no
 * build step. `lib/brand/artwork.test.ts` imports the same pipeline from it, so
 * the test and the command cannot disagree about the bytes they produce.
 */
import type { Sharp } from 'sharp'

export const MASTER: string

export const CUTS: readonly { path: string; width: number; height: number; why: string }[]

export function cut(width: number, height: number): Sharp
