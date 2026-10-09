import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Card from "../../../components/ui/Card.jsx";
import { AdminChart, AdminChartMark, AdminChartTooltipContent, adminChartColors, adminChartLinePath, adminChartScale } from "../../../components/ui/AdminChart.jsx";
import { factoryService } from "../../../services/factoryService.js";
import FactoryMonthPicker from "./FactoryMonthPicker.jsx";
import FactorySegmentedControl from "./FactorySegmentedControl.jsx";
import FactoryDailyProductionModal from "./FactoryDailyProductionModal.jsx";
import { factoryMonthLabel, formatFactoryReadableDate, malaysiaBusinessMonthInput, shiftFactoryMonth } from "../utils/factoryDates.js";
import { monthlyPerformanceModel, performanceNumber as number } from "../utils/productionMonthlyPerformance.js";

const modes = [{ value: "output", label: "Output Trend" }, { value: "productivity", label: "Productivity" }, { value: "calendar", label: "Calendar Heatmap" }];
const outputColor = adminChartColors.emerald;
const averageColor = adminChartColors.azure;
const muted = "var(--text-secondary)";

function dayLabel(day) {
  if (day.state === "future") return "Future date";
  if (day.state === "missing") return "Output data incomplete";
  return `${number(day.output_kg)} kg`;
}

function DayTooltip({ day }) {
  return <AdminChartTooltipContent title={formatFactoryReadableDate(day.day)} rows={[
    { label: "Output", value: dayLabel(day), color: outputColor },
    { label: "Completed runs", value: number(day.completed_runs) },
    { label: "Productivity", value: day.productivity == null ? "Unavailable" : `${number(day.productivity)} kg/JO-hour` },
    { label: "Valid JO-hours", value: number(day.jo_hours) },
    ...(day.moving_average_kg != null ? [{ label: `${day.average_days}-production-day avg`, value: `${number(day.moving_average_kg)} kg`, color: averageColor }] : []),
  ]} note={day.state === "future" ? "No output attributed yet." : `${day.productivity_runs || 0} ${Number(day.productivity_runs) === 1 ? "run" : "runs"} with valid output and duration.${day.invalid_duration_runs ? ` ${day.invalid_duration_runs} missing/invalid durations excluded.` : ""}${day.missing_output_runs ? ` ${day.missing_output_runs} ${Number(day.missing_output_runs) === 1 ? "run" : "runs"} without valid kg output.` : ""}`} />;
}

export function ProductionPerformanceChart({ days, mode, month, onSelectDay }) {
  const [selected, setSelected] = useState(null);
  useEffect(() => setSelected(null), [month, mode]);
  const calendar = mode === "calendar";
  const firstWeekday = new Date(`${month}-01T00:00:00Z`).getUTCDay();
  const height = calendar ? width => 28 + Math.ceil((firstWeekday + days.length) / 7) * Math.max(48, Math.min(62, width / 7)) : 240;
  const maxOutput = Math.max(1, ...days.map(day => day.output_kg || 0));
  return <AdminChart label={`${factoryMonthLabel(month)} ${modes.find(item => item.value === mode).label}`} height={height} dataKey={`${month}-${mode}`}>
    {(width) => {
      const left = 48, right = 12, top = 16, bottom = 210;
      const step = (width - left - right) / days.length;
      const value = day => mode === "productivity" ? day.productivity : day.output_kg;
      const values = days.flatMap(day => [value(day), ...(mode === "output" ? [Number(day.moving_average_kg ?? NaN)] : [])]);
      const scale = adminChartScale(values.some(value => Number.isFinite(value) && value > 0) ? values : [0, 1]);
      const y = value => bottom - value / scale.max * (bottom - top);
      const cellWidth = width / 7, cellHeight = Math.max(48, Math.min(62, cellWidth));
      const averagePoints = days.filter(day => day.completed_runs > 0 && day.state !== "future").map(day => day.moving_average_kg == null ? null : [left + (day.number - .5) * step, y(Number(day.moving_average_kg))]);
      return <>
        {calendar ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => <text key={label} x={(index + .5) * cellWidth} y={14} textAnchor="middle" fill={muted}>{label}</text>) : <>
          {scale.ticks.map(tick => <g key={tick}><line className="chart-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} /><text x={left - 8} y={y(tick) + 4} fill={muted} textAnchor="end">{new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 2 }).format(tick)}</text></g>)}
          <text x={left} y={10} fill={muted}>{mode === "productivity" ? "kg/JO-hour" : "kg"}</text>
        </>}
        {days.map((day, index) => {
          const col = (firstWeekday + index) % 7, row = Math.floor((firstWeekday + index) / 7);
          const x = calendar ? col * cellWidth + 3 : left + index * step;
          const cy = calendar ? 24 + row * cellHeight : top;
          const markWidth = calendar ? cellWidth - 6 : step;
          const markHeight = calendar ? cellHeight - 5 : bottom - top;
          const amount = value(day);
          const fill = day.state === "future" ? "var(--surface)" : day.state === "missing" ? "var(--border)" : outputColor;
          return <AdminChartMark key={day.day} label={`${formatFactoryReadableDate(day.day)}: ${dayLabel(day)}; ${day.completed_runs} completed runs${mode === "productivity" ? `; ${number(day.productivity)} kg per JO-hour` : ""}`} tooltip={<DayTooltip day={day} />} selected={selected === day.day} onSelect={() => { setSelected(day.day); onSelectDay?.(day.day); }}>
            {calendar ? <>
              <rect x={x} y={cy} width={markWidth} height={markHeight} rx={4} fill="var(--surface)" stroke="var(--border)" />
              <rect x={x} y={cy} width={markWidth} height={markHeight} rx={4} fill={fill} opacity={day.state === "recorded" ? .06 + .34 * (day.output_kg || 0) / maxOutput : .3} />
              <text x={x + 6} y={cy + 14} fill={muted}>{day.number}</text>
              <text x={x + markWidth / 2} y={cy + Math.min(36, markHeight - 6)} textAnchor="middle" fill="var(--text-primary)">{day.state === "future" ? "—" : day.state === "missing" ? "N/A" : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(day.output_kg)}</text>
            </> : <>
              <rect x={x} y={top} width={markWidth} height={markHeight} fill="transparent" />
              <rect className="chart-inspection-band" x={x} y={top} width={markWidth} height={markHeight} />
              {amount != null ? <rect x={x + step * .2} y={y(amount)} width={step * .6} height={Math.max(2, bottom - y(amount))} rx={2} fill={mode === "productivity" ? averageColor : outputColor} opacity={amount === 0 ? .25 : .8} /> : <text x={x + step / 2} y={bottom - 4} textAnchor="middle" fill={muted}>{day.state === "future" ? "·" : "—"}</text>}
              {(day.number === 1 || day.number % (width < 500 ? 7 : 5) === 0 || day.number === days.length) ? <text x={x + step / 2} y={bottom + 20} textAnchor="middle" fill={muted}>{day.number}</text> : null}
            </>}
            <rect className="chart-focus" x={x} y={cy} width={markWidth} height={markHeight} rx={4} />
          </AdminChartMark>;
        })}
        {mode === "output" ? <g pointerEvents="none"><path d={adminChartLinePath(averagePoints)} fill="none" stroke={averageColor} strokeWidth={2} className="admin-chart-series" />{averagePoints.filter(Boolean).map(([x, cy]) => <circle key={x} cx={x} cy={cy} r={3} fill={averageColor} />)}</g> : null}
      </>;
    }}
  </AdminChart>;
}

export default function FactoryProductionMonthlyPerformance({ enabled, refreshKey, onViewResult }) {
  const [month, setMonth] = useState(malaysiaBusinessMonthInput);
  const [mode, setMode] = useState("output");
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ loading: true });
  const [selectedDay, setSelectedDay] = useState(null);
  const closeDay = useCallback(() => setSelectedDay(null), []);
  useEffect(closeDay, [month, closeDay]);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const controller = new AbortController();
    setState({ loading: true });
    factoryService.getProductionMonthlyPerformance(month, { signal: controller.signal }).then(
      snapshot => { if (current) setState({ month, snapshot }); },
      () => { if (current) setState({ month, error: "Unable to load Production performance. Please retry." }); },
    );
    return () => { current = false; controller.abort(); };
  }, [enabled, month, retry, refreshKey]);
  const model = useMemo(() => state.snapshot && state.month === month ? monthlyPerformanceModel(state.snapshot) : null, [state, month]);
  if (!enabled) return null;
  return <Card title="Monthly Production Performance">
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1"><button type="button" className="btn-icon" aria-label="Previous performance month" title="Previous month" onClick={() => setMonth(shiftFactoryMonth(month, -1))}><ChevronLeft size={16} /></button><div className="w-44"><FactoryMonthPicker value={month} onChange={setMonth} ariaLabel="Performance month" /></div><button type="button" className="btn-icon" aria-label="Next performance month" title="Next month" onClick={() => setMonth(shiftFactoryMonth(month, 1))}><ChevronRight size={16} /></button></div>
        <FactorySegmentedControl label="Production performance mode" value={mode} onChange={setMode} options={modes} />
      </div>
      {state.error ? <div role="alert" className="py-8 text-sm text-text-secondary">{state.error} <button type="button" className="btn-secondary ml-2" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : !model ? <div role="status" className="flex h-72 items-center justify-center text-sm text-text-muted">Loading Production performance…</div> : <>
        <dl className="my-4 flex flex-wrap gap-x-10 gap-y-3 border-b border-border pb-3">
          {[{ label: "Total Output", value: `${number(model.totalOutput)} kg` }, { label: "Completed Runs", value: number(model.completedRuns) }, { label: "Avg Productivity", value: model.productivity == null ? "—" : `${number(model.productivity)} kg/JO-hour` }].map(item => <div key={item.label}><dt className="text-xs text-text-secondary">{item.label}</dt><dd className="mt-1 text-lg font-semibold tabular-nums text-text-primary">{item.value}</dd></div>)}
        </dl>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-text-secondary">
          {mode === "output" ? <><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-sm" style={{ background: outputColor }} />Daily output</span><span className="flex items-center gap-2"><i className="h-0.5 w-4" style={{ background: averageColor }} />7-production-day average</span></> : mode === "calendar" ? <span>Daily output (kg) · — Future · N/A Incomplete</span> : <span>{number(model.hours)} summed JO-hours · {model.productivityRuns}/{model.completedRuns} runs eligible</span>}
        </div>
        <ProductionPerformanceChart days={model.days} mode={mode} month={month} onSelectDay={setSelectedDay} />
        {selectedDay && model.days.some(day => day.day === selectedDay) ? <FactoryDailyProductionModal day={model.days.find(day => day.day === selectedDay)} onClose={closeDay} onViewResult={onViewResult ? run => { closeDay(); onViewResult({ id: run.job_order_id, job_order_no: run.job_order_no, product_name: run.finished_good_name, status: "completed" }); } : undefined} /> : null}
        <p className="text-xs text-text-secondary">{mode === "productivity" ? "Output from runs with valid durations ÷ summed JO-hours; not factory operating hours." : mode === "output" ? "Malaysia Production End date · Average spans the latest 7 production days, including prior months; fewer when history is limited." : "Malaysia Production End date · Past days without completed production show 0."}</p>
        {model.invalidDurationRuns > 0 || model.missingOutputRuns > 0 || model.unattributedRuns > 0 ? <p role="note" className="mt-2 text-xs text-text-secondary">{model.invalidDurationRuns > 0 ? `${model.invalidDurationRuns} runs excluded from productivity: missing or invalid duration. ` : ""}{model.missingOutputRuns > 0 ? `${model.missingOutputRuns} runs lack valid kg output; totals include known output only. ` : ""}{model.unattributedRuns > 0 ? `${model.unattributedRuns} historical runs have no complete Production End and cannot be attributed to a month.` : ""}</p> : null}
      </>}
    </div>
  </Card>;
}
