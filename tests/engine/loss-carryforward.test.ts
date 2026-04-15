import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { applyLossCarryforward } from "../../src/engine/loss-carryforward.js";
import type { LossCarryforward } from "../../src/types/tax.js";

describe("Loss Carryforward (Art. 49 LIRPF)", () => {
  it("should compensate prior gains losses against current gains", () => {
    const priorLosses: LossCarryforward[] = [
      { year: 2023, amount: new Decimal("-1000"), remaining: new Decimal("-1000"), category: "gains" },
    ];

    const result = applyLossCarryforward(2025, new Decimal("3000"), new Decimal("500"), priorLosses);

    expect(result.adjustedGains.toFixed(2)).toBe("2000.00"); // 3000 - 1000
    expect(result.totalCompensated.toFixed(2)).toBe("1000.00");
  });

  it("should compensate prior income losses against current income", () => {
    const priorLosses: LossCarryforward[] = [
      { year: 2023, amount: new Decimal("-200"), remaining: new Decimal("-200"), category: "income" },
    ];

    const result = applyLossCarryforward(2025, new Decimal("0"), new Decimal("800"), priorLosses);

    expect(result.adjustedIncome.toFixed(2)).toBe("600.00"); // 800 - 200
    expect(result.totalCompensated.toFixed(2)).toBe("200.00");
  });

  it("should apply 25% cross-compensation limit (gains losses → income)", () => {
    const priorLosses: LossCarryforward[] = [
      { year: 2023, amount: new Decimal("-5000"), remaining: new Decimal("-5000"), category: "gains" },
    ];

    // No current gains, but 1000 income → max 25% = 250 cross-compensation
    const result = applyLossCarryforward(2025, new Decimal("0"), new Decimal("1000"), priorLosses);

    expect(result.adjustedIncome.toFixed(2)).toBe("750.00"); // 1000 - 250
    expect(result.totalCompensated.toFixed(2)).toBe("250.00");
    // Remaining: 5000 - 250 = 4750
    const remaining = result.updatedCarryforward.find((l) => l.year === 2023);
    expect(remaining).toBeDefined();
    expect(remaining!.remaining.abs().toFixed(2)).toBe("4750.00");
  });

  it("should apply 25% cross-compensation limit (income losses → gains)", () => {
    const priorLosses: LossCarryforward[] = [
      { year: 2024, amount: new Decimal("-2000"), remaining: new Decimal("-2000"), category: "income" },
    ];

    // 4000 gains, no income → max 25% = 1000 cross-compensation
    const result = applyLossCarryforward(2025, new Decimal("4000"), new Decimal("0"), priorLosses);

    expect(result.adjustedGains.toFixed(2)).toBe("3000.00"); // 4000 - 1000
    expect(result.totalCompensated.toFixed(2)).toBe("1000.00");
  });

  it("should expire losses older than 4 years", () => {
    const priorLosses: LossCarryforward[] = [
      { year: 2020, amount: new Decimal("-3000"), remaining: new Decimal("-3000"), category: "gains" },
      { year: 2023, amount: new Decimal("-500"), remaining: new Decimal("-500"), category: "gains" },
    ];

    const result = applyLossCarryforward(2025, new Decimal("5000"), new Decimal("0"), priorLosses);

    // 2020 loss expired (5 years old), only 2023 loss compensated
    expect(result.expiredLosses.toFixed(2)).toBe("3000.00");
    expect(result.adjustedGains.toFixed(2)).toBe("4500.00"); // 5000 - 500
    expect(result.totalCompensated.toFixed(2)).toBe("500.00");
  });

  it("should add current year losses to carryforward", () => {
    const result = applyLossCarryforward(
      2025,
      new Decimal("-2000"), // Net loss on gains
      new Decimal("500"),   // Positive income
      [],
    );

    expect(result.updatedCarryforward).toHaveLength(1);
    expect(result.updatedCarryforward[0]!.year).toBe(2025);
    expect(result.updatedCarryforward[0]!.category).toBe("gains");
    expect(result.updatedCarryforward[0]!.remaining.toFixed(2)).toBe("-2000.00");
  });

  it("should use FIFO order for loss consumption (oldest first)", () => {
    const priorLosses: LossCarryforward[] = [
      { year: 2022, amount: new Decimal("-500"), remaining: new Decimal("-500"), category: "gains" },
      { year: 2024, amount: new Decimal("-300"), remaining: new Decimal("-300"), category: "gains" },
    ];

    const result = applyLossCarryforward(2025, new Decimal("600"), new Decimal("0"), priorLosses);

    // Should use 2022 first (500), then 100 from 2024
    expect(result.adjustedGains.toFixed(2)).toBe("0.00");
    expect(result.totalCompensated.toFixed(2)).toBe("600.00");

    // 2024 should have 200 remaining
    const remaining2024 = result.updatedCarryforward.find((l) => l.year === 2024);
    expect(remaining2024).toBeDefined();
    expect(remaining2024!.remaining.abs().toFixed(2)).toBe("200.00");

    // 2022 should be fully consumed (not in carryforward)
    const remaining2022 = result.updatedCarryforward.find((l) => l.year === 2022);
    expect(remaining2022).toBeUndefined();
  });

  it("should handle no prior losses gracefully", () => {
    const result = applyLossCarryforward(2025, new Decimal("5000"), new Decimal("1000"), []);

    expect(result.adjustedGains.toFixed(2)).toBe("5000.00");
    expect(result.adjustedIncome.toFixed(2)).toBe("1000.00");
    expect(result.totalCompensated.toFixed(2)).toBe("0.00");
    expect(result.updatedCarryforward).toHaveLength(0);
  });
});
