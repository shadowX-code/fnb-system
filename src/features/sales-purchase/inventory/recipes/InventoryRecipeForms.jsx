import { useState, useRef } from "react";
import { PackagePlus, GripVertical, Plus } from "lucide-react";
import Modal from "../../../../components/feedback/Modal.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import FloatingLayer from "../../../../components/ui/FloatingLayer.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminPagination, { useAdminClientPagination } from "../../../../components/tables/AdminPagination.jsx";
import { Field, TextArea, selectInputText, parseNonNegativeNumber } from "../InventorySharedPresentation.jsx";
import { isActiveInventoryItem } from "../inventoryItemModel.js";
import { IMAGE_UPLOAD_ACCEPT, optimizeImageFileForPreview } from "../../../../utils/imageUpload.js";
import { findRecipeCodeMatches } from "./inventoryRecipeModalSupportReads.js";
import { formatRestaurantRecipeCurrency, recipeCode, recipeNameEn, recipeNameCn, normalizeProductRecipeKey, recipeIngredientCost, recipeCostSummary, recipeMarginPercent, recipeMarginTone, formatRecipeMargin, recipeMenuCategories } from "./inventoryRecipeReadModel.js";
const makeId = prefix => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
const debugLog = (...args) => { if (import.meta.env.DEV) console.log(...args); };
const toTitle = value => String(value || "").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
const statuses = ["active", "inactive", "archived"];
const statusTone = status => status === "active" ? "success" : status === "archived" ? "danger" : "neutral";
const itemHasActiveOutletLink = (item = {}, outletId) => (item.linkedOutletIds || []).includes(outletId);

export function MenuCategoryModal({ category, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    id: category?.id || "",
    name: category?.name || "",
    description: category?.description || "",
    status: category?.status || "active",
    sortOrder: category?.sortOrder ?? 0,
  }));
  const [touched, setTouched] = useState(false);
  const invalid = touched && !form.name.trim();
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <Modal
      title={category ? "Edit Menu Category" : "Add Menu Category"}
      description="Menu categories organize recipe BOMs and recipe filters."
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => {
              setTouched(true);
              if (!form.name.trim()) return;
              onSave({
                ...form,
                name: form.name.trim(),
                description: form.description.trim(),
                sortOrder: Number(form.sortOrder || 0),
              });
            }}
          >
            Save
          </button>
        </>
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Category Name" value={form.name} required onChange={(value) => update("name", value)} placeholder="Main Dish" />
        <Field label="Sort Order" type="number" value={form.sortOrder} onChange={(value) => update("sortOrder", Number(value || 0))} />
        <SelectField label="Status" value={form.status} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onChange={(value) => update("status", value)} />
        <div className="md:col-span-2">
          <TextArea label="Description" value={form.description} onChange={(value) => update("description", value)} placeholder="Optional description" />
        </div>
        {invalid ? <div className="md:col-span-2 type-caption font-semibold text-rose-600">Menu category name is required.</div> : null}
      </div>
    </Modal>
  );
}

export function MenuCategorySettingsModal({ categories, canManage, requirePermission, onAdd, onEdit, onArchive, onSort, onClose }) {
  const ordered = [...categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  return (
    <Modal
      title="Menu Category Settings"
      description="Create, edit, archive and sort menu categories used by Recipes & Usage."
      size="lg"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="type-caption text-text-secondary">{ordered.length} configured menu categor{ordered.length === 1 ? "y" : "ies"}</div>
          <div className="type-caption text-text-muted">Only active menu categories appear in recipe forms and filters.</div>
        </div>
        <button className="btn-primary h-8 px-3 text-xs" type="button" onClick={() => requirePermission(canManage, "add menu categories") && onAdd()}>
          <PackagePlus size={14} /> Add Category
        </button>
      </div>
      {ordered.length ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {ordered.map((category) => (
            <div
              key={category.id}
              draggable={canManage}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", category.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData("text/plain");
                if (draggedId && draggedId !== category.id) onSort(draggedId, category.id);
              }}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-primary/5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <GripVertical size={14} className="text-text-muted" />
                  <div className="truncate type-body-sm font-bold text-text-primary">{category.name}</div>
                  <Badge tone={category.status === "active" ? "success" : "neutral"}>{toTitle(category.status || "active")}</Badge>
                </div>
                <div className="mt-0.5 truncate type-caption text-text-secondary">{category.description || "No description"}</div>
                <div className="mt-1 type-caption font-semibold text-text-muted">Sort {category.sortOrder || 0}</div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canManage, "edit menu categories") && onEdit(category)}>Edit</button>
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canManage, "archive menu categories") && onArchive(category)}>{category.status === "active" ? "Archive" : "Activate"}</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="Create your first menu category." description="Menu categories help scan recipe BOMs by product type." />
      )}
    </Modal>
  );
}

export function RecipeIngredientPreviewPill({ recipe, itemById }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const ingredients = recipe.ingredients || [];
  const rows = ingredients.slice(0, 5).map((line) => {
    const item = itemById.get(line.itemId);
    const quantity = Number(line.quantityUsed ?? line.quantity_used ?? 0);
    const displayQty = Number.isFinite(quantity) ? String(quantity).replace(/\.0+$/, "") : "-";
    const unit = line.unit || item?.unit || "";
    const cost = recipeIngredientCost(line, item);
    return `${item?.name || "Inventory item"} · ${displayQty} ${unit}`.trim() + ` · ${formatRestaurantRecipeCurrency(cost.totalCost)}`;
  });
  const remaining = Math.max(0, ingredients.length - 5);

  return (
    <span
      className="inline-flex"
      ref={anchorRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <button
        className="rounded-full border border-border bg-slate-50 px-2.5 py-1 type-caption font-bold text-text-secondary transition hover:border-primary/30 hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary/20"
        type="button"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        {ingredients.length} ingredient{ingredients.length === 1 ? "" : "s"}
      </button>
      <FloatingLayer
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        align="start"
        width={300}
        minWidth={260}
        estimatedHeight={220}
        className="p-0"
        contentClassName="p-3"
      >
        <div className="mb-2 type-caption font-black uppercase tracking-wide text-text-muted">Ingredient Preview</div>
        {rows.length ? (
          <div className="space-y-1.5">
            {rows.map((line) => (
              <div key={line} className="type-caption font-semibold text-text-secondary">{line}</div>
            ))}
            {remaining ? <div className="type-caption font-black text-primary">+{remaining} more</div> : null}
          </div>
        ) : (
          <div className="type-caption text-text-muted">No ingredients</div>
        )}
      </FloatingLayer>
    </span>
  );
}

export function RecipeIngredientCloneModal({ recipes, items, outletById, excludedRecipeId, onClone, onClose }) {
  const [search, setSearch] = useState("");
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const candidates = recipes.filter((entry) => {
    if (entry.id === excludedRecipeId) return false;
    const searchText = `${recipeCode(entry)} ${recipeNameEn(entry)} ${recipeNameCn(entry)}`.toLowerCase();
    return !search.trim() || searchText.includes(search.trim().toLowerCase());
  });
  const selectedRecipe = candidates.find((entry) => entry.id === selectedRecipeId) || null;
  const ingredients = selectedRecipe?.ingredients || selectedRecipe?.items || [];
  const summary = selectedRecipe ? recipeCostSummary(selectedRecipe, items) : null;

  return <Modal title="Clone Ingredients" description="Copy ingredient rows into this draft only. Review and save the current recipe when ready." size="lg" onClose={onClose} footer={<><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={!selectedRecipe || !ingredients.length} onClick={() => { onClone(selectedRecipe); onClose(); }}>Clone {ingredients.length || ""} Ingredients</button></>}>
    <div className="space-y-4">
      <label><div className="mb-1 type-caption font-semibold text-text-secondary">Search existing recipe</div><input className="control h-9 w-full text-[13px]" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search recipe name or code" autoFocus /></label>
      <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
        {candidates.length ? candidates.map((entry) => {
          const count = (entry.ingredients || entry.items || []).length;
          const selected = entry.id === selectedRecipeId;
          return <button key={entry.id} className={`flex w-full items-start justify-between gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-primary bg-primary/5" : "border-border bg-white hover:border-primary/40"}`} type="button" onClick={() => setSelectedRecipeId(entry.id)}><span className="min-w-0"><span className="block font-bold text-text-primary">{recipeNameEn(entry) || recipeNameCn(entry) || recipeCode(entry) || "Recipe"}</span><span className="mt-0.5 block type-caption text-text-secondary">{recipeCode(entry) || "No code"} · {outletById.get(entry.outletId)?.name || "Outlet"}</span></span><Badge tone={count ? "success" : "neutral"}>{count} ingredient{count === 1 ? "" : "s"}</Badge></button>;
        }) : <EmptyState title="No matching recipes" description="Try another recipe name or code." />}
      </div>
      {selectedRecipe ? <div className="rounded-xl border border-border bg-slate-50 p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-bold text-text-primary">{recipeNameEn(selectedRecipe) || recipeNameCn(selectedRecipe) || recipeCode(selectedRecipe) || "Recipe"}</div><div className="mt-1 type-caption text-text-secondary">{outletById.get(selectedRecipe.outletId)?.name || "Outlet"} · {ingredients.length} ingredient{ingredients.length === 1 ? "" : "s"}</div></div><Badge tone="success">Cost {formatRestaurantRecipeCurrency(summary?.totalCost || 0)}</Badge></div>{ingredients.length ? <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-white">{ingredients.map((line) => { const item = items.find((entry) => entry.id === (line.itemId || line.inventory_item_id)); return <div key={line.id || `${line.itemId}-${line.quantityUsed}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"><span className="font-semibold text-text-primary">{item?.name || "Unavailable inventory item"}</span><span className="text-text-secondary">{line.quantityUsed ?? line.quantity_used ?? 0} {line.unit || item?.unit || ""} · {line.wastagePercent ?? line.wastage_percent ?? 0}% wastage{line.remark ? ` · ${line.remark}` : ""}</span></div>; })}</div> : <div className="mt-3 type-caption text-text-secondary">This recipe has no ingredients to clone.</div>}</div> : null}
    </div>
  </Modal>;
}

export function RecipeModal({ recipe, outletId, outlet, items, menuCategories, existingRecipes = [], outletById = new Map(), loadCloneRecipes, onClose, onSave }) {
  const [isSaving, setIsSaving] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(recipe?.recipePhotoUrl || recipe?.recipe_photo_url || "");
  const [photoError, setPhotoError] = useState("");
  const [touched, setTouched] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [duplicateCodeError, setDuplicateCodeError] = useState("");
  const [checkingRecipeCode, setCheckingRecipeCode] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneRecipes, setCloneRecipes] = useState(existingRecipes);
  const [cloneLoading, setCloneLoading] = useState(false);
  async function openClone() {
    if (!loadCloneRecipes) { setCloneRecipes(existingRecipes); setCloneOpen(true); return; }
    setCloneLoading(true);
    try {
      setCloneRecipes(loadCloneRecipes ? await loadCloneRecipes() : existingRecipes);
      setCloneOpen(true);
    } catch (error) { setCloneFeedback(error.message || "Unable to load clone sources. Please try again."); }
    finally { setCloneLoading(false); }
  }
  const [cloneFeedback, setCloneFeedback] = useState("");
  const duplicateCheckRef = useRef({ requestId: 0, submitting: false, saving: false });
  const [form, setForm] = useState(() => ({
    id: recipe?.id || "",
    outletId: recipe?.outletId || outletId || "",
    recipeCode: recipeCode(recipe),
    recipeNameEn: recipeNameEn(recipe),
    recipeNameCn: recipeNameCn(recipe),
    menuCategory: recipe?.menuCategory || recipe?.menu_category || menuCategories.find((category) => category.status === "active")?.name || recipeMenuCategories[0],
    recipePhotoUrl: recipe?.recipePhotoUrl || recipe?.recipe_photo_url || "",
    recipePhotoFile: null,
    sellingPrice: recipe?.sellingPrice ?? recipe?.selling_price ?? "",
    servingSize: recipe?.servingSize || recipe?.serving_size || "1",
    status: recipe?.status || "active",
    notes: recipe?.notes || "",
    ingredients: (recipe?.ingredients || recipe?.items || []).map((line) => ({
      id: line.id || makeId("recipe_item"),
      itemId: line.itemId || line.inventory_item_id || "",
      quantityUsed: line.quantityUsed ?? line.quantity_used ?? 0,
      unit: line.unit || "",
      wastagePercent: line.wastagePercent ?? line.wastage_percent ?? 0,
      remark: line.remark || "",
    })),
  }));
  const availableItems = items.filter((item) => isActiveInventoryItem(item) && itemHasActiveOutletLink(item, form.outletId));
  const update = (key, value) => setForm((current) => {
    return { ...current, [key]: value };
  });
  const updateIngredient = (id, patch) => setForm((current) => ({
    ...current,
    ingredients: current.ingredients.map((line) => {
      if (line.id !== id) return line;
      const next = { ...line, ...patch };
      if (patch.itemId) {
        next.unit = items.find((item) => item.id === patch.itemId)?.unit || next.unit;
        next.cloneUnavailable = !availableItems.some((item) => item.id === patch.itemId);
      }
      return next;
    }),
  }));
  const addIngredient = () => {
    const firstItem = availableItems[0];
    setForm((current) => ({
      ...current,
      ingredients: [
        ...current.ingredients,
        {
          id: makeId("recipe_item"),
          itemId: firstItem?.id || "",
          quantityUsed: 0,
          unit: firstItem?.unit || "",
          wastagePercent: 0,
          remark: "",
        },
      ],
    }));
  };
  const removeIngredient = (id) => setForm((current) => ({ ...current, ingredients: current.ingredients.filter((line) => line.id !== id) }));
  const cloneIngredients = (sourceRecipe) => {
    const sourceIngredients = sourceRecipe?.ingredients || sourceRecipe?.items || [];
    const existingItemIds = new Set(form.ingredients.map((line) => line.itemId).filter(Boolean));
    const cloned = [];
    let skipped = 0;
    let unavailable = 0;
    sourceIngredients.forEach((line) => {
      const itemId = line.itemId || line.inventory_item_id || "";
      if (!itemId || existingItemIds.has(itemId)) {
        skipped += 1;
        return;
      }
      existingItemIds.add(itemId);
      const available = availableItems.some((item) => item.id === itemId);
      if (!available) unavailable += 1;
      cloned.push({
        id: makeId("recipe_item"),
        itemId,
        quantityUsed: line.quantityUsed ?? line.quantity_used ?? 0,
        unit: line.unit || items.find((item) => item.id === itemId)?.unit || "",
        wastagePercent: line.wastagePercent ?? line.wastage_percent ?? 0,
        remark: line.remark || "",
        cloneUnavailable: !available,
      });
    });
    setForm((current) => ({ ...current, ingredients: [...current.ingredients, ...cloned] }));
    setCloneFeedback(`${cloned.length} ingredient${cloned.length === 1 ? "" : "s"} cloned${skipped ? `; ${skipped} duplicate${skipped === 1 ? "" : "s"} skipped` : ""}${unavailable ? `; ${unavailable} unavailable for this outlet` : ""}.`);
  };
  const summary = recipeCostSummary(form, items);
  const margin = recipeMarginPercent(form.sellingPrice, summary.totalCost);
  const profit = Number(form.sellingPrice || 0) - Number(summary.totalCost || 0);
  const normalizedRecipeCode = recipeCode(form).toLowerCase();
  const duplicateValidationSuppressed = isSaving || duplicateCheckRef.current.saving;
  const setRecipeDuplicateError = (message, source, meta = {}) => {
    debugLog("[RecipeDuplicateErrorSource]", {
      source,
      value: recipeCode(form),
      mode: form.id ? "edit" : "create",
      recipeId: form.id || "",
      timestamp: new Date().toISOString(),
      message,
      ...meta,
    });
    setDuplicateCodeError(message);
  };
  const localDuplicateRecipeCode = !duplicateValidationSuppressed && Boolean(normalizedRecipeCode && existingRecipes.some((entry) => entry.id !== form.id && recipeCode(entry).toLowerCase() === normalizedRecipeCode));
  const duplicateRecipeCode = !duplicateValidationSuppressed && Boolean(localDuplicateRecipeCode || duplicateCodeError);
  const sellingPriceValue = Number(form.sellingPrice);
  const sellingPriceInvalid = form.sellingPrice === "" || !Number.isFinite(sellingPriceValue) || sellingPriceValue <= 0;
  const identityErrors = {
    recipeCode: !form.recipeCode.trim() ? "Recipe code is required." : duplicateRecipeCode ? "Recipe code already exists." : "",
    recipeNameEn: !form.recipeNameEn.trim() ? "Recipe Name EN is required." : "",
    recipeNameCn: !form.recipeNameCn.trim() ? "Recipe Name CN is required." : "",
    sellingPrice: sellingPriceInvalid ? "Selling price must be greater than 0." : "",
  };
  const categoryOptions = menuCategories
    .filter((category) => category.status === "active")
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.name.localeCompare(b.name))
    .map((category) => ({ value: category.name, label: category.name }));
  const safeCategoryOptions = categoryOptions.length ? categoryOptions : recipeMenuCategories.map((category) => ({ value: category, label: category }));
  const handlePhotoChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPhotoError("");
    try {
      const optimized = await optimizeImageFileForPreview(file);
      setPhotoPreview(optimized.dataUrl);
      update("recipePhotoFile", file);
    } catch (error) {
      setPhotoError(error.message || "Unable to read image.");
    }
  };
  const hasInvalidIngredients = !form.ingredients.length || form.ingredients.some((line) => !line.itemId || Number(line.quantityUsed || 0) <= 0 || line.cloneUnavailable);
  const invalid = Boolean(identityErrors.recipeCode || identityErrors.recipeNameEn || identityErrors.recipeNameCn || identityErrors.sellingPrice || !form.outletId || hasInvalidIngredients);
  const showError = (key) => Boolean(touched[key] || submitAttempted);
  const touchField = (key) => setTouched((current) => ({ ...current, [key]: true }));
  const ingredientFieldKey = (lineId, field) => `ingredient.${lineId}.${field}`;
  const handleRecipeCodeChange = (value) => {
    duplicateCheckRef.current.requestId += 1;
    setRecipeDuplicateError("", "recipe-code-change");
    update("recipeCode", value);
  };
  const checkDuplicateRecipeCode = async ({ forSubmit = false } = {}) => {
    const code = recipeCode(form);
    const codeKey = normalizeProductRecipeKey(code);
    const requestId = duplicateCheckRef.current.requestId + 1;
    duplicateCheckRef.current.requestId = requestId;
    if (forSubmit) duplicateCheckRef.current.submitting = true;
    touchField("recipeCode");
    if (!code) {
      if (duplicateCheckRef.current.requestId === requestId) setRecipeDuplicateError("", forSubmit ? "submit-duplicate-check-blank" : "onBlur-duplicate-check-blank", { requestId });
      debugLog("[RecipeCodeValidation]", { value: code, duplicateResult: false, submitBlocked: forSubmit && true, reason: "blank" });
      return false;
    }
    const localDuplicate = Boolean(codeKey && existingRecipes.some((entry) => entry.id !== form.id && normalizeProductRecipeKey(recipeCode(entry)) === codeKey));
    if (localDuplicate) {
      if (duplicateCheckRef.current.requestId === requestId && !duplicateCheckRef.current.saving) setRecipeDuplicateError("Recipe code already exists.", forSubmit ? "submit-duplicate-check-local" : "onBlur-duplicate-check-local", { requestId });
      debugLog("[RecipeCodeValidation]", { value: code, duplicateResult: true, submitBlocked: forSubmit, source: "local" });
      return true;
    }
    setCheckingRecipeCode(true);
    try {
      const result = await findRecipeCodeMatches(code);
      if (result.error) throw result.error;
      const duplicate = (result.data || []).some((row) => row.id !== form.id && normalizeProductRecipeKey(recipeCode(row)) === codeKey);
      const isLatest = duplicateCheckRef.current.requestId === requestId && recipeCode(form).toLowerCase() === code.toLowerCase();
      if (isLatest && !duplicateCheckRef.current.saving) setRecipeDuplicateError(duplicate ? "Recipe code already exists." : "", forSubmit ? "submit-duplicate-check-remote" : "onBlur-duplicate-check-remote", { requestId, duplicateResult: duplicate });
      debugLog("[RecipeCodeValidation]", { value: code, duplicateResult: duplicate, submitBlocked: forSubmit && duplicate, source: "remote", stale: !isLatest });
      return duplicate;
    } catch (error) {
      debugLog("[RecipeCodeDuplicateDebug]", { recipeId: form.id, recipeCode: code, error });
      if (duplicateCheckRef.current.requestId === requestId && !duplicateCheckRef.current.saving) setRecipeDuplicateError("", forSubmit ? "submit-duplicate-check-error-clear" : "onBlur-duplicate-check-error-clear", { requestId, error });
      return false;
    } finally {
      if (duplicateCheckRef.current.requestId === requestId) setCheckingRecipeCode(false);
      if (forSubmit) duplicateCheckRef.current.submitting = false;
    }
  };
  const handleSave = async () => {
    setSubmitAttempted(true);
    if (isSaving) return;
    const blockingInvalid = Boolean(!form.recipeCode.trim() || !form.recipeNameEn.trim() || !form.recipeNameCn.trim() || identityErrors.sellingPrice || !form.outletId || hasInvalidIngredients);
    if (blockingInvalid) return;
    const hasDuplicate = await checkDuplicateRecipeCode({ forSubmit: true });
    if (hasDuplicate) return;
    duplicateCheckRef.current.saving = true;
    duplicateCheckRef.current.requestId += 1;
    setRecipeDuplicateError("", "submit-no-duplicate-clear");
    setIsSaving(true);
    try {
      await onSave({ ...form });
      setRecipeDuplicateError("", "save-success-clear");
      setTouched({});
      setSubmitAttempted(false);
    } catch (error) {
      if (/inventory_recipes_recipe_code_unique|recipe_code/i.test(String(error?.message || error?.details || ""))) {
        duplicateCheckRef.current.saving = false;
        setRecipeDuplicateError("Recipe code already exists.", "supabase-unique-fallback", { error });
        touchField("recipeCode");
      }
    } finally {
      duplicateCheckRef.current.saving = false;
      setIsSaving(false);
    }
  };

  return (
    <Modal
      title={recipe ? "Edit Recipe" : "Add Recipe"}
      description="Build a recipe BOM by linking menu items to outlet-linked inventory ingredients."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={isSaving || checkingRecipeCode} onClick={handleSave}>{isSaving ? "Saving..." : "Save Recipe"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <section className="rounded-3xl border border-border bg-background p-4">
          <div className="mb-3">
            <div className="type-title font-black text-text-primary">Recipe Identity</div>
            <div className="type-caption text-text-secondary">Core recipe names and lifecycle state.</div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field
              label="Recipe Code"
              value={form.recipeCode}
              required
              onChange={handleRecipeCodeChange}
              onBlur={checkDuplicateRecipeCode}
              error={showError("recipeCode") ? identityErrors.recipeCode : ""}
              placeholder="RCP-CURRY-001"
            />
            {checkingRecipeCode ? <div className="self-end type-caption font-semibold text-text-muted">Checking recipe code...</div> : null}
            <SelectField label="Menu Category" value={form.menuCategory} options={safeCategoryOptions} onChange={(value) => update("menuCategory", value)} />
            <Field
              label="Recipe Name EN"
              value={form.recipeNameEn}
              required
              onChange={(value) => update("recipeNameEn", value)}
              onBlur={() => touchField("recipeNameEn")}
              error={showError("recipeNameEn") ? identityErrors.recipeNameEn : ""}
              placeholder="Classic Dry Curry Noodle"
            />
            <Field
              label="Recipe Name CN"
              value={form.recipeNameCn}
              required
              onChange={(value) => update("recipeNameCn", value)}
              onBlur={() => touchField("recipeNameCn")}
              error={showError("recipeNameCn") ? identityErrors.recipeNameCn : ""}
              placeholder="经典干咖喱面"
            />
            <label>
              <div className="mb-1 type-caption font-semibold text-text-secondary">Outlet</div>
              <div className="control flex h-9 items-center text-[13px] font-semibold text-text-secondary">{outlet?.name || "Selected outlet"}</div>
            </label>
            <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => update("status", value)} />
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-background p-4">
          <div className="mb-3">
            <div className="type-title font-black text-text-primary">Commercial Information</div>
            <div className="type-caption text-text-secondary">Selling price and yield drive live recipe costing.</div>
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.4fr] lg:items-end">
            <Field
              label="Selling Price"
              type="number"
              value={form.sellingPrice}
              required
              onChange={(value) => update("sellingPrice", parseNonNegativeNumber(value))}
              onBlur={() => touchField("sellingPrice")}
              error={showError("sellingPrice") ? identityErrors.sellingPrice : ""}
              placeholder="0.00"
            />
            <Field label="Serving Size / Yield" value={form.servingSize} onChange={(value) => update("servingSize", value)} placeholder="1" />
            <div className="grid gap-2 sm:grid-cols-3">
              <MetricCard label="Recipe Cost" value={formatRestaurantRecipeCurrency(summary.totalCost)} helper="Ingredient + wastage" tone="success" size="compact" />
              <MetricCard label="Profit" value={form.sellingPrice !== "" ? formatRestaurantRecipeCurrency(profit) : "—"} helper="Price - cost" tone={profit >= 0 ? "success" : "danger"} size="compact" />
              <MetricCard label="Margin %" value={formatRecipeMargin(margin)} helper="Price vs cost" tone={recipeMarginTone(margin)} size="compact" />
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-background p-4">
          <div className="mb-3">
            <div className="type-title font-black text-text-primary">Product Display</div>
            <div className="type-caption text-text-secondary">Photo and notes shown to operators reviewing the recipe.</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
            <label>
              <div className="mb-1 type-caption font-semibold text-text-secondary">Recipe Photo</div>
              <div className="rounded-2xl border border-border bg-slate-50 p-3">
                <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-border bg-slate-100">
                  {photoPreview ? <img className="h-full w-full object-contain p-2" src={photoPreview} alt="Recipe preview" /> : <div className="text-xs font-bold text-text-muted">No recipe photo</div>}
                </div>
                <input type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={handlePhotoChange} className="mt-3 block w-full text-xs text-text-secondary file:mr-3 file:rounded-xl file:border-0 file:bg-primary/10 file:px-3 file:py-2 file:text-xs file:font-bold file:text-primary" />
                {photoError ? <div className="mt-2 type-caption font-semibold text-amber-700">{photoError}</div> : null}
              </div>
            </label>
            <TextArea label="Notes" value={form.notes} onChange={(value) => update("notes", value)} placeholder="Prep notes, yield assumptions or special handling." />
          </div>
        </section>

        <section className="rounded-3xl border border-border bg-background p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="type-title font-black text-text-primary">Ingredients</div>
              <div className="type-caption text-text-secondary">Quantity used is per serving/yield above.</div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge tone="success">Running total {formatRestaurantRecipeCurrency(summary.totalCost)}</Badge>
              <button className="btn-secondary h-8 px-3 text-xs" type="button" onClick={openClone} disabled={cloneLoading || (!loadCloneRecipes && !existingRecipes.some((entry) => entry.id !== form.id))}>
                Clone Ingredients
              </button>
              <button className="btn-secondary h-8 px-3 text-xs" type="button" onClick={addIngredient} disabled={!availableItems.length}>
                <Plus size={14} /> Add Ingredient
              </button>
            </div>
          </div>
          <div className="mb-3 rounded-2xl border border-primary/15 bg-primary/5 p-3 type-caption text-text-secondary">
            Ingredient selector only shows active inventory items linked to the selected outlet.
          </div>
          {cloneFeedback ? <div className="mb-3 rounded-xl border border-sky-200 bg-sky-50 p-3 type-caption font-semibold text-sky-800">{cloneFeedback}</div> : null}
          {form.ingredients.length ? (
            <div className="space-y-2">
              {form.ingredients.map((line) => {
                const item = items.find((entry) => entry.id === line.itemId);
                const cost = recipeIngredientCost(line, item);
                return (
                  <div key={line.id} className="grid gap-2 rounded-2xl border border-border bg-slate-50/70 p-3 xl:grid-cols-[1.4fr_95px_72px_95px_95px_100px_1fr_auto] xl:items-end">
                    <div>
                      <SelectField label="Inventory Item" value={line.itemId} options={availableItems.map((entry) => ({ value: entry.id, label: entry.name }))} onChange={(value) => updateIngredient(line.id, { itemId: value })} searchable />
                      {submitAttempted && !line.itemId ? <div className="mt-1 type-caption font-semibold text-rose-600">Inventory item is required.</div> : null}
                      {line.cloneUnavailable ? <div className="mt-1 type-caption font-semibold text-rose-600">This cloned ingredient is not active or linked to the current outlet. Replace or remove it before saving.</div> : null}
                    </div>
                    <Field
                      label="Qty Used"
                      type="number"
                      value={line.quantityUsed}
                      onChange={(value) => updateIngredient(line.id, { quantityUsed: parseNonNegativeNumber(value) })}
                      onBlur={() => touchField(ingredientFieldKey(line.id, "quantityUsed"))}
                      error={(showError(ingredientFieldKey(line.id, "quantityUsed")) && Number(line.quantityUsed || 0) <= 0) ? "Qty must be greater than 0." : ""}
                    />
                    <label>
                      <div className="mb-1 type-caption font-semibold text-text-secondary">Unit</div>
                      <div className="control flex h-9 items-center text-[13px] font-semibold text-text-secondary">{item?.unit || line.unit || "-"}</div>
                    </label>
                    <label>
                      <div className="mb-1 type-caption font-semibold text-text-secondary">Unit Cost</div>
                      <div className="control flex h-9 items-center text-[13px] font-semibold text-text-secondary">{formatRestaurantRecipeCurrency(cost.unitCost)}</div>
                    </label>
                    <Field label="Wastage %" type="number" value={line.wastagePercent} onChange={(value) => updateIngredient(line.id, { wastagePercent: parseNonNegativeNumber(value) })} />
                    <label>
                      <div className="mb-1 type-caption font-semibold text-text-secondary">Total Cost</div>
                      <div className="control flex h-9 items-center text-[13px] font-semibold text-text-primary">{formatRestaurantRecipeCurrency(cost.totalCost + cost.wastageCost)}</div>
                    </label>
                    <Field label="Remark" value={line.remark} onChange={(value) => updateIngredient(line.id, { remark: value })} placeholder="Optional" />
                    <button className="btn-secondary h-9 px-3 text-xs text-rose-700" type="button" onClick={() => removeIngredient(line.id)}>Remove</button>
                  </div>
                );
              })}
            </div>
          ) : <EmptyState title="No ingredients yet" description={availableItems.length ? "Add ingredients to define usage per serving." : "No active outlet-linked inventory items are available for this outlet."} />}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-slate-50 p-3">
            <div>
              <div className="type-caption font-black uppercase tracking-wide text-text-muted">Total Recipe Cost</div>
              <div className="type-title font-black text-text-primary">{formatRestaurantRecipeCurrency(summary.totalCost)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">Ingredient {formatRestaurantRecipeCurrency(summary.ingredientCost)}</Badge>
              <Badge tone={summary.wastageCost ? "warning" : "neutral"}>Wastage {formatRestaurantRecipeCurrency(summary.wastageCost)}</Badge>
            </div>
          </div>
        </section>
      </div>
      {cloneOpen ? <RecipeIngredientCloneModal recipes={cloneRecipes} items={items} outletById={outletById} excludedRecipeId={form.id} onClone={cloneIngredients} onClose={() => setCloneOpen(false)} /> : null}
    </Modal>
  );
}

export function RecipeDetailModal({ recipe, outlet, items, categories, onClose, onEdit }) {
  const ingredients = recipe?.ingredients || [];
  const summary = recipeCostSummary(recipe, items);
  const margin = recipeMarginPercent(recipe?.sellingPrice ?? recipe?.selling_price, summary.totalCost);
  const photoUrl = recipe?.recipePhotoUrl || recipe?.recipe_photo_url || "";
  const code = recipeCode(recipe);
  const nameEn = recipeNameEn(recipe);
  const nameCn = recipeNameCn(recipe);
  return (
    <Modal
      title={nameEn || nameCn || code || "Recipe"}
      description={`${outlet?.name || "Outlet"} · ${recipe?.menuCategory || "Menu Category"}`}
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          <button className="btn-primary" type="button" onClick={onEdit}>Edit Recipe</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-3xl border border-border bg-slate-50 lg:h-[240px] lg:w-[240px]">
            {photoUrl ? (
              <img className="h-full w-full object-contain p-2" src={photoUrl} alt={nameEn || nameCn || code || "Recipe"} />
            ) : (
              <div className="type-body-sm font-bold text-text-muted">No recipe photo</div>
            )}
          </div>
          <div className="rounded-3xl border border-border bg-background p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="type-caption font-black uppercase tracking-wide text-text-muted">{code || "No recipe code"}</div>
                <div className="type-section-title font-black text-text-primary">{nameEn || "Recipe Name EN required"}</div>
                <div className="mt-1 type-body-sm font-semibold text-text-secondary">{nameCn || "Recipe Name CN required"}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge tone="info">{recipe?.menuCategory || "Uncategorized"}</Badge>
                  <Badge tone={statusTone(recipe?.status || "active")}>{toTitle(recipe?.status || "active")}</Badge>
                </div>
                <div className="mt-2 type-body-sm font-semibold text-text-secondary">{outlet?.name || "Outlet"} · {recipe?.servingSize || "1 portion"}</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <MetricCard label="Estimated Cost" value={formatRestaurantRecipeCurrency(summary.totalCost)} helper="Ingredient + wastage" tone="success" size="compact" />
              <MetricCard label="Selling Price" value={recipe?.sellingPrice !== "" && recipe?.sellingPrice !== null && recipe?.sellingPrice !== undefined ? formatRestaurantRecipeCurrency(recipe.sellingPrice) : "—"} helper="Menu price" size="compact" />
              <MetricCard label="Margin %" value={formatRecipeMargin(margin)} helper="Price vs cost" tone={recipeMarginTone(margin)} size="compact" />
              <MetricCard label="Ingredients" value={ingredients.length} helper="BOM rows" size="compact" />
              <MetricCard label="Ingredient Cost" value={formatRestaurantRecipeCurrency(summary.ingredientCost)} helper="Before wastage" size="compact" />
              <MetricCard label="Status" value={toTitle(recipe?.status || "active")} helper="Recipe lifecycle" tone={statusTone(recipe?.status || "active")} size="compact" />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full min-w-[900px] text-left">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
              <tr>
                <th className="px-3 py-2">Inventory Item</th>
                <th>Category</th>
                <th>Qty Used</th>
                <th>Unit</th>
                <th>Unit Cost</th>
                <th>Total Cost</th>
                <th>Wastage %</th>
                <th>Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-[13px]">
              {ingredients.map((line) => {
                const item = items.find((entry) => entry.id === line.itemId);
                const category = categories.find((entry) => entry.id === item?.categoryId);
                const cost = recipeIngredientCost(line, item);
                return (
                  <tr key={line.id || line.itemId}>
                    <td className="px-3 py-2 font-bold text-text-primary">{item?.name || "Inventory item"}</td>
                    <td>{category?.name || "Uncategorized"}</td>
                    <td>{line.quantityUsed}</td>
                    <td>{line.unit || item?.unit || "-"}</td>
                    <td>{formatRestaurantRecipeCurrency(cost.unitCost)}</td>
                    <td>{formatRestaurantRecipeCurrency(cost.totalCost)}</td>
                    <td>{line.wastagePercent || 0}%</td>
                    <td>{line.remark || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {recipe?.notes ? <div className="rounded-2xl border border-border bg-slate-50 p-3 type-body-sm text-text-secondary">{recipe.notes}</div> : null}
      </div>
    </Modal>
  );
}

export function RecipeListPagination({ rows, resetKey, children }) {
  const pagination = useAdminClientPagination("restaurant.recipes", rows.length, 20, resetKey);
  return children(
    rows.slice(pagination.from, pagination.to),
    <AdminPagination
      page={pagination.page}
      pageSize={pagination.pageSize}
      total={rows.length}
      onPageChange={pagination.setPage}
      onPageSizeChange={pagination.setPageSize}
    />,
  );
}
