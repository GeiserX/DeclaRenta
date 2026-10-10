/**
 * The web manifest must be served from the site root. When it sat next to
 * index.html, Vite hashed it into /assets/, so its relative start_url, scope
 * and icons resolved under /assets/ and the icons 404'd: the app was not
 * installable. In public/ it is copied as is and its relative URLs resolve
 * against /.
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const WEB = resolve(__dirname, "../../src/web");
const INDEX_HTML = readFileSync(resolve(WEB, "index.html"), "utf-8");
const MANIFEST_PATH = resolve(WEB, "public/manifest.json");
const ORIGIN = "https://declarenta.com";

interface ManifestIcon { src: string; sizes: string; type: string; purpose?: string }
interface Manifest { start_url: string; scope: string; display: string; icons: ManifestIcon[] }

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): string {
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

describe("web manifest", () => {
  const href = /<link rel="manifest" href="([^"]+)"/.exec(INDEX_HTML)?.[1];
  const manifestUrl = new URL(href ?? "", `${ORIGIN}/`);
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;

  it("is a public file linked from the site root", () => {
    expect(href).toBe("/manifest.json");
    expect(existsSync(resolve(WEB, "manifest.json"))).toBe(false);
  });

  it("starts and scopes the app at the site root", () => {
    expect(new URL(manifest.start_url, manifestUrl).href).toBe(`${ORIGIN}/`);
    expect(new URL(manifest.scope, manifestUrl).href).toBe(`${ORIGIN}/`);
    expect(manifest.display).toBe("standalone");
  });

  it("lists 192 and 512 PNG icons that exist at their declared size", () => {
    for (const size of ["192x192", "512x512"]) {
      const icon = manifest.icons.find((i) => i.sizes === size);
      expect(icon, size).toBeDefined();
      const url = new URL(icon!.src, manifestUrl);
      expect(url.origin).toBe(ORIGIN);
      expect(pngSize(resolve(WEB, "public", `.${url.pathname}`))).toBe(size);
    }
  });
});

describe("service worker source", () => {
  it("keeps the line the build fills with the app shell", () => {
    const sw = readFileSync(resolve(WEB, "public/sw.js"), "utf-8");
    expect(sw).toContain("const PRECACHE_URLS = [];");
  });
});
