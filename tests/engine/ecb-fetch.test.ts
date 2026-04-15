import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchEcbRates } from "../../src/engine/ecb.js";

describe("fetchEcbRates", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should fetch rates and return inverted values", async () => {
    const csvData =
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n" +
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-01-02,1.0350\n" +
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-01-03,1.0400\n";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () => csvData,
    } as Response);

    const rates = await fetchEcbRates(2025, ["USD"]);
    expect(rates.has("2025-01-02")).toBe(true);
    expect(rates.has("2025-01-03")).toBe(true);

    // Inverted: 1/1.035 ≈ 0.966...
    const rate = parseFloat(rates.get("2025-01-02")!.get("USD")!);
    expect(rate).toBeCloseTo(1 / 1.035, 4);
  });

  it("should fetch multiple currencies", async () => {
    const usdCsv =
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n" +
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-01-02,1.0350\n";
    const gbpCsv =
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n" +
      "EXR.D.GBP.EUR.SP00.A,D,GBP,EUR,SP00,A,2025-01-02,0.8600\n";

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({ ok: true, text: async () => usdCsv } as Response)
      .mockResolvedValueOnce({ ok: true, text: async () => gbpCsv } as Response);

    const rates = await fetchEcbRates(2025, ["USD", "GBP"]);
    expect(rates.get("2025-01-02")!.has("USD")).toBe(true);
    expect(rates.get("2025-01-02")!.has("GBP")).toBe(true);
  });

  it("should throw on API error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    } as Response);

    await expect(fetchEcbRates(2025, ["XYZ"])).rejects.toThrow("ECB API error");
  });

  it("should return empty map for empty currencies array", async () => {
    const rates = await fetchEcbRates(2025, []);
    expect(rates.size).toBe(0);
  });

  it("should skip empty lines in CSV", async () => {
    const csvData =
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n" +
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-01-02,1.0350\n" +
      "\n" +
      "\n";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () => csvData,
    } as Response);

    const rates = await fetchEcbRates(2025, ["USD"]);
    expect(rates.size).toBe(1);
  });

  it("should skip lines with empty OBS_VALUE", async () => {
    const csvData =
      "KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE\n" +
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-01-02,1.0350\n" +
      "EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,2025-01-03,\n";

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () => csvData,
    } as Response);

    const rates = await fetchEcbRates(2025, ["USD"]);
    expect(rates.has("2025-01-02")).toBe(true);
    expect(rates.has("2025-01-03")).toBe(false);
  });

  it("should use correct URL format with year range", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      text: async () => "header\n",
    } as Response);

    await fetchEcbRates(2024, ["CHF"]);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("startPeriod=2024-01-01"),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("endPeriod=2024-12-31"),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("D.CHF.EUR"),
    );
  });
});
