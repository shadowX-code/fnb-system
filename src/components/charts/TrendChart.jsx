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

function buildSignedTicks(minValue, maxValue, yAxisType, compact = false) {
  if (minValue >= 0) return { ...buildTicks(maxValue, yAxisType, compact), bottom: 0 };
  const desired = compact ? 4 : 5;
  const step = niceStep(Math.max(maxValue - minValue, 1) / desired, yAxisType);
  const top = Math.max(step, Math.ceil(maxValue / step) * step);
  const bottom = Math.min(-step, Math.floor(minValue / step) * step);
  const ticks = [];
  for (let value = bottom; value <= top + step / 2; value += step) {
    ticks.push(value);
  }
  return { ticks, top, bottom };
}

function defaultTickFormatter(value, yAxisType) {
  if (yAxisType === "percent") return `${Math.round(value)}%`;
  return compactCurrency(value);
}

function buildPointList(data, yForValue) {
  return data.map((value, index) => ({
    x: (index / Math.max(data.length - 1, 1)) * 100,
    y: yForValue(value),
    value,
  }));
}

function buildSmoothPath(points, tension = 0.4) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;

    const previous = points[index - 1];
    const distance = point.x - previous.x;
    const firstControlX = previous.x + distance * tension;
    const secondControlX = point.x - distance * tension;
    return `${path} C ${firstControlX} ${previous.y}, ${secondControlX} ${point.y}, ${point.x} ${point.y}`;
  }, "");
}

function buildAreaPath(points, baseline, tension) {
  if (!points.length) return "";
  const line = buildSmoothPath(points, tension);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}

function ChartDot({ point, color, active }) {
  const size = active ? 14 : 10;
  const radius = active ? 6 : 4;
  const center = size / 2;

  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute z-20 overflow-visible transition-all duration-150"
      style={{
        left: `${point.x}%`,
        top: `${point.y}%`,
        width: size,
        height: size,
        transform: "translate(-50%, -50%)",
        filter: active ? "drop-shadow(0 0 6px rgba(34, 197, 94, 0.28))" : undefined,
      }}
      viewBox={`0 0 ${size} ${size}`}
    >
      <circle cx={center} cy={center} r={radius} fill={color} stroke="var(--theme-surface)" strokeWidth="1.5" />
    </svg>
  );
}

export default function TrendChart({
  series,
  labels,
  type = "line",
  yLabel = "RM",
  yAxisType = "currency",
  tickFormat,
  highlightIndex,
  tension = 0.4,
  renderTooltip,
}) {
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
  const minValue = Math.min(...allValues, 0);
  const { ticks, top, bottom } = useMemo(() => buildSignedTicks(minValue, maxValue, yAxisType, safeLabels.length > 6), [maxValue, minValue, safeLabels.length, yAxisType]);
  const formatTick = tickFormat ?? ((value) => defaultTickFormatter(value, yAxisType));
  const gradientPrefix = useMemo(() => `trend-${Math.random().toString(36).slice(2)}`, []);
  const plotTop = 7;
  const plotBottom = 91;
  const plotHeight = plotBottom - plotTop;
  const activeIndex = hoverIndex ?? (Number.isInteger(highlightIndex) ? highlightIndex : null);
  const activeX = activeIndex !== null ? (activeIndex / Math.max(safeLabels.length - 1, 1)) * 100 : null;

  function yForValue(value) {
    const range = Math.max(top - bottom, 1);
    return plotBottom - ((Number(value) || 0) - bottom) / range * plotHeight;
  }

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between gap-4">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">{yLabel}</div>
        <div className="flex flex-wrap gap-3">
          {safeSeries.map((item) => (
            <div key={item.name} className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
              <span
                className={`h-2.5 w-2.5 rounded-full ${item.fill || item.stroke ? "" : item.color}`}
                style={item.fill || item.stroke ? { backgroundColor: item.legendColor ?? item.stroke ?? item.fill } : undefined}
              />
              {item.name}
            </div>
          ))}
        </div>
      </div>
      <div className="relative h-64 rounded-2xl border border-border bg-surface/95 py-3 pl-12 pr-3 shadow-sm">
        {!hasData ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-surface/85 backdrop-blur-sm">
            <div className="text-center">
              <div className="text-sm font-bold text-text-primary">Not enough saved monthly records yet</div>
              <div className="mt-1 text-xs text-text-secondary">Save sales and purchase data to populate this trend.</div>
            </div>
          </div>
        ) : null}

        <div className="absolute bottom-8 left-2 top-3 w-9">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2 whitespace-nowrap text-[10px] font-medium text-text-muted/70"
              style={{ top: `${yForValue(tick)}%` }}
            >
              {formatTick(tick)}
            </span>
          ))}
        </div>

        <div className="absolute bottom-8 left-12 right-3 top-3">
          {ticks.map((tick) => (
            <div
              key={tick}
              className="absolute left-0 right-0 border-t border-border/60"
              style={{ top: `${yForValue(tick)}%` }}
            />
          ))}
        </div>

        <div className="absolute bottom-8 left-12 right-3 top-3">
          {activeX !== null ? (
            <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-primary/30 transition-all duration-150" style={{ left: `${activeX}%` }} />
          ) : null}
          {Number.isInteger(highlightIndex) && highlightIndex >= 0 && highlightIndex < safeLabels.length ? (
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-0 w-8 -translate-x-1/2 rounded-full bg-primary/10 transition-all"
              style={{ left: `${(highlightIndex / Math.max(safeLabels.length - 1, 1)) * 100}%` }}
            />
          ) : null}
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
                    const value = Number(item.data[index] || 0);
                    const y = yForValue(value);
                      const baseline = yForValue(0);
                      const height = Math.abs(baseline - y);
                      const x = groupStart + seriesIndex * (barWidth + barGap);
                      return (
                        <rect
                          key={item.name}
                          x={x}
                          y={Math.min(y, baseline)}
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
            <>
            <svg className="relative z-10 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                {safeSeries.map((item, seriesIndex) => (
                  <linearGradient key={item.name} id={`${gradientPrefix}-area-${seriesIndex}`} x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={item.fill ?? item.stroke ?? "#22c55e"} stopOpacity={item.areaOpacity ?? 0.22} />
                    <stop offset="72%" stopColor={item.fill ?? item.stroke ?? "#22c55e"} stopOpacity={0.04} />
                    <stop offset="100%" stopColor={item.fill ?? item.stroke ?? "#22c55e"} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              {safeSeries.map((item, seriesIndex) => {
                const pointList = buildPointList(item.data, yForValue);
                const smoothPath = buildSmoothPath(pointList, tension);
                return (
                <g key={item.name}>
                  {item.area || type === "area" ? (
                    <path d={buildAreaPath(pointList, yForValue(0), tension)} fill={`url(#${gradientPrefix}-area-${seriesIndex})`} />
                  ) : null}
                  <path
                    d={smoothPath}
                    fill="none"
                    stroke={item.stroke}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={item.strokeWidth ?? 3}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )})}
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
            {safeSeries.map((item) => {
              const pointList = buildPointList(item.data, yForValue);
              return pointList.map((point, index) => (
                <ChartDot
                  key={`${item.name}-${safeLabels[index]}-dot`}
                  point={point}
                  color={item.pointColor ?? item.stroke}
                  active={hoverIndex === index}
                />
              ));
            })}
            </>
          )}
        </div>

        <div className="absolute bottom-2 left-12 right-3 flex justify-between">
          {safeLabels.map((label) => (
            <span key={label} className="text-[10px] font-semibold text-text-muted/80">{label}</span>
          ))}
        </div>
        {hoverIndex !== null ? (
          <div
            className="pointer-events-none absolute top-3 z-20 rounded-xl border border-border bg-surface/95 p-3 text-xs shadow-card backdrop-blur transition-all duration-150"
            style={{ left: `${Math.min(86, Math.max(14, activeX ?? 50))}%`, transform: "translateX(-50%)" }}
          >
            {renderTooltip ? (
              renderTooltip({ label: safeLabels[hoverIndex], index: hoverIndex, series: safeSeries })
            ) : (
              <>
                <div className="font-bold text-text-primary">{safeLabels[hoverIndex]}</div>
                {safeSeries.map((item) => (
                  <div key={item.name} className="mt-1 flex justify-between gap-6 text-text-secondary">
                    <span>{item.name}</span>
                    <strong className="text-text-primary">{item.format ? item.format(item.data[hoverIndex]) : item.data[hoverIndex]}</strong>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
