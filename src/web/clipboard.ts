/**
 * Copy text to the clipboard, resolving to whether it succeeded.
 *
 * `navigator.clipboard` is undefined in non-secure contexts and `writeText`
 * can reject without document focus, so this never throws — callers branch on
 * the boolean to drive their own success/failure UI. Local-only: no network.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // In non-secure contexts navigator.clipboard is undefined, so this access
    // throws synchronously — caught here alongside writeText's own rejection.
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
