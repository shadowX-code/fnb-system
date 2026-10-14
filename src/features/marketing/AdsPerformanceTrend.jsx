import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { adsMetric } from "./adsPresentation.js";
export default function AdsPerformanceTrend({ report }) {
  const rows = report?.insights?.daily || [];
  if (!rows.length)
    return (
      <p className="text-xs text-text-secondary mt-3">
        Daily trend unavailable for this scope and period.
      </p>
    );
  const data = rows.map((r) => ({
    date: r.date_start,
    spend: r.metrics?.spend?.value ?? null,
  }));
  return (
    <figure className="mt-4">
      <figcaption className="text-sm">
        Daily spend · {report.account.currency} · {report.account.timezone}
      </figcaption>
      <div style={{ height: 190, width: "100%", minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={35} />
            <YAxis tick={{ fontSize: 10 }} width={50} />
            <Tooltip
              formatter={(v) =>
                adsMetric({ value: v }, "spend", report.account.currency)
              }
            />
            <Line
              type="linear"
              dataKey="spend"
              stroke="var(--theme-primary, #059669)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary className="text-xs">Daily values</summary>
        <ul className="text-xs">
          {data.map((r) => (
            <li key={r.date}>
              {r.date}:{" "}
              {adsMetric({ value: r.spend }, "spend", report.account.currency)}
            </li>
          ))}
        </ul>
      </details>
    </figure>
  );
}
