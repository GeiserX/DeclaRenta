/**
 * Layout check for the results step (wizard step 3).
 *
 * Builds the real web app, serves it with `vite preview`, drives headless
 * Chrome (dark theme) over the DevTools protocol through the upload wizard with
 * tests/fixtures/ibkr-sample.xml, and measures the rendered page at 375 and
 * 390 CSS px. The casilla amounts are what the user types into Renta Web, so
 * the page must not scroll sideways and every amount and copy button must sit
 * inside the screen.
 *
 * It also uploads the two-broker fixtures and checks, at 1280 and 390 px, that
 * the operations table and the annex show the purchase and sale broker with no
 * cell wrapped to a second line.
 *
 * ECB requests are answered locally with a flat rate, so the test needs no
 * network. It needs a Chrome or Chromium binary (CHROME_PATH, or a standard
 * install path); without one it is skipped locally and fails in CI.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview, type PreviewServer } from "vite";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const FIXTURE = join(ROOT, "tests/fixtures/ibkr-sample.xml");
// Two brokers: a sale at Degiro uses shares bought at Interactive Brokers.
const TWO_BROKER_FIXTURES = [
  join(ROOT, "tests/fixtures/two-broker-ibkr.xml"),
  join(ROOT, "tests/fixtures/two-broker-degiro.csv"),
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const CHROME = CHROME_CANDIDATES.find((p): p is string => typeof p === "string" && existsSync(p));

if (!CHROME && process.env.CI) {
  throw new Error("mobile-width e2e: no Chrome/Chromium binary found in CI (set CHROME_PATH)");
}

interface CdpMessage {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
}

/** Minimal DevTools-protocol client over the browser WebSocket (flattened sessions). */
class Cdp {
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private listeners: ((msg: CdpMessage) => void)[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (ev: MessageEvent<string>) => {
      const msg = JSON.parse(ev.data) as CdpMessage;
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? {});
        return;
      }
      for (const l of this.listeners) l(msg);
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const ws = new WebSocket(url);
    await new Promise<void>((res, rej) => {
      ws.addEventListener("open", () => { res(); });
      ws.addEventListener("error", () => { rej(new Error(`CDP connect failed: ${url}`)); });
    });
    return new Cdp(ws);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }

  on(listener: (msg: CdpMessage) => void): void {
    this.listeners.push(listener);
  }

  close(): void {
    this.ws.close();
  }
}

/** Resolves true once `proc` has exited, or false after `ms`. */
function exited(proc: ChildProcess, ms: number): Promise<boolean> {
  if (proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve(true);
  return new Promise((res) => {
    const timer = setTimeout(() => { res(false); }, ms);
    proc.once("exit", () => { clearTimeout(timer); res(true); });
  });
}

/** Sends `signal` to every process in group `pgid` (0 only probes); false once the group is empty. */
function killGroup(pgid: number, signal: NodeJS.Signals | 0 = "SIGKILL"): boolean {
  try {
    process.kill(-pgid, signal);
    return true;
  } catch {
    return false; // ESRCH: the group is empty
  }
}

/** Headless Chrome in its own process group, plus the watchdog that kills the group if the test dies. */
interface Chrome {
  proc: ChildProcess;
  watchdog: ChildProcess;
  stderr: () => string;
}

function startChrome(profileDir: string): Chrome {
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-component-update",
    ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    "about:blank",
  ];
  // Its own process group, so teardown can kill every Chrome helper at once.
  const proc = spawn(CHROME!, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
  // Keep draining stderr for Chrome's whole life, or a full pipe can stall it.
  let stderr = "";
  proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  // Vitest can end its worker without an "exit" event, so a separate process
  // kills the group if this one goes away before stopChrome has.
  const watchdog = spawn(
    "sh",
    ["-c", `while kill -0 ${process.pid} 2>/dev/null; do sleep 1; done; kill -KILL -${proc.pid!} 2>/dev/null`],
    { detached: true, stdio: "ignore" },
  );
  watchdog.unref();
  return { proc, watchdog, stderr: () => stderr };
}

/**
 * The browser's DevTools WebSocket URL. Chrome writes the port and path to
 * DevToolsActivePort in its profile once it listens; the stderr banner is a
 * second source. A loaded CI runner can take tens of seconds to get there.
 */
async function devtoolsUrl(chrome: Chrome, profileDir: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const [port, path] = readFileSync(join(profileDir, "DevToolsActivePort"), "utf8").split("\n");
      if (port && /^\d+$/.test(port) && path?.startsWith("/devtools/browser/")) return `ws://127.0.0.1:${port}${path}`;
    } catch {
      // Not written yet.
    }
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(chrome.stderr());
    if (m?.[1]) return m[1];
    const { exitCode, signalCode } = chrome.proc;
    if (exitCode !== null || signalCode !== null) throw new Error(`Chrome exited (${exitCode ?? signalCode}): ${chrome.stderr()}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chrome did not start within ${timeoutMs / 1000} s: ${chrome.stderr()}`);
}

/**
 * Stops Chrome and every helper it started; true if any of them is still alive.
 * Chrome's helpers keep writing into the profile after the browser process is
 * killed, and removing the profile under them fails with ENOTEMPTY. Ask Chrome
 * to shut down, then kill its whole group and wait until it is empty.
 */
async function stopChrome(chrome: Chrome, cdp: Cdp | undefined): Promise<boolean> {
  const { proc, watchdog } = chrome;
  if (proc.pid === undefined) return false;
  const pgid = proc.pid;
  if (cdp) {
    try {
      void cdp.send("Browser.close").catch(() => undefined);
      await exited(proc, 5_000);
    } catch {
      // The socket is already closed; the group kill below still runs.
    }
  }
  killGroup(pgid);
  await exited(proc, 5_000);
  const deadline = Date.now() + 5_000;
  while (killGroup(pgid, 0) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const leaked = killGroup(pgid, 0);
  // Keep the watchdog if anything survived, so it still dies with the worker.
  if (!leaked) watchdog.kill("SIGKILL");
  return leaked;
}

/** A flat-rate ECB csvdata response covering every day of the requested year. */
function fakeEcbCsv(url: string): string {
  const year = Number(/startPeriod=(\d{4})/.exec(url)?.[1] ?? "2024");
  const rows = ["KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE"];
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    rows.push(`EXR.D.USD.EUR.SP00.A,D,USD,EUR,SP00,A,${d.toISOString().slice(0, 10)},1.1`);
  }
  return rows.join("\n") + "\n";
}

interface Layout {
  innerWidth: number;
  scrollWidth: number;
  appContentWidth: number;
  values: { right: number; rowRight: number }[];
  copies: { right: number; width: number }[];
  annexWraps: { right: number; overflowX: string; scrolls: boolean }[];
}

describe.skipIf(!CHROME)("results step layout", () => {
  let outDir = "";
  let profileDir = "";
  let server: PreviewServer | undefined;
  let chrome: Chrome | undefined;
  let cdp: Cdp | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "declarenta-e2e-web-"));
    const configFile = join(ROOT, "vite.config.ts");
    await build({ configFile, logLevel: "error", build: { outDir, emptyOutDir: true } });
    server = await preview({
      configFile,
      logLevel: "error",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0, strictPort: false, open: false },
    });
    baseUrl = server.resolvedUrls?.local[0] ?? "";
    expect(baseUrl).not.toBe("");

    // One retry with a fresh profile if Chrome dies or never comes up.
    let wsUrl = "";
    for (let attempt = 1; !wsUrl; attempt++) {
      profileDir = mkdtempSync(join(tmpdir(), "declarenta-e2e-chrome-"));
      chrome = startChrome(profileDir);
      try {
        wsUrl = await devtoolsUrl(chrome, profileDir, 60_000);
      } catch (err) {
        if (attempt === 2) throw err;
        if (await stopChrome(chrome, undefined)) throw new Error("mobile-width e2e: Chrome processes still alive 5 s after SIGKILL");
        rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
    cdp = await Cdp.connect(wsUrl);
  }, 240_000);

  afterAll(async () => {
    const leaked = chrome ? await stopChrome(chrome, cdp) : false;
    cdp?.close();
    await server?.close();
    for (const dir of [outDir, profileDir]) {
      if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    if (leaked) throw new Error("mobile-width e2e: Chrome processes still alive 5 s after SIGKILL");
  }, 30_000);

  /** Opens the app at `width`, uploads `files` and walks the wizard to the results step. */
  async function openResults(
    width: number,
    files: string[],
  ): Promise<{ evaluate: <T>(expression: string) => Promise<T>; close: () => Promise<unknown> }> {
    const c = cdp!;
    const { targetId } = await c.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = (await c.send("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
    const send = (method: string, params: Record<string, unknown> = {}) => c.send(method, params, sessionId);

    // Answer ECB rate requests locally (no network in the test).
    c.on((msg) => {
      if (msg.sessionId !== sessionId || msg.method !== "Fetch.requestPaused") return;
      const params = msg.params as { requestId: string; request: { url: string } };
      void send("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: "Content-Type", value: "text/csv" },
          { name: "Access-Control-Allow-Origin", value: "*" },
        ],
        body: Buffer.from(fakeEcbCsv(params.request.url)).toString("base64"),
      });
    });

    const evaluate = async <T>(expression: string): Promise<T> => {
      const r = (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })) as {
        result: { value: T };
        exceptionDetails?: { text: string };
      };
      if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.text}`);
      return r.result.value;
    };
    const waitFor = async (expression: string, what: string): Promise<void> => {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (await evaluate<boolean>(expression)) return;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`timed out waiting for ${what}`);
    };

    await send("Page.enable");
    await send("Page.bringToFront");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Network.setBypassServiceWorker", { bypass: true });
    await send("Fetch.enable", { patterns: [{ urlPattern: "*data-api.ecb.europa.eu*" }] });
    // A plain narrow viewport: `mobile: true` lets Chrome widen the layout
    // viewport to fit overflowing content, which would hide the defect.
    await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: false });
    // Phones draw overlay scrollbars; without this, Linux Chrome reserves 15px
    // for a classic scrollbar and the page measures narrower than the screen.
    await send("Emulation.setScrollbarsHidden", { hidden: true });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
    await send("Page.navigate", { url: baseUrl });
    await waitFor(`document.readyState === "complete" && !!document.getElementById("splash-cta")`, "page load");

    await evaluate(`document.getElementById("splash-cta").click()`);
    await waitFor(`!document.body.classList.contains("splash-visible")`, "splash dismissed");
    const { root } = (await send("DOM.getDocument")) as { root: { nodeId: number } };
    const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-input" })) as { nodeId: number };
    await send("DOM.setFileInputFiles", { nodeId, files });

    await waitFor(`!document.getElementById("wizard-next").disabled`, "file accepted");
    await evaluate(`document.getElementById("wizard-next").click()`);
    await waitFor(
      `!document.getElementById("wizard-step-2").hidden && !document.getElementById("wizard-next").disabled`,
      "step 2",
    );
    await evaluate(`document.getElementById("wizard-next").click()`);
    await waitFor(
      `!document.getElementById("wizard-step-3").hidden && document.querySelectorAll("#casillas .casilla-value").length > 0`,
      "step 3 with casillas",
    );
    // Open the operations annex groups: their tables are wider than a phone.
    await evaluate(`document.querySelectorAll(".annex-group").forEach((d) => { d.open = true; })`);
    // Let fonts and late layout settle before measuring.
    await evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    return { evaluate, close: () => c.send("Target.closeTarget", { targetId }) };
  }

  async function resultsLayouts(width: number): Promise<Layout[]> {
    const { evaluate, close } = await openResults(width, [FIXTURE]);
    const measure = `(() => {
      const rect = (el) => el.getBoundingClientRect();
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        appContentWidth: rect(document.getElementById("app-content")).width,
        // Measure the text itself, not the span's box: a shrunk flex item can
        // let its nowrap text spill past the box into the copy button.
        values: [...document.querySelectorAll("#casillas .casilla-value")].map((el) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          return { right: range.getBoundingClientRect().right, rowRight: rect(el.closest(".casilla-trigger")).right };
        }),
        copies: [...document.querySelectorAll("#casillas .casilla-copy")].map((el) => ({ right: rect(el).right, width: rect(el).width })),
        annexWraps: [...document.querySelectorAll(".annex-table-wrap")].map((el) => ({
          right: rect(el).right,
          overflowX: getComputedStyle(el).overflowX,
          scrolls: el.scrollWidth > el.clientWidth,
        })),
      };
    })()`;
    const asRendered = await evaluate<Layout>(measure);
    // The fixture's amounts are short; a real return can carry seven-digit
    // figures, so check the layout still holds with the widest plausible value.
    await evaluate(`document.querySelectorAll("#casillas .casilla-value").forEach((el) => { el.textContent = "-1.234.567,89 EUR"; })`);
    const largeAmounts = await evaluate<Layout>(measure);
    await close();
    return [asRendered, largeAmounts];
  }

  for (const width of [375, 390]) {
    it(`keeps casilla amounts on screen at ${width}px`, async () => {
      for (const layout of await resultsLayouts(width)) {
        expect(layout.innerWidth).toBe(width);
        // No sideways scroll: the page is exactly as wide as the screen.
        expect(layout.scrollWidth).toBe(width);
        expect(layout.appContentWidth).toBeGreaterThan(0);
        expect(layout.appContentWidth).toBeLessThanOrEqual(width);

        expect(layout.values.length).toBeGreaterThan(0);
        for (const v of layout.values) {
          expect(v.right).toBeGreaterThan(0);
          expect(v.right).toBeLessThanOrEqual(width);
          // The amount stays inside its own row instead of running under the copy button.
          expect(v.right).toBeLessThanOrEqual(v.rowRight + 0.5);
        }

        // Copy buttons stay compact icon buttons inside the screen, not full-width rows.
        expect(layout.copies.length).toBeGreaterThan(0);
        for (const cp of layout.copies) {
          expect(cp.right).toBeLessThanOrEqual(width);
          expect(cp.width).toBeGreaterThan(0);
          expect(cp.width).toBeLessThan(100);
        }

        // The annex tables scroll sideways inside the screen instead of being cut off.
        expect(layout.annexWraps.length).toBeGreaterThan(0);
        for (const w of layout.annexWraps) {
          expect(w.right).toBeLessThanOrEqual(width);
          if (w.scrolls) expect(w.overflowX).toBe("auto");
        }
      }
    }, 120_000);
  }

  /**
   * Text lines a cell's text takes. Text boxes whose tops are within 6 px sit
   * on one line (a smaller badge font starts a little lower).
   */
  const LINES_OF = `(el) => {
    const tops = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0) tops.push(r.top);
    }
    tops.sort((a, b) => a - b);
    let lines = 0;
    let last = -Infinity;
    for (const top of tops) if (top - last > 6) { lines++; last = top; }
    return lines;
  }`;

  interface TwoBrokerLayout {
    lang: string;
    scrollWidth: number;
    opsCols: string[];
    /** Each table box as "scrollWidth/clientWidth overflow-x", the results table first. */
    boxes: string[];
    wrapped: string[];
    symbols: { text: string; title: string }[];
    truncated: string[];
    fontSizes: string[];
    /** Per broker table: font size, cell padding, header wrap, symbol cap and sort-arrow room. */
    tuning: string[];
  }

  for (const width of [1280, 390]) {
    it(`keeps the two-broker operations table and annex on one line per row at ${width}px, in every locale`, async () => {
      const { evaluate, close } = await openResults(width, TWO_BROKER_FIXTURES);
      const layouts: Record<string, TwoBrokerLayout> = {};
      for (const locale of ["es", "en", "ca", "gl", "eu"]) {
        // Switching the language re-renders the results; reopen the annex groups.
        await evaluate(`(async () => {
          const select = document.getElementById("lang-select");
          select.value = "${locale}";
          select.dispatchEvent(new Event("change"));
          for (let i = 0; i < 100 && document.documentElement.lang !== "${locale}"; i++) await new Promise((r) => setTimeout(r, 50));
          await new Promise((r) => setTimeout(r, 300));
          document.querySelectorAll(".annex-group").forEach((d) => { d.open = true; });
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        })()`);
        layouts[locale] = await evaluate<TwoBrokerLayout>(`(() => {
          const linesOf = ${LINES_OF};
          const ops = document.getElementById("operations-table");
          const cells = [
            ...ops.querySelectorAll("tbody tr:not(.wash-sale-detail) td"),
            ...document.querySelectorAll(".annex-table tbody tr:not(.wash-sale-detail) td, .annex-table tfoot td"),
          ];
          return {
            lang: document.documentElement.lang,
            scrollWidth: document.documentElement.scrollWidth,
            opsCols: [...ops.querySelectorAll("thead th")].map((th) => th.dataset.col),
            boxes: [ops, ...document.querySelectorAll(".annex-table-wrap")]
              .map((el) => el.scrollWidth + "/" + el.clientWidth + " " + getComputedStyle(el).overflowX),
            wrapped: cells.filter((td) => linesOf(td) > 1).map((td) => td.textContent.trim()),
            symbols: [...document.querySelectorAll(".cell-symbol")].map((el) => ({ text: el.textContent, title: el.title })),
            truncated: [...document.querySelectorAll(".cell-symbol")]
              .filter((el) => el.scrollWidth > el.clientWidth)
              .map((el) => el.textContent),
            fontSizes: [...document.querySelectorAll(".ops-table--brokers, .annex-table--brokers")]
              .map((el) => getComputedStyle(el).fontSize),
            tuning: [...document.querySelectorAll(".ops-table--brokers, .annex-table--brokers")].map((table) => {
              const td = getComputedStyle(table.querySelector("tbody td"));
              const th = getComputedStyle(table.querySelector("thead th"));
              const symbol = getComputedStyle(table.querySelector(".cell-symbol"));
              const sortable = table.querySelector("th.sortable");
              return [
                getComputedStyle(table).fontSize, td.paddingLeft, td.paddingRight, th.whiteSpace,
                symbol.maxWidth, symbol.overflowX, symbol.textOverflow,
                sortable ? getComputedStyle(sortable).paddingRight : "-",
              ].join(" ");
            }),
          };
        })()`);
      }
      await close();

      for (const [locale, layout] of Object.entries(layouts)) {
        expect(layout.lang, locale).toBe(locale);
        // The page never scrolls sideways.
        expect(layout.scrollWidth, locale).toBe(width);
        expect(layout.opsCols, locale).toEqual(
          ["isin", "symbol", "buyDate", "sellDate", "buyBroker", "sellBroker", "qty", "cost", "proceeds", "gl", "days"],
        );
        // No cell wraps: not the long symbol, not a broker name, not an amount
        // (the subtotal "+877,35 EUR" included).
        expect(layout.wrapped, locale).toEqual([]);
        // A symbol cut short keeps its full name in the tooltip.
        expect(layout.symbols, locale).toContainEqual({ text: "ACME WORLD ETF", title: "ACME WORLD ETF" });
        // Whether an eleven-column table fits its box depends on the visitor's
        // system font (Linux falls back to a wider one than macOS), so a table
        // wider than its box must scroll inside it, never be cut off. The
        // numbers are in the message so a regression shows its size.
        expect(layout.boxes.length, locale).toBeGreaterThan(1);
        for (const box of layout.boxes) {
          expect(box.endsWith(" auto"), `${locale}: ${layout.boxes.join(", ")}`).toBe(true);
        }
        if (width === 1280) {
          // What keeps the eleven columns narrow on a desktop: a smaller font,
          // tighter padding, headers that may wrap, a symbol cut at 5rem and just
          // the room the sort arrow needs. Read as computed styles, since whether
          // the table then fits 1280 px depends on the system font.
          expect(new Set(layout.tuning), locale).toEqual(new Set([
            "12.8px 4px 4px normal 80px hidden ellipsis 13.6px",
            "12.8px 4px 4px normal 80px hidden ellipsis -",
          ]));
        }
        if (width === 390) {
          // A phone has no tooltip; the table scrolls inside its box, so the
          // whole symbol shows.
          expect(layout.truncated, locale).toEqual([]);
          // Same 0.75rem as every other table on a phone.
          expect(layout.fontSizes.length, locale).toBeGreaterThan(1);
          expect(new Set(layout.fontSizes), locale).toEqual(new Set(["12px"]));
        }
      }
    }, 120_000);
  }

  for (const width of [1280, 390]) {
    it(`keeps an option row of the two-broker annex to the symbol line and one badge line at ${width}px`, async () => {
      const { evaluate, close } = await openResults(width, [
        join(ROOT, "tests/fixtures/ibkr-options.xml"),
        join(ROOT, "tests/fixtures/two-broker-degiro.csv"),
      ]);
      const cells = await evaluate<{ text: string; lines: number; badgeLines: number }[]>(`(() => {
        const linesOf = ${LINES_OF};
        return [...document.querySelectorAll(".annex-table--brokers .option-badge")].map((badge) => ({
          text: badge.parentElement.textContent.trim(),
          lines: linesOf(badge.parentElement),
          badgeLines: linesOf(badge),
        }));
      })()`);
      const scrollWidth = await evaluate<number>(`document.documentElement.scrollWidth`);
      await close();

      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cell.badgeLines, cell.text).toBe(1);
        expect(cell.lines, cell.text).toBe(2);
      }
      expect(scrollWidth).toBe(width);
    }, 120_000);
  }
});
