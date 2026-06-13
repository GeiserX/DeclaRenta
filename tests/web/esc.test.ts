import { describe, it, expect } from "vitest";
import { esc } from "../../src/web/esc.js";

describe("esc — HTML escaping (XSS prevention)", () => {
  it("escapes ampersand", () => {
    expect(esc("a & b")).toBe("a &amp; b");
  });

  it("escapes less-than", () => {
    expect(esc("a < b")).toBe("a &lt; b");
  });

  it("escapes greater-than", () => {
    expect(esc("a > b")).toBe("a &gt; b");
  });

  it("escapes double quote", () => {
    expect(esc('say "hi"')).toBe("say &quot;hi&quot;");
  });

  it("escapes single quote (closes the single-quoted-attribute XSS gap)", () => {
    expect(esc("it's")).toBe("it&#39;s");
  });

  it("escapes all five special characters in one pass", () => {
    expect(esc(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("escapes & first so other entities are not double-escaped", () => {
    // If '<' were replaced before '&', the '&' in '&lt;' would become '&amp;lt;'.
    expect(esc("<")).toBe("&lt;");
    expect(esc(">")).toBe("&gt;");
    expect(esc('"')).toBe("&quot;");
    expect(esc("'")).toBe("&#39;");
    // A literal entity-like string must only have its leading '&' escaped once.
    expect(esc("&lt;")).toBe("&amp;lt;");
    expect(esc("&amp;")).toBe("&amp;amp;");
  });

  it("neutralizes a script-injection payload in a single-quoted attribute", () => {
    // The payload would break out of value='...' if the single quote were not escaped.
    const payload = "x' onerror='alert(1)";
    expect(esc(payload)).toBe("x&#39; onerror=&#39;alert(1)");
  });

  it("leaves safe text unchanged", () => {
    expect(esc("Bitcoin 1.5 BTC")).toBe("Bitcoin 1.5 BTC");
  });

  it("returns empty string for empty input", () => {
    expect(esc("")).toBe("");
  });
});
