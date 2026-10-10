// Storage can be unavailable, for example with cookies blocked; a flag then lasts the visit only.

/** Whether a flag was left set on an earlier visit. */
export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

/** Keeps a flag for the next visit. */
export function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Nothing to fall back on: the flag is simply not remembered.
  }
}
