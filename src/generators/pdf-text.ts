/**
 * Both PDF generators use the built-in Helvetica font, which only covers the
 * WinAnsi character set. A character outside it (⚠ ℹ ⛔ → or an emoji) has no
 * glyph code: pdfkit prints garbage bytes ("&Ô", "!9") and jsPDF switches the
 * whole string to 2-byte text, so the full line turns unreadable.
 */

/** Characters above U+00FF that WinAnsi still encodes (0x80–0x9F). */
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/**
 * Make `text` printable with the standard PDF fonts: arrows become "->", other
 * characters outside WinAnsi (severity symbols, emoji) are dropped, and the
 * spaces they leave behind are collapsed.
 */
export function pdfSafeText(text: string): string {
  let out = "";
  for (const ch of text.replace(/→/g, "->")) {
    if (ch.codePointAt(0)! <= 0xff || WIN_ANSI_EXTRA.has(ch)) out += ch;
  }
  return out.replace(/ {2,}/g, " ").trim();
}
