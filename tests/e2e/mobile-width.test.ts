/**
 * Phone-width layout check for the results step (wizard step 3).
 *
 * Builds the real web app, serves it with `vite preview`, drives headless
 * Chrome over the DevTools protocol through the upload wizard with
 * tests/fixtures/ibkr-sample.xml, and measures the rendered page at 375 and
 * 390 CSS px. The casilla amounts are what the user types into Renta Web, so
 * the page must not scroll sideways and every amount and copy button must sit
 * inside the screen.
 *
 * ECB requests are answered locally with a flat rate, so the test needs no
 * network. It needs a Chrome or Chromium binary (CHROME_PATH, or a standard
 * install path); without one it is skipped locally and fails in CI.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview, type PreviewServer } from "vite";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const FIXTURE = join(ROOT, "tests/fixtures/ibkr-sample.xml");

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
}

describe.skipIf(!CHROME)("results step fits a phone screen", () => {
  let outDir = "";
  let profileDir = "";
  let server: PreviewServer | undefined;
  let chrome: ChildProcess | undefined;
  let cdp: Cdp | undefined;
  let watchdog: ChildProcess | undefined;
  let baseUrl = "";

  beforeAll(async () => {
    outDir = mkdtempSync(join(tmpdir(), "declarenta-e2e-web-"));
    profileDir = mkdtempSync(join(tmpdir(), "declarenta-e2e-chrome-"));
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

    const args = [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "about:blank",
    ];
    // Its own process group, so teardown can kill every Chrome helper at once.
    const proc = spawn(CHROME!, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
    chrome = proc;
    // Vitest can end its worker without an "exit" event, so a separate process
    // kills the group if this one goes away before afterAll has.
    watchdog = spawn(
      "sh",
      ["-c", `while kill -0 ${process.pid} 2>/dev/null; do sleep 1; done; kill -KILL -${proc.pid!} 2>/dev/null`],
      { detached: true, stdio: "ignore" },
    );
    watchdog.unref();
    const wsUrl = await new Promise<string>((res, rej) => {
      let buf = "";
      const timer = setTimeout(() => { rej(new Error(`Chrome did not start: ${buf}`)); }, 30_000);
      proc.stderr.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
        if (m?.[1]) {
          clearTimeout(timer);
          res(m[1]);
        }
      });
      proc.on("exit", (code) => { clearTimeout(timer); rej(new Error(`Chrome exited (${code}): ${buf}`)); });
    });
    cdp = await Cdp.connect(wsUrl);
  }, 180_000);

  afterAll(async () => {
    // Chrome's helpers keep writing into the profile after the browser process
    // is killed, and removing the profile under them fails with ENOTEMPTY. Ask
    // Chrome to shut down, then kill its whole group and wait until it is empty.
    let leaked = false;
    if (chrome?.pid !== undefined) {
      const pgid = chrome.pid;
      if (cdp) {
        try {
          void cdp.send("Browser.close").catch(() => undefined);
          await exited(chrome, 5_000);
        } catch {
          // The socket is already closed; the group kill below still runs.
        }
      }
      killGroup(pgid);
      await exited(chrome, 5_000);
      const deadline = Date.now() + 5_000;
      while (killGroup(pgid, 0) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      leaked = killGroup(pgid, 0);
      // Keep the watchdog if anything survived, so it still dies with the worker.
      if (!leaked) watchdog?.kill("SIGKILL");
    }
    cdp?.close();
    await server?.close();
    for (const dir of [outDir, profileDir]) {
      if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    if (leaked) throw new Error("mobile-width e2e: Chrome processes still alive 5 s after SIGKILL");
  }, 30_000);

  async function resultsLayouts(width: number): Promise<Layout[]> {
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
    await send("Page.navigate", { url: baseUrl });
    await waitFor(`document.readyState === "complete" && !!document.getElementById("splash-cta")`, "page load");

    await evaluate(`document.getElementById("splash-cta").click()`);
    await waitFor(`!document.body.classList.contains("splash-visible")`, "splash dismissed");
    const { root } = (await send("DOM.getDocument")) as { root: { nodeId: number } };
    const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#file-input" })) as { nodeId: number };
    await send("DOM.setFileInputFiles", { nodeId, files: [FIXTURE] });

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
    // Let fonts and late layout settle before measuring.
    await evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);

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
      };
    })()`;
    const asRendered = await evaluate<Layout>(measure);
    // The fixture's amounts are short; a real return can carry seven-digit
    // figures, so check the layout still holds with the widest plausible value.
    await evaluate(`document.querySelectorAll("#casillas .casilla-value").forEach((el) => { el.textContent = "-1.234.567,89 EUR"; })`);
    const largeAmounts = await evaluate<Layout>(measure);
    await c.send("Target.closeTarget", { targetId });
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
      }
    }, 120_000);
  }
});
