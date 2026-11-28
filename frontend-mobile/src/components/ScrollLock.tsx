import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";

/**
 * Lets an embedded map stop the page from scrolling while a finger is on it.
 * Without this, the page's ScrollView takes the drag and the map cannot be panned.
 */
type ScrollLockValue = { setLocked: (locked: boolean) => void };

const ScrollLockContext = createContext<ScrollLockValue>({ setLocked: () => undefined });

export function ScrollLockProvider({
  onChange,
  children,
}: {
  onChange: (locked: boolean) => void;
  children: React.ReactNode;
}): React.ReactElement {
  const value = useMemo(() => ({ setLocked: onChange }), [onChange]);
  return <ScrollLockContext.Provider value={value}>{children}</ScrollLockContext.Provider>;
}

/** Touch handlers for the View that wraps a map: page scrolling pauses while it is touched. */
export function useMapTouchLock(): {
  onTouchStart: () => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
} {
  const { setLocked } = useContext(ScrollLockContext);
  const lockedRef = useRef(false);
  const lock = useCallback(() => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    setLocked(true);
  }, [setLocked]);
  const unlock = useCallback(() => {
    if (!lockedRef.current) return;
    lockedRef.current = false;
    setLocked(false);
  }, [setLocked]);
  // Never leave the page stuck if the map unmounts mid-gesture.
  useEffect(() => () => { if (lockedRef.current) setLocked(false); }, [setLocked]);
  return { onTouchStart: lock, onTouchEnd: unlock, onTouchCancel: unlock };
}
