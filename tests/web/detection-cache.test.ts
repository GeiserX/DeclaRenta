import { describe, it, expect, vi } from "vitest";
import { resolveDetection } from "../../src/web/detection-cache.js";

const CONTENT = "raw-file-content";

describe("resolveDetection — cache semantics", () => {
  it("undefined: cache miss → runs detectFn (full detection path)", () => {
    const parser = { name: "IBKR" };
    const detectFn = vi.fn().mockReturnValue(parser);
    const getBrokerFn = vi.fn();

    const result = resolveDetection(undefined, CONTENT, detectFn, getBrokerFn);

    expect(detectFn).toHaveBeenCalledOnce();
    expect(detectFn).toHaveBeenCalledWith(CONTENT);
    expect(getBrokerFn).not.toHaveBeenCalled();
    expect(result).toBe(parser);
  });

  it("broker name: cache hit → uses getBrokerFn, skips detectFn entirely", () => {
    const parser = { name: "Degiro" };
    const detectFn = vi.fn();
    const getBrokerFn = vi.fn().mockReturnValue(parser);

    const result = resolveDetection("Degiro", CONTENT, detectFn, getBrokerFn);

    expect(getBrokerFn).toHaveBeenCalledOnce();
    expect(getBrokerFn).toHaveBeenCalledWith("Degiro");
    expect(detectFn).not.toHaveBeenCalled();
    expect(result).toBe(parser);
  });

  it("null: attempted, not found → returns undefined, neither fn called (chip fallback kicks in)", () => {
    const detectFn = vi.fn();
    const getBrokerFn = vi.fn();

    const result = resolveDetection(null, CONTENT, detectFn, getBrokerFn);

    expect(detectFn).not.toHaveBeenCalled();
    expect(getBrokerFn).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("__error__: pre-detection failed → retries detectFn (not treated as null)", () => {
    const parser = { name: "Kraken" };
    const detectFn = vi.fn().mockReturnValue(parser);
    const getBrokerFn = vi.fn();

    const result = resolveDetection("__error__", CONTENT, detectFn, getBrokerFn);

    expect(detectFn).toHaveBeenCalledOnce();
    expect(getBrokerFn).not.toHaveBeenCalled();
    expect(result).toBe(parser);
  });

  it("__error__ vs null are distinct: error retries, null does not", () => {
    const detectFn = vi.fn().mockReturnValue(undefined);
    const getBrokerFn = vi.fn();

    resolveDetection("__error__", CONTENT, detectFn, getBrokerFn);
    const callsAfterError = detectFn.mock.calls.length;

    detectFn.mockClear();
    resolveDetection(null, CONTENT, detectFn, getBrokerFn);
    const callsAfterNull = detectFn.mock.calls.length;

    expect(callsAfterError).toBe(1);
    expect(callsAfterNull).toBe(0);
  });
});
