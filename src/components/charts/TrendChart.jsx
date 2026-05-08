import { useState } from "react";

export default function TrendChart({ series, labels, type = "line", yLabel = "RM" }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const allValues = series.flatMap((item) => item.data);
  const max = Math.max(...allValues, 1);
  const min = Math.min(...allValues, 0);
  const range = max - min || 1;

  function points(data) {
    return data
      .map((value, index) => {
        const x = (index / Math.max(data.length - 1, 1)) * 100;
        const y = 100 - ((value - min) / range) * 82 - 8;
        return `${x},${y}`;
      })
      .join(" ");
  }

  return (
    <div className="relative">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-muted">{yLabel}</div>
        <div className="flex flex-wrap gap-3">
          {series.map((item) => (
            <div key={item.name} className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
              <span className={`h-2.5 w-2.5 rounded-full ${item.color}`} />
              {item.name}
            </div>
          ))}
        </div>
      </div>
      <div className="relative h-56 rounded-2xl border border-border bg-white p-4">
        <div className="absolute inset-x-4 top-1/4 border-t border-dashed border-slate-200" />
        <div className="absolute inset-x-4 top-1/2 border-t border-dashed border-slate-200" />
        <div className="absolute inset-x-4 top-3/4 border-t border-dashed border-slate-200" />
        {type === "bar" ? (
          <div className="relative z-10 flex h-full items-end gap-4 px-2 pb-6">
            {labels.map((label, index) => (
              <div
                key={label}
                className="flex flex-1 items-end justify-center gap-1"
                onMouseEnter={() => setHoverIndex(index)}
                onMouseLeave={() => setHoverIndex(null)}
              >
                {series.map((item) => (
                  <div
                    key={item.name}
                    className={`w-full max-w-5 rounded-t-lg ${item.color} opacity-90 transition hover:opacity-100`}
                    style={{ height: `${Math.max(((item.data[index] - min) / range) * 82, 4)}%` }}
                  />
                ))}
              </div>
            ))}
          </div>
        ) : (
          <svg className="relative z-10 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
            {series.map((item) => (
              <polyline
                key={item.name}
                fill="none"
                points={points(item.data)}
                stroke={item.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {labels.map((label, index) => {
              const x = (index / Math.max(labels.length - 1, 1)) * 100;
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
        <div className="absolute bottom-3 left-4 right-4 flex justify-between">
          {labels.map((label) => (
            <span key={label} className="text-[11px] font-semibold text-text-muted">{label}</span>
          ))}
        </div>
        {hoverIndex !== null ? (
          <div className="absolute right-4 top-4 z-20 rounded-xl border border-border bg-white p-3 text-xs shadow-card">
            <div className="font-bold text-text-primary">{labels[hoverIndex]}</div>
            {series.map((item) => (
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
