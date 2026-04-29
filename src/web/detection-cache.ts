/**
 * Cache semantics for broker auto-detection pre-scan:
 *   undefined    → not yet attempted
 *   null         → attempted, no broker found
 *   "__error__"  → pre-detection threw an exception
 *   string       → detected broker name (e.g. "IBKR", "Revolut")
 */
export type DetectionEntry = string | null;

/**
 * Resolves which parser to use given the current cache entry.
 * Used by parseFiles() to skip re-detection when the cache is warm.
 *
 * - undefined / "__error__"  → run detectFn (full detection or retry after error)
 * - null                     → no broker found; return undefined (triggers chip fallback)
 * - broker name              → look up via getBrokerFn, skip detectFn entirely
 */
export function resolveDetection<P>(
  cached: DetectionEntry | undefined,
  content: string,
  detectFn: (c: string) => P | undefined,
  getBrokerFn: (name: string) => P | undefined,
): P | undefined {
  if (cached === undefined || cached === "__error__") return detectFn(content);
  return cached ? getBrokerFn(cached) : undefined;
}
