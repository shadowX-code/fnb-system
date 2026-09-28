import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from "recharts";
import { Sparkles, X } from "lucide-react";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminFilterToolbar from "../../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import { formatRestaurantRecipeCurrency, recipeNameEn, recipeNameCn, recipeCode, formatRecipeMargin, serialToMonthParts } from "../recipes/inventoryRecipeReadModel.js";
import { classifyMenuEngineeringRow } from "./inventoryRecipeIntelligenceModel.js";
export function formatMonthShort(serial) {
  const { month } = serialToMonthParts(serial);
  const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return labels[month - 1] || "—";
}


export function formatPercentChange(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  const numeric = Number(value);
  return `${numeric > 0 ? "+" : ""}${Math.round(numeric)}%`;
}

function formatCompactCurrency(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 1000) return `RM${(amount / 1000).toLocaleString("en-MY", { maximumFractionDigits: 1 })}k`;
  return formatRestaurantRecipeCurrency(amount);
}




function RecipeIntelligencePlaceholder({ title, description }) {
  return (
    <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-border bg-slate-50/70 p-4 text-center dark:bg-white/5">
      <div>
        <div className="type-title font-black text-text-primary">{title}</div>
        <p className="mt-1 max-w-md type-body-sm text-text-secondary">{description}</p>
      </div>
    </div>
  );
}

export function RecipeIntelligenceCard({ title, description, children, showViewAll = false, action = null }) {
  return (
    <div className="rounded-3xl border border-border bg-background p-4 shadow-sm dark:bg-white/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="type-title font-black text-text-primary">{title}</div>
          <p className="mt-1 type-body-sm text-text-secondary">{description}</p>
        </div>
        {action || (showViewAll ? <button className="type-caption font-black text-primary hover:underline" type="button">View All</button> : null)}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export function RecipeYearSelector({ year, years = [], onChange }) {
  const options = years.length ? years : [year];
  return <div className="w-32"><SelectField ariaLabel="Trend year" value={String(year)} options={options.map((option) => ({ value: String(option), label: String(option) }))} onChange={(value) => onChange(Number(value))} /></div>;
}

function RecipeInsightBadge({ classification }) {
  const tone = classification === "Star" ? "success" : classification === "Puzzle" ? "info" : classification === "Workhorse" ? "warning" : "danger";
  return <Badge tone={tone}>{classification}</Badge>;
}

export function RecipeInsightsPanel({ rows = [], grossProfitRows = [], ingredientDrivers = [], pendingCount = 0 }) {
  if (!rows.length && !grossProfitRows.length && !ingredientDrivers.length) {
    return (
      <RecipeIntelligenceCard title="Recipe Insights" description="Actionable classification will appear when mapped sales data is available.">
        <RecipeIntelligencePlaceholder
          title="No reliable insights yet"
          description="Map recipes to Product Analytics products to classify Star, Workhorse, Puzzle and Dog recipes."
        />
      </RecipeIntelligenceCard>
    );
  }
  const averageVolume = rows.reduce((sum, row) => sum + Number(row.salesVolume || 0), 0) / rows.length;
  const averageMargin = rows.reduce((sum, row) => sum + Number(row.margin || 0), 0) / rows.length;
  const ranked = rows
    .map((row) => ({ ...row, ...classifyMenuEngineeringRow(row, averageVolume, averageMargin) }))
    .sort((a, b) => {
      const priority = { Star: 0, Workhorse: 1, Puzzle: 2, Dog: 3 };
      return priority[a.classification] - priority[b.classification] || Number(b.revenue || 0) - Number(a.revenue || 0);
    })
    .slice(0, 5);
  return (
    <RecipeIntelligenceCard title="Recipe Insights" description="Top actions from the mapped Product Analytics period.">
      <div className="space-y-3">
        {pendingCount > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-400/30 dark:bg-amber-950/30">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-black text-amber-900 dark:text-amber-100">Mapping coverage warning</div>
                <p className="mt-1 type-body-sm text-amber-800 dark:text-amber-100">{pendingCount} pending products are excluded from profit and ingredient planning.</p>
              </div>
              <Badge tone="warning">Medium impact</Badge>
            </div>
          </div>
        ) : null}
        {grossProfitRows[0] ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-400/30 dark:bg-emerald-950/30">
            <div className="font-black text-emerald-900 dark:text-emerald-100">Top gross profit recipe</div>
            <p className="mt-1 type-body-sm text-emerald-800 dark:text-emerald-100">
              {recipeNameEn(grossProfitRows[0].recipe) || grossProfitRows[0].label} contributes {formatRestaurantRecipeCurrency(grossProfitRows[0].grossProfit)} gross profit.
            </p>
            <div className="mt-2 type-caption font-bold text-emerald-800 dark:text-emerald-100">Action: protect availability and ingredient supply.</div>
          </div>
        ) : null}
        {ingredientDrivers[0] ? (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 p-3 dark:border-orange-400/30 dark:bg-orange-950/30">
            <div className="font-black text-orange-900 dark:text-orange-100">Ingredient cost driver</div>
            <p className="mt-1 type-body-sm text-orange-800 dark:text-orange-100">
              {ingredientDrivers[0].ingredient} is the largest forecast purchase driver at {formatRestaurantRecipeCurrency(ingredientDrivers[0].forecastCost)}.
            </p>
            <div className="mt-2 type-caption font-bold text-orange-800 dark:text-orange-100">Action: check supplier pricing and par level planning.</div>
          </div>
        ) : null}
        {ranked.map((row) => (
          <div key={`${row.id}-${row.classification}`} className="rounded-2xl border border-border bg-slate-50/80 p-3 dark:bg-white/5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-black text-text-primary">{recipeNameEn(row.recipe) || row.label}</div>
                <div className="type-caption text-text-muted">{row.salesVolume.toLocaleString()} sold · {formatRestaurantRecipeCurrency(row.revenue)} revenue</div>
              </div>
              <RecipeInsightBadge classification={row.classification} />
            </div>
            <p className="mt-2 type-body-sm text-text-secondary">{row.reason}</p>
            <div className="mt-2 rounded-xl bg-background/80 p-2 type-caption text-text-secondary dark:bg-black/20">
              <span className="font-black text-text-primary">Recommended action:</span> {row.action}
            </div>
            <div className="mt-2 type-caption font-bold text-text-muted">Impact: {row.impact}</div>
          </div>
        ))}
      </div>
    </RecipeIntelligenceCard>
  );
}

export function RecipeIntelligenceLockedState({ mappedCount }) {
  const remaining = Math.max(10 - Number(mappedCount || 0), 0);
  return (
    <div className="flex min-h-[300px] items-center justify-center rounded-3xl border border-amber-200 bg-amber-50/80 p-6 text-center shadow-inner dark:border-amber-400/30 dark:bg-amber-950/30">
      <div className="max-w-md">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-200/80 text-amber-900 dark:bg-amber-400/20 dark:text-amber-100">
          <Sparkles size={24} />
        </div>
        <div className="mt-4 type-title font-black text-text-primary">Need at least 10 mapped recipes</div>
        <p className="mt-1 type-body-sm text-text-secondary">Menu Engineering needs enough mapped products to avoid noisy management decisions.</p>
        <p className="mt-3 type-body-sm font-bold text-amber-800 dark:text-amber-100">
          Map {remaining} more {remaining === 1 ? "recipe" : "recipes"} to unlock reliable matrix insights.
        </p>
      </div>
    </div>
  );
}


export function RecipeMappingHealth({ mapped, unmapped, totalRecipes, loading }) {
  const total = mapped + unmapped;
  const coverage = total ? Math.round((mapped / total) * 100) : 0;
  return (
    <div className="overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/10 via-background to-emerald-50 p-4 shadow-sm dark:from-emerald-400/10 dark:via-white/5 dark:to-cyan-400/10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="type-caption font-black uppercase tracking-wide text-text-muted">Recipe Mapping Health</div>
          <div className="mt-1 text-3xl font-black text-text-primary">{coverage}%</div>
          <p className="mt-1 max-w-xl type-body-sm text-text-secondary">You’re almost there. Map more recipes to unlock full menu insights.</p>
        </div>
        {loading ? <Badge tone="info">Loading</Badge> : <Badge tone={coverage >= 80 ? "success" : coverage >= 40 ? "warning" : "neutral"}>{mapped} mapped</Badge>}
      </div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-white/80 shadow-inner dark:bg-black/30">
        <div className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-all" style={{ width: `${coverage}%` }} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-center type-caption sm:grid-cols-4">
        <div className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="font-black text-text-primary">{mapped}</div>
          <div className="font-semibold text-text-muted">Mapped</div>
        </div>
        <div className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="font-black text-text-primary">{unmapped}</div>
          <div className="font-semibold text-text-muted">Pending</div>
        </div>
        <div className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="font-black text-text-primary">{coverage}%</div>
          <div className="font-semibold text-text-muted">Coverage %</div>
        </div>
        <div className="rounded-2xl border border-white/60 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="font-black text-text-primary">{total || 0} / {totalRecipes || 0}</div>
          <div className="font-semibold text-text-muted">Products / Recipes</div>
        </div>
      </div>
    </div>
  );
}

export function RecipeMenuEngineeringMatrix({ rows = [] }) {
  if (!rows.length) {
    return (
      <RecipeIntelligencePlaceholder
        title="Coming Soon"
        description="Requires Product Analytics ↔ Recipe Mapping before sales volume, margin %, and revenue bubbles can be plotted."
      />
    );
  }
  const maxVolume = Math.max(...rows.map((row) => Number(row.salesVolume || 0)), 1);
  const maxRevenue = Math.max(...rows.map((row) => Number(row.revenue || 0)), 1);
  const averageVolume = rows.reduce((sum, row) => sum + Number(row.salesVolume || 0), 0) / rows.length;
  const averageMargin = rows.reduce((sum, row) => sum + Number(row.margin || 0), 0) / rows.length;
  const averageVolumeX = 10 + (averageVolume / maxVolume) * 80;
  const averageMarginY = 86 - Math.max(0, Math.min(100, averageMargin));
  return (
    <div className="relative h-[360px] overflow-hidden rounded-3xl border border-border bg-slate-950 p-4 shadow-inner dark:bg-slate-950">
      <div className="absolute inset-x-10 bottom-12 top-10 overflow-hidden rounded-2xl border border-white/10">
        <div className="absolute left-0 top-0 h-1/2 w-1/2 bg-amber-400/10" />
        <div className="absolute right-0 top-0 h-1/2 w-1/2 bg-emerald-400/10" />
        <div className="absolute bottom-0 left-0 h-1/2 w-1/2 bg-rose-400/10" />
        <div className="absolute bottom-0 right-0 h-1/2 w-1/2 bg-sky-400/10" />
      </div>
      <div className="absolute left-4 top-3 type-caption font-black uppercase tracking-wide text-slate-300">Margin %</div>
      <div className="absolute bottom-4 right-4 type-caption font-black uppercase tracking-wide text-slate-300">Qty Sold</div>
      <div className="absolute bottom-12 top-10 border-l border-dashed border-white/35" style={{ left: `${averageVolumeX}%` }} />
      <div className="absolute left-10 right-10 border-t border-dashed border-white/35" style={{ top: `${averageMarginY}%` }} />
      <div className="absolute right-14 top-14 rounded-full bg-emerald-400/15 px-2 py-1 type-caption font-black text-emerald-100">Star</div>
      <div className="absolute left-14 top-14 rounded-full bg-amber-400/15 px-2 py-1 type-caption font-black text-amber-100">Puzzle</div>
      <div className="absolute bottom-16 right-14 rounded-full bg-sky-400/15 px-2 py-1 type-caption font-black text-sky-100">Workhorse</div>
      <div className="absolute bottom-16 left-14 rounded-full bg-rose-400/15 px-2 py-1 type-caption font-black text-rose-100">Dog</div>
      {rows.map((row) => {
        const x = 10 + (Number(row.salesVolume || 0) / maxVolume) * 80;
        const y = 86 - Math.max(0, Math.min(100, Number(row.margin || 0)));
        const size = 18 + (Number(row.revenue || 0) / maxRevenue) * 34;
        const cost = Number(row.recipeCost || 0);
        const price = Number(row.sellingPrice || 0);
        return (
          <div
            key={row.id}
            className="group absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%`, height: size, width: size }}
            title={`${row.label}: ${row.salesVolume} sold, ${formatRestaurantRecipeCurrency(row.revenue)} revenue, ${formatRecipeMargin(row.margin)} margin`}
          >
            <div className="h-full w-full rounded-full border-2 border-white/80 bg-primary shadow-[0_0_22px_rgba(34,197,94,0.55)] ring-4 ring-primary/25" />
            <div className="pointer-events-none absolute left-full top-1/2 ml-2 hidden w-48 -translate-y-1/2 rounded-2xl border border-white/15 bg-slate-900/95 p-3 text-left text-xs text-white shadow-2xl group-hover:block">
              <div className="font-black">{recipeNameEn(row.recipe) || row.label}</div>
              <div className="mt-1 text-slate-300">Qty Sold: {Number(row.salesVolume || 0).toLocaleString()}</div>
              <div className="text-slate-300">Revenue: {formatRestaurantRecipeCurrency(row.revenue)}</div>
              <div className="text-slate-300">Cost: {formatRestaurantRecipeCurrency(cost)}</div>
              <div className="text-slate-300">Price: {formatRestaurantRecipeCurrency(price)}</div>
              <div className="text-slate-300">Profit: {formatRestaurantRecipeCurrency(row.profitPerServing)}</div>
              <div className="text-slate-300">Margin: {formatRecipeMargin(row.margin)}</div>
            </div>
            <div className="absolute left-full top-1/2 ml-2 max-w-[110px] -translate-y-1/2 truncate rounded-full bg-white/90 px-2 py-0.5 type-caption font-black text-slate-900 shadow-sm">
              {row.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RecipeRankingTable({ rows = [], columns = [], emptyTitle, emptyDescription }) {
  if (!rows.length) {
    return <RecipeIntelligencePlaceholder title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
          <tr>
            {columns.map((column, index) => (
              <th key={column.key} className={index === 0 ? "px-3 py-2" : "py-2"}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id || row.label}>
              {columns.map((column, index) => (
                <td key={column.key} className={index === 0 ? "px-3 py-2" : "py-2"}>
                  {column.render ? column.render(row) : row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const recipeTrendPalette = ["#22c55e", "#38bdf8", "#f59e0b", "#a855f7", "#f43f5e"];

export function RecipeTrendChart({ series = [], months = [], valueFormatter = (value) => value, emptyTitle, emptyDescription, height = 280, showLegend = true, tooltipVariant = "default" }) {
  const activeSeries = series.filter((entry) => entry?.values?.some((point) => Number(point.value || 0) > 0)).slice(0, 5);
  if (!activeSeries.length || !months.length) {
    return <RecipeIntelligencePlaceholder title={emptyTitle} description={emptyDescription} />;
  }
  const chartHeight = Math.max(240, Number(height) || 280);
  const values = activeSeries.flatMap((entry) => entry.values.map((point) => Number(point.value || 0)));
  const maxValue = Math.max(...values, 1);
  const trendData = months.map((month) => {
    const row = { month, monthLabel: formatMonthShort(month) };
    activeSeries.forEach((entry) => {
      const point = entry.values.find((candidate) => candidate.month === month) || { value: 0 };
      row[entry.id] = Number(point.value || 0);
      row[`${entry.id}Tooltip`] = point.tooltip || "";
      row[`${entry.id}Meta`] = point.meta || null;
    });
    return row;
  });
  if (!trendData.length) {
    return <RecipeIntelligencePlaceholder title={emptyTitle} description={emptyDescription} />;
  }
  const peakBySeries = Object.fromEntries(activeSeries.map((entry) => [entry.id, Math.max(...entry.values.map((point) => Number(point.value || 0)), 0)]));
  const axisMax = Math.ceil(maxValue * 1.12);
  const tooltipByKey = Object.fromEntries(activeSeries.map((entry) => [entry.id, entry]));
  const gradientId = `recipeTrendArea-${activeSeries.map((entry) => entry.id).join("-")}`.replace(/[^a-zA-Z0-9_-]/g, "");
  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const seen = new Set();
    const rows = payload.filter((entry) => {
      if (!tooltipByKey[entry.dataKey] || seen.has(entry.dataKey)) return false;
      seen.add(entry.dataKey);
      return true;
    });
    if (!rows.length) return null;
    return (
      <div className="min-w-56 rounded-2xl border border-white/60 bg-white/95 p-3 text-xs text-slate-800 shadow-2xl backdrop-blur dark:border-white/10 dark:bg-slate-950/95 dark:text-slate-100">
        <div className="font-black">{label}</div>
        <div className="mt-2 space-y-2">
          {rows.map((entry) => {
            if (tooltipVariant === "ingredient-cost") {
              return (
                <div key={entry.dataKey} className="grid grid-cols-[1fr_auto] gap-4">
                  <span className="font-bold" style={{ color: entry.color }}>{tooltipByKey[entry.dataKey]?.label || entry.name}</span>
                  <span className="font-black">{valueFormatter(entry.value)}</span>
                </div>
              );
            }
            return (
              <div key={entry.dataKey}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold" style={{ color: entry.color }}>{tooltipByKey[entry.dataKey]?.label || entry.name}</span>
                  <span className="font-black">{valueFormatter(entry.value)}</span>
                </div>
                {Array.isArray(entry.payload?.[`${entry.dataKey}Meta`]) ? (
                  <div className="mt-1.5 space-y-1 text-slate-500 dark:text-slate-300">
                    {entry.payload[`${entry.dataKey}Meta`].map((item) => (
                      <div key={item.label} className="flex justify-between gap-4">
                        <span>{item.label}</span>
                        <span className="font-bold text-slate-700 dark:text-slate-100">{item.value}</span>
                      </div>
                    ))}
                  </div>
                ) : entry.payload?.[`${entry.dataKey}Tooltip`] ? (
                  <div className="mt-1 text-slate-500 dark:text-slate-300">{entry.payload[`${entry.dataKey}Tooltip`]}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  };
  const Dot = ({ cx, cy, payload, dataKey, stroke }) => {
    const value = Number(payload?.[dataKey] || 0);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    const isPeak = value > 0 && value === peakBySeries[dataKey];
    const radius = isPeak ? 5 : value > 0 ? 3 : 1.5;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={value > 0 ? stroke : "#94a3b8"}
        stroke={value > 0 ? "var(--surface, #fff)" : "#cbd5e1"}
        strokeWidth={isPeak ? 2 : 1.5}
        opacity={value > 0 ? 1 : 0.18}
      />
    );
  };

  return (
    <div>
      <div className="w-full min-w-0 rounded-3xl border border-border bg-gradient-to-br from-slate-50 via-white to-emerald-50/40 p-3 dark:from-slate-950 dark:via-slate-900 dark:to-emerald-950/20" style={{ height: chartHeight, minHeight: chartHeight }}>
        <ResponsiveContainer width="100%" height={chartHeight - 24} minWidth={1} minHeight={1}>
          <ComposedChart data={trendData} margin={{ top: 10, right: 16, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={recipeTrendPalette[0]} stopOpacity="0.18" />
                <stop offset="100%" stopColor={recipeTrendPalette[0]} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="currentColor" strokeDasharray="4 6" className="text-border/70" />
            <XAxis dataKey="monthLabel" axisLine={false} tickLine={false} interval={0} tick={{ fill: "var(--text-muted)", fontSize: 11, fontWeight: 700 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "var(--text-muted)", fontSize: 11, fontWeight: 700 }} tickFormatter={formatCompactCurrency} width={48} domain={[0, axisMax]} />
            <RechartsTooltip content={<CustomTooltip />} cursor={{ stroke: "var(--border-subtle)", strokeWidth: 1, strokeDasharray: "4 4" }} />
            {activeSeries[0] ? <Area type="monotone" dataKey={activeSeries[0].id} fill={`url(#${gradientId})`} stroke="none" isAnimationActive={false} activeDot={false} dot={false} /> : null}
            {activeSeries.map((entry, index) => (
              <Line
                key={entry.id}
                type="monotone"
                dataKey={entry.id}
                name={entry.label}
                stroke={recipeTrendPalette[index % recipeTrendPalette.length]}
                strokeWidth={2}
                dot={<Dot />}
                activeDot={{ r: 6, strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {showLegend ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {activeSeries.map((entry, index) => (
            <span key={entry.id || entry.label} className="inline-flex items-center gap-2 rounded-full border border-border bg-background px-2.5 py-1 type-caption font-bold text-text-secondary dark:bg-white/5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: recipeTrendPalette[index % recipeTrendPalette.length] }} />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatGrowthPercent(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric === 0) return "0%";
  return `${numeric > 0 ? "▲" : "▼"}${Math.abs(Math.round(numeric))}%`;
}

export function IngredientSelectorPills({ rows = [], selectedIds = [], onToggle, search, onSearch, sort, onSort }) {
  const selectedRows = selectedIds
    .map((id) => rows.find((row) => row.id === id))
    .filter(Boolean);
  const visible = rows
    .filter((row) => !search.trim() || `${row.ingredient} ${row.category}`.toLowerCase().includes(search.trim().toLowerCase()))
    .filter((row) => !selectedIds.includes(row.id))
    .slice(0, 12);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <label>
          <div className="mb-1 type-caption font-semibold text-text-secondary">Search ingredient</div>
          <input
            className="control h-9 w-full text-[13px]"
            value={search}
            list="recipe-ingredient-trend-options"
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Type ingredient name"
          />
          <datalist id="recipe-ingredient-trend-options">
            {rows.slice(0, 30).map((row) => <option key={row.id} value={row.ingredient} />)}
          </datalist>
        </label>
        <SelectField
          label="Sort"
          value={sort}
          options={[
            { value: "cost", label: "Total Cost" },
            { value: "usage", label: "Usage" },
            { value: "growth", label: "Growth %" },
          ]}
          onChange={onSort}
        />
      </div>
      {selectedRows.length ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedRows.map((row) => (
            <button
              key={row.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2 py-1 type-caption font-black text-primary transition hover:bg-primary/15 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200"
              type="button"
              onClick={() => onToggle(row.id)}
              title={`Remove ${row.ingredient}`}
            >
              <span>{row.ingredient}</span>
              <span className={Number(row.growthPercent || 0) >= 0 ? "text-emerald-700 dark:text-emerald-200" : "text-rose-700 dark:text-rose-200"}>
                {formatGrowthPercent(row.growthPercent)}
              </span>
              <X size={12} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {visible.map((row) => {
          const disabled = selectedIds.length >= 5;
          return (
            <button
              key={row.id}
              className={`rounded-full border border-border bg-background px-2 py-1 type-caption font-bold text-text-secondary transition hover:bg-primary/10 hover:text-text-primary dark:bg-white/5 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(row.id)}
            >
              {row.ingredient}
            </button>
          );
        })}
      </div>
      {selectedIds.length >= 5 ? <div className="type-caption text-text-muted">Up to 5 ingredients can be compared at once.</div> : null}
    </div>
  );
}

export function IngredientConsumptionModal({ rows = [], categories = [], filters, onFilter, onClose }) {
  const search = filters.search.trim().toLowerCase();
  const filtered = rows
    .filter((row) => (filters.category === "all" || row.category === filters.category)
      && (!search || `${row.ingredient} ${row.category}`.toLowerCase().includes(search)))
    .sort((a, b) => {
      if (filters.sort === "usage") return Number(b.estimatedUsage || 0) - Number(a.estimatedUsage || 0);
      if (filters.sort === "ingredient") return a.ingredient.localeCompare(b.ingredient);
      if (filters.sort === "category") return a.category.localeCompare(b.category) || a.ingredient.localeCompare(b.ingredient);
      return Number(b.totalCost || 0) - Number(a.totalCost || 0);
    });
  return (
    <Modal
      title="Ingredient Consumption"
      description="Full monthly estimated ingredient consumption from mapped Product Analytics sales and Recipe BOM."
      size="xl"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <AdminFilterToolbar className="mb-4">
        <AdminSearchField label="Search ingredient" value={filters.search} onChange={(value) => onFilter({ ...filters, search: value })} placeholder="Search ingredient" />
        <SelectField
          label="Category"
          value={filters.category}
          options={[{ value: "all", label: "All" }, ...categories.map((category) => ({ value: category, label: category }))]}
          onChange={(value) => onFilter({ ...filters, category: value })}
        />
        <SelectField
          label="Sort"
          value={filters.sort}
          options={[
            { value: "cost", label: "Total Cost" },
            { value: "usage", label: "Estimated Usage" },
            { value: "ingredient", label: "Ingredient Name" },
            { value: "category", label: "Category" },
          ]}
          onChange={(value) => onFilter({ ...filters, sort: value })}
        />
      </AdminFilterToolbar>
      <RecipeRankingTable
        rows={filtered}
        columns={[
          { key: "ingredient", label: "Ingredient", render: (row) => <div className="font-bold text-text-primary">{row.ingredient}</div> },
          { key: "category", label: "Category", render: (row) => <Badge tone="info">{row.category}</Badge> },
          { key: "usage", label: "Estimated Usage", render: (row) => <span className="font-black text-text-primary">{Number(row.estimatedUsage || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}</span> },
          { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
          { key: "unitCost", label: "Unit Cost", render: (row) => formatRestaurantRecipeCurrency(row.unitCost) },
          { key: "totalCost", label: "Total Cost", render: (row) => <span className="font-black text-text-primary">{formatRestaurantRecipeCurrency(row.totalCost)}</span> },
          { key: "contribution", label: "Cost Contribution %", render: (row) => <Badge tone="info">{formatRecipeMargin(row.costContribution)}</Badge> },
        ]}
        emptyTitle="No ingredient consumption rows"
        emptyDescription="Try another search or category filter."
      />
    </Modal>
  );
}
