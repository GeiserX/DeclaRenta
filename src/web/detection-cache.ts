/**
 * Cache semantics for broker auto-detection pre-scan:
 *   undefined          → not yet attempted
 *   null               → attempted, no broker found
 *   DETECTION_ERROR    → pre-detection threw an exception
 *   string             → detected broker name (e.g. "IBKR", "Revolut")
 */
export type DetectionEntry = string | null;

export const DETECTION_ERROR = "__error__" as const;

/**
 * Resolves which parser to use given the current cache entry.
 * Used by parseFiles() to skip re-detection when the cache is warm.
 *
 * - undefined / DETECTION_ERROR  → run detectFn (full detection or retry after error)
 * - null                         → no broker found; return undefined (triggers chip fallback)
 * - broker name                  → look up via getBrokerFn, skip detectFn entirely
 */
export function resolveDetection<P>(
  cached: DetectionEntry | undefined,
  content: string,
  detectFn: (c: string) => P | undefined,
  getBrokerFn: (name: string) => P | undefined,
): P | undefined {
  if (cached === undefined || cached === DETECTION_ERROR) return detectFn(content);
  return cached ? getBrokerFn(cached) : undefined;
}
