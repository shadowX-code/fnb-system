import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import FloatingLayer from "../../../../components/ui/FloatingLayer.jsx";
import FeedXDatePicker from "../../components/FeedXDatePicker.jsx";
import SearchableSelect from "../../components/SearchableSelect.jsx";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import { todayInput, formatFactoryDate } from "../../utils/factoryDates.js";
import { percent, quantity, sopMinutesLabel, sopStepEstimatedMinutes, sopTotalEstimatedMinutes, validSopMinutes } from "../../utils/factoryFormatters.js";
import { jobStatusLabel } from "../../utils/factoryStatus.js";
import { productionSopDisplayName } from "../../utils/productionSop.js";

function emptySopQcCheck(index = 0) {
  return {
    id: `qc-${Date.now()}-${index}`,
    sequence_no: index + 1,
    qc_type: "checklist",
    checklist_template_id: "",
    qc_name: "",
    instructions: "",
    is_required: true,
    legacy_custom: false,
  };
}

function persistedSopStructureId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function emptySopStep(index = 0) {
  return {
    id: `step-${Date.now()}-${index}`,
    step_no: index + 1,
    step_name: "",
    description: "",
    estimated_time_minutes: "",
    ingredient_material_ids: [],
    qc_checks: [],
    remarks: "",
    sub_steps: [],
  };
}

function SopIngredientPicker({ ingredients = [], value = [], disabled = false, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const anchorRef = useRef(null);
  const selectedIds = new Set(value || []);
  const selectedIngredients = ingredients.filter((item) => selectedIds.has(item.raw_material_id));
  const visibleIngredients = ingredients.filter((item) => `${item.raw_material_name || ""} ${item.uom || ""}`.toLowerCase().includes(query.toLowerCase()));

  function toggleIngredient(rawMaterialId) {
    const next = new Set(value || []);
    if (next.has(rawMaterialId)) next.delete(rawMaterialId);
    else next.add(rawMaterialId);
    onChange([...next]);
  }

  return (
    <div>
      <button ref={anchorRef} className={`${inputClass()} min-h-[42px] text-left disabled:cursor-not-allowed disabled:opacity-70`} type="button" disabled={disabled || !ingredients.length} onClick={() => setOpen((current) => !current)}>
        {selectedIngredients.length ? <span className="flex flex-wrap gap-1.5">{selectedIngredients.map((item) => <span key={item.raw_material_id} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">{item.raw_material_name}</span>)}</span> : <span className="text-text-muted">{ingredients.length ? "Select recipe ingredients" : "No recipe ingredients"}</span>}
      </button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" minWidth={300} estimatedHeight={340} maxHeight={380}>
        <input className={inputClass()} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search recipe ingredients" autoFocus />
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {visibleIngredients.length ? visibleIngredients.map((item) => (
            <label key={item.raw_material_id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-primary/10">
              <input type="checkbox" checked={selectedIds.has(item.raw_material_id)} onChange={() => toggleIngredient(item.raw_material_id)} />
              <span className="min-w-0"><span className="block text-sm font-bold text-text-primary">{item.raw_material_name}</span><span className="block text-xs text-text-secondary">{quantity(item.quantity_used, item.uom)}</span></span>
            </label>
          )) : <div className="px-3 py-4 text-sm font-semibold text-text-secondary">No matching ingredients</div>}
        </div>
      </FloatingLayer>
    </div>
  );
}

export function ProductionSopBuilderModal({ initialValue, productFamilies = [], recipes = [], sops = [], equipment = [], qcChecklistTemplates = [], onClose, onSave }) {
  const isEdit = Boolean(initialValue?.id);
  const activeQcTemplates = qcChecklistTemplates.filter((template) => template.is_active !== false);
  const activeQcTemplateIds = new Set(activeQcTemplates.map((template) => template.id));
  const initialSteps = initialValue?.steps?.length
    ? initialValue.steps.map((step, index) => ({
        ...emptySopStep(index),
        ...step,
        id: step.id || `step-${Date.now()}-${index}`,
        step_no: index + 1,
        ingredient_material_ids: step.ingredient_material_ids || [],
        sub_steps: (step.sub_steps || []).map((subStep, subIndex) => ({ ...subStep, id: subStep.id || `sub-${Date.now()}-${index}-${subIndex}`, sequence_no: subIndex + 1 })),
        qc_checks: step.qc_checks?.length
          ? step.qc_checks.map((qc, qcIndex) => ({
              ...emptySopQcCheck(qcIndex),
              ...qc,
              id: qc.id || `qc-${Date.now()}-${index}-${qcIndex}`,
              sequence_no: qcIndex + 1,
              checklist_template_id: activeQcTemplateIds.has(qc.checklist_template_id) ? qc.checklist_template_id : "",
              legacy_custom: !activeQcTemplateIds.has(qc.checklist_template_id) && Boolean(qc.qc_name),
            }))
          : (step.qc_required || step.is_qc_checkpoint)
            ? [{ ...emptySopQcCheck(0), qc_name: step.qc_label || step.control_point || "QC Check", instructions: step.qc_target_value || "", legacy_custom: true }]
            : [],
      }))
    : [emptySopStep(0)];
  const productOptions = productFamilies
    .filter((family) => family.status === "active" || family.id === initialValue?.finished_good_id)
    .map((family) => ({ value: family.id, label: family.name_en, helper: family.name_cn || family.category || "Finished Good" }));
  const [form, setForm] = useState(() => ({
    sop_code: "",
    finished_good_id: "",
    product_name: "",
    recipe_id: "",
    recipe_version: "",
    version: "v1",
    effective_date: todayInput(),
    remarks: "",
    ...initialValue,
    title: initialValue?.title || initialValue?.sop_name || "",
    sop_name: initialValue?.sop_name || initialValue?.title || "",
    status: initialValue?.status || "draft",
    equipment_ids: initialValue?.equipment_ids || (initialValue?.equipment_links || []).map((link) => link.equipment_id),
    steps: initialSteps,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isLocked = isEdit && form.status !== "draft";
  const activeRecipe = useMemo(() => recipes.find((recipe) => recipe.product_family_id === form.finished_good_id && recipe.status === "active") || null, [recipes, form.finished_good_id]);
  const recipeReference = useMemo(() => {
    if (!form.recipe_id) return null;
    return recipes.find((recipe) => recipe.id === form.recipe_id) || (initialValue?.linked_recipe?.id === form.recipe_id ? initialValue.linked_recipe : null);
  }, [form.recipe_id, recipes, initialValue]);
  const recipeIngredients = recipeReference?.items || [];
  const recipeIngredientIds = new Set(recipeIngredients.map((item) => item.raw_material_id));
  const calculatedMinutes = form.steps.reduce((sum, step) => sum + sopStepEstimatedMinutes(step), 0);
  const qcPresetOptions = activeQcTemplates.map((template) => ({ value: template.id, label: template.name }));

  function nextVersionForFinishedGood(finishedGoodId) {
    const maxVersion = sops.filter((sop) => sop.finished_good_id === finishedGoodId).reduce((max, sop) => Math.max(max, Number(String(sop.version || "").replace(/\D/g, "")) || 0), 0);
    return `v${maxVersion + 1}`;
  }

  const resequenceSteps = (steps) => steps.map((step, index) => ({ ...step, step_no: index + 1 }));

  function updateStep(rowId, patch) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => (step.id === rowId ? { ...step, ...patch } : step)) }));
  }

  function addStep() {
    setForm((current) => ({ ...current, steps: [...current.steps, emptySopStep(current.steps.length)] }));
  }

  function removeStep(rowId) {
    setForm((current) => ({ ...current, steps: resequenceSteps(current.steps.filter((step) => step.id !== rowId)) }));
  }

  function moveStep(rowId, direction) {
    setForm((current) => {
      const index = current.steps.findIndex((step) => step.id === rowId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps: resequenceSteps(steps) };
    });
  }

  function duplicateStep(rowId) {
    setForm((current) => {
      const index = current.steps.findIndex((step) => step.id === rowId);
      if (index < 0) return current;
      const source = current.steps[index];
      const duplicate = {
        ...source,
        id: `step-${Date.now()}-${index}`,
        sub_steps: (source.sub_steps || []).map((subStep, subIndex) => ({ ...subStep, id: `sub-${Date.now()}-${index}-${subIndex}` })),
        qc_checks: (source.qc_checks || []).map((qc, qcIndex) => ({ ...qc, id: `qc-${Date.now()}-${index}-${qcIndex}` })),
      };
      const steps = [...current.steps];
      steps.splice(index + 1, 0, duplicate);
      return { ...current, steps: resequenceSteps(steps) };
    });
  }

  function addSubStep(stepId) {
    setForm((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === stepId ? { ...step, sub_steps: [...(step.sub_steps || []), { id: `sub-${Date.now()}-${step.sub_steps?.length || 0}`, sequence_no: (step.sub_steps?.length || 0) + 1, instruction: "", estimated_minutes: "", remarks: "" }] } : step),
    }));
  }

  function updateSubStep(stepId, subStepId, patch) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, sub_steps: (step.sub_steps || []).map((subStep) => subStep.id === subStepId ? { ...subStep, ...patch } : subStep) } : step) }));
  }

  function removeSubStep(stepId, subStepId) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, sub_steps: (step.sub_steps || []).filter((subStep) => subStep.id !== subStepId).map((subStep, index) => ({ ...subStep, sequence_no: index + 1 })) } : step) }));
  }

  function updateQcCheck(stepId, qcId, patch) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, qc_checks: (step.qc_checks || []).map((qc) => qc.id === qcId ? { ...qc, ...patch } : qc) } : step) }));
  }

  function addQcCheck(stepId) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, qc_checks: [...(step.qc_checks || []), emptySopQcCheck(step.qc_checks?.length || 0)] } : step) }));
  }

  function removeQcCheck(stepId, qcId) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, qc_checks: (step.qc_checks || []).filter((qc) => qc.id !== qcId).map((qc, index) => ({ ...qc, sequence_no: index + 1 })) } : step) }));
  }

  function moveQcCheck(stepId, qcId, direction) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => {
      if (step.id !== stepId) return step;
      const checks = [...(step.qc_checks || [])];
      const index = checks.findIndex((qc) => qc.id === qcId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= checks.length) return step;
      [checks[index], checks[target]] = [checks[target], checks[index]];
      return { ...step, qc_checks: checks.map((qc, qcIndex) => ({ ...qc, sequence_no: qcIndex + 1 })) };
    }) }));
  }

  function duplicateQcCheck(stepId, qcId) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => {
      if (step.id !== stepId) return step;
      const checks = [...(step.qc_checks || [])];
      const index = checks.findIndex((qc) => qc.id === qcId);
      if (index < 0) return step;
      checks.splice(index + 1, 0, { ...checks[index], id: `qc-${Date.now()}-${index}` });
      return { ...step, qc_checks: checks.map((qc, qcIndex) => ({ ...qc, sequence_no: qcIndex + 1 })) };
    }) }));
  }

  function selectQcPreset(stepId, qcId, templateId) {
    const template = activeQcTemplates.find((item) => item.id === templateId);
    if (!template) return;
    updateQcCheck(stepId, qcId, {
      checklist_template_id: template.id,
      qc_name: template.name,
      qc_type: template.result_mode || "checklist",
      instructions: template.description || "",
      legacy_custom: false,
    });
  }

  function selectFinishedGood(finishedGoodId) {
    const product = productFamilies.find((family) => family.id === finishedGoodId);
    const nextRecipe = recipes.find((recipe) => recipe.product_family_id === finishedGoodId && recipe.status === "active") || null;
    setForm((current) => ({ ...current, finished_good_id: finishedGoodId, product_name: product?.name_en || "", version: isEdit ? current.version : nextVersionForFinishedGood(finishedGoodId), recipe_id: nextRecipe?.id || "", recipe_version: nextRecipe?.version || "", steps: current.steps.map((step) => ({ ...step, ingredient_material_ids: [] })) }));
  }

  function linkActiveRecipe() {
    if (!activeRecipe) return;
    setForm((current) => ({ ...current, recipe_id: activeRecipe.id, recipe_version: activeRecipe.version || "", steps: current.steps.map((step) => ({ ...step, ingredient_material_ids: [] })) }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (isLocked) return setError("Only draft SOPs can be edited.");
    if (!form.finished_good_id) return setError("Finished Good is required.");
    if (!form.steps.length) return setError("At least one SOP step is required.");
    for (let index = 0; index < form.steps.length; index += 1) {
      const step = form.steps[index];
      if (!String(step.step_name || step.process_name || "").trim()) return setError(`Step ${index + 1} requires a Step Name.`);
      if (!(step.sub_steps || []).length && !validSopMinutes(step.estimated_time_minutes)) return setError(`Step ${index + 1} minutes must be a non-negative whole number.`);
      const invalidQc = (step.qc_checks || []).findIndex((qc) => !["checklist", "remarks"].includes(qc.qc_type) || !String(qc.qc_name || "").trim() || (!qc.checklist_template_id && !persistedSopStructureId(qc.id)));
      if (invalidQc >= 0) return setError(`Step ${index + 1} QC ${invalidQc + 1} requires a QC Check preset.`);
      const emptySubStep = (step.sub_steps || []).findIndex((subStep) => !String(subStep.instruction || "").trim());
      if (emptySubStep >= 0) return setError(`Sub-step ${index + 1}.${emptySubStep + 1} requires an instruction.`);
      const invalidSubStepMinutes = (step.sub_steps || []).findIndex((subStep) => !validSopMinutes(subStep.estimated_minutes));
      if (invalidSubStepMinutes >= 0) return setError(`Sub-step ${index + 1}.${invalidSubStepMinutes + 1} minutes must be a non-negative whole number.`);
      if ((step.ingredient_material_ids || []).some((materialId) => !recipeIngredientIds.has(materialId))) return setError(`Step ${index + 1} contains an ingredient outside the linked Product Recipe.`);
    }
    const product = productFamilies.find((family) => family.id === form.finished_good_id);
    const productName = product?.name_en || form.product_name || "Finished Good";
    const sopName = `${productName} Production SOP · ${form.version || "v1"}`;
    setSaving(true);
    try {
      await onSave({ ...form, title: sopName, sop_name: sopName, product_name: productName, estimated_minutes: calculatedMinutes });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isEdit ? "Edit Production SOP" : "Create Production SOP"} description="Build the production process. Ingredient quantities and costing remain controlled by Product Recipes / BOM." size="2xl" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>{!isLocked ? <button className="btn-primary" type="submit" form="factory-sop-builder-form" disabled={saving}>{saving ? "Saving..." : "Save SOP"}</button> : null}</>}>
      <form id="factory-sop-builder-form" className="space-y-6" onSubmit={submit}>
        {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <section>
          <div className="mb-3 text-sm font-black text-text-primary">SOP Header</div>
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Finished Good *"><SearchableSelect value={form.finished_good_id || ""} options={productOptions} placeholder="Select Finished Good" searchPlaceholder="Search finished goods" emptyText="No finished goods" disabled={isLocked} onChange={selectFinishedGood} /></Field>
            <Field label="Version"><div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-sm font-bold text-text-primary">{form.version || "v1"}</div></Field>
            <Field label="Estimated Time"><div className="rounded-xl border border-border bg-slate-50 px-3 py-2"><div className="text-sm font-bold text-text-primary">{sopMinutesLabel(calculatedMinutes)}</div><div className="text-[10.5px] font-semibold text-text-muted">Calculated from process steps</div></div></Field>
            <Field label="Effective Date"><FeedXDatePicker value={form.effective_date || ""} disabled={isLocked} onChange={(nextDate) => setForm((current) => ({ ...current, effective_date: nextDate }))} /></Field>
            <Field label="Status"><div className="rounded-xl border border-border bg-slate-50 px-3 py-2"><Badge tone={form.status === "active" ? "success" : form.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(form.status)}</Badge></div></Field>
          </div>
          <div className="mt-3"><Field label="Remarks"><textarea className={inputClass()} rows={2} value={form.remarks || form.notes || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value, notes: event.target.value }))} /></Field></div>
          <div className="mt-3"><Field label="Equipment"><div className="grid gap-2 sm:grid-cols-2">{equipment.filter((item) => item.status === "active" || form.equipment_ids.includes(item.id)).map((item) => <label key={item.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><input type="checkbox" disabled={isLocked || item.status !== "active"} checked={form.equipment_ids.includes(item.id)} onChange={(event) => setForm((current) => ({ ...current, equipment_ids: event.target.checked ? [...new Set([...current.equipment_ids, item.id])] : current.equipment_ids.filter((id) => id !== item.id) }))} /><span><span className="font-bold text-text-primary">{item.equipment_code} · {item.name}</span><span className="block text-xs text-text-secondary">{item.location?.location_name || ""}</span></span></label>)}</div></Field></div>
        </section>

        <section className="border-y border-border bg-slate-50 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-sm font-black text-text-primary">Recipe Reference</div><div className="mt-1 text-xs font-semibold text-text-secondary">Read-only ingredient reference pinned to this SOP version.</div></div>{!recipeReference && isEdit && activeRecipe && !isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={linkActiveRecipe}>Link Active Recipe</button> : null}</div>
          {recipeReference ? <div className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3"><div><div className="text-[10.5px] font-semibold text-text-muted">Active Recipe</div><div className="mt-1 text-sm font-bold text-text-primary">{recipeReference.version || form.recipe_version || "—"}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Standard Output</div><div className="mt-1 text-sm font-bold text-text-primary">{quantity(recipeReference.yield_quantity, recipeReference.uom)}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Ingredients</div><div className="mt-1 text-sm font-bold text-text-primary">{recipeIngredients.length}</div></div></div>
            <div className="hidden overflow-hidden rounded-xl border border-border bg-white sm:block"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border bg-slate-50 text-xs font-semibold text-text-secondary"><th className="px-3 py-2">Ingredient</th><th className="px-3 py-2">Recipe Qty</th><th className="px-3 py-2">UOM</th><th className="px-3 py-2">Wastage</th></tr></thead><tbody>{recipeIngredients.map((item) => <tr key={item.id || item.raw_material_id} className="border-b border-border last:border-0"><td className="px-3 py-2 font-bold text-text-primary">{item.raw_material_name || "Raw Material"}</td><td className="px-3 py-2">{Number(item.quantity_used || 0).toLocaleString("en-MY", { maximumFractionDigits: 4 })}</td><td className="px-3 py-2">{item.uom || "—"}</td><td className="px-3 py-2">{percent(item.wastage_percent)}</td></tr>)}</tbody></table></div>
            <div className="space-y-2 sm:hidden">{recipeIngredients.map((item) => <div key={item.id || item.raw_material_id} className="rounded-xl border border-border bg-white p-3"><div className="font-bold text-text-primary">{item.raw_material_name || "Raw Material"}</div><div className="mt-1 text-xs font-semibold text-text-secondary">{quantity(item.quantity_used, item.uom)} · Wastage {percent(item.wastage_percent)}</div></div>)}</div>
          </div> : <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><div className="text-sm font-bold text-amber-900">No Active Recipe</div><div className="mt-1 text-xs font-semibold text-amber-800">Activate a Product Recipe before using ingredient references in this SOP.</div></div>}
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-black text-text-primary">SOP Steps</div><div className="mt-1 text-xs font-semibold text-text-secondary">Steps re-sequence automatically after moving or removing.</div></div>{!isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={addStep}><Plus size={14} /> Add Step</button> : null}</div>
          <div className="space-y-4">{form.steps.map((step, index) => {
            const hasSubSteps = Boolean(step.sub_steps?.length);
            const stepMinutes = sopStepEstimatedMinutes(step);
            return <article key={step.id} className="rounded-xl border border-border bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-black text-white">{index + 1}</span><div><div className="text-sm font-black text-text-primary">Step {index + 1}</div><div className="text-xs font-semibold text-text-secondary">{step.step_name || "Unnamed process step"}</div></div></div>{!isLocked ? <div className="flex flex-wrap gap-1"><button className="icon-btn" title="Move step up" type="button" disabled={index === 0} onClick={() => moveStep(step.id, -1)}><ArrowUp size={15} /></button><button className="icon-btn" title="Move step down" type="button" disabled={index === form.steps.length - 1} onClick={() => moveStep(step.id, 1)}><ArrowDown size={15} /></button><button className="icon-btn" title="Duplicate step" type="button" onClick={() => duplicateStep(step.id)}><Copy size={15} /></button><button className="icon-btn text-rose-600" title="Remove step" type="button" disabled={form.steps.length === 1} onClick={() => removeStep(step.id)}><Trash2 size={15} /></button></div> : null}</div>
              <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]"><Field label="Step Name *"><input className={inputClass()} value={step.step_name || step.process_name || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { step_name: event.target.value, process_name: event.target.value })} /></Field><Field label="Estimated Minutes"><input className={inputClass()} type="number" min="0" step="1" value={hasSubSteps ? stepMinutes : step.estimated_time_minutes ?? ""} disabled={isLocked || hasSubSteps} onChange={(event) => updateStep(step.id, { estimated_time_minutes: event.target.value })} />{hasSubSteps ? <div className="mt-1 text-[10.5px] font-semibold text-text-muted">Calculated from sub-steps</div> : null}</Field></div>
              <div className="mt-3"><Field label="Description"><textarea className={inputClass()} rows={3} value={step.description || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { description: event.target.value })} /></Field></div>
              <div className="mt-3"><Field label="Ingredient References"><SopIngredientPicker ingredients={recipeIngredients} value={step.ingredient_material_ids || []} disabled={isLocked || !recipeReference} onChange={(ingredientMaterialIds) => updateStep(step.id, { ingredient_material_ids: ingredientMaterialIds })} /></Field><div className="mt-1 text-[10.5px] font-semibold text-text-muted">Reference only. Recipe quantities, costing and stock movements are unchanged.</div></div>
              <div className="mt-4 border-t border-border pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-xs font-black text-text-primary">QC Checks</div><div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">The selected QC preset determines the Production input.</div></div>{!isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => addQcCheck(step.id)}><Plus size={13} /> Add QC Check</button> : null}</div>
                {step.qc_checks?.length ? <div className="mt-3 space-y-3">{step.qc_checks.map((qc, qcIndex) => (
                  <div key={qc.id} className="rounded-xl border border-border bg-slate-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs font-black text-primary">QC {qcIndex + 1}</div>{!isLocked ? <div className="flex gap-1"><button className="icon-btn" title="Move QC up" type="button" disabled={qcIndex === 0} onClick={() => moveQcCheck(step.id, qc.id, -1)}><ArrowUp size={14} /></button><button className="icon-btn" title="Move QC down" type="button" disabled={qcIndex === step.qc_checks.length - 1} onClick={() => moveQcCheck(step.id, qc.id, 1)}><ArrowDown size={14} /></button><button className="icon-btn" title="Duplicate QC" type="button" onClick={() => duplicateQcCheck(step.id, qc.id)}><Copy size={14} /></button><button className="icon-btn text-rose-600" title="Remove QC" type="button" onClick={() => removeQcCheck(step.id, qc.id)}><Trash2 size={14} /></button></div> : null}</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="QC Check *"><SearchableSelect value={qc.checklist_template_id || (qc.legacy_custom ? `legacy-${qc.id}` : "")} options={qc.legacy_custom ? [{ value: `legacy-${qc.id}`, label: `${qc.qc_name} (Custom / Legacy QC)` }, ...qcPresetOptions] : qcPresetOptions} placeholder="Select QC Check" searchPlaceholder="Search QC checks" emptyText="No active QC presets" disabled={isLocked} onChange={(value) => selectQcPreset(step.id, qc.id, value)} /></Field><Field label="Instructions"><textarea className={inputClass()} rows={2} value={qc.instructions || ""} disabled={isLocked} onChange={(event) => updateQcCheck(step.id, qc.id, { instructions: event.target.value })} /></Field></div>
                    <label className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-text-secondary"><input type="checkbox" checked={qc.is_required !== false} disabled={isLocked} onChange={(event) => updateQcCheck(step.id, qc.id, { is_required: event.target.checked })} /> Required before production completion</label>
                  </div>
                ))}</div> : <div className="mt-3 text-xs font-semibold text-text-muted">No QC checks for this step.</div>}
              </div>
              <div className="mt-4 border-t border-border pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="text-xs font-black text-text-primary">Sub-steps</div>{!isLocked ? <button className="btn-secondary px-3 py-1.5 text-xs" type="button" onClick={() => addSubStep(step.id)}><Plus size={13} /> Add Sub-step</button> : null}</div>{step.sub_steps?.length ? <div className="mt-3 space-y-2">{step.sub_steps.map((subStep, subIndex) => <div key={subStep.id} className="grid gap-2 rounded-xl bg-slate-50 p-3 md:grid-cols-[48px_minmax(0,1fr)_140px_minmax(0,0.7fr)_36px]"><div className="pt-2 text-sm font-black text-primary">{index + 1}.{subIndex + 1}</div><input className={inputClass()} placeholder="Instruction *" value={subStep.instruction || ""} disabled={isLocked} onChange={(event) => updateSubStep(step.id, subStep.id, { instruction: event.target.value })} /><input className={inputClass()} type="number" min="0" step="1" placeholder="Minutes" value={subStep.estimated_minutes ?? ""} disabled={isLocked} onChange={(event) => updateSubStep(step.id, subStep.id, { estimated_minutes: event.target.value })} /><input className={inputClass()} placeholder="Remarks" value={subStep.remarks || ""} disabled={isLocked} onChange={(event) => updateSubStep(step.id, subStep.id, { remarks: event.target.value })} />{!isLocked ? <button className="icon-btn text-rose-600" title="Remove sub-step" type="button" onClick={() => removeSubStep(step.id, subStep.id)}><Trash2 size={14} /></button> : null}</div>)}</div> : <div className="mt-3 text-xs font-semibold text-text-muted">No sub-steps added.</div>}</div>
              <div className="mt-4"><Field label="Step Remarks"><textarea className={inputClass()} rows={2} value={step.remarks || step.safety_note || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { remarks: event.target.value, safety_note: event.target.value })} /></Field></div>
            </article>;
          })}</div>
        </section>
      </form>
    </Modal>
  );
}

export function ProductionSopDocumentModal({ sop, onClose }) {
  const steps = [...(sop.steps || [])].sort((a, b) => Number(a.step_no || 0) - Number(b.step_no || 0));
  const qcCount = steps.reduce((count, step) => count + (step.qc_checks?.length || ((step.qc_required || step.is_qc_checkpoint) ? 1 : 0)), 0);
  const recipe = sop.linked_recipe;
  const referencedIngredientCount = new Set(steps.flatMap((step) => step.ingredient_material_ids || [])).size;
  const totalEstimatedMinutes = sopTotalEstimatedMinutes({ ...sop, steps });
  return (
    <Modal title={productionSopDisplayName(sop)} description="Read-only standard process reference" size="2xl" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
      <div className="space-y-6">
        <section className="border-b border-border pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-xl font-black text-text-primary">{productionSopDisplayName(sop)}</div>{sop.product_name_cn ? <div className="mt-1 text-sm font-semibold text-text-secondary">{sop.product_name_cn}</div> : null}</div><Badge tone={sop.status === "active" ? "success" : sop.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(sop.status)}</Badge></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[["Version", sop.version || "v1"], ["Estimated Time", sopMinutesLabel(totalEstimatedMinutes)], ["Effective Date", formatFactoryDate(sop.effective_date)], ["Steps", steps.length], ["QC Points", qcCount], ["Updated", formatFactoryDate(sop.updated_at)]].map(([label, value]) => <div key={label}><div className="text-[10.5px] font-semibold text-text-muted">{label}</div><div className="mt-1 text-sm font-bold text-text-primary">{value}</div></div>)}</div>
          {sop.remarks || sop.notes ? <div className="mt-4 max-w-[70ch] text-sm font-semibold text-text-secondary">{sop.remarks || sop.notes}</div> : null}
        </section>

        <section className="bg-slate-50 px-4 py-4 sm:px-5">
          <div className="text-sm font-black text-text-primary">Recipe Reference</div>
          {recipe ? <div className="mt-3 grid gap-3 sm:grid-cols-3"><div><div className="text-[10.5px] font-semibold text-text-muted">Linked Recipe</div><div className="mt-1 text-sm font-bold text-text-primary">{recipe.recipe_name && recipe.recipe_name !== recipe.version ? `${recipe.recipe_name} ${sop.recipe_version || recipe.version}` : sop.recipe_version || recipe.version}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Standard Output</div><div className="mt-1 text-sm font-bold text-text-primary">{quantity(recipe.yield_quantity, recipe.uom)}</div></div><div><div className="text-[10.5px] font-semibold text-text-muted">Referenced Ingredients</div><div className="mt-1 text-sm font-bold text-text-primary">{referencedIngredientCount} of {recipe.items?.length || 0}</div></div></div> : <div className="mt-3"><div className="text-sm font-bold text-text-primary">No Recipe Linked</div><div className="mt-1 text-xs font-semibold text-text-secondary">This SOP predates recipe snapshot linking or was saved without an active recipe.</div></div>}
        </section>

        <section>
          <div className="mb-3 text-sm font-black text-text-primary">SOP Timeline</div>
          <div className="relative space-y-4 before:absolute before:bottom-4 before:left-4 before:top-4 before:w-px before:bg-border sm:before:left-5">
            {steps.length ? steps.map((step) => {
              const qcChecks = step.qc_checks?.length ? step.qc_checks : (step.qc_required || step.is_qc_checkpoint) ? [{ id: `legacy-${step.id}`, qc_type: "checklist", qc_name: step.qc_label || step.control_point || "QC Check", instructions: step.qc_target_value || "", is_required: true, legacy: true }] : [];
              const stepMinutes = sopStepEstimatedMinutes(step);
              return (
                <article key={step.id} className="relative ml-10 rounded-xl border border-border bg-white p-4 sm:ml-12 sm:p-5">
                  <span className="absolute -left-[34px] top-4 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-black text-white sm:-left-[40px]">{step.step_no}</span>
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-base font-black text-text-primary">{step.step_name || step.process_name || "Unnamed Step"}</div><div className="mt-1 text-xs font-bold text-text-secondary">Step Time: {sopMinutesLabel(stepMinutes)}</div>{step.sub_steps?.length ? <div className="mt-0.5 text-[10.5px] font-semibold text-text-muted">Calculated from {step.sub_steps.length} sub-step{step.sub_steps.length === 1 ? "" : "s"}</div> : null}</div>{qcChecks.length ? <Badge tone="warning">{qcChecks.length} QC {qcChecks.length === 1 ? "Check" : "Checks"}</Badge> : <Badge tone="neutral">Process Step</Badge>}</div>
                  {step.description ? <div className="mt-3 max-w-[75ch] text-sm font-semibold text-text-secondary">{step.description}</div> : null}
                  {step.ingredient_references?.length ? <div className="mt-3"><div className="text-[10.5px] font-semibold text-text-muted">Recipe Ingredients</div><div className="mt-1.5 flex flex-wrap gap-1.5">{step.ingredient_references.map((item) => <span key={item.raw_material_id} className="rounded-full bg-primary/10 px-2 py-1 text-xs font-bold text-primary">{item.raw_material_name}</span>)}</div></div> : null}
                  {step.sub_steps?.length ? <div className="mt-4 space-y-2">{step.sub_steps.map((subStep, index) => <div key={subStep.id} className="flex gap-3 rounded-lg bg-slate-50 px-3 py-2"><span className="shrink-0 text-xs font-black text-primary">{step.step_no}.{index + 1}</span><div className="min-w-0"><div className="text-sm font-semibold text-text-primary">{subStep.instruction}</div><div className="mt-0.5 flex flex-wrap gap-3 text-xs font-semibold text-text-secondary"><span>{sopMinutesLabel(subStep.estimated_minutes)}</span>{subStep.remarks ? <span>{subStep.remarks}</span> : null}</div></div></div>)}</div> : null}
                  {qcChecks.length ? <div className="mt-4 border-t border-border pt-3"><div className="text-xs font-black text-text-primary">QC Checks</div><div className="mt-2 grid gap-2 sm:grid-cols-2">{qcChecks.map((qc) => <div key={qc.id} className="rounded-lg bg-slate-50 px-3 py-2"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-bold text-text-primary">{qc.qc_name}</div>{qc.instructions ? <div className="mt-1 text-xs font-semibold text-text-secondary">{qc.instructions}</div> : null}</div>{qc.is_required ? <Badge tone="warning">Required</Badge> : <Badge tone="neutral">Optional</Badge>}</div></div>)}</div></div> : null}
                  {step.remarks || step.safety_note ? <div className="mt-3 text-xs font-semibold text-text-secondary">Remarks: {step.remarks || step.safety_note}</div> : null}
                </article>
              );
            }) : <EmptyState title="No SOP steps" description="This SOP has no saved process steps." />}
          </div>
        </section>
      </div>
    </Modal>
  );
}

export function QcChecklistPresetManagerModal({ templates = [], sops = [], onClose, onCreate, onUpdate, onArchive, onRestore, onDelete }) {
  const emptyForm = { id: "", name: "", result_mode: "checklist", description: "", is_active: true };
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const referenceCounts = useMemo(() => {
    const counts = new Map();
    sops.forEach((sop) => (sop.steps || []).forEach((step) => (step.qc_checks || []).forEach((qc) => {
      if (qc.checklist_template_id) counts.set(qc.checklist_template_id, (counts.get(qc.checklist_template_id) || 0) + 1);
    })));
    return counts;
  }, [sops]);
  const orderedTemplates = [...templates].sort((a, b) => Number(b.is_active !== false) - Number(a.is_active !== false) || String(a.name || "").localeCompare(String(b.name || "")));
  const resultModeOptions = [
    { value: "checklist", label: "Checklist" },
    { value: "remarks", label: "Remarks" },
  ];

  function beginEdit(template) {
    setError("");
    setForm({
      id: template.id,
      name: template.name || "",
      result_mode: template.result_mode || "checklist",
      description: template.description || "",
      is_active: template.is_active !== false,
    });
  }

  function resetForm() {
    setError("");
    setForm(emptyForm);
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.name || "").trim()) return setError("QC Check Name is required.");
    setSaving(true);
    try {
      if (form.id) await onUpdate(form);
      else await onCreate(form);
      resetForm();
    } catch (nextError) {
      setError(nextError.message || "Unable to save QC Checklist Preset.");
    } finally {
      setSaving(false);
    }
  }

  async function runLifecycle(action, template) {
    setError("");
    setSaving(true);
    try {
      await action(template);
      if (form.id === template.id) resetForm();
    } catch (nextError) {
      setError(nextError.message || "Unable to update QC Checklist Preset.");
    } finally {
      setSaving(false);
    }
  }

  function requestDelete(template) {
    if (!window.confirm(`Delete unused QC check "${template.name}"?`)) return;
    runLifecycle(onDelete, template);
  }

  return (
    <Modal title="QC Checklist Presets" description="Manage reusable QC checks for Production SOP steps." size="2xl" onClose={saving ? undefined : onClose} footer={<button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Close</button>}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.4fr)]">
        <form className="space-y-4" onSubmit={submit}>
          <div>
            <div className="text-sm font-black text-text-primary">{form.id ? "Edit QC Check" : "Create QC Check"}</div>
            <div className="mt-1 text-xs font-semibold text-text-secondary">Preset instructions provide a starting point and remain editable in each Draft SOP.</div>
          </div>
          {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
          <Field label="QC Check Name *"><input className={inputClass()} value={form.name} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
          <Field label="Result Mode"><SearchableSelect value={form.result_mode} options={resultModeOptions} placeholder="Select result mode" disabled={saving} onChange={(value) => setForm((current) => ({ ...current, result_mode: value }))} /></Field>
          <Field label="Default Instructions"><textarea className={inputClass()} rows={4} value={form.description} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field>
          <Field label="Status"><div className="rounded-xl border border-border bg-slate-50 px-3 py-2"><Badge tone={form.is_active ? "success" : "neutral"}>{form.is_active ? "Active" : "Archived"}</Badge></div></Field>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Save QC Check" : "Create QC Check"}</button>
            {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={resetForm}>Cancel Edit</button> : null}
          </div>
        </form>

        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3"><div><div className="text-sm font-black text-text-primary">Preset Records</div><div className="mt-1 text-xs font-semibold text-text-secondary">Archived checks remain visible in historical SOPs.</div></div><Badge tone="neutral">{templates.length}</Badge></div>
          {orderedTemplates.length ? <div className="space-y-2">
            {orderedTemplates.map((template) => {
              const references = referenceCounts.get(template.id) || 0;
              const active = template.is_active !== false;
              return <article key={template.id} className="rounded-xl border border-border bg-white p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><div className="font-bold text-text-primary">{template.name}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-text-secondary"><span>{template.result_mode === "remarks" ? "Remarks" : "Checklist"}</span><span>{references} SOP reference{references === 1 ? "" : "s"}</span></div>{template.description ? <div className="mt-2 text-sm font-semibold text-text-secondary">{template.description}</div> : null}</div>
                  <Badge tone={active ? "success" : "neutral"}>{active ? "Active" : "Archived"}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={saving} onClick={() => beginEdit(template)}>Edit</button>
                  {active ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" disabled={saving} onClick={() => runLifecycle(onArchive, template)}>Archive</button> : <button className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50" type="button" disabled={saving} onClick={() => runLifecycle(onRestore, template)}>Restore</button>}
                  {!references ? <button className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50" type="button" disabled={saving} onClick={() => requestDelete(template)}>Delete</button> : null}
                </div>
              </article>;
            })}
          </div> : <EmptyState title="No QC Checklist Presets" description="Create a reusable QC check for Production SOP steps." />}
        </section>
      </div>
    </Modal>
  );
}
