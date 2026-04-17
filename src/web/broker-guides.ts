/**
 * Broker-specific document acquisition guides.
 *
 * Shows expandable panels with step-by-step instructions for
 * obtaining the correct report from each supported broker.
 */

import { t } from "../i18n/index.js";

interface BrokerGuide {
  title: string;
  steps: string[];
}

const GUIDES: Record<string, BrokerGuide> = {
  ibkr: {
    title: "Interactive Brokers (Flex Query XML)",
    steps: [
      "Inicia sesión en el <strong>Portal del Cliente</strong> de IBKR",
      "Ve a <strong>Rendimiento e Informes → Flex Queries</strong>",
      "Crea una nueva <em>Activity Flex Query</em> incluyendo:<ul><li>Trades (obligatorio)</li><li>Cash Transactions — dividendos y retenciones (obligatorio)</li><li>Open Positions — para Modelo 720/D-6 (recomendado)</li><li>Securities Info — ISINs (recomendado)</li></ul>",
      "Formato de salida: <strong>XML</strong>",
      "Incluye <strong>todos los años disponibles</strong> para cálculo FIFO correcto",
      "Ejecuta la query y descarga el fichero <code>.xml</code>",
    ],
  },
  degiro: {
    title: "Degiro (CSV)",
    steps: [
      "Inicia sesión en la <strong>web de Degiro</strong> (no la app)",
      "Ve a <strong>Actividad → Transacciones</strong>",
      "Selecciona el rango de fechas deseado",
      "Haz clic en <strong>Exportar</strong> y descarga el fichero CSV",
    ],
  },
  etoro: {
    title: "eToro (XLSX)",
    steps: [
      "Inicia sesión en <strong>eToro</strong>",
      "Ve a <strong>Ajustes → Extracto de cuenta</strong>",
      "Selecciona el período del ejercicio fiscal",
      "Descarga el fichero <strong>XLSX</strong> (Excel)",
    ],
  },
  scalable: {
    title: "Scalable Capital (CSV)",
    steps: [
      "Inicia sesión en <strong>Scalable Capital</strong>",
      "Ve a <strong>Perfil → Documentos fiscales</strong>",
      "Descarga el informe de transacciones en formato <strong>CSV</strong>",
    ],
  },
  freedom24: {
    title: "Freedom24 (JSON)",
    steps: [
      "Inicia sesión en la <strong>plataforma web de Freedom24</strong>",
      "Ve a <strong>Informes → Informe de operaciones</strong>",
      "Selecciona el período y formato <strong>JSON</strong>",
      "Descarga el fichero",
    ],
  },
  coinbase: {
    title: "Coinbase (CSV)",
    steps: [
      "Inicia sesión en <strong>Coinbase</strong>",
      "Ve a <strong>Impuestos → Documentos</strong>",
      "Haz clic en <strong>Generar informe</strong>",
      "Descarga el historial de transacciones en formato CSV",
    ],
  },
  binance: {
    title: "Binance (CSV)",
    steps: [
      "Inicia sesión en <strong>Binance</strong>",
      "Ve a <strong>Pedidos → Historial de operaciones</strong>",
      "Haz clic en <strong>Exportar historial de operaciones</strong>",
      "Selecciona el rango de fechas y formato <strong>CSV</strong>",
    ],
  },
  kraken: {
    title: "Kraken (CSV)",
    steps: [
      "Inicia sesión en <strong>Kraken</strong>",
      "Ve a <strong>History → Export</strong>",
      "Selecciona <strong>Trades</strong> y el rango de fechas",
      "Formato: <strong>CSV</strong>, descarga el fichero",
    ],
  },
};

/** Initialize broker guide display */
export function initBrokerGuides(): void {
  const brokerSelect = document.getElementById("broker-select") as HTMLSelectElement | null;
  const container = document.getElementById("broker-guide-container");
  if (!brokerSelect || !container) return;

  function renderGuide(): void {
    if (!container) return;
    const selected = brokerSelect!.value;

    if (selected === "auto") {
      container.innerHTML = Object.values(GUIDES).map((g) => renderPanel(g)).join("");
    } else if (GUIDES[selected]) {
      container.innerHTML = renderPanel(GUIDES[selected]);
    } else {
      container.innerHTML = "";
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

function renderPanel(guide: BrokerGuide): string {
  return `
    <div class="broker-guide">
      <div class="broker-guide-header">
        ${guide.title}
        <span class="broker-guide-toggle">&#9660;</span>
      </div>
      <div class="broker-guide-content">
        <ol>${guide.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        <p class="guide-tip">${t("guide.tip_fifo")}</p>
      </div>
    </div>
  `;
}
