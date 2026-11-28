import { create } from "zustand";

/** Set when the API answers ACCOUNT_LOCKED (3 warnings): the app then shows only the lock screen. */
export interface AccountLock {
  lockedUntil: string | null;
  warningCount: number | null;
  /** Why the warnings were given (most recent first) */
  reasons?: string[];
}

interface AccountLockState {
  lock: AccountLock | null;
  setLock: (lock: AccountLock) => void;
  clear: () => void;
}

export const useAccountLockStore = create<AccountLockState>((set) => ({
  lock: null,
  setLock: (lock) => set({ lock }),
  clear: () => set({ lock: null }),
}));
