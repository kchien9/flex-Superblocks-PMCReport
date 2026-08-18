import { useState, useCallback, useRef, useEffect } from "react";

/**
 * A drop-in replacement for useState that persists to sessionStorage.
 * - Reads from sessionStorage on mount (hydrates initial value)
 * - Writes to sessionStorage on every state change
 * - Falls back to the provided initialValue if storage is empty or parse fails
 * - Handles serialization/deserialization gracefully
 *
 * @param key - Unique sessionStorage key (namespace per page to avoid collisions)
 * @param initialValue - Default value when nothing is stored
 */
export function useSessionState<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  // Lazy initializer reads from sessionStorage once on mount
  const [state, setStateRaw] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) {
        return JSON.parse(stored) as T;
      }
    } catch {
      // Parse failed — use initial value
    }
    return initialValue;
  });

  // Keep a ref to the key so the effect doesn't stale-close over it
  const keyRef = useRef(key);
  keyRef.current = key;

  // Sync to sessionStorage whenever state changes
  useEffect(() => {
    try {
      sessionStorage.setItem(keyRef.current, JSON.stringify(state));
    } catch {
      // Storage full or serialization failed — silent fallback
    }
  }, [state]);

  // Wrapped setter that behaves identically to useState setter
  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStateRaw(value);
    },
    []
  );

  // Clear function to remove this key from storage and reset to initial
  const clear = useCallback(() => {
    try {
      sessionStorage.removeItem(keyRef.current);
    } catch {
      // silent
    }
    setStateRaw(initialValue);
  }, [initialValue]);

  return [state, setState, clear];
}

/**
 * Helper to clear all session state for a given page namespace prefix.
 * Useful for "Start Over" actions that reset an entire page's state.
 */
export function clearSessionNamespace(prefix: string): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(prefix)) {
        keysToRemove.push(k);
      }
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // silent
  }
}
