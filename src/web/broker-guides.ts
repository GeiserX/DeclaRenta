/**
 * Broker selection cards + step-by-step guides.
 *
 * Renders a visual grid of broker cards. Users click to select one or more.
 * Selected brokers show their download guide inline below the grid.
 */

import { t } from "../i18n/index.js";

interface BrokerInfo {
  id: string;
  format: string;
}

const BROKERS: BrokerInfo[] = [
  { id: "ibkr", format: "XML" },
  { id: "degiro", format: "CSV" },
  { id: "scalable", format: "CSV" },
  { id: "etoro", format: "XLSX" },
  { id: "freedom24", format: "JSON" },
  { id: "trade_republic", format: "CSV" },
  { id: "revolut", format: "CSV" },
  { id: "trading212", format: "CSV" },
  { id: "lightyear", format: "CSV" },
  { id: "mexem", format: "XML" },
  { id: "swissquote", format: "CSV" },
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

function renderCards(grid: HTMLElement): void {
  grid.innerHTML = BROKERS.map((b) => {
    const title = t(`guide.${b.id}.title` as Parameters<typeof t>[0]);
    const isSelected = selected.has(b.id);
    return `
      <button class="broker-card${isSelected ? " selected" : ""}" data-broker="${b.id}" type="button" aria-pressed="${isSelected}">
        <span class="broker-card-check">${isSelected ? "&#10003;" : ""}</span>
        <span class="broker-card-name">${title}</span>
        <span class="broker-card-format">${b.format}</span>
      </button>
    `;
  }).join("");
}

function renderGuides(container: HTMLElement): void {
  if (selected.size === 0) {
    container.innerHTML = "";
    return;
  }

  const guides = Array.from(selected).map((brokerId) => {
    const title = t(`guide.${brokerId}.title` as Parameters<typeof t>[0]);
    const steps = getGuideSteps(brokerId);
    if (steps.length === 0) return "";
    return `
      <div class="broker-guide open" data-broker="${brokerId}">
        <div class="broker-guide-header">
          <span class="broker-guide-name">${title}</span>
        </div>
        <div class="broker-guide-content">
          <ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
          <p class="guide-tip">${t("guide.tip_fifo")}</p>
        </div>
      </div>
    `;
  }).join("");

  container.innerHTML = guides;
}

/** Initialize broker card grid + guides */
export function initBrokerGuides(): void {
  const grid = document.getElementById("broker-card-grid");
  const guideContainer = document.getElementById("broker-guide-container");
  if (!grid || !guideContainer) return;

  function update(): void {
    renderCards(grid!);
    renderGuides(guideContainer!);

    // Bind card clicks
    grid!.querySelectorAll<HTMLButtonElement>(".broker-card").forEach((card) => {
      card.addEventListener("click", () => {
        const id = card.dataset.broker!;
        if (selected.has(id)) {
          selected.delete(id);
        } else {
          selected.add(id);
        }
        update();
      });
    });
  }

  update();

  // Re-render when locale changes
  document.addEventListener("localechange", () => update());
}
