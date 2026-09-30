/**
 * Tests for src/web/positions-date.ts — the guard that stops Modelo 720/721/D-6
 * from declaring a statement's open positions as the holdings at 31 December of
 * a year the statement does not end on.
 *
 * A broker's open positions are the holdings (and mark values) on the
 * statement's period end (IBKR FlexStatement `toDate`). Without this guard a
 * Flex Query exported in spring, or one covering an older period, was valued
 * and generated as the year-end holdings of whatever year the profile selects.
 */

import { describe, expect, it } from "vitest";
import { positionsDateMismatch, renderPositionsDateBanner } from "../../src/web/positions-date.js";
import { createEmptyStatement, mergeStatement } from "../../src/parsers/merge.js";

function withToDate(toDate: string) {
  const statement = createEmptyStatement();
  statement.toDate = toDate;
  return statement;
}

describe("positionsDateMismatch", () => {
  it("flags a statement that ends on another date than 31 December of the year", () => {
    expect(positionsDateMismatch(withToDate("20200912"), 2025)).toBe(true);
    // Exported in spring for the previous year: ends in the next year.
    expect(positionsDateMismatch(withToDate("20260315"), 2025)).toBe(true);
    // Ends on 31 December, but of another year.
    expect(positionsDateMismatch(withToDate("20241231"), 2025)).toBe(true);
  });

  it("accepts a statement that ends on 31 December of the year, in either date format", () => {
    expect(positionsDateMismatch(withToDate("20251231"), 2025)).toBe(false);
    expect(positionsDateMismatch(withToDate("2025-12-31"), 2025)).toBe(false);
  });

  it("returns 'unknown' when the broker gives no period end", () => {
    expect(positionsDateMismatch(withToDate(""), 2025)).toBe("unknown");
  });

  it("uses the latest period end when several files are merged", () => {
    const merged = createEmptyStatement();
    mergeStatement(merged, withToDate("20251231"));
    mergeStatement(merged, withToDate("20260315"));
    mergeStatement(merged, withToDate(""));
    expect(merged.toDate).toBe("20260315");
    expect(positionsDateMismatch(merged, 2025)).toBe(true);
  });
});

describe("renderPositionsDateBanner", () => {
  it("blocks generation and names both dates on a mismatch", () => {
    const banner = renderPositionsDateBanner(withToDate("20200912"), 2025);
    expect(banner.blocked).toBe(true);
    expect(banner.html).toContain("banner-warning");
    expect(banner.html).toContain("12/09/2020");
    expect(banner.html).toContain("31/12/2025");
  });

  it("shows a non-blocking notice when the period end is unknown", () => {
    const banner = renderPositionsDateBanner(withToDate(""), 2025);
    expect(banner.blocked).toBe(false);
    expect(banner.html).toContain("banner-info");
    expect(banner.html).toContain("31/12/2025");
  });

  it("renders nothing when the statement ends on 31 December of the year", () => {
    expect(renderPositionsDateBanner(withToDate("20251231"), 2025)).toEqual({ html: "", blocked: false });
  });
});
