// Haptics — a tiny, crash-proof wrapper around navigator.vibrate.
//
// Web vibration exists on Android Chromium/Firefox and nowhere on iOS Safari, and
// browsers also refuse it before the page has had a user gesture. So every call
// here is feature-detected, wrapped in try/catch, and returns whether anything
// actually fired. On unsupported devices it is a silent no-op — never an error.
//
// Reduced motion: users who ask for it get haptics OFF by default (they can still
// opt in from Settings). The preference is stored under `desk-haptics`.

export type HapticKind = 'tap' | 'toggle' | 'armed' | 'signal';

export const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 6,                       // tab / chip changes — barely there
  toggle: 12,                   // a switch flipped
  armed: [14, 50, 14],          // new ARMED pre-trigger alert — double pulse
  signal: [24, 60, 24, 60, 48], // new fired signal — triple, ending long
};

export interface VibrateTarget { vibrate?: (pattern: number | number[]) => boolean }
export interface MotionWindow { matchMedia?: (q: string) => { matches: boolean } }
export interface PrefStorage { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const HAPTICS_KEY = 'desk-haptics';

const defaultNav = (): VibrateTarget | null =>
  typeof navigator === 'undefined' ? null : (navigator as unknown as VibrateTarget);

export function canVibrate(nav: VibrateTarget | null | undefined = defaultNav()): boolean {
  return !!nav && typeof nav.vibrate === 'function';
}

export function prefersReducedMotion(win?: MotionWindow | null): boolean {
  try {
    const w = win ?? (typeof window === 'undefined' ? null : (window as unknown as MotionWindow));
    return !!w?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Fire a pattern. Returns true only if the browser accepted the vibration. Never throws. */
export function haptic(
  kind: HapticKind,
  opts: { enabled?: boolean; nav?: VibrateTarget | null } = {},
): boolean {
  try {
    if (opts.enabled === false) return false;
    const nav = opts.nav === undefined ? defaultNav() : opts.nav;
    if (!nav || !canVibrate(nav)) return false;
    return nav.vibrate!(PATTERNS[kind]) === true;
  } catch {
    return false;
  }
}

/** Saved choice wins; otherwise ON, unless the user prefers reduced motion. */
export function readHapticsPref(storage?: PrefStorage | null, win?: MotionWindow | null): boolean {
  try {
    const s = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    const v = s?.getItem(HAPTICS_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch { /* storage blocked — fall through to the default */ }
  return !prefersReducedMotion(win);
}

export function writeHapticsPref(on: boolean, storage?: PrefStorage | null): void {
  try {
    const s = storage ?? (typeof localStorage === 'undefined' ? null : localStorage);
    s?.setItem(HAPTICS_KEY, on ? 'on' : 'off');
  } catch { /* private mode — preference just won't persist */ }
}
