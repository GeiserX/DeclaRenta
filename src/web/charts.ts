/**
 * SVG chart generators for DeclaRenta web UI.
 *
 * Zero dependencies — generates inline SVG strings.
 * All charts use CSS custom properties for theming.
 */

import Decimal from "decimal.js";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const CHART_COLORS = [
  "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#6366f1",
];

interface PieSlice {
  label: string;
  value: number;
  color: string;
}

interface BarItem {
  label: string;
  value: number;
  color: string;
}

interface MonthlyBar {
  month: string;
  gain: number;
  loss: number;
}

// ---------------------------------------------------------------------------
// Donut / Pie Chart
// ---------------------------------------------------------------------------

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function renderDonutChart(title: string, items: { label: string; value: Decimal }[]): string {
  const data: PieSlice[] = items
    .filter((d) => d.value.greaterThan(0))
    .map((d, i) => ({ label: d.label, value: d.value.toNumber(), color: CHART_COLORS[i % CHART_COLORS.length]! }));

  if (data.length === 0) return "";

  const total = data.reduce((s, d) => s + d.value, 0);
  const cx = 100, cy = 100, r = 70, inner = 45;
  let angle = 0;

  const paths = data.map((slice) => {
    const sliceAngle = (slice.value / total) * 360;
    // Prevent rendering a full 360 arc (SVG limitation)
    const clampedAngle = Math.min(sliceAngle, 359.99);
    const path = describeArc(cx, cy, r, angle, angle + clampedAngle);
    angle += sliceAngle;
    return `<path d="${path}" fill="none" stroke="${slice.color}" stroke-width="${r - inner}" opacity="0.85"/>`;
  });

  const legend = data.map((d, i) =>
    `<g transform="translate(210, ${20 + i * 22})">
      <rect width="12" height="12" rx="2" fill="${d.color}" opacity="0.85"/>
      <text x="18" y="10" fill="var(--text)" font-size="11">${escSvg(d.label)} (${((d.value / total) * 100).toFixed(1)}%)</text>
    </g>`
  ).join("");

  return `<div class="chart-card">
    <h4 class="chart-title">${escSvg(title)}</h4>
    <svg viewBox="0 0 400 ${Math.max(200, 20 + data.length * 22)}" class="chart-svg">
      ${paths.join("")}
      <circle cx="${cx}" cy="${cy}" r="${inner}" fill="var(--surface)"/>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="600">${formatCompact(total)}</text>
      ${legend}
    </svg>
  </div>`;
}

// ---------------------------------------------------------------------------
// Bar Chart (monthly G/P)
// ---------------------------------------------------------------------------

export function renderMonthlyGainLossChart(title: string, monthly: MonthlyBar[]): string {
  if (monthly.length === 0) return "";

  const maxAbs = Math.max(
    ...monthly.map((m) => Math.abs(m.gain)),
    ...monthly.map((m) => Math.abs(m.loss)),
    1,
  );

  const chartW = 380, chartH = 160, barW = 26;
  const baseY = chartH / 2;
  const scale = (baseY - 10) / maxAbs;

  const bars = monthly.map((m, i) => {
    const x = 30 + i * (barW + 4);
    const gainH = m.gain * scale;
    const lossH = Math.abs(m.loss) * scale;
    return `
      ${gainH > 0 ? `<rect x="${x}" y="${baseY - gainH}" width="${barW}" height="${gainH}" rx="3" fill="var(--success)" opacity="0.8"/>` : ""}
      ${lossH > 0 ? `<rect x="${x}" y="${baseY}" width="${barW}" height="${lossH}" rx="3" fill="var(--danger)" opacity="0.8"/>` : ""}
      <text x="${x + barW / 2}" y="${chartH + 14}" text-anchor="middle" fill="var(--muted)" font-size="9">${escSvg(m.month)}</text>
    `;
  }).join("");

  return `<div class="chart-card">
    <h4 class="chart-title">${escSvg(title)}</h4>
    <svg viewBox="0 0 ${chartW} ${chartH + 20}" class="chart-svg">
      <line x1="25" y1="${baseY}" x2="${chartW}" y2="${baseY}" stroke="var(--border)" stroke-width="1"/>
      ${bars}
    </svg>
  </div>`;
}

// ---------------------------------------------------------------------------
// Horizontal Bar Chart (withholdings by country)
// ---------------------------------------------------------------------------

export function renderHorizontalBarChart(title: string, items: { label: string; value: Decimal }[]): string {
  const data: BarItem[] = items
    .filter((d) => d.value.greaterThan(0))
    .sort((a, b) => b.value.toNumber() - a.value.toNumber())
    .slice(0, 10)
    .map((d, i) => ({ label: d.label, value: d.value.toNumber(), color: CHART_COLORS[i % CHART_COLORS.length]! }));

  if (data.length === 0) return "";

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const barH = 22, gap = 6, labelW = 40, chartW = 380;
  const totalH = data.length * (barH + gap) + 10;
  const barMaxW = chartW - labelW - 80;

  const bars = data.map((d, i) => {
    const y = 5 + i * (barH + gap);
    const w = (d.value / maxVal) * barMaxW;
    return `
      <text x="${labelW - 4}" y="${y + barH / 2 + 4}" text-anchor="end" fill="var(--text)" font-size="11">${escSvg(d.label)}</text>
      <rect x="${labelW}" y="${y}" width="${w}" height="${barH}" rx="4" fill="${d.color}" opacity="0.8"/>
      <text x="${labelW + w + 6}" y="${y + barH / 2 + 4}" fill="var(--muted)" font-size="10">${d.value.toFixed(2)} EUR</text>
    `;
  }).join("");

  return `<div class="chart-card">
    <h4 class="chart-title">${escSvg(title)}</h4>
    <svg viewBox="0 0 ${chartW} ${totalH}" class="chart-svg">${bars}</svg>
  </div>`;
}

// ---------------------------------------------------------------------------
// Data extraction helpers (called from main.ts with the report)
// ---------------------------------------------------------------------------

export interface ChartData {
  assetDistribution: { label: string; value: Decimal }[];
  currencyComposition: { label: string; value: Decimal }[];
  withholdingsByCountry: { label: string; value: Decimal }[];
  monthlyGainLoss: MonthlyBar[];
}

export function extractChartData(report: {
  capitalGains: { disposals: { assetCategory: string; currency: string; sellDate: string; gainLossEur: Decimal; proceedsEur: Decimal }[] };
  dividends: { entries: { withholdingCountry: string; withholdingTaxEur: Decimal }[] };
}): ChartData {
  const disposals = report.capitalGains.disposals;

  // Asset distribution by category
  const byAsset = new Map<string, number>();
  for (const d of disposals) {
    const cat = d.assetCategory || "OTHER";
    byAsset.set(cat, (byAsset.get(cat) ?? 0) + Math.abs(d.proceedsEur.toNumber()));
  }
  const assetDistribution = [...byAsset.entries()].map(([label, value]) => ({
    label: ASSET_LABELS[label] ?? label,
    value: new Decimal(value),
  }));

  // Currency composition
  const byCurrency = new Map<string, number>();
  for (const d of disposals) {
    byCurrency.set(d.currency, (byCurrency.get(d.currency) ?? 0) + Math.abs(d.proceedsEur.toNumber()));
  }
  const currencyComposition = [...byCurrency.entries()].map(([label, value]) => ({
    label,
    value: new Decimal(value),
  }));

  // Withholdings by country
  const byCountry = new Map<string, number>();
  for (const d of report.dividends.entries) {
    const country = d.withholdingCountry || "??";
    byCountry.set(country, (byCountry.get(country) ?? 0) + d.withholdingTaxEur.toNumber());
  }
  const withholdingsByCountry = [...byCountry.entries()].map(([label, value]) => ({
    label,
    value: new Decimal(value),
  }));

  // Monthly G/P
  const monthMap = new Map<string, { gain: number; loss: number }>();
  const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  for (const d of disposals) {
    const date = d.sellDate;
    const monthIdx = parseInt(date.length === 8 ? date.slice(4, 6) : date.slice(5, 7)) - 1;
    const key = MONTHS[monthIdx] ?? "?";
    if (!monthMap.has(key)) monthMap.set(key, { gain: 0, loss: 0 });
    const entry = monthMap.get(key)!;
    const gl = d.gainLossEur.toNumber();
    if (gl >= 0) entry.gain += gl;
    else entry.loss += gl;
  }
  const monthlyGainLoss = MONTHS
    .filter((m) => monthMap.has(m))
    .map((month) => ({ month, ...monthMap.get(month)! }));

  return { assetDistribution, currencyComposition, withholdingsByCountry, monthlyGainLoss };
}

const ASSET_LABELS: Record<string, string> = {
  STK: "Acciones",
  FUND: "Fondos/ETF",
  OPT: "Opciones",
  CRYPTO: "Crypto",
  BOND: "Bonos",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escSvg(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
