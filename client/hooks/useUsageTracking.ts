import { useEffect, useRef, useCallback } from "react";
import { useApi } from "@/hooks/useApi.js";

/**
 * Fires a usage tracking event to Snowflake.
 * Returns a `track` function for imperative event logging (e.g., after generation).
 * Optionally auto-fires a "page_view" event on mount.
 */
export function useUsageTracking(module: string, options?: { trackPageView?: boolean }) {
  const { run: logEvent } = useApi("LogUsageEvent");
  const firedRef = useRef(false);

  // Fire page view on mount (once)
  useEffect(() => {
    if (options?.trackPageView && !firedRef.current) {
      firedRef.current = true;
      logEvent({ event_type: "page_view", module, metadata: null }).catch(() => {
        // Silently ignore tracking failures
      });
    }
  }, [module, options?.trackPageView, logEvent]);

  // Imperative track function for generation events
  const track = useCallback(
    (eventType: string, metadata?: Record<string, unknown>) => {
      logEvent({ event_type: eventType, module, metadata: metadata ?? null }).catch(() => {
        // Silently ignore tracking failures
      });
    },
    [module, logEvent]
  );

  return { track };
}
