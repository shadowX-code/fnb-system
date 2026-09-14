import { useMemo, useState } from "react";
import { BookOpen, CheckCircle2, ClipboardCheck, TriangleAlert } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import FactorySummaryCard from "../components/FactorySummaryCard.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { FactoryCellEntity, FactoryCellMuted, FactoryCellSemanticText } from "../components/FactoryTableCell.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import ProductRecipeDetailModal from "../modals/recipes/ProductRecipeDetailModal.jsx";
import ProductRecipeModal from "../modals/recipes/ProductRecipeModal.jsx";
import { costDisplay, recipeCostInfo } from "../utils/factoryCosting.js";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { money, quantity } from "../utils/factoryFormatters.js";
import { canArchiveActiveProductRecipe, canDeleteDraftProductRecipe } from "../utils/factoryPermissionActions.js";
import { jobStatusLabel } from "../utils/factoryStatus.js";

function recipeReadiness(recipe) {
  if (recipe.status === "archived") return { isReady: false, label: "Not applicable", tone: "gray" };
  return recipe.product_family_id || recipe.finished_good_id
    ? { isReady: true, label: "Ready", tone: "green" }
    : { isReady: false, label: "Finished Good missing", tone: "amber" };
}

function costPerKgDisplay(cost) {
  if (!cost?.itemRows?.length || cost.missingCostRows || cost.unsupportedCostRows || !Number.isFinite(Number(cost.costPerUnit)) || Number(cost.costPerUnit) <= 0) return "—";
  return `${money(cost.costPerUnit)}/kg`;
}

function productFirstRecipes(recipes, productFamilies, receivings) {
  const groups = new Map();
  recipes.forEach((recipe) => {
    const family = productFamilies.find((item) => item.id === recipe.product_family_id);
    const storedName = recipe.product_name_en || recipe.product_name || recipe.product_family_name || "Finished Good";
    const key = recipe.product_family_id ? `family:${recipe.product_family_id}` : recipe.finished_good_id ? `sku:${recipe.finished_good_id}` : `legacy:${String(storedName).toLowerCase()}:${recipe.id}`;
    if (!groups.has(key)) groups.set(key, { id: key, productName: family?.name_en || storedName, productNameCn: family?.name_cn || recipe.product_name_cn || "", recipes: [] });
    groups.get(key).recipes.push(recipe);
  });
  return [...groups.values()].map((group) => {
    const versions = [...group.recipes]
      .sort((left, right) => String(right.version || "").localeCompare(String(left.version || ""), "en-MY", { numeric: true, sensitivity: "base" }) || String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")) || String(left.id || "").localeCompare(String(right.id || "")))
      .map((recipe) => ({ ...recipe, productName: group.productName, productNameCn: group.productNameCn, cost: recipeCostInfo(recipe, receivings), readiness: recipeReadiness(recipe), versionCount: group.recipes.length }));
    return { ...versions[0], versions };
  }).sort((left, right) => left.productName.localeCompare(right.productName, "en-MY", { numeric: true, sensitivity: "base" }));
}

export default function FactoryProductRecipesPage() {
  const masterData = useFactoryMasterData();
  const { can } = useFactoryPermissions();
  const actions = useFactoryNavigation();
  const recipes = Array.isArray(masterData.recipes) ? masterData.recipes : [];
  const productFamilies = Array.isArray(masterData.productFamilies) ? masterData.productFamilies : [];
  const finishedGoods = Array.isArray(masterData.finishedGoods) ? masterData.finishedGoods : [];
  const rawMaterials = Array.isArray(masterData.rawMaterials) ? masterData.rawMaterials : [];
  const receivings = Array.isArray(masterData.receivings) ? masterData.receivings : [];
  const [filters, setFilters] = useState({ search: "", status: "" });
  const [editorRecipe, setEditorRecipe] = useState(null);
  const [selectedRecipe, setSelectedRecipe] = useState(null);
  const [expandedProducts, setExpandedProducts] = useState({});
  const productRows = useMemo(() => productFirstRecipes(recipes, productFamilies, receivings), [productFamilies, receivings, recipes]);
  const filteredRows = useMemo(() => productRows.filter((row) => {
    const haystack = `${row.productName || ""} ${row.productNameCn || ""} ${(row.versions || []).map((version) => version.version || "").join(" ")}`.toLowerCase();
    return (!filters.search || haystack.includes(filters.search.toLowerCase())) && (!filters.status || row.status === filters.status);
  }), [filters, productRows]);
  const pager = useFactoryClientPagination("product-recipes", filteredRows.length, 20, JSON.stringify(filters));
  const visibleRows = filteredRows.slice(pager.from, pager.to);
  const draftCount = productRows.filter((row) => row.status === "draft").length;
  const activeCount = productRows.filter((row) => row.status === "active").length;
  const recipeFamilyIds = new Set(recipes.map((recipe) => recipe.product_family_id).filter(Boolean));
  const missingRecipeCount = productFamilies.filter((family) => family.status === "active" && !recipeFamilyIds.has(family.id)).length;
  const activeFilters = [
    filters.search && { key: "search", label: "Search", value: filters.search, onRemove: () => setFilters((current) => ({ ...current, search: "" })) },
    filters.status && { key: "status", label: "Status", value: jobStatusLabel(filters.status), onRemove: () => setFilters((current) => ({ ...current, status: "" })) },
  ].filter(Boolean);
  const renderActions = (row) => <div className="flex items-center justify-end gap-2"><FactoryRowActions
    onView={() => setSelectedRecipe(row)}
    primaryAction={row.status === "draft" && row.readiness.isReady && can("factory_product_recipes.manage") ? { label: "Activate", onClick: () => actions.activateProductRecipe(row) } : row.status === "archived" && can("factory_product_recipes.edit") ? { label: "Restore", onClick: () => actions.restoreProductRecipe(row) } : null}
    directActions={[
      row.status === "draft" && can("factory_product_recipes.edit") ? { label: "Edit Recipe", onClick: () => setEditorRecipe(row) } : null,
      row.status === "active" && can("factory_product_recipes.create") ? { label: "New Version", variant: "button", compact: true, onClick: async () => { const draft = await actions.createProductRecipeNewVersion(row); if (draft) setEditorRecipe(draft); } } : null,
    ]}
    secondaryActions={[
      row.status === "draft" && canDeleteDraftProductRecipe(can) ? { label: "Delete", destructive: true, onClick: () => actions.deleteProductRecipe(row) } : null,
      row.status === "active" && canArchiveActiveProductRecipe(can) ? { label: "Archive", destructive: true, onClick: () => actions.archiveProductRecipe(row) } : null,
    ]}
  />{row.status === "draft" && !row.readiness.isReady ? <FactoryCellSemanticText tone={row.readiness.tone}>{row.readiness.label}</FactoryCellSemanticText> : null}</div>;
  const versionCell = (row, showHistory = true) => <div className="flex items-center gap-2 whitespace-nowrap"><span className="font-semibold text-text-primary">{row.version || "v1"}</span>{showHistory && row.versionCount > 1 ? <button className="text-xs font-medium text-text-secondary underline-offset-2 hover:text-primary hover:underline" type="button" aria-label={`${expandedProducts[row.id] ? "Hide" : "Show"} ${row.versionCount} versions for ${row.productName}`} aria-expanded={expandedProducts[row.id] ?? false} onClick={(event) => { event.stopPropagation(); setExpandedProducts((current) => ({ ...current, [row.id]: !current[row.id] })); }}>{row.versionCount} versions</button> : null}</div>;
  const columns = [
    { key: "product", label: "Product", className: "min-w-[190px]", render: (row) => <FactoryCellEntity name={row.productName} code={row.productNameCn} /> },
    { key: "version", label: "Version", render: (row) => versionCell(row) },
    { key: "standard_output", label: "Standard Output", render: (row) => <span className="whitespace-nowrap text-sm text-text-secondary">{quantity(row.yield_quantity, row.uom)}</span> },
    { key: "materials", label: "Materials", align: "right", render: (row) => <span className="font-medium text-text-primary">{row.items?.length || 0}</span> },
    { key: "cost", label: "Recipe Cost", align: "right", render: (row) => <span className="whitespace-nowrap font-semibold tabular-nums text-text-primary">{costDisplay(row.cost.standardCost, row.cost.missingCostRows, row.cost.unsupportedCostRows)}</span> },
    { key: "cost_per_kg", label: "Cost / kg", align: "right", render: (row) => <span className="whitespace-nowrap tabular-nums text-text-secondary">{costPerKgDisplay(row.cost)}</span> },
    { key: "status", label: "Status", render: (row) => <FactoryStatusBadge status={jobStatusLabel(row.status)} /> },
    { key: "updated", label: "Updated", render: (row) => row.updated_at ? formatFactoryDate(row.updated_at) : <FactoryCellMuted /> },
    { key: "actions", label: "Actions", align: "right", render: renderActions },
  ];
  const versionHistoryColumns = [{ key: "version", label: "Version", render: (row) => versionCell(row, false) }, ...columns.slice(2)];

  return <div className="space-y-5">
    <PageHeader section="Master Data" title="Product Recipes / BOM" description="Manage finished good recipes, standard output quantities and raw material requirements." actions={can("factory_product_recipes.create") ? <button className="btn-primary" type="button" onClick={() => setEditorRecipe({})}><BookOpen size={15} /> Create Recipe</button> : null} />
    <div className="grid gap-3 md:grid-cols-4"><FactorySummaryCard icon={BookOpen} label="Products with Recipe" value={productRows.length} helper="Current product standards" /><FactorySummaryCard icon={ClipboardCheck} label="Draft" value={draftCount} helper="Current recipe drafts" /><FactorySummaryCard icon={CheckCircle2} tone="success" label="Active" value={activeCount} helper="Available for production" /><FactorySummaryCard icon={TriangleAlert} tone={missingRecipeCount ? "warning" : "success"} label="Missing Recipe" value={missingRecipeCount} helper={missingRecipeCount ? "Active Finished Goods without a Recipe" : "All active Finished Goods covered"} /></div>
    <FactoryFilterBar activeFilters={activeFilters} onClear={() => setFilters({ search: "", status: "" })}>
      <Field label="Search"><input className={inputClass()} value={filters.search} placeholder="Search product or version" onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></Field>
      <Field label="Status"><SearchableSelect value={filters.status} options={[{ value: "", label: "All" }, { value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} placeholder="All" searchPlaceholder="Search status" onChange={(status) => setFilters((current) => ({ ...current, status }))} /></Field>
    </FactoryFilterBar>
    <FactoryDataSurface>
      {visibleRows.length ? <FactoryTable columns={columns} rows={visibleRows} rowHover="mint" onRowClick={setSelectedRecipe} renderAfterRow={(row) => expandedProducts[row.id] ? <div className="border-t border-border bg-[var(--theme-subtle)] px-4 py-3 md:px-8"><div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">Version history</div><FactoryTable columns={versionHistoryColumns} rows={row.versions} rowHover="mint" onRowClick={setSelectedRecipe} /></div> : null} /> : <EmptyState title="No Product Recipes" description="No recipes match the selected filters." />}
      <FactoryPagination page={pager.page} pageSize={pager.pageSize} total={filteredRows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </FactoryDataSurface>
    {editorRecipe !== null ? <ProductRecipeModal initialValue={editorRecipe} productFamilies={productFamilies} recipes={recipes} finishedGoods={finishedGoods} rawMaterials={rawMaterials} receivings={receivings} onClose={() => setEditorRecipe(null)} onSave={async (form) => { await actions.saveProductRecipe(form); setEditorRecipe(null); }} /> : null}
    {selectedRecipe ? <ProductRecipeDetailModal recipe={selectedRecipe} receivings={receivings} onClose={() => setSelectedRecipe(null)} /> : null}
  </div>;
}
