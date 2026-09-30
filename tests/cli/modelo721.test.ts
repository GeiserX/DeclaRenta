/**
 * `declarenta modelo721` generates nothing: the official 721 is an XML format the
 * CLI does not produce. It used to exit 0 with no output and claim there were no
 * crypto parsers, so a script asking for `-o 721.txt` saw success and no file.
 */

import { describe, expect, it } from "vitest";
import { runCli } from "./run-cli.js";

describe("declarenta modelo721", () => {
  it.each([
    ["with the old arguments", ["-i", "positions.json", "-y", "2025", "--nif", "12345678Z", "--name", "Apellido, Nombre", "-o", "721.txt"]],
    ["with no arguments", []],
  ])("fails and points to the web %s", (_label, args) => {
    const res = runCli(["modelo721", ...args]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("no está disponible en la CLI");
    expect(res.stderr).not.toContain("no hay parsers de crypto");
  }, 30_000);
});
