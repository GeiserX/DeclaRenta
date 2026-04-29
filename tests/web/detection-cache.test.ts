import { describe, it, expect, vi } from "vitest";
import { resolveDetection, DETECTION_ERROR, type DetectionEntry } from "../../src/web/detection-cache.js";

const CONTENT = "raw-file-content";

type FakeParser = { name: string };

function resolve(
  cached: DetectionEntry | undefined,
  detect: (c: string) => FakeParser | undefined,
  get: (n: string) => FakeParser | undefined,
): FakeParser | undefined {
  return resolveDetection<FakeParser>(cached, CONTENT, detect, get);
}

describe("resolveDetection — cache semantics", () => {
  it("undefined: cache miss → runs detectFn (full detection path)", () => {
    const parser: FakeParser = { name: "IBKR" };
    const detectFn = vi.fn((): FakeParser | undefined => parser);
    const getBrokerFn = vi.fn((): FakeParser | undefined => undefined);

    const result = resolve(undefined, detectFn, getBrokerFn);

    expect(detectFn).toHaveBeenCalledOnce();
    expect(detectFn).toHaveBeenCalledWith(CONTENT);
    expect(getBrokerFn).not.toHaveBeenCalled();
    expect(result).toBe(parser);
  });

  it("broker name: cache hit → uses getBrokerFn, skips detectFn entirely", () => {
    const parser: FakeParser = { name: "Degiro" };
    const detectFn = vi.fn((): FakeParser | undefined => undefined);
    const getBrokerFn = vi.fn((): FakeParser | undefined => parser);

    const result = resolve("Degiro", detectFn, getBrokerFn);

    expect(getBrokerFn).toHaveBeenCalledOnce();
    expect(getBrokerFn).toHaveBeenCalledWith("Degiro");
    expect(detectFn).not.toHaveBeenCalled();
    expect(result).toBe(parser);
  });

  it("null: attempted, not found → returns undefined, neither fn called (chip fallback kicks in)", () => {
    const detectFn = vi.fn((): FakeParser | undefined => undefined);
    const getBrokerFn = vi.fn((): FakeParser | undefined => undefined);

    const result = resolve(null, detectFn, getBrokerFn);

    expect(detectFn).not.toHaveBeenCalled();
    expect(getBrokerFn).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it("DETECTION_ERROR: pre-detection failed → retries detectFn (not treated as null)", () => {
    const parser: FakeParser = { name: "Kraken" };
    const detectFn = vi.fn((): FakeParser | undefined => parser);
    const getBrokerFn = vi.fn((): FakeParser | undefined => undefined);

    const result = resolve(DETECTION_ERROR, detectFn, getBrokerFn);

    expect(detectFn).toHaveBeenCalledOnce();
    expect(getBrokerFn).not.toHaveBeenCalled();
    expect(result).toBe(parser);
  });

  it("DETECTION_ERROR vs null are distinct: error retries, null does not", () => {
    const detectFn = vi.fn((): FakeParser | undefined => undefined);
    const getBrokerFn = vi.fn((): FakeParser | undefined => undefined);

    resolve(DETECTION_ERROR, detectFn, getBrokerFn);
    const callsAfterError = detectFn.mock.calls.length;

    detectFn.mockClear();
    resolve(null, detectFn, getBrokerFn);
    const callsAfterNull = detectFn.mock.calls.length;

    expect(callsAfterError).toBe(1);
    expect(callsAfterNull).toBe(0);
  });
});
