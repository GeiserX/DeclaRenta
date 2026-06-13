/**
 * Tests for src/web/validation.ts — post-parse sanity checks.
 *
 * Two pure functions are covered:
 *   - validateStatement(): decides WHICH ValidationIssue[] fire for a given
 *     parsed Statement (future dates, missing cash, no trades in the selected
 *     year, very old data, duplicate trades). No DOM, no network.
 *   - renderValidationIssues(): turns issues into an HTML string. It interpolates
 *     issue messages — which contain broker-supplied data such as a trade
 *     `symbol` — so it MUST HTML-escape, or a crafted symbol becomes stored XSS
 *     in the review banner.
 *
 * Both functions are pure (return data / a string), so they are called directly
 * with the minimal structural shape they read — no jsdom harness needed.
 *
 * The i18n module defaults to the Spanish locale without initLocale(), so t()
 * yields the es.ts strings here; assertions match on the stable, data-bearing
 * fragments of those strings (symbol, year, count) rather than the full prose,
 * so locale copy edits don't make the suite brittle.
 */

import { describe, it, expect } from "vitest";
import { validateStatement, renderValidationIssues, type ValidationIssue } from "../../src/web/validation.js";
import type { Statement } from "../../src/types/broker.js";
import type { Trade } from "../../src/types/ibkr.js";

/** Build a minimal Trade carrying only the fields validateStatement reads. */
function trade(overrides: Partial<Trade> = {}): Trade {
  return {
    tradeID: "",
    accountId: "U1",
    symbol: "AAPL",
    description: "Apple Inc",
    isin: "US0378331005",
    assetCategory: "STK",
    currency: "USD",
    tradeDate: "2023-06-15",
    settlementDate: "2023-06-17",
    quantity: "10",
    tradePrice: "150",
    tradeMoney: "1500",
    proceeds: "1500",
    cost: "0",
    fifoPnlRealized: "0",
    fxRateToBase: "1",
    buySell: "BUY",
    openCloseIndicator: "O",
    exchange: "NASDAQ",
    commissionCurrency: "USD",
    commission: "0",
    taxes: "0",
    multiplier: "1",
    ...overrides,
  };
}

/** Build a minimal Statement with the given trades and (optional) cash rows. */
function statement(trades: Trade[], cash: Statement["cashTransactions"] = []): Statement {
  return {
    accountId: "U1",
    fromDate: "20230101",
    toDate: "20231231",
    period: "2023",
    trades,
    cashTransactions: cash,
    corporateActions: [],
    openPositions: [],
    securitiesInfo: [],
  };
}

/** A single dummy cash transaction (presence is all validateStatement checks). */
function cashRow(): Statement["cashTransactions"][number] {
  return {
    transactionID: "C1",
    accountId: "U1",
    symbol: "AAPL",
    description: "Dividend",
    isin: "US0378331005",
    currency: "USD",
    dateTime: "20230601;120000",
    settleDate: "20230603",
    amount: "5",
    fxRateToBase: "1",
    type: "Dividends",
  };
}

/** Tomorrow as YYYYMMDD — always strictly after today's date string. */
function tomorrowYmd(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

describe("validateStatement — issue detection", () => {
  it("returns no issues for clean current-data with trades and cash", () => {
    const issues = validateStatement(statement([trade()], [cashRow()]), 2023, ["IBKR"]);
    expect(issues).toEqual([]);
  });

  describe("future dates", () => {
    it("warns when a trade has a future date", () => {
      const issues = validateStatement(
        statement([trade({ tradeDate: tomorrowYmd(), symbol: "FUTURE" })], [cashRow()]),
        null,
      );
      const future = issues.find((i) => i.message.includes("FUTURE"));
      expect(future).toBeDefined();
      expect(future!.level).toBe("warning");
    });

    it("does not warn for a trade dated today (boundary: not strictly greater)", () => {
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const issues = validateStatement(statement([trade({ tradeDate: today })], [cashRow()]), null);
      expect(issues).toEqual([]);
    });

    it("emits only one future-date warning even with several future trades", () => {
      const issues = validateStatement(
        statement(
          [
            trade({ tradeDate: tomorrowYmd(), symbol: "F1" }),
            trade({ tradeDate: tomorrowYmd(), symbol: "F2" }),
          ],
          [cashRow()],
        ),
        null,
      );
      const futureWarnings = issues.filter(
        (i) => i.message.includes("F1") || i.message.includes("F2"),
      );
      expect(futureWarnings).toHaveLength(1);
    });
  });

  describe("missing cash transactions", () => {
    it("warns with the Degiro-specific hint when a Degiro statement has trades but no cash", () => {
      const issues = validateStatement(statement([trade()], []), null, ["Degiro"]);
      const msgs = issues.map((i) => i.message);
      expect(msgs.some((m) => m.includes("Degiro"))).toBe(true);
      expect(issues.every((i) => i.level === "warning")).toBe(true);
    });

    it("warns with the IBKR-specific hint (Flex Query) when an IBKR statement lacks cash", () => {
      const issues = validateStatement(statement([trade()], []), null, ["IBKR"]);
      expect(issues.some((i) => i.message.includes("Flex Query"))).toBe(true);
    });

    it("warns generically when an unknown broker has trades but no cash", () => {
      const issues = validateStatement(statement([trade()], []), null, ["Kraken"]);
      expect(issues).toHaveLength(1);
      expect(issues[0]!.level).toBe("warning");
      // Neither broker-specific hint should appear for an unrecognised broker.
      expect(issues[0]!.message).not.toContain("Degiro");
      expect(issues[0]!.message).not.toContain("Flex Query");
    });

    it("does not warn about missing cash when there are no trades at all", () => {
      const issues = validateStatement(statement([], []), null, ["Degiro"]);
      expect(issues).toEqual([]);
    });

    it("does not warn about missing cash when cash transactions are present", () => {
      const issues = validateStatement(statement([trade()], [cashRow()]), null, ["Degiro"]);
      expect(issues).toEqual([]);
    });
  });

  describe("no trades in the selected year", () => {
    it("emits an info issue naming the selected year when no trade falls in it", () => {
      const issues = validateStatement(
        statement([trade({ tradeDate: "2021-03-10" })], [cashRow()]),
        2024,
      );
      const info = issues.find((i) => i.level === "info");
      expect(info).toBeDefined();
      expect(info!.message).toContain("2024");
    });

    it("does not emit the no-trades-in-year info when a trade matches the selected year", () => {
      const issues = validateStatement(
        statement([trade({ tradeDate: "2024-03-10" })], [cashRow()]),
        2024,
      );
      expect(issues.some((i) => i.level === "info" && i.message.includes("2024"))).toBe(false);
    });

    it("does not check the year when selectedYear is null", () => {
      const issues = validateStatement(
        statement([trade({ tradeDate: "2021-03-10" })], [cashRow()]),
        null,
      );
      expect(issues).toEqual([]);
    });
  });

  describe("very old data", () => {
    it("emits an info issue naming the oldest year when data is older than 10 years", () => {
      const oldYear = new Date().getFullYear() - 15;
      const issues = validateStatement(
        statement([trade({ tradeDate: `${oldYear}-01-05` })], [cashRow()]),
        null,
      );
      const info = issues.find((i) => i.level === "info" && i.message.includes(String(oldYear)));
      expect(info).toBeDefined();
    });

    it("does not flag data that is within the last 10 years", () => {
      const recentYear = new Date().getFullYear() - 2;
      const issues = validateStatement(
        statement([trade({ tradeDate: `${recentYear}-01-05` })], [cashRow()]),
        null,
      );
      expect(issues).toEqual([]);
    });
  });

  describe("duplicate trades", () => {
    it("warns and reports the count when the same tradeID appears twice", () => {
      const issues = validateStatement(
        statement([trade({ tradeID: "T1" }), trade({ tradeID: "T1" })], [cashRow()]),
        null,
      );
      const dupe = issues.find((i) => i.level === "warning" && /\b1\b/.test(i.message));
      expect(dupe).toBeDefined();
    });

    it("counts duplicates by composite key when no tradeID is present", () => {
      // Two identical trades (no tradeID) collapse to symbol|isin|date|qty|price|side.
      const issues = validateStatement(
        statement([trade(), trade()], [cashRow()]),
        null,
      );
      expect(issues.some((i) => i.level === "warning")).toBe(true);
    });

    it("does not flag trades that share a symbol but differ in quantity", () => {
      const issues = validateStatement(
        statement([trade({ quantity: "10" }), trade({ quantity: "20" })], [cashRow()]),
        null,
      );
      expect(issues).toEqual([]);
    });

    it("reports the number of EXCESS duplicates, not the total occurrences", () => {
      // Three identical trades => 1 unique + 2 excess => count is 2.
      const issues = validateStatement(
        statement([trade(), trade(), trade()], [cashRow()]),
        null,
      );
      const dupe = issues.find((i) => i.level === "warning" && /\b2\b/.test(i.message));
      expect(dupe).toBeDefined();
    });
  });
});

describe("renderValidationIssues — HTML rendering & XSS prevention", () => {
  it("returns an empty string when there are no issues", () => {
    expect(renderValidationIssues([])).toBe("");
  });

  it("wraps issues in the validation banner and a per-level list item", () => {
    const html = renderValidationIssues([{ level: "warning", message: "Algo" }]);
    expect(html).toContain('class="validation-banner"');
    expect(html).toContain('class="validation-list"');
    expect(html).toContain('class="validation-warning"');
    expect(html).toContain("Algo");
  });

  it("renders the matching icon for each level", () => {
    const issues: ValidationIssue[] = [
      { level: "error", message: "e" },
      { level: "warning", message: "w" },
      { level: "info", message: "i" },
    ];
    const html = renderValidationIssues(issues);
    expect(html).toContain("⛔"); // ⛔ error
    expect(html).toContain("⚠️"); // ⚠️ warning
    expect(html).toContain("ℹ️"); // ℹ️ info
  });

  it("renders one <li> per issue, in order", () => {
    const html = renderValidationIssues([
      { level: "info", message: "first" },
      { level: "warning", message: "second" },
    ]);
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html.indexOf("first")).toBeLessThan(html.indexOf("second"));
  });

  it("escapes HTML metacharacters so a crafted message cannot inject markup", () => {
    const html = renderValidationIssues([
      { level: "error", message: '<img src=x onerror="alert(1)">' },
    ]);
    // The raw tag must NOT survive; its angle brackets/quotes are entity-encoded.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&gt;");
    expect(html).toContain("&quot;");
  });

  it("escapes a <script> payload arriving via a broker-controlled trade symbol (end-to-end)", () => {
    // A malicious symbol flows: trade.symbol -> t('validation.future_date') message
    // -> renderValidationIssues(). The render layer is the last line of defence.
    const issues = validateStatement(
      statement([trade({ tradeDate: tomorrowYmd(), symbol: "<script>alert(1)</script>" })], [cashRow()]),
      null,
    );
    const html = renderValidationIssues(issues);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes ampersands before other entities (no double-escaping artifacts)", () => {
    const html = renderValidationIssues([{ level: "info", message: "Beneficio & pérdida < 0" }]);
    expect(html).toContain("Beneficio &amp; pérdida &lt; 0");
    expect(html).not.toContain("&amp;lt;");
  });
});
