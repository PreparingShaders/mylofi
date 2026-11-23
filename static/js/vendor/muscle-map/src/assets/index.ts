import type { BodyView, Gender, Theme } from '../data/types';
import maleFrontLight from './bodies/male-front-light.webp';
import maleBackLight from './bodies/male-back-light.webp';
import femaleFrontLight from './bodies/female-front-light.webp';
import femaleBackLight from './bodies/female-back-light.webp';
import maleFrontDark from './bodies/male-front-dark.webp';
import maleBackDark from './bodies/male-back-dark.webp';
import femaleFrontDark from './bodies/female-front-dark.webp';
import femaleBackDark from './bodies/female-back-dark.webp';

const BODIES: Record<string, string> = {
  'male-front-light': maleFrontLight,
  'male-back-light': maleBackLight,
  'female-front-light': femaleFrontLight,
  'female-back-light': femaleBackLight,
  'male-front-dark': maleFrontDark,
  'male-back-dark': maleBackDark,
  'female-front-dark': femaleFrontDark,
  'female-back-dark': femaleBackDark,
};

/** All bundled body image URLs, keyed `${gender}-${view}-${theme}`. */
export const DEFAULT_BODIES: Readonly<Record<string, string>> = BODIES;

/** Resolve the bundled body image for a gender/view/theme combination. */
export function defaultBody(gender: Gender, view: BodyView, theme: Theme): string {
  return BODIES[`${gender}-${view}-${theme}`] ?? BODIES['male-front-light']!;
}