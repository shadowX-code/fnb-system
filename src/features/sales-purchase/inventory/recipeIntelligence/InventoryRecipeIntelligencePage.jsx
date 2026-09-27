import { useEffect, useState } from "react";
import PageHeader from "../../../../components/layout/PageHeader.jsx";
import DashboardSection from "../../../../components/layout/DashboardSection.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminFilterToolbar from "../../../../components/layout/AdminFilterToolbar.jsx";
import { getAccessibleOutletOptions, getAccessibleOutlets, hasPermission } from "../../../../utils/accessControl.js";
import { getBusinessDateInput } from "../InventorySharedPresentation.jsx";
import { recipeAnalysisPeriodOptions, formatRestaurantRecipeCurrency, recipeCode, recipeNameEn, recipeNameCn, recipeMarginTone, formatRecipeMargin } from "../recipes/inventoryRecipeReadModel.js";
import { createRecipeIntelligenceProjection } from "./inventoryRecipeIntelligenceModel.js";
import { RecipeIntelligenceCard, RecipeYearSelector, RecipeInsightsPanel, RecipeIntelligenceLockedState, RecipeMappingHealth, RecipeMenuEngineeringMatrix, RecipeRankingTable, RecipeTrendChart, IngredientSelectorPills, IngredientConsumptionModal, formatMonthShort, formatPercentChange } from "./RecipeIntelligenceViews.jsx";
import useRecipeIntelligenceRead from "./useRecipeIntelligenceRead.js";
const recipeMonthOptions = [
  { value: "1", label: "Jan" },
  { value: "2", label: "Feb" },
  { value: "3", label: "Mar" },
  { value: "4", label: "Apr" },
  { value: "5", label: "May" },
  { value: "6", label: "Jun" },
  { value: "7", label: "Jul" },
  { value: "8", label: "Aug" },
  { value: "9", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
];











export default function InventoryRecipeIntelligencePage({auth, outlets}) {
  const accessibleOutlets = getAccessibleOutlets(auth,outlets);
  const recipeOutletOptions = getAccessibleOutletOptions(auth,outlets).filter(row => row.value !== "all");
  const [selectedOutletId,setSelectedOutletId] = useState(() => accessibleOutlets[0]?.id || "");
  const activeRecipeOutletId = accessibleOutlets.some(row => row.id === selectedOutletId) ? selectedOutletId : accessibleOutlets[0]?.id || "";
  const today = getBusinessDateInput();
  const [recipeAnalysisPeriod,setRecipeAnalysisPeriod] = useState("last3");
  const [recipeReportMonth,setRecipeReportMonth] = useState(() => String(Number(today.slice(5,7))));
  const [recipeReportYear,setRecipeReportYear] = useState(() => today.slice(0,4));
  const [recipeTrendYear,setRecipeTrendYear] = useState(() => Number(today.slice(0,4)));
  const [ingredientTrendSearch,setIngredientTrendSearch] = useState("");
  const [ingredientTrendSort,setIngredientTrendSort] = useState("cost");
  const [ingredientTrendSelectedIds,setIngredientTrendSelectedIds] = useState([]);
  const [ingredientConsumptionFilters,setIngredientConsumptionFilters] = useState({search:"",category:"all",sort:"cost"});
  const [modal,setModal] = useState(null);
  const enabled = hasPermission(auth,"recipe_intelligence.view");
  const read = useRecipeIntelligenceRead({outletId:activeRecipeOutletId,scopeKey:auth?.user?.id || "",enabled,recipeAnalysisPeriod,recipeReportMonth,recipeReportYear,recipeTrendYear});
  useEffect(() => { setIngredientTrendSearch(""); setIngredientTrendSelectedIds([]); setModal(null); },[activeRecipeOutletId,recipeAnalysisPeriod,recipeReportMonth,recipeReportYear,recipeTrendYear]);
  if (!enabled) return <EmptyState title="Permission required" description="You do not have permission to view Recipe Intelligence." />;
  if (!read.data) return <div className="space-y-4"><PageHeader section="INVENTORY CONTROL" title="Recipe Intelligence" description="Analyze recipe profit, mapped product performance, and ingredient demand." /><div className="card p-4" role={read.error ? "alert" : "status"}>{read.error ? <><p>Recipe Intelligence data unavailable or incomplete.</p><p>{read.error}</p><p>No partial analytics are presented as complete.</p><button className="btn-secondary" onClick={read.refresh}>Retry</button></> : <p>{activeRecipeOutletId ? "Loading complete Recipe Intelligence…" : "No accessible outlet."}</p>}</div></div>;
  const data = read.data;
  const outletById = new Map(accessibleOutlets.map(row => [row.id,row]));
  const {selectedPeriod,selectedReportLabel,trendMonths,availableTrendYears,availableReportYears,mappingCandidateRecipes,menuEngineeringRows,mappedRecipeCount,mappedProductCount,pendingProductCount,ignoredProductCount,mappingCoverage,reliableMenuEngineeringRows,topGrossProfitRows,grossProfitTrendSeries,currentYearGrossProfit,bestGrossProfitMonth,averageMonthlyGrossProfit,ingredientConsumptionCategories,ingredientConsumptionRowsWithContribution,ingredientDemandForecastRows,trendIngredientRows,activeTrendIngredientIds,ingredientTrendSeries,highestIngredientCostPoint} = createRecipeIntelligenceProjection({data,outletById,activeRecipeOutletId,recipeAnalysisPeriod,recipeReportYear,recipeReportMonth,recipeTrendYear,recipeProductReports:data.recipeProductReports,recipeProductItems:data.recipeProductItems,recipeProductMappings:data.recipeProductMappings,ingredientTrendSort,ingredientTrendSelectedIds});
  const recipeProductLoading = read.state === "refreshing";
    return (
      <div className="space-y-4">
<PageHeader section="INVENTORY CONTROL" title="Recipe Intelligence" description="Analyze recipe profit, mapped product performance, and ingredient demand." actions={<button type="button" className="btn-secondary" onClick={read.refresh}>Refresh</button>} />
{read.state === "refreshing" ? <p role="status">Refreshing Recipe Intelligence. Showing the last verified complete read.</p> : null}
{modal ? <IngredientConsumptionModal rows={ingredientConsumptionRowsWithContribution} categories={ingredientConsumptionCategories} filters={ingredientConsumptionFilters} onFilter={setIngredientConsumptionFilters} onClose={() => setModal(null)} /> : null}
        {(
      <AdminFilterToolbar>
            <SelectField label="Outlet" value={activeRecipeOutletId} options={recipeOutletOptions} onChange={setSelectedOutletId} searchable />
            <SelectField label="Forecast period" value={recipeAnalysisPeriod} options={recipeAnalysisPeriodOptions} onChange={setRecipeAnalysisPeriod} />
            <SelectField
              label="Month"
              value={String(recipeReportMonth)}
              options={recipeMonthOptions}
              onChange={(value) => setRecipeReportMonth(String(value))}
            />
            <SelectField
              label="Year"
              value={String(recipeReportYear)}
              options={availableReportYears.map((year) => ({ value: String(year), label: String(year) }))}
              onChange={(value) => setRecipeReportYear(String(value))}
            />
          </AdminFilterToolbar>
        )}
        {<DashboardSection
          title="Recipe Intelligence"
          subtitle="Identify profitable menu items, highest cost recipes and key ingredient cost drivers."
        >
          <div className="mb-4 grid gap-3">
            <RecipeMappingHealth mapped={mappedProductCount} unmapped={pendingProductCount} totalRecipes={mappingCandidateRecipes.length} loading={recipeProductLoading} />
          </div>
          {pendingProductCount > 0 ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 type-body-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-100">
              <span className="font-black">Some products are not mapped yet.</span> Insights may be incomplete until {pendingProductCount} pending {pendingProductCount === 1 ? "product is" : "products are"} mapped or ignored.
            </div>
          ) : null}
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
            <RecipeIntelligenceCard
              title="Menu Engineering Matrix"
              description="Product Analytics source: X = Qty Sold, Y = Margin %, bubble size = Revenue."
            >
              {mappedRecipeCount < 10 ? (
                <RecipeIntelligenceLockedState mappedCount={mappedRecipeCount} />
              ) : (
                <RecipeMenuEngineeringMatrix rows={menuEngineeringRows} />
              )}
            </RecipeIntelligenceCard>
            <RecipeInsightsPanel rows={reliableMenuEngineeringRows} grossProfitRows={topGrossProfitRows} ingredientDrivers={ingredientDemandForecastRows} pendingCount={pendingProductCount} />
          </div>
          <div className="mt-4 grid gap-4">
            <RecipeIntelligenceCard
              title="Recipe Gross Profit Trend"
              description={`Jan-Dec ${recipeTrendYear} monthly gross profit from mapped Product Analytics quantity sold × recipe profit per serving.`}
              action={<RecipeYearSelector year={recipeTrendYear} years={availableTrendYears} onChange={setRecipeTrendYear} />}
            >
              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <MetricCard label={`${recipeTrendYear} Gross Profit`} value={formatRestaurantRecipeCurrency(currentYearGrossProfit)} helper="Mapped recipe sales only" tone={currentYearGrossProfit ? "success" : "neutral"} size="compact" />
                <MetricCard label="Best Month" value={bestGrossProfitMonth ? formatMonthShort(bestGrossProfitMonth.month) : "—"} helper={bestGrossProfitMonth ? formatRestaurantRecipeCurrency(bestGrossProfitMonth.grossProfit) : "No mapped sales"} tone={bestGrossProfitMonth?.grossProfit ? "success" : "neutral"} size="compact" />
                <MetricCard label="Average Monthly GP" value={formatRestaurantRecipeCurrency(averageMonthlyGrossProfit)} helper="12-month average" size="compact" />
              </div>
              <RecipeTrendChart
                series={grossProfitTrendSeries}
                months={trendMonths}
                valueFormatter={formatRestaurantRecipeCurrency}
                emptyTitle="Map products to recipes to unlock gross profit trend."
                emptyDescription="Gross profit uses Product Analytics qty sold and Recipe BOM costing. No fake trend is shown."
              />
              {bestGrossProfitMonth?.grossProfit ? (
                <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 type-body-sm text-emerald-900 dark:border-emerald-400/30 dark:bg-emerald-950/30 dark:text-emerald-100">
                  Gross profit peaked in {formatMonthShort(bestGrossProfitMonth.month)} at {formatRestaurantRecipeCurrency(bestGrossProfitMonth.grossProfit)}.
                </div>
              ) : null}
            </RecipeIntelligenceCard>
            <div className="grid gap-4 lg:grid-cols-2">
              <RecipeIntelligenceCard
                title={`Top Gross Profit Recipes - ${selectedReportLabel}`}
                description="Recipes ranked by selected-month gross profit, not just revenue."
              >
                <RecipeRankingTable
                  rows={topGrossProfitRows}
                  columns={[
                    { key: "recipe", label: "Recipe", render: (row) => <div><div className="font-bold text-text-primary">{recipeNameEn(row.recipe) || row.label}</div><div className="type-caption text-text-muted">{recipeNameCn(row.recipe) || recipeCode(row.recipe)}</div></div> },
                    { key: "qty", label: "Qty Sold", render: (row) => <span className="font-black text-text-primary">{Number(row.salesVolume || 0).toLocaleString()}</span> },
                    { key: "revenue", label: "Revenue", render: (row) => formatRestaurantRecipeCurrency(row.revenue) },
                    { key: "grossProfit", label: "Gross Profit", render: (row) => <span className="font-black text-text-primary">{formatRestaurantRecipeCurrency(row.grossProfit)}</span> },
                    { key: "margin", label: "Margin %", render: (row) => <Badge tone={recipeMarginTone(row.margin)}>{formatRecipeMargin(row.margin)}</Badge> },
                  ]}
                  emptyTitle="No mapped gross profit yet"
                  emptyDescription="Map Product Analytics products to recipes with selling prices and ingredient costs."
                />
              </RecipeIntelligenceCard>
              <RecipeIntelligenceCard
                title="Ingredient Demand Forecast"
                description={`${selectedPeriod.label} average monthly usage for procurement planning.`}
              >
                <RecipeRankingTable
                  rows={ingredientDemandForecastRows}
                  columns={[
                    { key: "ingredient", label: "Ingredient", render: (row) => <div><div className="font-bold text-text-primary">{row.ingredient}</div><div className="type-caption text-text-muted">{row.category}</div></div> },
                    { key: "usage", label: "Forecast Usage", render: (row) => <span className="font-black text-text-primary">{Number(row.forecastUsage || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}</span> },
                    { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
                    { key: "cost", label: "Forecast Cost", render: (row) => <span className="font-black text-text-primary">{formatRestaurantRecipeCurrency(row.forecastCost)}</span> },
                    { key: "change", label: "Change", render: (row) => <Badge tone={Number(row.change || 0) > 0 ? "warning" : Number(row.change || 0) < 0 ? "success" : "neutral"}>{formatPercentChange(row.change)}</Badge> },
                  ]}
                  emptyTitle="Map products to recipes to estimate demand."
                  emptyDescription="Ingredient demand forecast needs mapped Product Analytics sales and Recipe BOM quantities."
                />
              </RecipeIntelligenceCard>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <RecipeIntelligenceCard
                title={`Top 10 Ingredient Consumption - ${selectedReportLabel}`}
                description="Estimated monthly usage from mapped Product Analytics sales × Recipe BOM."
                action={(
                  <button
                    className="btn-secondary h-8 px-3 text-xs"
                    type="button"
                    onClick={() => setModal({ type: "ingredient-consumption", rows: ingredientConsumptionRowsWithContribution, categories: ingredientConsumptionCategories })}
                    disabled={!ingredientConsumptionRowsWithContribution.length}
                  >
                    View All
                  </button>
                )}
              >
                <RecipeRankingTable
                  rows={ingredientConsumptionRowsWithContribution.slice(0, 10)}
                  columns={[
                    { key: "ingredient", label: "Ingredient", render: (row) => <div><div className="font-bold text-text-primary">{row.ingredient}</div><div className="type-caption text-text-muted">{row.category}</div></div> },
                    { key: "usage", label: "Estimated Usage", render: (row) => <span className="font-black text-text-primary">{Number(row.estimatedUsage || 0).toLocaleString("en-MY", { maximumFractionDigits: 2 })}</span> },
                    { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
                    { key: "unitCost", label: "Unit Cost", render: (row) => formatRestaurantRecipeCurrency(row.unitCost) },
                    { key: "totalCost", label: "Total Cost", render: (row) => <span className="font-black text-text-primary">{formatRestaurantRecipeCurrency(row.totalCost)}</span> },
                    { key: "contribution", label: "Cost Contribution %", render: (row) => <Badge tone="info">{formatRecipeMargin(row.costContribution)}</Badge> },
                  ]}
                  emptyTitle="Map products to recipes to estimate ingredient consumption."
                  emptyDescription="Only mapped products feed ingredient usage. Pending and ignored products are excluded."
                />
              </RecipeIntelligenceCard>
              <RecipeIntelligenceCard
                title="Ingredient Cost Trend"
                description={`Jan-Dec ${recipeTrendYear} estimated procurement cost trend by ingredient.`}
                action={<RecipeYearSelector year={recipeTrendYear} years={availableTrendYears} onChange={setRecipeTrendYear} />}
              >
                <IngredientSelectorPills
                  rows={trendIngredientRows}
                  selectedIds={activeTrendIngredientIds}
                  search={ingredientTrendSearch}
                  onSearch={setIngredientTrendSearch}
                  sort={ingredientTrendSort}
                  onSort={setIngredientTrendSort}
                  onToggle={(id) => setIngredientTrendSelectedIds((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id].slice(0, 5))}
                />
                <div className="mt-4">
                  <RecipeTrendChart
                    series={ingredientTrendSeries}
                    months={trendMonths}
                    valueFormatter={formatRestaurantRecipeCurrency}
                    emptyTitle="Map products to recipes to unlock ingredient cost trends."
                    emptyDescription="The trend uses estimated monthly procurement cost, not quantity."
                    showLegend={false}
                    tooltipVariant="ingredient-cost"
                  />
                  {highestIngredientCostPoint?.peak ? (
                    <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50 p-3 dark:border-orange-400/30 dark:bg-orange-950/30">
                      <div className="type-caption font-black uppercase tracking-wide text-orange-700 dark:text-orange-200">Top Cost Driver</div>
                      <div className="mt-2 grid gap-3 sm:grid-cols-3">
                        <MetricCard label="Ingredient" value={highestIngredientCostPoint.ingredient} helper={highestIngredientCostPoint.category || "Ingredient"} tone="warning" size="compact" />
                        <MetricCard label="Month" value={formatMonthShort(highestIngredientCostPoint.peak.month)} helper={String(recipeTrendYear)} tone="warning" size="compact" />
                        <MetricCard label="Cost" value={formatRestaurantRecipeCurrency(highestIngredientCostPoint.peak.cost)} helper="Estimated cost" tone="warning" size="compact" />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-border bg-slate-50 p-3 type-body-sm text-text-secondary dark:bg-white/5">
                      No ingredient cost trend available for selected year.
                    </div>
                  )}
                </div>
              </RecipeIntelligenceCard>
            </div>
          </div>
        </DashboardSection>}
      </div>
    );

}

