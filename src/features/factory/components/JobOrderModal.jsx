import { useState } from "react";
import { BookOpen, Factory, Package, PackageCheck, RefreshCw } from "lucide-react";
import EmptyState from "../../../components/feedback/EmptyState.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { Field, inputClass } from "./FactoryBulkSelectionModal.jsx";
import FeedXDatePicker from "./FeedXDatePicker.jsx";
import SearchableSelect from "./SearchableSelect.jsx";
import { factoryService } from "../../../services/factoryService.js";
import useFactoryNumberPreview from "../hooks/useFactoryNumberPreview.js";
import { activeRecipeForSku, finishedGoodParentKey, inheritedRecipeUom } from "../utils/productionPlanning.js";
import { todayInput } from "../utils/factoryDates.js";
import { normalizePackSizeToBase, packSizeText, quantity, rawMaterialLabel, skuBalanceLabel } from "../utils/factoryFormatters.js";
import { jobStatusLabel } from "../utils/factoryStatus.js";

const priorityOptions = ["Low", "Normal", "High", "Urgent"];

function packagingPackEstimate(productionQty, productionUom, sku, recipeUom = "") {
  const targetProductionQty = Number(productionQty || 0); const packSizeQty = Number(sku?.pack_size_qty || sku?.base_qty || 0); const packSizeUom = sku?.pack_size_uom || sku?.base_uom || ""; const packBase = normalizePackSizeToBase(packSizeQty, packSizeUom); const productionBase = normalizePackSizeToBase(targetProductionQty, productionUom); const recipeBase = recipeUom ? normalizePackSizeToBase(1, recipeUom) : null;
  if (!targetProductionQty) return { target_pack_qty: 0, target_production_qty: 0, production_uom: productionUom || recipeBase?.uom || packBase?.uom || "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  if (!String(productionUom || "").trim()) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: "", pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM is required." };
  if (!packSizeQty || !packSizeUom) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Packaging SKU needs Pack Size before creating Job Order." };

  if (packBase) {
    if (!productionBase) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM cannot convert to the selected Packaging SKU Pack Size." };
    if (productionBase.uom !== packBase.uom) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM cannot convert to the selected Packaging SKU Pack Size." };
    if (recipeBase && recipeBase.uom !== productionBase.uom) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: productionBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM must match the active recipe UOM." };
    return { target_pack_qty: productionBase.amount / packBase.amount, target_production_qty: productionBase.amount, production_uom: productionBase.uom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
  }

  const normalizedPackUom = String(packSizeUom || "").trim();
  const normalizedProductionUom = String(productionUom || "").trim();
  const normalizedRecipeUom = String(recipeUom || "").trim();
  if (normalizedRecipeUom && normalizedRecipeUom.toLowerCase() !== normalizedProductionUom.toLowerCase()) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: normalizedProductionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM must match the active recipe UOM." };
  if (normalizedPackUom.toLowerCase() !== normalizedProductionUom.toLowerCase()) return { target_pack_qty: 0, target_production_qty: targetProductionQty, production_uom: normalizedProductionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "Production UOM cannot convert to the selected Packaging SKU Pack Size." };
  return { target_pack_qty: targetProductionQty / packSizeQty, target_production_qty: targetProductionQty, production_uom: normalizedProductionUom, pack_size_qty: packSizeQty, pack_size_uom: packSizeUom, error: "" };
}


export default function JobOrderModal({ initialValue, finishedGoods = [], rawMaterials = [], recipes = [], readOnly = false, onClose, onSave }) {
  const initialSku = finishedGoods.find((product) => product.id === initialValue?.finished_good_id);
  const initialParentKey = initialSku ? finishedGoodParentKey(initialSku) : "";
  const [form, setForm] = useState(() => ({
    product_family_key: initialParentKey,
    finished_good_id: "",
    product_name: "",
    target_pack_qty: "",
    target_production_qty: "",
    target_quantity: "",
    produced_quantity: 0,
    uom: "",
    planned_date: todayInput(),
    due_date: "",
    priority: "Normal",
    status: "draft",
    assigned_team: "",
    remarks: "",
    ...initialValue,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const normalizedStatus = String(form.status || "draft").toLowerCase();
  const isPlanningStatus = ["draft", "planned"].includes(normalizedStatus);
  const isReadOnly = readOnly || (Boolean(initialValue?.id) && !isPlanningStatus);
  const activeFinishedGoods = finishedGoods.filter((product) => product.status === "active" || product.id === form.finished_good_id);
  const finishedGoodParents = Array.from(activeFinishedGoods.reduce((map, product) => {
    const key = finishedGoodParentKey(product);
    if (!key || map.has(key)) return map;
    map.set(key, {
      key,
      product_family_id: product.product_family_id || "",
      legacy_sku_id: product.product_family_id ? "" : product.id,
      name: product.product_family_name || product.product_name_en || product.product_name || "Finished Good",
      category: product.category_name || product.category || "",
      status: product.status || "active",
    });
    return map;
  }, new Map()).values());
  const finishedGoodOptions = finishedGoodParents.map((product) => ({
    value: product.key,
    label: product.name,
    helper: [product.category || "No category", product.product_family_id ? "Finished Good" : "Legacy SKU"].join(" · "),
  }));
  const selectedParent = finishedGoodParents.find((product) => product.key === form.product_family_key);
  const parentSkus = selectedParent ? activeFinishedGoods.filter((product) => finishedGoodParentKey(product) === selectedParent.key) : [];
  const packagingSkuOptions = parentSkus.map((product) => ({
    value: product.id,
    label: [product.product_code || "No SKU", product.product_family_name || product.product_name_en || product.product_name, product.variant_name || packSizeText(product)].filter(Boolean).join(" · "),
    helper: `Pack size ${packSizeText(product) || "not set"} · Balance ${skuBalanceLabel(product)}`,
  }));
  const selectedProduct = parentSkus.find((product) => product.id === form.finished_good_id) || activeFinishedGoods.find((product) => product.id === form.finished_good_id);
  const parentRecipe = selectedParent?.product_family_id ? recipes.find((recipe) => recipe.status === "active" && recipe.product_family_id === selectedParent.product_family_id) : null;
  const legacyRecipe = selectedProduct ? activeRecipeForSku(recipes, selectedProduct, selectedParent?.name || form.product_name) : null;
  const matchingRecipe = parentRecipe || legacyRecipe;
  const targetProductionQty = Number(form.target_production_qty || form.target_quantity || 0);
  const inheritedProductionUom = matchingRecipe?.uom || inheritedRecipeUom(selectedParent?.product_family_id, activeFinishedGoods, form.uom || selectedProduct?.base_uom || selectedProduct?.pack_size_uom || "");
  const productionUom = form.uom || inheritedProductionUom || "";
  const productionPlan = selectedProduct ? packagingPackEstimate(targetProductionQty, productionUom, selectedProduct, matchingRecipe?.uom) : null;
  const estimatedPackQty = productionPlan && !productionPlan.error ? productionPlan.target_pack_qty : null;
  const normalizedPreviewProductionQty = productionPlan && !productionPlan.error ? productionPlan.target_production_qty : targetProductionQty;
  const normalizedPreviewProductionUom = productionPlan && !productionPlan.error ? productionPlan.production_uom : productionUom;
  const packSizeMissing = selectedProduct && productionPlan?.error === "Packaging SKU needs Pack Size before creating Job Order.";
  const recipeUomMismatch = selectedProduct && (productionPlan?.error === "Production UOM must match the active recipe UOM." || productionPlan?.error === "Production UOM cannot convert to the selected Packaging SKU Pack Size.");
  const activeRecipeVersion = matchingRecipe?.version || "v1";
  const activeRecipeLabel = [selectedParent?.name || selectedProduct?.product_name, activeRecipeVersion].filter(Boolean).join(" · ") || activeRecipeVersion;
  const jobOrderNoPreview = useFactoryNumberPreview({
    assignedValue: form.job_order_no || "",
    previewKey: form.job_order_no || "new-job-order",
    loadPreview: () => factoryService.getJobOrderNoPreview(),
    enabled: !form.job_order_no && !isReadOnly,
    scope: "job_order_no",
  });
  const bomRows = matchingRecipe?.items?.length ? matchingRecipe.items.map((item) => {
    const material = rawMaterials.find((row) => row.id === item.raw_material_id);
    const recipeYield = Number(matchingRecipe.yield_quantity || 1) || 1;
    const requiredQty = (Number(item.quantity_used || 0) * Number(normalizedPreviewProductionQty || 0)) / recipeYield;
    const balance = Number(material?.current_balance || 0);
    return {
      ...item,
      material_name: rawMaterialLabel(material) || "Raw Material",
      material_code: material?.material_code || "",
      required_qty: requiredQty,
      balance,
      enough: balance >= requiredQty,
      uom: item.uom || material?.uom || "",
    };
  }) : [];

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isReadOnly) {
      return;
    }
    if (!form.product_family_key) {
      setError("Select a Finished Good.");
      return;
    }
    if (Number(form.target_production_qty || form.target_quantity || 0) <= 0) {
      setError("Target Production Qty must be greater than 0.");
      return;
    }
    if (!String(productionUom || "").trim()) {
      setError("Production UOM is required.");
      return;
    }
    if (!form.finished_good_id) {
      setError("Select an active Packaging SKU.");
      return;
    }
    if (productionPlan?.error) {
      setError(productionPlan.error);
      return;
    }
    if (!productionPlan?.target_pack_qty || !productionPlan.target_production_qty || !productionPlan.production_uom) {
      setError("Packaging SKU Pack Size UOM cannot be used for production quantity.");
      return;
    }
    setSaving(true);
    try {
      const selectedProduct = activeFinishedGoods.find((product) => product.id === form.finished_good_id);
      await onSave({
        ...form,
        product_name: selectedProduct?.product_name || form.product_name,
        target_pack_qty: productionPlan.target_pack_qty,
        target_production_qty: productionPlan.target_production_qty,
        target_quantity: productionPlan.target_production_qty,
        uom: productionPlan.production_uom,
      });
    } catch {
      // Workspace saveJobOrder already owns user-facing error feedback.
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isReadOnly ? "View Job Order" : initialValue?.id ? "Edit Job Order" : "Create Job Order"}
      description="Plan factory production demand before production execution."
      size="xl"
      onClose={saving ? undefined : onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>{isReadOnly ? "Close" : "Cancel"}</button>
          {!isReadOnly ? <button className="btn-primary" type="submit" form="factory-job-order-form" disabled={saving}>{saving ? "Saving..." : initialValue?.id ? "Save Changes" : form.planned_date ? "Schedule Job Order" : "Save Draft"}</button> : null}
        </>
      )}
    >
      <form id="factory-job-order-form" className="space-y-4" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        {isReadOnly ? <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-text-secondary">This Job Order is {jobStatusLabel(normalizedStatus)} and is read-only. Use the production lifecycle actions for the next step.</div> : null}
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Job Order No.">
            <div className="rounded-xl border border-border bg-slate-50 px-3 py-2">
              <div className={`font-mono text-sm font-black ${form.job_order_no || jobOrderNoPreview.value ? "text-text-primary" : "text-text-secondary"}`}>{form.job_order_no || jobOrderNoPreview.value || (jobOrderNoPreview.loading ? "Loading preview..." : "—")}</div>
              {!form.job_order_no && jobOrderNoPreview.value ? <div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">Preview only</div> : null}
              {!form.job_order_no && jobOrderNoPreview.error ? <button className="mt-1 inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline" type="button" onClick={jobOrderNoPreview.retry}><RefreshCw size={11} /> Retry</button> : null}
            </div>
          </Field>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Finished Good *" error={!form.product_family_key && error.includes("Finished Good") ? "Finished Good is required." : ""}>
            <SearchableSelect
              value={form.product_family_key || ""}
              options={finishedGoodOptions}
              placeholder={finishedGoodOptions.length ? "Select Finished Good" : "Create a Finished Good first"}
              searchPlaceholder="Search finished goods"
              emptyText="No matching Finished Goods"
              error={!form.product_family_key && error.includes("Finished Good")}
              disabled={isReadOnly}
              onChange={(parentKey) => {
                const parent = finishedGoodParents.find((item) => item.key === parentKey);
                const recipe = parent?.product_family_id ? recipes.find((item) => item.status === "active" && item.product_family_id === parent.product_family_id) : null;
                setForm((current) => ({
                  ...current,
                  product_family_key: parentKey,
                  finished_good_id: "",
                  product_name: parent?.name || "",
                  uom: recipe?.uom || inheritedRecipeUom(parent?.product_family_id, activeFinishedGoods, current.uom),
                }));
              }}
            />
          </Field>
          <Field label="Packaging SKU *" error={!form.finished_good_id && error.includes("Packaging SKU") ? "Packaging SKU is required." : ""}>
            <SearchableSelect
              value={form.finished_good_id || ""}
              options={packagingSkuOptions}
              placeholder={selectedParent ? "Select Packaging SKU" : "Select Finished Good first"}
              searchPlaceholder="Search packaging SKUs"
              emptyText="No matching packaging SKUs"
              error={!form.finished_good_id && error.includes("Packaging SKU")}
              disabled={isReadOnly || !selectedParent}
              onChange={(finishedGoodId) => {
                const product = parentSkus.find((item) => item.id === finishedGoodId);
                setForm((current) => ({
                  ...current,
                  finished_good_id: finishedGoodId,
                  product_name: product?.product_name || selectedParent?.name || "",
                }));
              }}
            />
          </Field>
          <Field label="Target Production Qty *">
            <div className="flex overflow-hidden rounded-xl border border-border bg-white focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
              <input className="min-h-[42px] min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm font-medium text-text-primary outline-none disabled:bg-slate-50 disabled:text-text-secondary" type="number" min="0" step="0.01" value={form.target_production_qty || form.target_quantity || ""} disabled={isReadOnly} onChange={(event) => {
                const nextQty = event.target.value;
                setForm((current) => ({ ...current, target_production_qty: nextQty, target_quantity: nextQty }));
              }} />
              <div className="flex min-w-[86px] items-center justify-center border-l border-border bg-slate-50 px-3 text-sm font-bold text-text-primary">{productionUom || "—"}</div>
            </div>
            <div className="mt-1 text-xs font-semibold text-text-secondary">UOM inherited from active recipe / finished good output UOM.</div>
          </Field>
          <Field label="Estimated Pack Qty">
            <div className="flex min-h-[42px] items-center rounded-xl border border-border bg-slate-50 px-3 text-sm font-bold text-text-primary">
              {selectedProduct && targetProductionQty > 0 && estimatedPackQty != null ? quantity(estimatedPackQty, "packs") : "—"}
            </div>
          </Field>
          <Field label="Scheduled Date">
            <FeedXDatePicker
              value={form.planned_date || ""}
              disabled={isReadOnly}
              onChange={(nextDate) => setForm((current) => ({ ...current, planned_date: nextDate }))}
            />
          </Field>
          <Field label="Priority">
            <SearchableSelect
              value={form.priority}
              options={priorityOptions.map((option) => ({ value: option, label: option }))}
              placeholder="Select Priority"
              searchPlaceholder="Search priority"
              disabled={isReadOnly}
              onChange={(priority) => setForm((current) => ({ ...current, priority }))}
            />
          </Field>
        </div>
        {selectedProduct ? (
          <div className="grid gap-3 md:grid-cols-4">
            <MetricCard icon={PackageCheck} label="Finished Good" value={selectedProduct.product_family_name || selectedProduct.product_name_en || selectedProduct.product_name} helper={selectedProduct.product_code || "Packaging SKU"} />
            <MetricCard icon={Package} label="Pack Size" value={packSizeText(selectedProduct) || "Missing"} helper={selectedProduct.variant_name || "Packaging variant"} tone={packSizeMissing ? "warning" : "neutral"} />
            <MetricCard icon={Factory} label="Estimated Pack Qty" value={estimatedPackQty == null ? "—" : quantity(estimatedPackQty, "packs")} helper={quantity(normalizedPreviewProductionQty, normalizedPreviewProductionUom)} tone={recipeUomMismatch ? "warning" : "neutral"} />
            <MetricCard icon={BookOpen} label="Active Recipe" value={matchingRecipe ? matchingRecipe.version || "Active" : "—"} helper={matchingRecipe ? matchingRecipe.product_name || selectedProduct.product_family_name || "Finished Good recipe" : "No active recipe"} tone={matchingRecipe ? "success" : "warning"} />
          </div>
        ) : null}
        <Card title="BOM / Recipe Requirement Preview" description="This preview uses the current active recipe. Actual production usage remains captured during completion.">
          {selectedParent && matchingRecipe ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                <div>Active Recipe: {activeRecipeLabel}</div>
                <div className="text-xs">Standard Output: {quantity(matchingRecipe.yield_quantity, matchingRecipe.uom)}</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-left">
                  <thead>
                    <tr className="border-b border-border bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
                      <th className="px-4 py-2.5">Raw Material</th>
                      <th className="px-4 py-2.5">Required Qty</th>
                      <th className="px-4 py-2.5">Available Balance</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bomRows.map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-3"><div className="font-semibold text-text-primary">{row.material_name}</div><div className="text-xs text-text-secondary">{row.material_code || "Raw material"}</div></td>
                        <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.required_qty, row.uom)}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-text-secondary">{quantity(row.balance, row.uom)}</td>
                        <td className="px-4 py-3"><Badge tone={row.enough ? "success" : "danger"}>{row.enough ? "Enough" : "Shortage"}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : selectedParent ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
              No active recipe found. You can still create the job order, but material usage must be entered manually during production.
            </div>
          ) : (
            <EmptyState title="Select a Finished Good" description="Choose a Finished Good and production quantity to preview active recipe requirements." />
          )}
        </Card>
        <Field label="Remarks">
          <textarea className={inputClass()} rows={3} value={form.remarks || ""} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value }))} />
        </Field>
      </form>
    </Modal>
  );
}



