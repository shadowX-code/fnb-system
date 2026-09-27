import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileText, ShoppingCart, Sparkles, Download, PackagePlus } from "lucide-react";
import PageHeader from "../../../../components/layout/PageHeader.jsx";
import DashboardSection from "../../../../components/layout/DashboardSection.jsx";
import AdminFilterToolbar from "../../../../components/layout/AdminFilterToolbar.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import { supabase } from "../../../../lib/supabase.ts";
import { getAccessibleOutlets, getAccessibleOutletOptions, hasPermission, notifyPermissionDenied } from "../../../../utils/accessControl.js";
import { productAnalyticsService } from "../../../../services/productAnalyticsService.js";
import { readCompleteInventoryRows } from "../../../../services/inventoryCompleteRead.js";
import { invalidateInventoryReads } from "../../../../services/inventoryRevalidation.js";
import { todayInput, getBusinessDateInput, csvEscape, downloadTextFile } from "../InventorySharedPresentation.jsx";
import { isUuid } from "../inventoryItemModel.js";
import { uploadRecipePhoto } from "./inventoryRecipeModalSupportReads.js";
import { formatRestaurantRecipeCurrency, recipeCode, recipeNameEn, recipeNameCn, normalizeProductRecipeKey, mappingConfidenceLabel, monthSerial, businessMonthSerial, recipeMarginTone, formatRecipeMargin, createRecipeWorkspaceProjection } from "./inventoryRecipeReadModel.js";
import { RecipeModal, RecipeDetailModal, MenuCategoryModal, MenuCategorySettingsModal, RecipeIngredientPreviewPill, RecipeListPagination } from "./InventoryRecipeForms.jsx";
import { loadRecipeSources, persistRemoteRecipe, archiveRemoteRecipe, persistRemoteMenuCategory } from "./inventoryRecipeService.js";
import useInventoryRecipesRead from "./useInventoryRecipesRead.js";
const recipeWorkspaceTabs = [{id:"recipes", label:"Recipes"}, {id:"mapping", label:"Product Mapping"}];
const recipeMappingStatusOptions = [{value:"all",label:"All"}, {value:"pending",label:"Pending"}, {value:"mapped",label:"Mapped"}, {value:"ignored",label:"Ignored"}];
const statuses = ["active", "inactive", "archived"];
const toTitle = value => String(value || "").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
const statusTone = value => value === "active" ? "success" : value === "archived" ? "danger" : "neutral";
const debugLog = (...args) => { if (import.meta.env.DEV) console.log(...args); };
export default function InventoryRecipesPage({auth, ui, outlets}) {
  const accessibleOutlets = getAccessibleOutlets(auth, outlets);
  const recipeOutletOptions = getAccessibleOutletOptions(auth, outlets).filter(row => row.value !== "all");
  const scopeKey = auth?.user?.id || "";
  const [selectedOutletId, setSelectedOutletId] = useState(() => accessibleOutlets[0]?.id || "");
  const activeRecipeOutletId = accessibleOutlets.some(row => row.id === selectedOutletId) ? selectedOutletId : accessibleOutlets[0]?.id || "";
  const can = {viewRecipes: hasPermission(auth,"inventory_recipes.view"), manageRecipes: hasPermission(auth,"inventory_recipes.manage"), exportRecipes: hasPermission(auth,"inventory_recipes.export"), manageRecipeIntelligence: hasPermission(auth,"recipe_intelligence.manage")};
  const read = useInventoryRecipesRead({outletId: activeRecipeOutletId, scopeKey, enabled: can.viewRecipes});
  const data = read.data || {recipes: [], items: [], categories: [], menuCategories: []};
  const outletById = new Map(accessibleOutlets.map(row => [row.id,row]));
  const itemById = new Map(data.items.map(row => [row.id,row]));
  const sortedCategories = data.categories;
  const [recipeFilters, setRecipeFilters] = useState({category:"all",status:"active",search:""});
  const [recipeWorkspaceTab, setRecipeWorkspaceTab] = useState("recipes");
  const [recipeMappingFilters, setRecipeMappingFilters] = useState({status:"all",search:""});
  const [recipeMappingSelections, setRecipeMappingSelections] = useState({});
  const [savingRecipeMappingKey, setSavingRecipeMappingKey] = useState("");
  const liveScope = useRef(activeRecipeOutletId + "|" + scopeKey);
  liveScope.current = activeRecipeOutletId + "|" + scopeKey;
  const commandScope = activeRecipeOutletId + "|" + scopeKey;
  const [modal, setModalState] = useState(null);
  const setModal = value => { if (liveScope.current === commandScope) setModalState(value); };
  const [recipeProductMappings, setMappings] = useState([]);
  const setRecipeProductMappings = value => { if (liveScope.current === commandScope) setMappings(value); };
  const [recipeProductReports, setRecipeProductReports] = useState([]);
  const [recipeProductItems, setRecipeProductItems] = useState([]);
  const [mappingRead, setMappingRead] = useState({state:"idle",error:""});
  const mappingRequest = useRef(0);
  const date = getBusinessDateInput();
  const recipeReportYear = date.slice(0,4), recipeReportMonth = Number(date.slice(5,7)), recipeTrendYear = Number(recipeReportYear);
  const notify = (title, message = "", tone = "success") => ui?.notify?.({title,message,tone});
  const requirePermission = (allowed, action) => { if (allowed) return true; notifyPermissionDenied(ui,action); return false; };
  async function refreshInventory({global = false} = {}) {
    if (liveScope.current !== commandScope) return;
    invalidateInventoryReads({outletId: global ? undefined : activeRecipeOutletId, reason:"recipe-saved",owner:"recipes"});
    await read.refresh();
  }
  async function refreshMapping() {
    if (liveScope.current !== commandScope) return;
    const id = ++mappingRequest.current;
    setMappingRead({state:"loading",error:""});
    try {
      const [reports, mappings] = await Promise.all([
        productAnalyticsService.listCompleteReports({outletIds:[activeRecipeOutletId]}),
        readCompleteInventoryRows("product_recipe_mappings",{eq:{outlet_id:activeRecipeOutletId}})
      ]);
      const minimum = Math.min(businessMonthSerial(-2), monthSerial(recipeTrendYear,1));
      const maximum = Math.max(businessMonthSerial(0), monthSerial(recipeTrendYear,12));
      const periodReports = reports.filter(row => { const serial = monthSerial(row.report_year,row.report_month); return serial >= minimum && serial <= maximum; });
      const items = await productAnalyticsService.listCompleteItemsByReportIds(periodReports.map(row => row.id));
      if (mappingRequest.current !== id || liveScope.current !== commandScope) return;
      setRecipeProductReports(periodReports); setRecipeProductItems(items); setRecipeProductMappings(mappings.data);
      setMappingRead({state:"complete",error:"",scope:commandScope});
    } catch(error) {
      if (mappingRequest.current === id && liveScope.current === commandScope) setMappingRead({state:error.readState || "error",error:error.message,scope:commandScope});
    }
  }
  useEffect(() => {
    setModal(null); setRecipeMappingSelections({}); setMappingRead({state:"idle",error:""});
    setRecipeProductReports([]); setRecipeProductItems([]); setRecipeProductMappings([]);
    if (recipeWorkspaceTab === "mapping" && activeRecipeOutletId && can.viewRecipes) refreshMapping();
    return () => { mappingRequest.current += 1; };
  }, [activeRecipeOutletId, scopeKey, recipeWorkspaceTab, can.viewRecipes]);
  const projection = createRecipeWorkspaceProjection({data,outletById,activeRecipeOutletId,recipeFilters,recipeReportYear,recipeReportMonth,recipeTrendYear,recipeProductReports,recipeProductItems,recipeProductMappings,recipeMappingSelections,recipeMappingFilters});
  const {recipeReadModel, activeMenuCategories, filteredRecipes, recipeCostRows, averageRecipeCost, pricedMargins, averageMargin, highestCostRecipe, selectedPeriod, analysisStartSerial, analysisEndSerial, analysisMonths, analysisMonthSet, selectedReportSerial, selectedReportMonthSet, selectedReportLabel, trendMonths, trendMonthSet, availableTrendYears, availableReportYears, reportById, buildProductSalesByName, analysisProductSalesByName, monthlyProductSalesByName, allProductSalesByName, productSalesByName, yearlyProductSalesByName, recipeCostById, mappingByProductKey, mappedMappings, mappingCandidateRecipes, productMappingKeys, productMappingRows, recipeMappingSearch, visibleProductMappingRows} = projection;
  const updateRecipeFilter = (key,value) => setRecipeFilters(current => ({...current,[key]:value}));
  const mappedProductCount = productMappingRows.filter(row => row.status === "mapped").length;
  const pendingProductCount = productMappingRows.filter(row => row.status === "pending").length;
  const ignoredProductCount = productMappingRows.filter(row => row.status === "ignored").length;
  const mappingCoverage = mappedProductCount + pendingProductCount ? Math.round(mappedProductCount / (mappedProductCount + pendingProductCount) * 100) : 0;
  const mappingReady = mappingRead.state === "complete" && mappingRead.scope === commandScope;
  const recipeProductLoading = !mappingReady && !mappingRead.error;
async function saveRecipe(recipe) {
    try {
      let recipePhotoUrl = recipe.recipePhotoUrl || recipe.recipe_photo_url || "";
      const previousRecipePhotoUrl = recipe.previousRecipePhotoUrl || recipe.previous_recipe_photo_url || (isUuid(recipe.id) ? data.recipes.find((entry) => entry.id === recipe.id)?.recipePhotoUrl || data.recipes.find((entry) => entry.id === recipe.id)?.recipe_photo_url || "" : "");
      const hasNewPhotoFile = typeof File !== "undefined" && recipe.recipePhotoFile instanceof File;
      if (hasNewPhotoFile) {
        const uploadResult = await uploadRecipePhoto(recipe.recipePhotoFile, isUuid(recipe.id) ? recipe.id : "draft", previousRecipePhotoUrl);
        recipePhotoUrl = uploadResult.publicUrl;
        debugLog("[RecipePhotoSaveDebug]", { recipeId: recipe.id || "new", uploadResult, error: null });
      }
      const normalized = {
        ...recipe,
        recipeCode: recipeCode(recipe),
        recipe_code: recipeCode(recipe),
        recipeNameEn: recipeNameEn(recipe),
        recipe_name: recipeNameEn(recipe),
        recipe_name_en: recipeNameEn(recipe),
        recipeNameCn: recipeNameCn(recipe),
        recipe_name_cn: recipeNameCn(recipe),
        recipePhotoUrl,
        recipe_photo_url: recipePhotoUrl,
        sellingPrice: recipe.sellingPrice === "" || recipe.sellingPrice === null || recipe.sellingPrice === undefined ? "" : Number(recipe.sellingPrice),
        selling_price: recipe.sellingPrice === "" || recipe.sellingPrice === null || recipe.sellingPrice === undefined ? "" : Number(recipe.sellingPrice),
        ingredients: (recipe.ingredients || []).map((line) => {
          const item = itemById.get(line.itemId);
          return {
            ...line,
            unit: line.unit || item?.unit || "",
            quantityUsed: Number(line.quantityUsed || 0),
            wastagePercent: Number(line.wastagePercent || 0),
          };
        }),
      };
      const savedRecipe = await persistRemoteRecipe(normalized, auth?.user?.id);
      
      setModal(null);
      await refreshInventory();
      notify(isUuid(recipe.id) ? "Recipe updated" : "Recipe created");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save recipe.", error);
      debugLog("[RecipeSaveDebug]", { action: "save-recipe", payload: recipe, error });
      await refreshInventory();
      const duplicateCodeFailure = /inventory_recipes_recipe_code_unique|duplicate key|recipe_code/i.test(String(`${error?.message || ""} ${error?.details || ""}`));
      notify(
        isUuid(recipe.id) ? "Failed to update Recipe" : "Failed to create Recipe",
        duplicateCodeFailure ? "Recipe code already exists. Please use another code." : error.message || "Please try again.",
        "error",
      );
      throw error;
    }
  }

async function saveRecipeProductMapping(productName, recipeId) {
    if (!requirePermission(can.manageRecipeIntelligence, "manage Recipe Intelligence mappings")) return;
    const productKey = normalizeProductRecipeKey(productName);
    if (!activeRecipeOutletId || !productKey || !isUuid(recipeId)) {
      notify("Failed to map Product to Recipe", "Choose a recipe before saving the mapping.", "error");
      return;
    }
    setSavingRecipeMappingKey(productKey);
    try {
      const existing = recipeProductMappings.find((mapping) => normalizeProductRecipeKey(mapping.product_name) === productKey);
      const payload = {
        outlet_id: activeRecipeOutletId,
        product_name: productName,
        recipe_id: recipeId,
        status: "mapped",
        ignored_reason: null,
        ignored_at: null,
        ignored_by: null,
        updated_at: new Date().toISOString(),
      };
      const result = existing?.id
        ? await supabase
          .from("product_recipe_mappings")
          .update(payload)
          .eq("id", existing.id)
          .select("*")
          .single()
        : await supabase
          .from("product_recipe_mappings")
          .insert({ ...payload, created_by: isUuid(auth?.profile?.id) ? auth.profile.id : null })
          .select("*")
          .single();
      debugLog("[RecipeMappingSaveDebug]", { productName, recipeId, payload, result: { data: result.data, error: result.error } });
      if (result.error) throw result.error;
      setRecipeProductMappings((current) => [result.data, ...current.filter((mapping) => mapping.id !== result.data.id && normalizeProductRecipeKey(mapping.product_name) !== productKey)]);
      await refreshMapping();
      invalidateInventoryReads({outletId: activeRecipeOutletId, reason: "recipe-mapping", owner: "recipes"});
      notify("Product mapped to Recipe");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save recipe product mapping.", error);
      debugLog("[RecipeMappingSaveDebug]", { productName, recipeId, error });
      notify("Failed to map Product to Recipe", error.message || "Please try again.", "error");
    } finally {
      setSavingRecipeMappingKey("");
    }
  }

async function ignoreRecipeProductMapping(productName, reason = "Excluded from recipe intelligence") {
    if (!requirePermission(can.manageRecipeIntelligence, "manage Recipe Intelligence mappings")) return;
    const productKey = normalizeProductRecipeKey(productName);
    if (!activeRecipeOutletId || !productKey) {
      notify("Failed to ignore Product", "Product name is missing.", "error");
      return;
    }
    setSavingRecipeMappingKey(productKey);
    try {
      const existing = recipeProductMappings.find((mapping) => normalizeProductRecipeKey(mapping.product_name) === productKey);
      const payload = {
        outlet_id: activeRecipeOutletId,
        product_name: productName,
        recipe_id: null,
        status: "ignored",
        ignored_reason: reason,
        ignored_at: new Date().toISOString(),
        ignored_by: isUuid(auth?.profile?.id) ? auth.profile.id : null,
        updated_at: new Date().toISOString(),
      };
      const result = existing?.id
        ? await supabase
          .from("product_recipe_mappings")
          .update(payload)
          .eq("id", existing.id)
          .select("*")
          .single()
        : await supabase
          .from("product_recipe_mappings")
          .insert({ ...payload, created_by: isUuid(auth?.profile?.id) ? auth.profile.id : null })
          .select("*")
          .single();
      debugLog("[RecipeMappingSaveDebug]", { action: "ignore", productName, payload, result: { data: result.data, error: result.error } });
      if (result.error) throw result.error;
      setRecipeProductMappings((current) => [result.data, ...current.filter((mapping) => mapping.id !== result.data.id && normalizeProductRecipeKey(mapping.product_name) !== productKey)]);
      await refreshMapping();
      invalidateInventoryReads({outletId: activeRecipeOutletId, reason: "recipe-mapping", owner: "recipes"});
      notify("Product ignored for Recipe Intelligence");
    } catch (error) {
      console.warn("[InventoryControl] Unable to ignore recipe product mapping.", error);
      debugLog("[RecipeMappingSaveDebug]", { action: "ignore", productName, error });
      notify("Failed to ignore Product", error.message || "Please try again.", "error");
    } finally {
      setSavingRecipeMappingKey("");
    }
  }

async function clearRecipeProductMapping(productName) {
    if (!requirePermission(can.manageRecipeIntelligence, "manage Recipe Intelligence mappings")) return;
    const productKey = normalizeProductRecipeKey(productName);
    const existing = recipeProductMappings.find((mapping) => normalizeProductRecipeKey(mapping.product_name) === productKey);
    if (!existing?.id) return;
    setSavingRecipeMappingKey(productKey);
    try {
      const result = await supabase.from("product_recipe_mappings").delete().eq("id", existing.id);
      debugLog("[RecipeMappingSaveDebug]", { action: "clear", productName, result: { error: result.error } });
      if (result.error) throw result.error;
      setRecipeProductMappings((current) => current.filter((mapping) => mapping.id !== existing.id));
      setRecipeMappingSelections((current) => {
        const next = { ...current };
        delete next[productKey];
        return next;
      });
      await refreshMapping();
      invalidateInventoryReads({outletId: activeRecipeOutletId, reason: "recipe-mapping", owner: "recipes"});
      notify("Product mapping reset");
    } catch (error) {
      console.warn("[InventoryControl] Unable to reset recipe product mapping.", error);
      debugLog("[RecipeMappingSaveDebug]", { action: "clear", productName, error });
      notify("Failed to reset Product mapping", error.message || "Please try again.", "error");
    } finally {
      setSavingRecipeMappingKey("");
    }
  }

async function archiveRecipe(recipeId) {
    if (!requirePermission(can.manageRecipes, "archive recipes")) return;
    try {
      const archivedRecipe = await archiveRemoteRecipe(recipeId);
      
      await refreshInventory();
      notify("Recipe archived");
    } catch (error) {
      console.warn("[InventoryControl] Unable to archive recipe.", error);
      debugLog("[RecipeSaveDebug]", { action: "archive-recipe", recipeId, error });
      notify("Failed to archive Recipe", error.message || "Please try again.", "error");
    }
  }

async function saveMenuCategory(category) {
    if (!requirePermission(can.manageRecipes, "manage recipe menu categories")) return;
    try {
      const savedCategory = await persistRemoteMenuCategory({
        ...category,
        sortOrder: Number(category.sortOrder ?? category.sort_order ?? 0)
          || (data.menuCategories?.length ? Math.max(...data.menuCategories.map((entry) => Number(entry.sortOrder || 0))) + 1 : 1),
      });
      
      await refreshInventory({global:true});
      setModal({ type: "recipe-menu-categories" });
      notify(isUuid(category.id) ? "Menu category updated" : "Menu category created");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save menu category.", error);
      debugLog("[RecipeMenuCategoryDebug]", { action: "save", payload: category, error });
      notify(isUuid(category.id) ? "Failed to update menu category" : "Failed to create menu category", error.message || "Please try again.", "error");
    }
  }

async function archiveMenuCategory(category) {
    if (!requirePermission(can.manageRecipes, "archive recipe menu categories")) return;
    try {
      const savedCategory = await persistRemoteMenuCategory({ ...category, status: category.status === "active" ? "inactive" : "active" });
      
      await refreshInventory({global:true});
      notify(category.status === "active" ? "Menu category archived" : "Menu category activated");
    } catch (error) {
      console.warn("[InventoryControl] Unable to archive menu category.", error);
      debugLog("[RecipeMenuCategoryDebug]", { action: "archive", payload: category, error });
      notify("Failed to update menu category", error.message || "Please try again.", "error");
    }
  }

function exportRecipes() {
    if (!requirePermission(can.exportRecipes, "export recipes")) return;
    const activeRecipeOutletId = selectedOutletId === "all" ? (getAccessibleOutlets(auth, outlets)[0]?.id || outlets[0]?.id || "") : selectedOutletId;
    const rows = data.recipes.filter((recipe) => {
      const searchText = `${recipeCode(recipe)} ${recipeNameEn(recipe)} ${recipeNameCn(recipe)} ${recipe.menuCategory || ""} ${outletById.get(recipe.outletId)?.name || ""}`.toLowerCase();
      return recipe.outletId === activeRecipeOutletId
        && (recipeFilters.category === "all" || recipe.menuCategory === recipeFilters.category)
        && (recipeFilters.status === "all" || recipe.status === recipeFilters.status)
        && (!recipeFilters.search.trim() || searchText.includes(recipeFilters.search.trim().toLowerCase()));
    }).map((recipe) => {
      const outlet = outletById.get(recipe.outletId);
      return {
        recipe_code: recipeCode(recipe),
        recipe_name_en: recipeNameEn(recipe),
        recipe_name_cn: recipeNameCn(recipe),
        Outlet: outlet?.name || "",
        "Menu Category": recipe.menuCategory,
        "Serving Size": recipe.servingSize,
        Ingredients: (recipe.ingredients || []).length,
        Status: recipe.status,
        Notes: recipe.notes || "",
      };
    });
    const columns = ["recipe_code", "recipe_name_en", "recipe_name_cn", "Outlet", "Menu Category", "Serving Size", "Ingredients", "Status", "Notes"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    downloadTextFile(`feedx-recipes-${todayInput()}.csv`, csv);
    notify("Recipes exported successfully");
  }
async function sortMenuCategories(draggedId,targetId) {
  if (!requirePermission(can.manageRecipes,"sort recipe menu categories")) return;
  const ordered = data.menuCategories.slice().sort((a,b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const from = ordered.findIndex(row => row.id === draggedId), to = ordered.findIndex(row => row.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = ordered.splice(from,1); ordered.splice(to,0,moved);
  try {
    const results = await Promise.all(ordered.filter(row => isUuid(row.id)).map((row,index) => supabase.from("inventory_menu_categories").update({sort_order:index+1,updated_at:new Date().toISOString()}).eq("id",row.id)));
    const error = results.find(row => row.error)?.error; if (error) throw error;
    await refreshInventory({global:true}); notify("Menu category order updated");
  } catch(error) { notify("Failed to update menu category order",error.message,"error"); await read.refresh(); }
}

if (!can.viewRecipes) return <EmptyState title="Permission required" description="You do not have permission to view Recipes & Usage." />;
return <div className="space-y-4">
<PageHeader section="INVENTORY CONTROL" title="Recipes & Usage" description="Link menu items to ingredients and estimate consumption." actions={<>
<button className="btn-secondary" type="button" onClick={exportRecipes} disabled={!read.data}><Download size={15} /> Export</button>
{can.manageRecipes ? <><button className="btn-secondary" type="button" disabled={!read.data} onClick={() => setModal({type:"recipe-menu-categories"})}>Menu Categories</button><button className="btn-primary" type="button" disabled={!read.data} onClick={() => setModal({type:"recipe",outletId:activeRecipeOutletId})}><PackagePlus size={15} /> Add Recipe</button></> : null}
</>} />
      <AdminFilterToolbar>
              <SelectField label="Outlet" value={activeRecipeOutletId} options={recipeOutletOptions} onChange={setSelectedOutletId} searchable />
              <SelectField label="Category" value={recipeFilters.category} options={[{ value: "all", label: "All" }, ...activeMenuCategories.map((category) => ({ value: category.name, label: category.name }))]} onChange={(value) => updateRecipeFilter("category", value)} />
              <SelectField label="Status" value={recipeFilters.status} options={[{ value: "all", label: "All" }, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]} onChange={(value) => updateRecipeFilter("status", value)} />
              <AdminSearchField label="Search recipe/menu item" value={recipeFilters.search} onChange={(value) => updateRecipeFilter("search", value)} placeholder="Search recipe, outlet or ingredient" />
            </AdminFilterToolbar>
{read.error ? <div className="card p-4" role="alert"><p>{read.error}</p><p>No incomplete results are presented as complete.</p><button className="btn-secondary" onClick={read.refresh}>Retry</button></div> : !read.data ? <p role="status">{activeRecipeOutletId ? "Loading complete Recipes…" : "No accessible outlet."}</p> : <>
{read.state === "refreshing" ? <p role="status">Refreshing Recipes…</p> : null}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard icon={FileText} label="Total Recipes" value={filteredRecipes.length} helper="Current filters" size="compact" />
              <MetricCard icon={ShoppingCart} label="Average Recipe Cost" value={formatRestaurantRecipeCurrency(averageRecipeCost)} helper="Ingredient + wastage" size="compact" />
              <MetricCard icon={Sparkles} label="Average Margin" value={formatRecipeMargin(averageMargin)} helper="Priced recipes only" tone={recipeMarginTone(averageMargin)} size="compact" />
              <MetricCard
                icon={AlertTriangle}
                label="Highest Cost Recipe"
                value={highestCostRecipe ? recipeNameEn(highestCostRecipe.recipe) || recipeCode(highestCostRecipe.recipe) || "Recipe" : "—"}
                helper={highestCostRecipe ? `${recipeNameCn(highestCostRecipe.recipe) ? `${recipeNameCn(highestCostRecipe.recipe)} · ` : ""}${formatRestaurantRecipeCurrency(highestCostRecipe.summary.totalCost)}` : "No recipes"}
                tone={highestCostRecipe?.summary?.totalCost ? "warning" : "neutral"}
                size="compact"
              />
            </div>
            <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-background p-2 shadow-sm">
      
        {recipeWorkspaceTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={`rounded-xl px-4 py-2 type-body-sm font-black transition ${recipeWorkspaceTab === tab.id ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:bg-primary/10 hover:text-text-primary"}`}
                  type="button"
                  onClick={() => setRecipeWorkspaceTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
        {recipeWorkspaceTab === "recipes" ? <DashboardSection title="Recipe BOM Setup" subtitle="Link menu/product items to outlet-linked inventory ingredients.">
          {filteredRecipes.length ? (
            <RecipeListPagination rows={recipeCostRows} resetKey={[activeRecipeOutletId, recipeFilters.category, recipeFilters.status, recipeFilters.search].join("|")}>
              {(paginatedRecipeCostRows, pagination) => <>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2">Recipe</th>
                    <th>Category</th>
                    <th>Ingredients</th>
                    <th>Estimated Cost</th>
                    <th>Selling Price</th>
                    <th>Margin</th>
                    <th>Status</th>
                    <th className="pr-8 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {paginatedRecipeCostRows.map(({ recipe, summary, margin }) => (
                    <tr key={recipe.id} className="transition hover:bg-primary/5">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-2xl border border-border bg-slate-100">
                            {recipe.recipePhotoUrl || recipe.recipe_photo_url
                              ? <img className="h-full w-full object-cover" src={recipe.recipePhotoUrl || recipe.recipe_photo_url} alt={recipeNameEn(recipe) || recipeNameCn(recipe) || recipeCode(recipe)} />
                              : <div className="flex h-full w-full items-center justify-center text-sm font-black text-text-muted">{String(recipeNameEn(recipe) || recipeNameCn(recipe) || recipeCode(recipe) || "R").slice(0, 1).toUpperCase()}</div>}
                          </div>
                          <div className="min-w-0">
                            <div className="type-caption font-black uppercase tracking-wide text-text-muted">{recipeCode(recipe) || "No code"}</div>
                            <div className="font-bold text-text-primary">{recipeNameEn(recipe) || "Recipe Name EN required"}</div>
                            <div className="type-caption text-text-secondary">{recipeNameCn(recipe) || "Recipe Name CN required"}</div>
                            <div className="type-caption text-text-secondary">{outletById.get(recipe.outletId)?.name || "Outlet"} · {recipe.servingSize || "1 portion"}</div>
                          </div>
                        </div>
                      </td>
                      <td><Badge tone="info">{recipe.menuCategory || "Uncategorized"}</Badge></td>
                      <td>
                        <RecipeIngredientPreviewPill recipe={recipe} itemById={itemById} />
                      </td>
                      <td className="font-black text-text-primary">{formatRestaurantRecipeCurrency(summary.totalCost)}</td>
                      <td className="font-bold text-text-secondary">{recipe.sellingPrice !== "" && recipe.sellingPrice !== null && recipe.sellingPrice !== undefined ? formatRestaurantRecipeCurrency(recipe.sellingPrice) : "—"}</td>
                      <td><Badge tone={recipeMarginTone(margin)}>{formatRecipeMargin(margin)}</Badge></td>
                      <td><Badge tone={statusTone(recipe.status)}>{toTitle(recipe.status || "active")}</Badge></td>
                      <td className="pr-8">
                        <div className="flex justify-end gap-2">
                          <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => setModal({ type: "recipe-detail", recipe })}>View</button>
                          {can.manageRecipes ? <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.manageRecipes, "edit recipes") && setModal({ type: "recipe", recipe })}>Edit</button> : null}
                          {can.manageRecipes && recipe.status === "active" ? <button className="btn-secondary h-8 px-2.5 text-xs text-rose-700" type="button" onClick={() => archiveRecipe(recipe.id)}>Archive</button> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pagination}
              </>}
            </RecipeListPagination>
          ) : (
            <div className="space-y-3">
              <EmptyState
                title="No recipes set up yet."
                description="Create recipes to connect menu items with inventory ingredients and estimate future usage variance."
              />
              {can.manageRecipes ? <div className="flex justify-center">
                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => {
                    if (!requirePermission(can.manageRecipes, "add recipes")) return;
                    if (!activeRecipeOutletId) {
                      notify("Select an outlet before adding a recipe", "Recipes are outlet-specific and use the currently selected outlet context.", "warning");
                      return;
                    }
                    setModal({ type: "recipe", outletId: activeRecipeOutletId });
                  }}
                >
                  Add Recipe
                </button>
              </div> : null}
            </div>
          )}
        </DashboardSection> : null}
        {recipeWorkspaceTab === "mapping" && mappingReady ? <DashboardSection
          title="Product ↔ Recipe Mapping"
          subtitle="Connect Product Analytics products to recipes so Recipe Intelligence can use real sales volume and revenue."
          density="compact"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Total Products" value={productMappingRows.length} helper="Product Analytics products" size="compact" />
            <MetricCard label="Mapped" value={mappedProductCount} helper="Feeds Recipe Intelligence" tone={mappedProductCount ? "success" : "neutral"} size="compact" />
            <MetricCard label="Pending" value={pendingProductCount} helper="Needs mapping decision" tone={pendingProductCount ? "warning" : "success"} size="compact" />
            <MetricCard label="Ignored" value={ignoredProductCount} helper="Excluded intentionally" tone={ignoredProductCount ? "neutral" : "success"} size="compact" />
            <MetricCard label="Coverage %" value={`${mappingCoverage}%`} helper="Mapped / (Mapped + Pending)" tone={mappingCoverage >= 80 ? "success" : mappingCoverage >= 40 ? "warning" : "danger"} size="compact" />
          </div>
      <AdminFilterToolbar>
            <SelectField
              label="Status"
              value={recipeMappingFilters.status}
              options={recipeMappingStatusOptions}
              onChange={(value) => setRecipeMappingFilters((current) => ({ ...current, status: value }))}
            />
            <AdminSearchField label="Search product or recipe" value={recipeMappingFilters.search} onChange={(value) => setRecipeMappingFilters((current) => ({ ...current, search: value }))} placeholder="Search product name or mapped recipe" />
          </AdminFilterToolbar>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            {visibleProductMappingRows.length ? (
              <table className="w-full min-w-[980px] text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th>Sales</th>
                    <th>Suggested Match</th>
                    <th>Status</th>
                    <th>Recipe Mapping</th>
                    <th className="pr-8 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {visibleProductMappingRows.map((row) => {
                    const selectedRecipe = mappingCandidateRecipes.find((recipe) => recipe.id === row.selectedRecipeId);
                    const displayRecipe = row.mappedRecipe || row.suggestedRecipe;
                    const confidenceTone = row.confidence >= 90 ? "success" : row.confidence >= 60 ? "warning" : row.confidence > 0 ? "neutral" : "danger";
                    return (
                      <tr key={row.key} className="transition hover:bg-primary/5">
                        <td className="px-3 py-3">
                          <div className="font-bold text-text-primary">{row.productName}</div>
                          <div className="type-caption text-text-secondary">Outlet: {outletById.get(activeRecipeOutletId)?.name || "Selected outlet"}</div>
                          <div className="type-caption text-text-muted">Last Seen: {row.lastSeenLabel}</div>
                        </td>
                        <td>
                          <div className="font-bold text-text-primary">{row.latestMonth}</div>
                          <div className="type-caption font-semibold text-text-secondary">{Number(row.quantity || 0).toLocaleString()} sold</div>
                          <div className="type-caption font-black text-text-primary">{formatRestaurantRecipeCurrency(row.revenue)}</div>
                        </td>
                        <td>
                          {displayRecipe ? (
                            <div>
                              <div className="font-bold text-text-primary">{recipeNameEn(displayRecipe) || recipeCode(displayRecipe)}</div>
                              <div className="type-caption text-text-muted">{recipeCode(displayRecipe)} · {recipeNameCn(displayRecipe) || "No CN name"}</div>
                              {row.suggestedRecipe ? <div className="mt-1"><Badge tone={confidenceTone}>{mappingConfidenceLabel(row.confidence)}</Badge></div> : null}
                            </div>
                          ) : (
                            <span className="type-caption font-semibold text-text-muted">No suggestion</span>
                          )}
                        </td>
                        <td>
                          <div className="flex flex-col items-start gap-1">
                            <Badge tone={row.status === "mapped" ? "success" : row.status === "ignored" ? "neutral" : "warning"}>{toTitle(row.status)}</Badge>
                            <Badge tone={row.activityStatus === "active" ? "success" : "neutral"}>{row.activityStatus === "active" ? "Active" : "Inactive"}</Badge>
                          </div>
                        </td>
                        <td>
                          <SelectField
                            value={row.selectedRecipeId}
                            options={[
                              { value: "", label: "Choose recipe" },
                              ...mappingCandidateRecipes.map((recipe) => ({
                                value: recipe.id,
                                label: `${recipeCode(recipe) || "No code"} · ${recipeNameEn(recipe) || recipeNameCn(recipe) || "Recipe"}`,
                              })),
                            ]}
                            onChange={(value) => setRecipeMappingSelections((current) => ({ ...current, [row.key]: value }))}
                            searchable
                          />
                          {selectedRecipe ? <div className="mt-1 type-caption text-text-muted">{recipeNameCn(selectedRecipe) || "No Chinese name"}</div> : null}
                        </td>
                        <td className="pr-8">
                          <div className="flex justify-end gap-2">
                            {row.status === "mapped" ? (
                              <>
                                <button className="btn-primary h-8 px-3 text-xs" type="button" disabled={!can.manageRecipeIntelligence || !row.selectedRecipeId || savingRecipeMappingKey === row.key} onClick={() => saveRecipeProductMapping(row.productName, row.selectedRecipeId)}>
                                  {savingRecipeMappingKey === row.key ? "Saving..." : "Change Mapping"}
                                </button>
                                <button className="btn-secondary h-8 px-3 text-xs" type="button" disabled={!can.manageRecipeIntelligence || savingRecipeMappingKey === row.key} onClick={() => clearRecipeProductMapping(row.productName)}>Unmap</button>
                              </>
                            ) : row.status === "ignored" ? (
                              <button className="btn-secondary h-8 px-3 text-xs" type="button" disabled={!can.manageRecipeIntelligence || savingRecipeMappingKey === row.key} onClick={() => clearRecipeProductMapping(row.productName)}>
                                Restore to Pending
                              </button>
                            ) : (
                              <>
                                <button className="btn-primary h-8 px-3 text-xs" type="button" disabled={!can.manageRecipeIntelligence || !row.selectedRecipeId || savingRecipeMappingKey === row.key} onClick={() => saveRecipeProductMapping(row.productName, row.selectedRecipeId)}>
                                  {savingRecipeMappingKey === row.key ? "Mapping..." : "Map"}
                                </button>
                                <button className="btn-secondary h-8 px-3 text-xs" type="button" disabled={!can.manageRecipeIntelligence || savingRecipeMappingKey === row.key} onClick={() => ignoreRecipeProductMapping(row.productName)}>
                                  Ignore
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState
                title={recipeProductLoading ? "Loading Product Analytics products..." : "No products match this filter"}
                description={recipeProductLoading ? "Recipe mapping suggestions will appear after Product Analytics data loads." : "Try another status or search term. New Product Analytics products will appear as Pending."}
              />
            )}
          </div>
        </DashboardSection> : null}

{recipeWorkspaceTab === "mapping" && !mappingReady ? <div className="card p-4" role={mappingRead.scope === commandScope && mappingRead.error ? "alert" : "status"}><p>{mappingRead.scope === commandScope && mappingRead.error || "Loading verified Product Analytics…"}</p>{mappingRead.scope === commandScope && mappingRead.error ? <button className="btn-secondary" onClick={refreshMapping}>Retry</button> : null}</div> : null}
</>}
      {modal?.type === "recipe" ? (
        <RecipeModal
          recipe={modal.recipe}
          outletId={modal.recipe?.outletId || modal.outletId || selectedOutletId}
          outlet={outletById.get(modal.recipe?.outletId || modal.outletId || selectedOutletId)}
          items={data.items}
          menuCategories={data.menuCategories || []}
          existingRecipes={data.recipes || []}
          loadCloneRecipes={() => loadRecipeSources(accessibleOutlets.map(row => row.id))}
          outletById={outletById}
          onClose={() => setModal(null)}
          onSave={saveRecipe}
        />
      ) : null}
      {modal?.type === "recipe-menu-categories" ? (
        <MenuCategorySettingsModal
          categories={data.menuCategories || []}
          canManage={can.manageRecipes}
          requirePermission={requirePermission}
          onClose={() => setModal(null)}
          onAdd={() => setModal({ type: "recipe-menu-category", returnToSettings: true })}
          onEdit={(category) => setModal({ type: "recipe-menu-category", category, returnToSettings: true })}
          onArchive={archiveMenuCategory}
          onSort={sortMenuCategories}
        />
      ) : null}
      {modal?.type === "recipe-menu-category" ? (
        <MenuCategoryModal
          category={modal.category}
          onClose={() => setModal(modal.returnToSettings ? { type: "recipe-menu-categories" } : null)}
          onSave={saveMenuCategory}
        />
      ) : null}
      {modal?.type === "recipe-detail" ? (
        <RecipeDetailModal
          recipe={modal.recipe}
          outlet={outletById.get(modal.recipe?.outletId)}
          items={data.items}
          categories={sortedCategories}
          onClose={() => setModal(null)}
          onEdit={() => setModal({ type: "recipe", recipe: modal.recipe })}
        />
      ) : null}

</div>;
}
