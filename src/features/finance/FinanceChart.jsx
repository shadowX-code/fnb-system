import './interactive-visuals.css';
import { adminChartCategoryColors, adminChartColors, AdminChart, AdminChartMark, AdminChartTooltipContent, useAdminChartGeometry } from '../../components/ui/AdminChart.jsx';
export function FinanceChart(props) { return <AdminChart {...props} className={`finance-chart ${props.className ?? ''}`} />; }
export function FinanceMark(props) { return <AdminChartMark {...props} className={`finance-chart-mark ${props.className ?? ''}`} />; }
export const useFinanceGeometry = useAdminChartGeometry;

/** Place labels without moving financial coordinates. Hide excess labels; tooltips/ledgers retain every item. */
export function placeFinanceLabels(points, width, top, bottom, selectedId) {
  const occupied = [], labels = {};
  const ordered = [...points].sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId));
  for (const point of ordered) {
    const textWidth = Math.min(145, point.label.length * 6.2);
    for (const dy of [-14, 22, -34, 42]) {
      const left = Math.max(52, Math.min(width - textWidth - 8, point.x + 14));
      const y = point.y + dy, box = { left, right: left + textWidth, top: y - 12, bottom: y + 3 };
      if (box.top < top || box.bottom > bottom || occupied.some(other => box.left < other.right + 5 && box.right > other.left - 5 && box.top < other.bottom + 3 && box.bottom > other.top - 3)) continue;
      occupied.push(box); labels[point.id] = { x: left, y }; break;
    }
  }
  return labels;
}

export function FinanceChartTip(props) { return <AdminChartTooltipContent {...props}/>; }

/** Axis/stage shorthand only; precise amounts stay in tooltips and evidence. */
export function financeChartMoney(value) { return value === null || value === undefined ? '—' : `RM ${new Intl.NumberFormat('en-MY', {notation:'compact',maximumFractionDigits:1}).format(value)}`; }

/** Stable Finance series semantics; shared Admin primitives stay domain-neutral. */
export const financeChartColors = Object.freeze({revenue:adminChartColors.emerald,ebitda:adminChartColors.azure,cash:adminChartColors.violet,ebitda_margin:adminChartColors.azure,cogs:adminChartCategoryColors.coral,labour:adminChartColors.azure,opex:adminChartColors.slate,gross_margin:adminChartColors.violet,prime_cost:adminChartColors.slate,inventory:adminChartColors.slate,ar:adminChartColors.azure,ap:adminChartColors.violet});
export const financeMetricColor = id => financeChartColors[id.split('.')[0]] ?? adminChartColors.slate;

/** Signed display precision suppresses rounded negative zero; source evidence stays untouched. */
export function financeChartMovement(value, digits = 2) {
  return value === null || value === undefined ? '—' : new Intl.NumberFormat('en-MY',{minimumFractionDigits:digits,maximumFractionDigits:digits,signDisplay:'exceptZero'}).format(value);
}

/** Revenue composition categories carry identity, never automatic warning status. */
export const financeConversionColors = Object.freeze({cogs:adminChartCategoryColors.coral,labour:adminChartCategoryColors.azure,opex:adminChartCategoryColors.slate,ebitda:adminChartCategoryColors.emerald});
