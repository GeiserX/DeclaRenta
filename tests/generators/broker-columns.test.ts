import { describe, expect, it } from "vitest";
import { showBrokerColumns } from "../../src/generators/broker-columns.js";

describe("showBrokerColumns", () => {
  it("is false with no sales, or sales that name no broker", () => {
    expect(showBrokerColumns([])).toBe(false);
    expect(showBrokerColumns([{}, {}])).toBe(false);
  });

  it("is false when every sale and lot names the same broker", () => {
    expect(showBrokerColumns([
      { brokerSource: "Degiro", acquireBrokerSource: "Degiro" },
      { brokerSource: "Degiro" },
    ])).toBe(false);
  });

  it("is true when a sale consumed a lot bought at another broker", () => {
    expect(showBrokerColumns([{ brokerSource: "Degiro", acquireBrokerSource: "Interactive Brokers" }])).toBe(true);
  });

  it("is true when the sales come from two brokers", () => {
    expect(showBrokerColumns([{ brokerSource: "Degiro" }, { brokerSource: "Revolut" }])).toBe(true);
  });
});
