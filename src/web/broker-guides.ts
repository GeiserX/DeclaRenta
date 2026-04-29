import { t } from "../i18n/index.js";
import { esc } from "./esc.js";

interface BrokerInfo {
  id: string;
  format: string;
}

const BROKER_LOGOS: Record<string, string> = {
  ibkr:          "./broker-logos/interactive-brokers.ico",
  degiro:        "./broker-logos/degiro.ico",
  scalable:      "./broker-logos/scalable-capital.png",
  etoro:         "./broker-logos/etoro.ico",
  freedom24:     "./broker-logos/freedom24.png",
  trade_republic:"./broker-logos/trade-republic.ico",
  revolut:       "./broker-logos/Revolut.svg",
  trading212:    "./broker-logos/trading-212.ico",
  lightyear:     "./broker-logos/lightyear.ico",
  coinbase:      "./broker-logos/coinbase.png",
  binance:       "./broker-logos/binance.ico",
  kraken:        "./broker-logos/kraken.ico",
};

const BROKERS: BrokerInfo[] = [
  { id: "ibkr", format: "XML" },
  { id: "degiro", format: "CSV" },
  { id: "scalable", format: "CSV" },
  { id: "etoro", format: "XLSX" },
  { id: "freedom24", format: "JSON" },
  { id: "trade_republic", format: "CSV" },
  { id: "revolut", format: "XLSX" },
  { id: "trading212", format: "CSV" },
  { id: "lightyear", format: "CSV" },
  { id: "coinbase", format: "CSV" },
  { id: "binance", format: "CSV" },
  { id: "kraken", format: "CSV" },
];

const selected = new Set<string>();

function getGuideSteps(broker: string): string[] {
  const steps: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = `guide.${broker}.step${i}`;
    const val = t(key as Parameters<typeof t>[0]);
    if (val === key) break;
    steps.push(val);
  }
  return steps;
}

function chipLogoHtml(brokerId: string): string {
  const src = BROKER_LOGOS[brokerId];
  if (src) {
    return `<span class="broker-chip-logo"><img src="${src}" alt="" loading="lazy" /></span>`;
  }
  return `<span class="broker-chip-logo broker-chip-logo--text">${brokerId.slice(0, 2).toUpperCase()}</span>`;
}

function renderChips(grid: HTMLElement): void {
  grid.innerHTML = BROKERS.map((b) => {
    const title = t(`guide.${b.id}.title` as Parameters<typeof t>[0]);
    // Strip "(Format)" suffix — the format badge already shows it
    const shortName = title.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const isSelected = selected.has(b.id);
    return `
      <button class="broker-chip${isSelected ? " selected" : ""}" data-broker="${b.id}" type="button" aria-pressed="${isSelected}" title="${esc(title)}">
        ${chipLogoHtml(b.id)}
        <span class="broker-chip-name">${esc(shortName)}</span>
        <span class="broker-chip-format">${b.format}</span>
      </button>
    `;
  }).join("");
}

function renderGuideForBroker(container: HTMLElement, brokerId: string): void {
  if (!brokerId) {
    container.innerHTML = "";
    return;
  }
  const title = t(`guide.${brokerId}.title` as Parameters<typeof t>[0]);
  const steps = getGuideSteps(brokerId);
  if (steps.length === 0) {
    container.innerHTML = `<p class="guide-empty">${title} — ${t("upload.guide_unavailable")}</p>`;
    return;
  }
  container.innerHTML = `
    <div class="broker-guide open" data-broker="${brokerId}">
      <div class="broker-guide-content" style="display:block;padding:0 0 0.5rem;">
        <ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        <p class="guide-tip">${t("guide.tip_fifo")}</p>
      </div>
    </div>
  `;
}

function populateGuideSelect(select: HTMLSelectElement): void {
  const current = select.value;
  const options = BROKERS
    .filter((b) => getGuideSteps(b.id).length > 0)
    .map((b) => {
      const title = t(`guide.${b.id}.title` as Parameters<typeof t>[0]);
      return `<option value="${b.id}"${current === b.id ? " selected" : ""}>${esc(title)}</option>`;
    })
    .join("");
  select.innerHTML = `<option value="">${t("upload.choose_broker")}</option>${options}`;
  if (current) select.value = current;
}

/** Get the set of broker IDs currently selected by the user */
export function getSelectedBrokerIds(): ReadonlySet<string> {
  return selected;
}

/** Map card IDs to parser names for fallback detection */
export const BROKER_ID_TO_PARSER: Record<string, string> = {
  ibkr: "Interactive Brokers",
  degiro: "Degiro",
  scalable: "Scalable Capital",
  etoro: "eToro",
  freedom24: "Freedom24",
  trade_republic: "Trade Republic",
  revolut: "Revolut",
  trading212: "Trading 212",
  lightyear: "Lightyear",
  coinbase: "Coinbase",
  binance: "Binance",
  kraken: "Kraken",
};

/** Initialize broker chip grid + guide accordion */
export function initBrokerGuides(): void {
  const grid = document.getElementById("broker-card-grid");
  const guideContainer = document.getElementById("broker-guide-container");
  const guideSelect = document.getElementById("guide-broker-select") as HTMLSelectElement | null;

  if (!grid) return;

  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", t("upload.chip_group_label"));

  function updateChips(): void {
    renderChips(grid!);
    grid!.querySelectorAll<HTMLButtonElement>(".broker-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const id = chip.dataset.broker!;
        if (selected.has(id)) {
          selected.delete(id);
        } else {
          selected.add(id);
        }
        updateChips();
      });
    });
  }

  updateChips();

  if (guideSelect && guideContainer) {
    populateGuideSelect(guideSelect);
    guideSelect.addEventListener("change", () => {
      renderGuideForBroker(guideContainer, guideSelect.value);
    });
  }

  document.addEventListener("localechange", () => {
    grid.setAttribute("aria-label", t("upload.chip_group_label"));
    updateChips();
    if (guideSelect && guideContainer) {
      populateGuideSelect(guideSelect);
      renderGuideForBroker(guideContainer, guideSelect.value);
    }
  });
}
