import { esc } from "./esc.js";

/**
 * A symbol inside an operations table cell (results table and annex). Broker
 * symbols can be long product names ("ACME WORLD ETF"). In the eleven-column
 * broker tables the span keeps the symbol on one line and cuts it with an
 * ellipsis (style.css .cell-symbol); the full symbol stays in the text, for
 * screen readers and copy, and in the tooltip.
 */
export function symbolCell(symbol: string): string {
  return `<span class="cell-symbol" title="${esc(symbol)}">${esc(symbol)}</span>`;
}
