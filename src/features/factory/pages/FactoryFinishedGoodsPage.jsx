import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Clock3, Package, PackageCheck, Pencil, Plus, Tag, Warehouse } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryPagination, { useFactoryClientPagination } from "../components/FactoryPagination.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import FactoryRowActions from "../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../components/FactoryStatusBadge.jsx";
import { FactoryCellEntity, FactoryCellMuted, FactoryCellSemanticText, FactoryCellText } from "../components/FactoryTableCell.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import FactoryFinishedGoodCommercialTable from "../components/finishedGoods/FactoryFinishedGoodCommercialTable.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import useFactoryFinishedGoodsQuery from "../hooks/useFactoryFinishedGoodsQuery.js";
import useFactoryMasterData from "../hooks/useFactoryMasterData.js";
import useFactoryNavigation from "../hooks/useFactoryNavigation.js";
import useFactoryPermissions from "../hooks/useFactoryPermissions.js";
import FactoryFinishedGoodDetailModal from "../modals/FactoryFinishedGoodDetailModal.jsx";
import { finishedGoodCommercialCost } from "../utils/finishedGoodsCommercial.js";
import { activeRecipeForSku } from "../utils/productionPlanning.js";
import { formatFactoryDate } from "../utils/factoryDates.js";
import { quantity } from "../utils/factoryFormatters.js";
import { productionBatchReference, productionJobOrderReference } from "../utils/factoryReferences.js";
import { jobStatusLabel } from "../utils/factoryStatus.js";

const packSizeText = (sku) => Number(sku?.pack_size_qty || 0) > 0 ? `${sku.pack_size_qty} ${sku.pack_size_uom || ""}`.trim() : "";
const packagingTypeLabel = (sku) => sku?.packaging_type || "Pack";
const pluralizePackagingType = (type, value) => Number(value || 0) === 1 ? type || "Pack" : /ch$/i.test(type || "Pack") ? `${type || "Pack"}es` : `${type || "Pack"}s`;
const skuBalanceLabel = (sku) => quantity(Number(sku?.current_balance || 0), pluralizePackagingType(packagingTypeLabel(sku), sku?.current_balance));
const normalizePackSizeToBase = (qty, uom) => {
  const amount = Number(qty || 0); const unit = String(uom || "").trim().toLowerCase();
  if (!amount || !unit) return null;
  if (["kg", "kilogram", "kilograms"].includes(unit)) return { amount, uom: "kg" };
  if (["g", "gram", "grams"].includes(unit)) return { amount: amount / 1000, uom: "kg" };
  if (["l", "litre", "liter", "litres", "liters"].includes(unit)) return { amount, uom: "L" };
  if (["ml", "millilitre", "milliliter", "millilitres", "milliliters"].includes(unit)) return { amount: amount / 1000, uom: "L" };
  return null;
};
const skuBaseEquivalentLabel = (sku) => { const base = normalizePackSizeToBase(sku?.pack_size_qty || sku?.base_qty, sku?.pack_size_uom || sku?.base_uom); return base ? quantity(Number(sku?.current_balance || 0) * base.amount, base.uom) : ""; };
const packagingBaseBalanceInfo = (skus) => {
  let total = 0; let uom = "";
  for (const sku of skus) { const base = normalizePackSizeToBase(sku.pack_size_qty || sku.base_qty, sku.pack_size_uom || sku.base_uom); if (!base || (uom && uom !== base.uom)) return { label: "Mixed" }; uom = base.uom; total += Number(sku.current_balance || 0) * base.amount; }
  return skus.length ? { label: quantity(total, uom) } : { label: "—" };
};

export default function FactoryFinishedGoodsPage() {
  const masterData = useFactoryMasterData();
  const finishedGoods = Array.isArray(masterData.finishedGoods) ? masterData.finishedGoods : [];
  const finishedGoodCategories = Array.isArray(masterData.finishedGoodCategories) ? masterData.finishedGoodCategories : [];
  const recipes = Array.isArray(masterData.recipes) ? masterData.recipes : [];
  const receivings = Array.isArray(masterData.receivings) ? masterData.receivings : [];
  const productions = Array.isArray(masterData.productions) ? masterData.productions : [];
  const productMovements = Array.isArray(masterData.productMovements) ? masterData.productMovements : [];
  const productionCosts = Array.isArray(masterData.productionCosts) ? masterData.productionCosts : [];
  const { can } = useFactoryPermissions();
  const navigation = useFactoryNavigation();
  const [filters, setFilters] = useState({ product: "", category: "", status: "" });
  const [view, setView] = useState("grouped");
  const [expandedGroups, setExpandedGroups] = useState({});
  const [selectedProduct, setSelectedProduct] = useState(null);
  const query = useFactoryFinishedGoodsQuery({ filters });
  const pager = useFactoryClientPagination("finished-goods", view === "table" ? query.rows.length : query.groups.length, 20, JSON.stringify({ ...filters, view }));
  const canManage = can("factory_finished_goods.create") || can("factory_finished_goods.edit");
  const commercialRows = useMemo(() => query.rows.slice(pager.from, pager.to).map((sku) => {
    const cost = finishedGoodCommercialCost(sku, recipes, receivings);
    const price = Number(sku.b2b_price || 0) > 0 ? Number(sku.b2b_price) : null;
    return { ...sku, commercial_cost: cost, gross_margin: cost != null && price != null ? ((price - cost) / price) * 100 : null };
  }), [pager.from, pager.to, query.rows, receivings, recipes]);
  const groups = useMemo(() => query.groups.slice(pager.from, pager.to).map((group) => ({ ...group, total_base_balance: packagingBaseBalanceInfo(group.skus) })), [pager.from, pager.to, query.groups]);
  const outOfStock = finishedGoods.filter((sku) => Number(sku.current_balance || 0) <= 0).length;
  const activeRecipes = recipes.filter((recipe) => recipe.status === "active").length;
  const renderSkuActions = (sku, group = null) => <FactoryRowActions onView={() => setSelectedProduct(sku)} directActions={can("factory_finished_goods.edit") ? [{ label: "Edit Packaging SKU", icon: Pencil, onClick: () => navigation.openFinishedGoodPackagingSku(group, sku) }] : []} secondaryActions={can("factory_finished_goods.edit") && sku.status !== "archived" ? [{ label: "Archive", destructive: true, onClick: () => navigation.archiveFinishedGoodPackagingSku(sku) }] : []} />;
  const skuColumns = (group) => [
    { key: "sku", label: "SKU", render: (sku) => <span className="font-semibold text-text-primary">{sku.product_code || <FactoryCellMuted />}</span> },
    { key: "pack_size", label: "Pack Size", render: (sku) => packSizeText(sku) || <FactoryCellMuted /> },
    { key: "balance", label: "Balance", render: (sku) => <FactoryCellText primary={skuBalanceLabel(sku)} secondary={skuBaseEquivalentLabel(sku)} /> },
    { key: "recipe", label: "Recipe", render: (sku) => { const activeRecipe = activeRecipeForSku(recipes, sku, group.product_group_name); return activeRecipe ? <span className="font-semibold text-text-secondary">{activeRecipe.version || activeRecipe.recipe_name || "v1"}</span> : <FactoryCellMuted>No Recipe</FactoryCellMuted>; } },
    { key: "status", label: "Status", render: (sku) => <div className="flex flex-wrap gap-1.5"><FactoryStatusBadge status={jobStatusLabel(sku.status)}>{jobStatusLabel(sku.status)}</FactoryStatusBadge><FactoryStatusBadge status={Number(sku.current_balance || 0) <= 0 ? "Out of Stock" : "In Stock"} /></div> },
    { key: "actions", label: "Actions", align: "right", render: (sku) => renderSkuActions(sku, group.isStandalone ? null : group) },
  ];
  const groupColumns = [
    { key: "product", label: "Product", render: (group) => <button className="flex min-w-0 items-center gap-2 text-left" type="button" aria-expanded={expandedGroups[group.groupKey] ?? false} onClick={() => setExpandedGroups((current) => ({ ...current, [group.groupKey]: !(current[group.groupKey] ?? false) }))}>{expandedGroups[group.groupKey] ? <ChevronDown size={15} className="shrink-0 text-text-secondary" /> : <ChevronRight size={15} className="shrink-0 text-text-secondary" />}<FactoryCellEntity name={group.product_group_name} code={group.name_cn || ""} /></button> },
    { key: "category", label: "Category", render: (group) => <span className="text-sm font-medium text-text-secondary">{group.category || "No category"}</span> },
    { key: "balance", label: "Total Balance", align: "right", render: (group) => <span className="font-semibold tabular-nums text-text-primary">{group.total_base_balance.label}</span> },
    { key: "sku_count", label: "Active SKU Count", render: (group) => <FactoryCellSemanticText tone={group.active_sku_count ? "green" : "gray"}>{group.active_sku_count} Active SKU{group.active_sku_count === 1 ? "" : "s"}</FactoryCellSemanticText> },
    { key: "actions", label: "Actions", align: "right", render: (group) => !group.isStandalone && canManage ? <FactoryRowActions directActions={[can("factory_finished_goods.create") ? { label: "SKU", icon: Plus, variant: "button", onClick: () => navigation.openFinishedGoodPackagingSku(group) } : null, can("factory_finished_goods.edit") ? { label: "Edit Finished Good", icon: Pencil, onClick: () => navigation.openEditFinishedGood(group) } : null]} secondaryActions={can("factory_finished_goods.edit") && group.status !== "archived" ? [{ label: "Archive", destructive: true, onClick: () => navigation.archiveFinishedGood(group) }] : []} /> : null },
  ];

  return <div className="space-y-5">
    <PageHeader section="Warehouse" title="Finished Goods" description="Finished goods master setup with live warehouse balances, production history, batches and stock movements." actions={<div className="flex flex-wrap gap-2">{can("factory_finished_goods.create") ? <button className="btn-primary" type="button" onClick={navigation.openCreateFinishedGood}><Package size={15} /> Create Finished Good</button> : null}{canManage ? <button className="btn-secondary" type="button" onClick={navigation.openFinishedGoodCategory}><Tag size={15} /> Category</button> : null}</div>} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard icon={PackageCheck} label="Finished Goods" value={query.groups.length} helper="Product identities" /><MetricCard icon={Warehouse} label="Packaging SKUs" value={finishedGoods.length} helper="Inventory SKUs" /><MetricCard icon={BookOpen} label="Active Recipes" value={activeRecipes} helper="Production standards" tone={activeRecipes ? "success" : "warning"} /><MetricCard icon={Clock3} label="Out of Stock SKUs" value={outOfStock} helper="Current balance zero" tone={outOfStock ? "danger" : "success"} /></div>
    {query.error ? <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900" role="alert">{query.error}</div> : null}
    <FactoryFilterBar activeFilters={[filters.product && { key: "product", label: "Search", value: filters.product, onRemove: () => setFilters((current) => ({ ...current, product: "" })) }, filters.category && { key: "category", label: "Category", value: finishedGoodCategories.find((category) => category.id === filters.category)?.name || filters.category, onRemove: () => setFilters((current) => ({ ...current, category: "" })) }, filters.status && { key: "status", label: "Status", value: jobStatusLabel(filters.status), onRemove: () => setFilters((current) => ({ ...current, status: "" })) }].filter(Boolean)} onClear={() => setFilters({ product: "", category: "", status: "" })}><Field label="Search"><input className={inputClass()} value={filters.product} onChange={(event) => setFilters((current) => ({ ...current, product: event.target.value }))} placeholder="Search product" /></Field><Field label="Category"><SearchableSelect value={filters.category} options={[{ value: "", label: "All" }, ...finishedGoodCategories.map((category) => ({ value: category.id, label: category.name, helper: "Category" }))]} placeholder="All" searchPlaceholder="Search categories" emptyText="No matching categories" onChange={(category) => setFilters((current) => ({ ...current, category }))} /></Field><Field label="Status"><SearchableSelect value={filters.status} options={[{ value: "", label: "All" }, { value: "active", label: "Active" }, { value: "archived", label: "Archived" }, { value: "out_of_stock", label: "Out of Stock" }]} placeholder="All" searchPlaceholder="Search status" emptyText="No matching status" onChange={(status) => setFilters((current) => ({ ...current, status }))} /></Field></FactoryFilterBar>
    <div className="flex justify-end"><div className="inline-flex shrink-0 rounded-lg border border-border bg-[var(--theme-subtle)] p-1" aria-label="Finished Goods view"><button className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${view === "grouped" ? "bg-[var(--theme-surface)] text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"}`} type="button" aria-pressed={view === "grouped"} onClick={() => setView("grouped")}>Grouped View</button><button className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${view === "table" ? "bg-[var(--theme-surface)] text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"}`} type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>Table View</button></div></div>
    {view === "table" ? <FactoryDataSurface>{!commercialRows.length ? <EmptyState title="No Packaging SKUs" description="No Packaging SKUs match the selected filters." /> : <FactoryFinishedGoodCommercialTable rows={commercialRows} renderActions={renderSkuActions} formatPackSize={packSizeText} formatStorage={(sku) => sku.recommended_storage ? jobStatusLabel(sku.recommended_storage) : "—"} />}<FactoryPagination page={pager.page} pageSize={pager.pageSize} total={query.rows.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} /></FactoryDataSurface> : <FactoryDataSurface>{!groups.length ? <EmptyState title="No Finished Goods" description="Create a Finished Good and Packaging SKU to start managing inventory." /> : <><FactoryTable columns={groupColumns} rows={groups} rowHover="mint" renderAfterRow={(group) => (expandedGroups[group.groupKey] ?? false) ? <div className="border-t border-border bg-[var(--theme-subtle)] px-4 py-3 md:px-8"><FactoryTable columns={skuColumns(group)} rows={group.skus} emptyTitle="No Packaging SKU configured" emptyDescription="Add a Packaging SKU before production stock-in." rowHover="mint" /></div> : null} /><FactoryPagination page={pager.page} pageSize={pager.pageSize} total={query.groups.length} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} /></>}</FactoryDataSurface>}
    {selectedProduct ? <FactoryFinishedGoodDetailModal product={selectedProduct} productions={productions} movements={productMovements} productionCosts={productionCosts} onClose={() => setSelectedProduct(null)} formatBalance={skuBalanceLabel} formatDate={formatFactoryDate} formatQuantity={quantity} productionBatchReference={productionBatchReference} productionJobOrderReference={productionJobOrderReference} /> : null}
  </div>;
}
