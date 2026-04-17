/**
 * Broker-specific document acquisition guides.
 *
 * Shows expandable panels with step-by-step instructions for
 * obtaining the correct report from each supported broker.
 */

import { t } from "../i18n/index.js";

function getGuideSteps(broker: string): string[] {
  const steps: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = `guide.${broker}.step${i}`;
    const val = t(key as Parameters<typeof t>[0]);
    if (val === key) break; // Key doesn't exist, stop
    steps.push(val);
  }
  return steps;
}

/** Initialize broker guide display */
export function initBrokerGuides(): void {
  const brokerSelect = document.getElementById("broker-select") as HTMLSelectElement | null;
  const container = document.getElementById("broker-guide-container");
  if (!brokerSelect || !container) return;

  function renderGuide(): void {
    if (!container) return;
    const selected = brokerSelect!.value;

    if (selected === "auto") {
      container.innerHTML = `<p class="muted">${t("guide.select_broker_hint")}</p>`;
    } else {
      const titleKey = `guide.${selected}.title`;
      const title = t(titleKey as Parameters<typeof t>[0]);
      const steps = getGuideSteps(selected);
      if (steps.length > 0) {
        container.innerHTML = renderPanel(title, steps);
      } else {
        container.innerHTML = "";
      }
    }

    // Toggle behavior
    container.querySelectorAll<HTMLElement>(".broker-guide").forEach((el) => {
      el.querySelector(".broker-guide-header")?.addEventListener("click", () => {
        el.classList.toggle("open");
      });
    });
  }

  brokerSelect.addEventListener("change", renderGuide);
  renderGuide();
}

function renderPanel(title: string, steps: string[]): string {
  return `
    <div class="broker-guide">
      <div class="broker-guide-header">
        ${title}
        <span class="broker-guide-toggle">&#9660;</span>
      </div>
      <div class="broker-guide-content">
        <ol>${steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        <p class="guide-tip">${t("guide.tip_fifo")}</p>
      </div>
    </div>
  `;
}
