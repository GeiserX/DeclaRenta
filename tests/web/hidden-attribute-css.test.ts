import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// A class rule that sets `display` beats the browser's own `[hidden] { display: none }`,
// so an element rendered with `hidden` stays visible unless the stylesheet hides
// `.class[hidden]` too. jsdom applies no CSS, so the panel tests cannot see this:
// the «Guardado» label showed before any Save in three panels.
const WEB = new URL("../../src/web/", import.meta.url).pathname;
const css = readFileSync(join(WEB, "style.css"), "utf8");

/**
 * Classes of every element the web code renders with the `hidden` attribute,
 * written plainly (`<span class="x" hidden>`) or conditionally
 * (`<span class="x"${saved ? "" : " hidden"}>`, the «Guardado» labels since #472).
 */
function hiddenClasses(): Set<string> {
  const out = new Set<string>();
  for (const file of readdirSync(WEB).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(WEB, file), "utf8");
    for (const m of src.matchAll(/<\w+\b[^<>]*?\bclass="([^"$]+)"[^<>]*?\shidden(?=[\s>"])[^<>]*>/g)) {
      for (const cls of m[1]!.split(/\s+/)) if (cls) out.add(cls);
    }
  }
  return out;
}

/** True when the stylesheet gives `.cls` a display other than none in a plain rule. */
function setsDisplay(cls: string): boolean {
  const esc = cls.replace(/[-]/g, "\\-");
  for (const m of css.matchAll(new RegExp(`(^|[},\\s])\\.${esc}\\s*(,[^{]*)?\\{([^}]*)\\}`, "gm"))) {
    const display = /display\s*:\s*([^;]+);/.exec(m[3]!);
    if (display && display[1]!.trim() !== "none") return true;
  }
  return false;
}

function hidesWhenHidden(cls: string): boolean {
  const esc = cls.replace(/[-]/g, "\\-");
  return new RegExp(`\\.${esc}\\[hidden\\][^{]*\\{[^}]*display\\s*:\\s*none`).test(css);
}

describe("elements rendered with `hidden` really hide", () => {
  it("finds the saved labels it guards (the scan is not empty)", () => {
    const found = hiddenClasses();
    expect(found.has("crypto-rates-saved-msg")).toBe(true);
    expect(found.has("antichurning-window-saved")).toBe(true);
    expect(found.has("manual-opening-lots-saved-msg")).toBe(true);
  });

  it("every class that sets display also has a [hidden] rule with display: none", () => {
    const missing = [...hiddenClasses()].filter((cls) => setsDisplay(cls) && !hidesWhenHidden(cls));
    expect(missing).toEqual([]);
  });
});
