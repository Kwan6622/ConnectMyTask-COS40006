// Lock details shown on the "account locked" page (3 warnings = locked for 3 days).
// Kept in sessionStorage because a locked user has no session to load them from.
export interface AccountLock {
  lockedUntil: string | null;
  warningCount: number | null;
  /** Why the warnings were given (most recent first) */
  reasons?: string[];
}

const KEY = 'account-lock';

export function saveAccountLock(lock: AccountLock): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(lock));
  } catch {
    // Storage can be unavailable (private mode); the page then shows a generic message.
  }
}

export function readAccountLock(): AccountLock | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AccountLock) : null;
  } catch {
    return null;
  }
}

export function clearAccountLock(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
