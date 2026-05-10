import { useMemo, useState } from "react";

function compactCurrency(value) {
  const amount = Math.abs(Number(value) || 0);
  if (amount >= 1_000_000) return `RM ${(amount / 1_000_000).toFixed(amount >= 10_000_000 ? 0 : 1)}m`;
  if (amount >= 1_000) return `RM ${(amount / 1_000).toFixed(amount >= 100_000 ? 0 : 1)}k`;
  return `RM ${Math.round(amount)}`;
}

function niceStep(rawStep, type) {
  if (type === "percent") {
    if (rawStep <= 5) return 5;
    if (rawStep <= 10) return 10;
    if (rawStep <= 20) return 20;
    return Math.ceil(rawStep / 25) * 25;
  }
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rawStep, 1)));
  const normalized = rawStep / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

function buildTicks(maxValue, yAxisType, compact = false) {
  const desired = compact ? 4 : 5;
  const step = niceStep(Math.max(maxValue, 1) / desired, yAxisType);
  const top = Math.max(step, Math.ceil(Math.max(maxValue, 1) / step) * step);
  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step) {
    ticks.push(value);
  }
  return { ticks, top };
}

function defaultTickFormatter(value, yAxisType) {
  if (yAxisType === "percent") return `${Math.round(value)}%`;
  return compactCurrency(value);
}

export default function TrendChart({ series, labels, type = "line", yLabel = "RM", yAxisType = "currency", tickFormat }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const safeLabels = Array.isArray(labels) ? labels : [];
  const safeSeries = Array.isArray(series)
    ? series.map((item) => ({
        ...item,
        data: safeLabels.map((_, index) => Number(item.data?.[index] || 0)),
      }))
    : [];
  const allValues = safeSeries.flatMap((item) => item.data).filter((value) => Number.isFinite(value));
  const hasData = safeLabels.length > 0 && allValues.some((value) => Math.abs(value) > 0);
  const maxValue = Math.max(...allValues, 0);
  const { ticks, top } = useMemo(() => buildTicks(maxValue, yAxisType, safeLabels.length > 6), [maxValue, safeLabels.length, yAxisType]);
  const formatTick = tickFormat ?? ((value) => defaultTickFormatter(value, yAxisType));
  const plotTop = 8;
  const plotBottom = 90;
  const plotHeight = plotBottom - plotTop;

  function yForValue(value) {
    return plotBottom - (Math.max(Number(value) || 0, 0) / Math.max(top, 1)) * plotHeight;
  }

  function points(data) {
    return data
      .map((value, index) => {
        const x = (index / Math.max(data.length - 1, 1)) * 100;
        return `${x},${yForValue(value)}`;
      })
      .join(" ");
  }

  return (
    <div className="relative">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{yLabel}</div>
        <div className="flex flex-wrap gap-3">
          {safeSeries.map((item) => (
            <div key={item.name} className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
              <span className={`h-2.5 w-2.5 rounded-full ${item.fill ? "" : item.color}`} style={item.fill ? { backgroundColor: item.fill } : undefined} />
              {item.name}
            </div>
          ))}
        </div>
      </div>
      <div className="relative h-56 rounded-2xl border border-border bg-white py-4 pl-14 pr-4">
        {!hasData ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/80">
            <div className="text-center">
              <div className="text-sm font-bold text-text-primary">Not enough saved monthly records yet</div>
              <div className="mt-1 text-xs text-text-secondary">Save sales and purchase data to populate this trend.</div>
            </div>
          </div>
        ) : null}

        <div className="absolute bottom-10 left-3 top-4 w-10">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-[11px] font-semibold text-slate-400"
              style={{ top: `${yForValue(tick)}%` }}
            >
              {formatTick(tick)}
            </span>
          ))}
        </div>

        <div className="absolute bottom-10 left-14 right-4 top-4">
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute left-0 right-0 border-t border-dashed border-slate-300/80"
              style={{ top: `${yForValue(tick)}%` }}
            />
          ))}
        </div>

        <div className="absolute bottom-10 left-14 right-4 top-4">
          {type === "bar" ? (
            <svg className="relative z-10 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
              {safeLabels.map((label, index) => {
                const groupWidth = 100 / Math.max(safeLabels.length, 1);
                const barGap = 0.9;
                const barWidth = Math.min(5.8, (groupWidth - 3) / Math.max(safeSeries.length, 1));
                const groupStart = index * groupWidth + (groupWidth - (barWidth * safeSeries.length + barGap * (safeSeries.length - 1))) / 2;
                return (
                  <g
                    key={label}
                    onMouseEnter={() => setHoverIndex(index)}
                    onMouseLeave={() => setHoverIndex(null)}
                  >
                    {safeSeries.map((item, seriesIndex) => {
                      const value = Math.max(Number(item.data[index] || 0), 0);
                      const y = yForValue(value);
                      const height = plotBottom - y;
                      const x = groupStart + seriesIndex * (barWidth + barGap);
                      return (
                        <rect
                          key={item.name}
                          x={x}
                          y={y}
                          width={barWidth}
                          height={Math.max(height, value > 0 ? 2.5 : 0)}
                          rx="1.4"
                          fill={item.fill ?? item.stroke ?? "currentColor"}
                          className={item.fill ? "" : item.color}
                        />
                      );
                    })}
                  </g>
                );
              })}
            </svg>
          ) : (
            <svg className="relative z-10 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
              {safeSeries.map((item) => (
                <g key={item.name}>
                  <polyline
                    fill="none"
                    points={points(item.data)}
                    stroke={item.stroke}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="3"
                    vectorEffect="non-scaling-stroke"
                  />
                  {safeLabels.map((label, index) => {
                    const x = (index / Math.max(safeLabels.length - 1, 1)) * 100;
                    const y = yForValue(item.data[index]);
                    return (
                      <circle
                        key={`${item.name}-${label}`}
                        cx={x}
                        cy={y}
                        r={hoverIndex === index ? 2.2 : 1.4}
                        fill={item.stroke}
                        className={hoverIndex === index ? "drop-shadow-[0_0_6px_rgba(249,115,22,0.8)]" : ""}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </g>
              ))}
              {safeLabels.map((label, index) => {
                const x = (index / Math.max(safeLabels.length - 1, 1)) * 100;
                return (
                  <rect
                    key={label}
                    x={x - 5}
                    y="0"
                    width="10"
                    height="100"
                    fill="transparent"
                    onMouseEnter={() => setHoverIndex(index)}
                    onMouseLeave={() => setHoverIndex(null)}
                  />
                );
              })}
            </svg>
          )}
        </div>

        <div className="absolute bottom-3 left-14 right-4 flex justify-between">
          {safeLabels.map((label) => (
            <span key={label} className="text-[11px] font-semibold text-text-muted">{label}</span>
          ))}
        </div>
        {hoverIndex !== null ? (
          <div className="absolute right-4 top-4 z-20 rounded-xl border border-border bg-white p-3 text-xs shadow-card">
            <div className="font-bold text-text-primary">{safeLabels[hoverIndex]}</div>
            {safeSeries.map((item) => (
              <div key={item.name} className="mt-1 flex justify-between gap-6 text-text-secondary">
                <span>{item.name}</span>
                <strong className="text-text-primary">{item.format ? item.format(item.data[hoverIndex]) : item.data[hoverIndex]}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
