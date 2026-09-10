import { useMemo, useState } from "react";
import { BookOpen, CheckCircle2, ClipboardCheck, DollarSign, PackageCheck } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { FactoryCellMuted } from "../components/FactoryTableCell.jsx";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import ProductRecipeDetailModal from "../modals/recipes/ProductRecipeDetailModal.jsx";
import ProductRecipeModal from "../modals/recipes/ProductRecipeModal.jsx";
import { costDisplay, recipeCostInfo } from "../utils/factoryCosting.js";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { quantity } from "../utils/factoryFormatters.js";
import { canArchiveActiveProductRecipe, canDeleteDraftProductRecipe } from "../utils/factoryPermissionActions.js";
import { jobStatusLabel } from "../utils/factoryStatus.js";

function groupedRecipes(recipes, productFamilies) {
  return Object.values(recipes.reduce((groups, recipe) => {
    const family = productFamilies.find((item) => item.id === recipe.product_family_id);
    const key = String(recipe.product_family_id || recipe.finished_good_id || recipe.product_name || recipe.id);
    if (!groups[key]) groups[key] = { id: key, name: family?.name_en || recipe.product_name_en || recipe.product_name || recipe.product_family_name || "Finished Good", nameCn: family?.name_cn || recipe.product_name_cn || "", recipes: [] };
    groups[key].recipes.push(recipe);
    return groups;
  }, {})).map((group) => ({
    ...group,
    recipes: group.recipes.sort((a, b) => {
      const rank = { active: 0, draft: 1, archived: 2 };
      const aVersion = Number(String(a.version || "").replace(/[^0-9]/g, "")) || 0;
      const bVersion = Number(String(b.version || "").replace(/[^0-9]/g, "")) || 0;
      return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || aVersion - bVersion;
    }),
  })).sort((a, b) => a.name.localeCompare(b.name));
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
  const filteredRecipes = useMemo(() => recipes.filter((recipe) => {
    const haystack = `${recipe.product_name_en || ""} ${recipe.product_name || ""} ${recipe.product_family_name || ""} ${recipe.version || ""}`.toLowerCase();
    return (!filters.search || haystack.includes(filters.search.toLowerCase())) && (!filters.status || recipe.status === filters.status);
  }), [filters, recipes]);
  const recipeGroups = useMemo(() => groupedRecipes(filteredRecipes, productFamilies), [filteredRecipes, productFamilies]);
  const pager = useFactoryClientPagination("product-recipes", recipeGroups.length, 20, JSON.stringify(filters));
  const groups = recipeGroups.slice(pager.from, pager.to);
  const draftRecipes = recipes.filter((recipe) => recipe.status === "draft");
  const activeRecipes = recipes.filter((recipe) => recipe.status === "active");
  const activeFamilies = new Set(activeRecipes.map((recipe) => recipe.product_family_id).filter(Boolean));
  const missingFinishedGoods = productFamilies.filter((product) => product.status === "active" && !activeFamilies.has(product.id));
  const activeCosts = activeRecipes.map((recipe) => recipeCostInfo(recipe, receivings));
  const totalCost = activeCosts.reduce((sum, cost) => sum + Number(cost.standardCost || 0), 0);
  const missingCosts = activeCosts.reduce((sum, cost) => sum + Number(cost.missingCostRows || 0), 0);
  const unsupportedCosts = activeCosts.reduce((sum, cost) => sum + Number(cost.unsupportedCostRows || 0), 0);
  const activeFilters = [
    filters.search && { key: "search", label: "Search", value: filters.search, onRemove: () => setFilters((current) => ({ ...current, search: "" })) },
    filters.status && { key: "status", label: "Status", value: jobStatusLabel(filters.status), onRemove: () => setFilters((current) => ({ ...current, status: "" })) },
  ].filter(Boolean);
  const renderActions = (recipe) => <FactoryRowActions
    onView={() => setSelectedRecipe(recipe)}
    primaryAction={recipe.status === "draft" && can("factory_product_recipes.manage") ? { label: "Activate", onClick: () => actions.activateProductRecipe(recipe) } : recipe.status === "archived" && can("factory_product_recipes.edit") ? { label: "Restore", onClick: () => actions.restoreProductRecipe(recipe) } : null}
    directActions={[
      recipe.status === "draft" && can("factory_product_recipes.edit") ? { label: "Edit Recipe", onClick: () => setEditorRecipe(recipe) } : null,
      recipe.status === "active" && can("factory_product_recipes.create") ? { label: "New Version", variant: "button", compact: true, onClick: async () => { const draft = await actions.createProductRecipeNewVersion(recipe); if (draft) setEditorRecipe(draft); } } : null,
    ]}
    secondaryActions={[
      recipe.status === "draft" && canDeleteDraftProductRecipe(can) ? { label: "Delete", destructive: true, onClick: () => actions.deleteProductRecipe(recipe) } : null,
      recipe.status === "active" && canArchiveActiveProductRecipe(can) ? { label: "Archive", destructive: true, onClick: () => actions.archiveProductRecipe(recipe) } : null,
    ]}
  />;
  const columns = [
    { key: "version", label: "Version", render: (recipe) => <span className="font-semibold text-text-primary">{recipe.version || "v1"}</span> },
    { key: "standard_output", label: "Standard Output", render: (recipe) => quantity(recipe.yield_quantity, recipe.uom) },
    { key: "materials", label: "Materials", render: (recipe) => recipe.items?.length || 0 },
    { key: "cost", label: "Recipe Cost", align: "right", render: (recipe) => <span className="font-semibold tabular-nums text-text-primary">{costDisplay(recipeCostInfo(recipe, receivings).standardCost, recipeCostInfo(recipe, receivings).missingCostRows, recipeCostInfo(recipe, receivings).unsupportedCostRows)}</span> },
    { key: "status", label: "Status", render: (recipe) => <FactoryStatusBadge status={jobStatusLabel(recipe.status)} /> },
    { key: "updated", label: "Updated", render: (recipe) => recipe.updated_at ? formatFactoryDate(recipe.updated_at) : <FactoryCellMuted /> },
    { key: "actions", label: "Actions", align: "right", render: renderActions },
  ];

  return <div className="space-y-5">
    <PageHeader section="Master Data" title="Product Recipes / BOM" description="Manage finished good recipes, standard output quantities and raw material requirements." actions={can("factory_product_recipes.create") ? <button className="btn-primary" type="button" onClick={() => setEditorRecipe({})}><BookOpen size={15} /> Create Recipe</button> : null} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={ClipboardCheck} label="Draft" value={draftRecipes.length} helper="Editable recipes" /><MetricCard icon={CheckCircle2} label="Active" value={activeRecipes.length} helper="Production defaults" tone="success" /><MetricCard icon={PackageCheck} label="FG Without Recipe" value={missingFinishedGoods.length} helper="Finished goods missing active recipe" tone={missingFinishedGoods.length ? "warning" : "success"} /><MetricCard icon={DollarSign} label="Cost" value={costDisplay(totalCost, missingCosts, unsupportedCosts)} helper={missingCosts ? "Missing receiving cost" : unsupportedCosts ? "Review BOM and receiving UOMs" : "Active recipe total"} tone={missingCosts || unsupportedCosts ? "warning" : "success"} /></div>
    <FactoryFilterBar activeFilters={activeFilters} onClear={() => setFilters({ search: "", status: "" })}>
      <Field label="Search"><input className={inputClass()} value={filters.search} placeholder="Search product or version" onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} /></Field>
      <Field label="Status"><SearchableSelect value={filters.status} options={[{ value: "", label: "All" }, { value: "draft", label: "Draft" }, { value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} placeholder="All" searchPlaceholder="Search status" onChange={(status) => setFilters((current) => ({ ...current, status }))} /></Field>
    </FactoryFilterBar>
    <FactoryDataSurface>
      {groups.length ? <div className="divide-y divide-border">{groups.map((group) => <section key={group.id} className="overflow-x-auto"><div className="flex items-center justify-between gap-4 border-b border-border bg-[var(--theme-subtle)] px-4 py-3"><div className="min-w-0"><div className="text-sm font-semibold text-text-primary">{group.name}</div>{group.nameCn ? <div className="mt-0.5 text-xs text-text-secondary">{group.nameCn}</div> : null}</div><span className="shrink-0 text-xs font-semibold text-text-secondary">{group.recipes.length} {group.recipes.length === 1 ? "Version" : "Versions"}</span></div><FactoryTable columns={columns} rows={group.recipes} rowHover="mint" onRowClick={setSelectedRecipe} /></section>)}</div> : <EmptyState title="No Product Recipes" description="No recipes match the selected filters." />}
      <FactoryPagination page={pager.page} pageSize={pager.pageSize} total={recipeGroups.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
    </FactoryDataSurface>
    {editorRecipe !== null ? <ProductRecipeModal initialValue={editorRecipe} productFamilies={productFamilies} recipes={recipes} finishedGoods={finishedGoods} rawMaterials={rawMaterials} receivings={receivings} onClose={() => setEditorRecipe(null)} onSave={async (form) => { await actions.saveProductRecipe(form); setEditorRecipe(null); }} /> : null}
    {selectedRecipe ? <ProductRecipeDetailModal recipe={selectedRecipe} receivings={receivings} onClose={() => setSelectedRecipe(null)} /> : null}
  </div>;
}
