import MetricCard from "./MetricCard.jsx";

const standardColumns = {
  one: "grid-cols-1",
  two: "grid-cols-1 sm:grid-cols-2",
  three: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
  four: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
};

function gridColumns(variant, count) {
  if (variant === "compact") {
    if (count >= 5) return "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5";
    if (count === 4) return "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4";
    return standardColumns[["one", "two", "three"][Math.max(count - 1, 0)]];
  }
  return standardColumns[["one", "two", "three", "four"][Math.min(Math.max(count, 1), 4) - 1]];
}

/**
 * Canonical Admin KPI surface. Features provide metric data; this component owns
 * summary card anatomy and responsive grid behavior.
 */
export default function AdminSummaryGrid({ items = [], variant = "standard", ariaLabel = "Summary", className = "" }) {
  const metrics = items.filter(Boolean);
  return (
    <section className={`grid items-stretch gap-3 ${gridColumns(variant, metrics.length)} ${className}`} aria-label={ariaLabel} data-admin-summary-grid={variant}>
      {metrics.map(({ key, emphasis, ...metric }, index) => (
        <MetricCard
          key={key || `summary-${index}-${metric.label || "metric"}`}
          {...metric}
          presentation="summary"
          size={variant}
          emphasis={emphasis === true ? "primary" : emphasis}
        />
      ))}
    </section>
  );
}
