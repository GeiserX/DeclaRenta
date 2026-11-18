import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

// #442: tsconfig.test.json extends tsconfig.json, whose exclude lists "tests".
// An inherited exclude wins over the child's include, so `npm run
// typecheck:tests` checked no test file and stayed green over 195 type errors.
// This reads the config the way tsc does and checks every test file is in it.

const root = resolve(import.meta.dirname, "..");

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "fixtures" ? [] : testFiles(p);
    return e.name.endsWith(".ts") ? [p] : [];
  });
}

describe("tsconfig.test.json", () => {
  it("type-checks every test file", () => {
    const parsed = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.test.json"), {}, {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
      },
    });
    expect(parsed?.errors ?? []).toEqual([]);
    const checked = new Set(parsed!.fileNames.map((f) => resolve(f)));
    const files = testFiles(join(root, "tests"));
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => !checked.has(f))).toEqual([]);
  });
});
