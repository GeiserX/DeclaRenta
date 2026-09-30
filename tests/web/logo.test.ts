// @vitest-environment jsdom
/**
 * The splash and top-bar logo is fetched on every visit and shown at 180 px at
 * most, so the served file is a small export of the realistic bull. The
 * 1024 px original stays in src/web/assets for the social card. The Hard Trace
 * rule still holds: .splash-logo and .brand-logo use logo.png, never the
 * favicon.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const PUBLIC_LOGO = resolve(__dirname, "../../src/web/public/logo.png");
const INDEX_HTML = readFileSync(resolve(__dirname, "../../src/web/index.html"), "utf-8");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("served logo", () => {
  it("is under 150 KB", () => {
    expect(statSync(PUBLIC_LOGO).size).toBeLessThan(150 * 1024);
  });

  it("is square and sharp at 2x the largest display size (180 px)", () => {
    const { width, height } = pngSize(PUBLIC_LOGO);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(360);
  });

  it("is what .splash-logo and .brand-logo reference, never the favicon", () => {
    const doc = new DOMParser().parseFromString(INDEX_HTML, "text/html");
    for (const cls of ["splash-logo", "brand-logo"]) {
      const img = doc.querySelector<HTMLImageElement>(`img.${cls}`);
      expect(img?.getAttribute("src")).toBe("./logo.png");
    }
  });
});
