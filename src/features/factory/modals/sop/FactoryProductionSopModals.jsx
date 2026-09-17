import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, ListTree, Plus, Settings2, Trash2 } from "lucide-react";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import FloatingLayer from "../../../../components/ui/FloatingLayer.jsx";
import FeedXDatePicker from "../../components/FeedXDatePicker.jsx";
import FactoryMasterDataManagerModal from "../../components/FactoryMasterDataManagerModal.jsx";
import FactoryRowActions from "../../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../../components/FactoryStatusBadge.jsx";
import SearchableSelect from "../../components/SearchableSelect.jsx";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import { FactoryCellMuted, FactoryCellText } from "../../components/FactoryTableCell.jsx";
import { todayInput, formatFactoryDate } from "../../utils/factoryDates.js";
import { percent, quantity, sopMinutesLabel, sopStepEstimatedMinutes, sopTotalEstimatedMinutes, validSopMinutes } from "../../utils/factoryFormatters.js";
import { jobStatusLabel } from "../../utils/factoryStatus.js";
import { productionSopRecipeDiff } from "../../utils/productionSop.js";
import { finishedGoodFamiliesWithoutRecords } from "../../utils/factoryFamilyEligibility.js";

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

function equipmentSecondaryLabel(equipment) {
  return [equipment?.location?.location_name || equipment?.location_name, equipment?.equipment_code || equipment?.code].filter(Boolean).join(" · ");
}

function meaningfulSopMinutesLabel(minutes) {
  return Number(minutes || 0) > 0 ? sopMinutesLabel(minutes) : null;
}

function RecipeUpdateReview({ currentRecipe, nextRecipe, saving, onUpdate }) {
  const diff = productionSopRecipeDiff(currentRecipe, nextRecipe);
  const hasChanges = diff.standardOutputChanged || diff.added.length || diff.removed.length || diff.quantityChanges.length;
  return <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold text-text-primary">Review Recipe update</div><div className="mt-0.5 text-xs text-text-secondary">Recipe {currentRecipe.version || "—"} to Recipe {nextRecipe.version || "—"}. SOP steps, sub-steps, Equipment, and QC remain unchanged.</div></div><button className="btn-primary px-2.5 py-1.5 text-xs" type="button" disabled={saving} onClick={onUpdate}>{saving ? "Updating..." : `Update Draft to Recipe ${nextRecipe.version || ""}`}</button></div>
    {hasChanges ? <div className="mt-3 grid gap-3 text-xs text-text-secondary sm:grid-cols-2">
      <div><div className="font-semibold text-text-primary">Standard Output</div><div className="mt-1">{diff.standardOutputChanged ? `${diff.currentOutput} to ${diff.nextOutput}` : diff.nextOutput || "Unchanged"}</div></div>
      <div><div className="font-semibold text-text-primary">Materials</div><div className="mt-1">{diff.currentMaterialCount} to {diff.nextMaterialCount} ingredients</div></div>
      {diff.added.length ? <div><div className="font-semibold text-text-primary">Added materials</div><div className="mt-1 space-y-1">{diff.added.map((item) => <div key={item.raw_material_id}>{item.name} · {item.quantity}</div>)}</div></div> : null}
      {diff.removed.length ? <div><div className="font-semibold text-text-primary">Removed materials</div><div className="mt-1 space-y-1">{diff.removed.map((item) => <div key={item.raw_material_id}>{item.name} · {item.quantity}</div>)}</div></div> : null}
      {diff.quantityChanges.length ? <div className="sm:col-span-2"><div className="font-semibold text-text-primary">Quantity changes</div><div className="mt-1 space-y-1">{diff.quantityChanges.map((item) => <div key={item.raw_material_id}>{item.name} · {item.previous} to {item.next}</div>)}</div></div> : null}
    </div> : <div className="mt-3 text-xs text-text-secondary">No material or output changes were detected.</div>}
  </div>;
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

export function ProductionSopBuilderModal({ initialValue, productFamilies = [], recipes = [], sops = [], equipment = [], qcChecklistTemplates = [], onClose, onSave, onUpdateRecipe }) {
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
  const eligibleProductFamilies = finishedGoodFamiliesWithoutRecords(productFamilies, sops, initialValue?.finished_good_id);
  const productOptions = eligibleProductFamilies
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
  const [settingsOpen, setSettingsOpen] = useState(!isEdit);
  const [recipeDetailsOpen, setRecipeDetailsOpen] = useState(false);
  const [recipeUpdateReviewOpen, setRecipeUpdateReviewOpen] = useState(false);
  const [updatingRecipe, setUpdatingRecipe] = useState(false);
  const [recipeUpdateError, setRecipeUpdateError] = useState("");
  const [expandedStepIds, setExpandedStepIds] = useState(() => new Set(isEdit ? [] : initialSteps.slice(0, 1).map((step) => step.id)));
  const [expandedQcIds, setExpandedQcIds] = useState(new Set());
  const headerRef = useRef(null);
  const stepRefs = useRef(new Map());
  const isLocked = isEdit && form.status !== "draft";
  const activeRecipe = useMemo(() => recipes.find((recipe) => recipe.product_family_id === form.finished_good_id && recipe.status === "active") || null, [recipes, form.finished_good_id]);
  const recipeReference = useMemo(() => {
    if (!form.recipe_id) return null;
    return recipes.find((recipe) => recipe.id === form.recipe_id) || (initialValue?.linked_recipe?.id === form.recipe_id ? initialValue.linked_recipe : null);
  }, [form.recipe_id, recipes, initialValue]);
  const recipeIngredients = recipeReference?.items || [];
  const recipeIngredientIds = new Set(recipeIngredients.map((item) => item.raw_material_id));
  const recipeUpdateAvailable = isEdit && form.status === "draft" && Boolean(activeRecipe && recipeReference && activeRecipe.id !== recipeReference.id);
  const referencedIngredientIds = new Set(form.steps.flatMap((step) => step.ingredient_material_ids || []));
  const ingredientsNeedingReview = form.recipe_id === activeRecipe?.id ? recipeIngredients.filter((item) => !referencedIngredientIds.has(item.raw_material_id)) : [];
  const calculatedMinutes = form.steps.reduce((sum, step) => sum + sopStepEstimatedMinutes(step), 0);
  const totalSubSteps = form.steps.reduce((sum, step) => sum + (step.sub_steps?.length || 0), 0);
  const totalQcChecks = form.steps.reduce((sum, step) => sum + (step.qc_checks?.length || 0), 0);
  const qcPresetOptions = activeQcTemplates.map((template) => ({ value: template.id, label: template.name }));

  if (!isEdit && !eligibleProductFamilies.length) {
    return <Modal title="Create Production SOP" description="All Finished Goods already have an SOP. Create a new version from an existing SOP instead." size="md" onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}><EmptyState title="No eligible Finished Goods" description="All Finished Goods already have an SOP. Create a new version from an existing SOP instead." /></Modal>;
  }

  function nextVersionForFinishedGood(finishedGoodId) {
    const maxVersion = sops.filter((sop) => sop.finished_good_id === finishedGoodId).reduce((max, sop) => Math.max(max, Number(String(sop.version || "").replace(/\D/g, "")) || 0), 0);
    return `v${maxVersion + 1}`;
  }

  const resequenceSteps = (steps) => steps.map((step, index) => ({ ...step, step_no: index + 1 }));

  function updateStep(rowId, patch) {
    setForm((current) => ({ ...current, steps: current.steps.map((step) => (step.id === rowId ? { ...step, ...patch } : step)) }));
  }

  function addStep() {
    const nextStep = emptySopStep(form.steps.length);
    setForm((current) => ({ ...current, steps: [...current.steps, nextStep] }));
    setExpandedStepIds((current) => new Set([...current, nextStep.id]));
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
    const nextCheck = emptySopQcCheck(form.steps.find((step) => step.id === stepId)?.qc_checks?.length || 0);
    setForm((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, qc_checks: [...(step.qc_checks || []), nextCheck] } : step) }));
    setExpandedQcIds((current) => new Set([...current, nextCheck.id]));
  }

  function toggleStep(stepId) {
    setExpandedStepIds((current) => {
      const next = new Set(current);
      if (next.has(stepId)) next.delete(stepId);
      else next.add(stepId);
      return next;
    });
  }

  function focusBuilderSection(stepId) {
    if (!stepId) {
      headerRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return;
    }
    setExpandedStepIds((current) => new Set([...current, stepId]));
    window.requestAnimationFrame(() => stepRefs.current.get(stepId)?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
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

  async function updateDraftToActiveRecipe() {
    if (!activeRecipe || !onUpdateRecipe || updatingRecipe) return;
    setRecipeUpdateError("");
    setUpdatingRecipe(true);
    try {
      const saved = await onUpdateRecipe(form, activeRecipe);
      setForm((current) => ({ ...current, recipe_id: saved.recipe_id, recipe_version: saved.recipe_version, linked_recipe: saved.linked_recipe || activeRecipe }));
      setRecipeUpdateReviewOpen(false);
    } catch (nextError) {
      setRecipeUpdateError(nextError.message || "Unable to update the Draft SOP Recipe.");
    } finally {
      setUpdatingRecipe(false);
    }
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
    <Modal title={isEdit ? "Edit Production SOP" : "Create Production SOP"} description="Build the process without changing Recipe quantities, costing, or stock movements." size="2xl" panelClassName="max-w-[1040px]" bodyClassName="p-0" onClose={saving ? undefined : onClose} footer={<><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>{!isLocked ? <button className="btn-primary" type="submit" form="factory-sop-builder-form" disabled={saving}>{saving ? "Saving..." : "Save SOP"}</button> : null}</>}>
      <form id="factory-sop-builder-form" className="min-h-0" onSubmit={submit}>
        {error ? <div className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
        <section ref={headerRef} className="border-b border-border px-4 py-4 sm:px-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(240px,1.2fr)_repeat(4,minmax(0,0.72fr))]">
            <Field label="Finished Good *"><SearchableSelect value={form.finished_good_id || ""} options={productOptions} placeholder="Select Finished Good" searchPlaceholder="Search eligible finished goods" emptyText="All Finished Goods already have an SOP. Create a new version from an existing SOP instead." disabled={isLocked} onChange={selectFinishedGood} /></Field>
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2"><div className="text-[10.5px] font-semibold text-text-muted">Version</div><div className="mt-1 text-sm font-semibold text-text-primary">{form.version || "v1"}</div></div>
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2"><div className="text-[10.5px] font-semibold text-text-muted">Status</div><div className="mt-1"><Badge tone={form.status === "active" ? "success" : form.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(form.status)}</Badge></div></div>
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2"><div className="text-[10.5px] font-semibold text-text-muted">Estimated Time</div><div className="mt-1 text-sm font-semibold text-text-primary">{sopMinutesLabel(calculatedMinutes)}</div></div>
            <div className="rounded-lg border border-border bg-surface-muted px-3 py-2"><div className="text-[10.5px] font-semibold text-text-muted">Structure</div><div className="mt-1 text-sm font-semibold text-text-primary">{form.steps.length} steps · {totalSubSteps} sub-steps · {totalQcChecks} QC</div></div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm"><div className="min-w-0"><span className="font-semibold text-text-primary">Recipe reference: </span>{recipeReference ? <span className="text-text-secondary">Recipe {recipeReference.version || form.recipe_version || "—" } · {quantity(recipeReference.yield_quantity, recipeReference.uom)} · {recipeIngredients.length} ingredients</span> : <span className="text-text-secondary">No active recipe linked</span>}{recipeUpdateAvailable ? <span className="ml-2 text-xs font-semibold text-amber-700">{activeRecipe.version} update available</span> : null}</div><div className="flex items-center gap-2">{recipeUpdateAvailable ? <button className="btn-secondary px-2.5 py-1.5 text-xs" type="button" aria-expanded={recipeUpdateReviewOpen} onClick={() => { setRecipeUpdateError(""); setRecipeUpdateReviewOpen((current) => !current); }}>Review Update</button> : null}{recipeReference ? <button className="btn-secondary px-2.5 py-1.5 text-xs" type="button" aria-expanded={recipeDetailsOpen} onClick={() => setRecipeDetailsOpen((current) => !current)}>{recipeDetailsOpen ? "Hide ingredients" : "View ingredients"}</button> : null}{!recipeReference && isEdit && activeRecipe && !isLocked ? <button className="btn-secondary px-2.5 py-1.5 text-xs" type="button" onClick={linkActiveRecipe}>Link Active Recipe</button> : null}</div></div>
          {recipeUpdateReviewOpen && recipeUpdateAvailable ? <RecipeUpdateReview currentRecipe={recipeReference} nextRecipe={activeRecipe} saving={updatingRecipe} onUpdate={updateDraftToActiveRecipe} /> : null}
          {recipeUpdateError ? <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{recipeUpdateError}</div> : null}
          {recipeDetailsOpen && recipeReference ? <div className="mt-3 overflow-hidden rounded-lg border border-border"><table className="w-full text-left text-xs"><thead className="bg-surface-muted text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted"><tr><th className="px-3 py-2">Ingredient</th><th className="px-3 py-2">Recipe Qty</th><th className="px-3 py-2">UOM</th></tr></thead><tbody>{recipeIngredients.map((item) => <tr key={item.id || item.raw_material_id} className="border-t border-border"><td className="px-3 py-2 font-semibold text-text-primary">{item.raw_material_name || "Raw Material"}</td><td className="px-3 py-2 tabular-nums text-text-secondary">{Number(item.quantity_used || 0).toLocaleString("en-MY", { maximumFractionDigits: 4 })}</td><td className="px-3 py-2 text-text-secondary">{item.uom || "—"}</td></tr>)}</tbody></table></div> : null}
          {ingredientsNeedingReview.length ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><span className="font-semibold">{ingredientsNeedingReview.length} recipe ingredient{ingredientsNeedingReview.length === 1 ? "" : "s"} needs review.</span><div className="mt-1">{ingredientsNeedingReview.map((item) => item.raw_material_name || "Raw Material").join(", ")}</div></div> : null}
          <div className="mt-3 border-t border-border pt-3"><button className="inline-flex items-center gap-2 text-sm font-semibold text-text-secondary hover:text-text-primary" type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((current) => !current)}><Settings2 size={15} /> SOP Settings {settingsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button>{settingsOpen ? <div className="mt-3 grid gap-3 md:grid-cols-2"><Field label="Effective Date"><FeedXDatePicker value={form.effective_date || ""} disabled={isLocked} onChange={(nextDate) => setForm((current) => ({ ...current, effective_date: nextDate }))} /></Field><Field label="Remarks"><textarea className={inputClass()} rows={2} value={form.remarks || form.notes || ""} disabled={isLocked} onChange={(event) => setForm((current) => ({ ...current, remarks: event.target.value, notes: event.target.value }))} /></Field><div className="md:col-span-2"><Field label="Equipment"><div className="grid gap-2 sm:grid-cols-2">{equipment.filter((item) => item.status === "active" || form.equipment_ids.includes(item.id)).map((item) => <label key={item.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><input aria-label={[item.name, equipmentSecondaryLabel(item)].filter(Boolean).join(" · ")} type="checkbox" disabled={isLocked || item.status !== "active"} checked={form.equipment_ids.includes(item.id)} onChange={(event) => setForm((current) => ({ ...current, equipment_ids: event.target.checked ? [...new Set([...current.equipment_ids, item.id])] : current.equipment_ids.filter((id) => id !== item.id) }))} /><span className="min-w-0"><span className="block truncate font-semibold text-text-primary">{item.name || "Equipment"}</span>{equipmentSecondaryLabel(item) ? <span className="block text-xs text-text-secondary">{equipmentSecondaryLabel(item)}</span> : null}</span></label>)}</div></Field>{form.status === "draft" && !form.equipment_ids.length ? <p className="mt-2 text-xs font-semibold text-amber-700">Equipment configuration is incomplete. Drafts can be saved; assign at least one active Equipment before activation.</p> : null}</div></div> : null}</div>
        </section>

        <div className="grid min-h-0 lg:grid-cols-[180px_minmax(0,1fr)]">
          <aside className="hidden border-r border-border bg-surface-muted p-3 lg:block"><div className="sticky top-0"><div className="mb-2 flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted"><ListTree size={14} /> SOP Outline</div><button className="w-full rounded-lg px-2 py-2 text-left text-xs font-semibold text-text-secondary hover:bg-surface hover:text-text-primary" type="button" onClick={() => focusBuilderSection(null)}>Header / Settings</button>{form.steps.map((step, index) => <button key={step.id} className="mt-1 w-full rounded-lg px-2 py-2 text-left text-xs hover:bg-surface" type="button" onClick={() => focusBuilderSection(step.id)}><span className="block truncate font-semibold text-text-primary">{String(index + 1).padStart(2, "0")} {step.step_name || "Untitled step"}</span><span className="mt-0.5 block text-text-secondary">{step.sub_steps?.length || 0} sub-steps · {step.qc_checks?.length || 0} QC</span></button>)}</div></aside>
          <section className="min-w-0 px-4 py-4 sm:px-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><div className="text-sm font-semibold text-text-primary">Main Steps</div><div className="mt-1 text-xs text-text-secondary">Steps resequence automatically after moving or removing.</div></div><div className="flex flex-wrap items-center gap-2"><button className="btn-secondary px-2.5 py-1.5 text-xs" type="button" onClick={() => setExpandedStepIds(new Set(form.steps.map((step) => step.id)))}>Expand All</button><button className="btn-secondary px-2.5 py-1.5 text-xs" type="button" onClick={() => setExpandedStepIds(new Set())}>Collapse All</button>{!isLocked ? <button className="btn-secondary px-2.5 py-1.5 text-xs" type="button" onClick={addStep}><Plus size={14} /> Add Step</button> : null}</div></div>
            <div className="space-y-3">{form.steps.map((step, index) => {
              const hasSubSteps = Boolean(step.sub_steps?.length);
              const stepMinutes = sopStepEstimatedMinutes(step);
              const expanded = expandedStepIds.has(step.id);
              return <article key={step.id} ref={(node) => { if (node) stepRefs.current.set(step.id, node); else stepRefs.current.delete(step.id); }} className="scroll-mt-4 overflow-hidden rounded-lg border border-border bg-surface">
                <div className="flex items-center gap-3 px-3 py-3"><button className="flex min-w-0 flex-1 items-center gap-3 text-left" type="button" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} step ${index + 1}`} onClick={() => toggleStep(step.id)}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{String(index + 1).padStart(2, "0")}</span><span className="min-w-0"><span className="block truncate text-sm font-semibold text-text-primary">{step.step_name || "Untitled main step"}</span><span className="mt-0.5 block text-xs text-text-secondary">{step.sub_steps?.length || 0} sub-steps · {step.qc_checks?.length || 0} QC · {sopMinutesLabel(stepMinutes)}</span></span>{expanded ? <ChevronDown className="shrink-0 text-text-muted" size={16} /> : <ChevronRight className="shrink-0 text-text-muted" size={16} />}</button>{!isLocked ? <div className="flex shrink-0 items-center gap-1"><button className="icon-btn" title="Move step up" aria-label="Move step up" type="button" disabled={index === 0} onClick={() => moveStep(step.id, -1)}><ArrowUp size={15} /></button><button className="icon-btn" title="Move step down" aria-label="Move step down" type="button" disabled={index === form.steps.length - 1} onClick={() => moveStep(step.id, 1)}><ArrowDown size={15} /></button><button className="icon-btn" title="Duplicate step" aria-label="Duplicate step" type="button" onClick={() => duplicateStep(step.id)}><Copy size={15} /></button><button className="icon-btn text-rose-600" title="Remove step" aria-label="Remove step" type="button" disabled={form.steps.length === 1} onClick={() => removeStep(step.id)}><Trash2 size={15} /></button></div> : null}</div>
                {expanded ? <div className="border-t border-border px-3 py-3"><div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px]"><Field label="Step Name *"><input className={inputClass()} value={step.step_name || step.process_name || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { step_name: event.target.value, process_name: event.target.value })} /></Field><Field label="Minutes"><input className={inputClass()} type="number" min="0" step="1" value={hasSubSteps ? stepMinutes : step.estimated_time_minutes ?? ""} disabled={isLocked || hasSubSteps} onChange={(event) => updateStep(step.id, { estimated_time_minutes: event.target.value })} />{hasSubSteps ? <div className="mt-1 text-[10.5px] font-semibold text-text-muted">From sub-steps</div> : null}</Field></div><div className="mt-3"><Field label="Description / Instruction"><textarea className={inputClass()} rows={2} value={step.description || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { description: event.target.value })} /></Field></div><div className="mt-3"><Field label="Ingredient References"><SopIngredientPicker ingredients={recipeIngredients} value={step.ingredient_material_ids || []} disabled={isLocked || !recipeReference} onChange={(ingredientMaterialIds) => updateStep(step.id, { ingredient_material_ids: ingredientMaterialIds })} /></Field><div className="mt-1 text-[10.5px] font-semibold text-text-muted">Reference only; Recipe quantities and costing remain unchanged.</div></div>
                  <div className="mt-4 border-t border-border pt-3"><div className="flex items-center justify-between gap-3"><div><div className="text-xs font-semibold text-text-primary">QC Checks</div><div className="mt-0.5 text-[10.5px] text-text-muted">Compact evidence and input requirements.</div></div>{!isLocked ? <button className="btn-secondary px-2.5 py-1.5 text-xs" type="button" onClick={() => addQcCheck(step.id)}><Plus size={13} /> Add QC</button> : null}</div>{step.qc_checks?.length ? <div className="mt-2 divide-y divide-border rounded-lg border border-border">{step.qc_checks.map((qc, qcIndex) => <div key={qc.id} className="px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><div className="min-w-0"><div className="truncate text-sm font-semibold text-text-primary">{qc.qc_name || "Select QC Check"}</div><div className="mt-0.5 truncate text-xs text-text-secondary">{qc.instructions || "No instructions"}</div></div><div className="flex items-center gap-2"><span className="text-xs font-semibold text-text-secondary">{qc.is_required !== false ? "Required" : "Optional"}</span>{!isLocked ? <button className="btn-secondary px-2 py-1 text-xs" type="button" aria-expanded={expandedQcIds.has(qc.id)} onClick={() => setExpandedQcIds((current) => { const next = new Set(current); if (next.has(qc.id)) next.delete(qc.id); else next.add(qc.id); return next; })}>{expandedQcIds.has(qc.id) ? "Close" : "Edit"}</button> : null}</div></div>{expandedQcIds.has(qc.id) ? <div className="mt-3 border-t border-border pt-3"><div className="grid gap-3 md:grid-cols-2"><Field label="QC Check *"><SearchableSelect value={qc.checklist_template_id || (qc.legacy_custom ? `legacy-${qc.id}` : "")} options={qc.legacy_custom ? [{ value: `legacy-${qc.id}`, label: `${qc.qc_name} (Custom / Legacy QC)` }, ...qcPresetOptions] : qcPresetOptions} placeholder="Select QC Check" searchPlaceholder="Search QC checks" emptyText="No active QC presets" disabled={isLocked} onChange={(value) => selectQcPreset(step.id, qc.id, value)} /></Field><Field label="Instructions"><textarea className={inputClass()} rows={2} value={qc.instructions || ""} disabled={isLocked} onChange={(event) => updateQcCheck(step.id, qc.id, { instructions: event.target.value })} /></Field></div><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><label className="inline-flex items-center gap-2 text-xs font-semibold text-text-secondary"><input type="checkbox" checked={qc.is_required !== false} disabled={isLocked} onChange={(event) => updateQcCheck(step.id, qc.id, { is_required: event.target.checked })} /> Required before production completion</label><div className="flex gap-1"><button className="icon-btn" title="Move QC up" aria-label="Move QC up" type="button" disabled={qcIndex === 0} onClick={() => moveQcCheck(step.id, qc.id, -1)}><ArrowUp size={14} /></button><button className="icon-btn" title="Move QC down" aria-label="Move QC down" type="button" disabled={qcIndex === step.qc_checks.length - 1} onClick={() => moveQcCheck(step.id, qc.id, 1)}><ArrowDown size={14} /></button><button className="icon-btn" title="Duplicate QC" aria-label="Duplicate QC" type="button" onClick={() => duplicateQcCheck(step.id, qc.id)}><Copy size={14} /></button><button className="icon-btn text-rose-600" title="Remove QC" aria-label="Remove QC" type="button" onClick={() => removeQcCheck(step.id, qc.id)}><Trash2 size={14} /></button></div></div></div> : null}</div>)}</div> : <div className="mt-2 text-xs text-text-muted">No QC checks for this step.</div>}</div>
                  <div className="mt-4 border-t border-border pt-3"><div className="flex items-center justify-between gap-3"><div className="text-xs font-semibold text-text-primary">Sub-steps</div>{!isLocked ? <button className="btn-secondary px-2.5 py-1.5 text-xs" type="button" onClick={() => addSubStep(step.id)}><Plus size={13} /> Add Sub-step</button> : null}</div>{step.sub_steps?.length ? <div className="mt-2 overflow-x-auto rounded-lg border border-border"><div className="hidden min-w-[560px] grid-cols-[48px_minmax(180px,1fr)_96px_minmax(150px,0.6fr)_36px] gap-2 border-b border-border bg-surface-muted px-3 py-2 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-text-muted md:grid"><span>No.</span><span>Instruction</span><span>Minutes</span><span>Remarks</span><span /></div><div className="min-w-[560px] divide-y divide-border">{step.sub_steps.map((subStep, subIndex) => <div key={subStep.id} className="grid grid-cols-[48px_minmax(180px,1fr)_96px_minmax(150px,0.6fr)_36px] items-center gap-2 px-3 py-2"><div className="text-xs font-semibold text-text-secondary">{index + 1}.{subIndex + 1}</div><input className={inputClass()} placeholder="Instruction *" value={subStep.instruction || ""} disabled={isLocked} onChange={(event) => updateSubStep(step.id, subStep.id, { instruction: event.target.value })} /><input className={inputClass()} type="number" min="0" step="1" placeholder="Min" value={subStep.estimated_minutes ?? ""} disabled={isLocked} onChange={(event) => updateSubStep(step.id, subStep.id, { estimated_minutes: event.target.value })} /><input className={inputClass()} placeholder="Remarks" value={subStep.remarks || ""} disabled={isLocked} onChange={(event) => updateSubStep(step.id, subStep.id, { remarks: event.target.value })} />{!isLocked ? <button className="icon-btn text-rose-600" title="Remove sub-step" aria-label="Remove sub-step" type="button" onClick={() => removeSubStep(step.id, subStep.id)}><Trash2 size={14} /></button> : <span />}</div>)}</div></div> : <div className="mt-2 text-xs text-text-muted">No sub-steps added.</div>}</div><div className="mt-3"><Field label="Step Remarks"><textarea className={inputClass()} rows={2} value={step.remarks || step.safety_note || ""} disabled={isLocked} onChange={(event) => updateStep(step.id, { remarks: event.target.value, safety_note: event.target.value })} /></Field></div></div> : null}
              </article>;
            })}</div>
          </section>
        </div>
      </form>
    </Modal>
  );
}

export function ProductionSopDocumentModal({ sop, recipes = [], onClose }) {
  const steps = [...(sop.steps || [])].sort((a, b) => Number(a.step_no || 0) - Number(b.step_no || 0));
  const qcCount = steps.reduce((count, step) => count + (step.qc_checks?.length || ((step.qc_required || step.is_qc_checkpoint) ? 1 : 0)), 0);
  const recipe = sop.linked_recipe;
  const currentActiveRecipe = recipes.find((item) => item.product_family_id === sop.finished_good_id && item.status === "active") || null;
  const recipeUpdateAvailable = Boolean(recipe && currentActiveRecipe && currentActiveRecipe.id !== recipe.id);
  const referencedIngredientCount = new Set(steps.flatMap((step) => step.ingredient_material_ids || [])).size;
  const totalEstimatedMinutes = sopTotalEstimatedMinutes({ ...sop, steps });
  const linkedEquipment = (sop.equipment_links || []).map((link) => link.equipment || link).filter((equipment) => equipment?.id || equipment?.name || equipment?.equipment_code);
  const productName = sop.product_name_en || sop.product_name || "Finished Good";
  const recipeVersion = sop.recipe_version || recipe?.version || "v1";
  const totalRecipeIngredients = recipe?.items?.length || 0;
  const summaryMetrics = [
    ["Estimated Time", meaningfulSopMinutesLabel(totalEstimatedMinutes) || "—"],
    ["Steps", steps.length],
    ["QC", qcCount],
    ["Updated", formatFactoryDate(sop.updated_at)],
  ];
  if (sop.effective_date) summaryMetrics.push(["Effective Date", formatFactoryDate(sop.effective_date)]);
  return (
    <Modal title={`${productName} SOP · ${sop.version || "v1"}`} description={sop.product_name_cn || undefined} size="2xl" headerActions={<Badge tone={sop.status === "active" ? "success" : sop.status === "draft" ? "info" : "neutral"}>{jobStatusLabel(sop.status)}</Badge>} onClose={onClose} footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}>
      <div className="space-y-4">
        <section className="border-b border-border pb-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
            {summaryMetrics.map(([label, value]) => <div key={label} className="flex items-baseline gap-1.5"><span className="font-medium text-text-muted">{label}</span><span className="font-semibold text-text-primary">{value}</span></div>)}
          </div>
          {sop.remarks || sop.notes ? <div className="mt-3 max-w-[70ch] text-sm text-text-secondary">{sop.remarks || sop.notes}</div> : null}
        </section>

        <section className="border-b border-border pb-4">
          <div className="text-sm font-semibold text-text-primary">Production Setup</div>
          <div className="mt-2.5 space-y-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span className="w-20 shrink-0 text-xs font-medium text-text-muted">Recipe</span>{recipe ? <span className="font-medium text-text-primary">{productName} {recipeVersion} · {quantity(recipe.yield_quantity, recipe.uom)} output · {referencedIngredientCount}/{totalRecipeIngredients} ingredients</span> : <span className="font-medium text-text-primary">No Recipe Linked</span>}</div>
            {recipeUpdateAvailable ? <div className="pl-0 text-xs text-amber-700 sm:pl-[92px]"><span className="font-semibold">{currentActiveRecipe.version} update available.</span> Create a new SOP version to use the newer Recipe.</div> : null}
            <div className="flex items-start gap-3"><span className="w-20 shrink-0 pt-0.5 text-xs font-medium text-text-muted">Equipment</span>{linkedEquipment.length ? <div className="grid min-w-0 flex-1 gap-x-5 gap-y-2 sm:grid-cols-2">{linkedEquipment.map((equipment, index) => <FactoryCellText key={equipment.id || `${equipment.equipment_code}-${index}`} primary={equipment.name || "Equipment"} secondary={equipmentSecondaryLabel(equipment)} />)}</div> : <FactoryCellMuted>No equipment linked</FactoryCellMuted>}</div>
          </div>
        </section>

        <section>
          <div className="mb-2 text-sm font-semibold text-text-primary">SOP Timeline</div>
          <div className="relative space-y-3 before:absolute before:bottom-3 before:left-3 before:top-3 before:w-px before:bg-border sm:before:left-4">
            {steps.length ? steps.map((step) => {
              const qcChecks = step.qc_checks?.length ? step.qc_checks : (step.qc_required || step.is_qc_checkpoint) ? [{ id: `legacy-${step.id}`, qc_type: "checklist", qc_name: step.qc_label || step.control_point || "QC Check", instructions: step.qc_target_value || "", is_required: true, legacy: true }] : [];
              const stepMinutes = sopStepEstimatedMinutes(step);
              const stepDuration = meaningfulSopMinutesLabel(stepMinutes);
              return (
                <article key={step.id} className="relative ml-8 rounded-lg border border-border bg-surface px-3 py-3 sm:ml-10 sm:px-4">
                  <span className="absolute -left-[27px] top-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white sm:-left-[33px]">{step.step_no}</span>
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="text-base font-semibold text-text-primary">{step.step_name || step.process_name || "Unnamed Step"}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">{stepDuration ? <span>{stepDuration}</span> : null}{step.sub_steps?.length && stepDuration ? <span>Calculated from {step.sub_steps.length} sub-step{step.sub_steps.length === 1 ? "" : "s"}</span> : null}</div></div>{qcChecks.length ? <Badge tone="warning">{qcChecks.length} QC</Badge> : null}</div>
                  {step.description ? <div className="mt-2 max-w-[75ch] text-sm text-text-secondary">{step.description}</div> : null}
                  {step.ingredient_references?.length ? <div className="mt-2.5"><div className="text-[10.5px] font-medium text-text-muted">Recipe Ingredients</div><div className="mt-1 flex flex-wrap gap-1.5">{step.ingredient_references.map((item) => <span key={item.raw_material_id} className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-secondary">{item.raw_material_name}</span>)}</div></div> : null}
                  {step.sub_steps?.length ? <div className="mt-3 border-t border-border pt-1">{step.sub_steps.map((subStep, index) => { const subStepDuration = meaningfulSopMinutesLabel(subStep.estimated_minutes); return <div key={subStep.id} className="flex gap-2 py-1.5"><span className="shrink-0 text-xs font-semibold text-text-muted">{step.step_no}.{index + 1}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"><span className="text-sm font-medium text-text-primary">{subStep.instruction}</span>{subStepDuration ? <span className="text-xs text-text-secondary">{subStepDuration}</span> : null}</div>{subStep.remarks ? <div className="mt-0.5 text-xs text-text-secondary">{subStep.remarks}</div> : null}</div></div>; })}</div> : null}
                  {qcChecks.length ? <div className="mt-3 border-t border-border pt-2"><div className="text-xs font-semibold text-text-primary">QC Checks</div><div className="mt-1.5 grid gap-2 sm:grid-cols-2">{qcChecks.map((qc) => <div key={qc.id} className="rounded-md bg-surface-muted px-2.5 py-2"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="text-sm font-medium text-text-primary">{qc.qc_name}</div>{qc.instructions ? <div className="mt-0.5 text-xs text-text-secondary">{qc.instructions}</div> : null}</div>{qc.is_required ? <Badge tone="warning">Required</Badge> : <Badge tone="neutral">Optional</Badge>}</div></div>)}</div></div> : null}
                  {step.remarks || step.safety_note ? <div className="mt-2 text-xs text-text-secondary">Remarks: {step.remarks || step.safety_note}</div> : null}
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

  const columns = [
    { key: "check", label: "QC Check", render: (template) => <FactoryCellText primary={template.name} secondary={template.description || "No default instructions"} /> },
    { key: "result-mode", label: "Result Mode", render: (template) => <FactoryCellMuted>{template.result_mode === "remarks" ? "Remarks" : "Checklist"}</FactoryCellMuted> },
    {
      key: "usage",
      label: "SOP Usage",
      align: "right",
      render: (template) => {
        const references = referenceCounts.get(template.id) || 0;
        return <FactoryCellMuted>{references} SOP {references === 1 ? "reference" : "references"}</FactoryCellMuted>;
      },
    },
    { key: "status", label: "Status", render: (template) => <FactoryStatusBadge status={template.is_active !== false ? "Active" : "Archived"} /> },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (template) => {
        const references = referenceCounts.get(template.id) || 0;
        return <FactoryRowActions
          directSingleSecondary
          disabled={saving}
          secondaryActions={[
            { label: "Edit", onClick: () => beginEdit(template) },
            template.is_active !== false
              ? { label: "Archive", destructive: true, onClick: () => runLifecycle(onArchive, template) }
              : { label: "Restore", onClick: () => runLifecycle(onRestore, template) },
            !references ? { label: "Delete", destructive: true, onClick: () => requestDelete(template) } : null,
          ].filter(Boolean)}
        />;
      },
    },
  ];

  return <FactoryMasterDataManagerModal
    title="QC Checklist Presets"
    description="Maintain reusable QC checks without changing saved SOP evidence."
    editorTitle={form.id ? "Edit QC Check" : "Create QC Check"}
    editorDescription="Preset instructions provide a starting point and remain editable in each Draft SOP."
    saving={saving}
    onClose={onClose}
    columns={columns}
    rows={orderedTemplates}
    emptyTitle="No QC Checklist Presets"
    emptyDescription="Create a reusable QC check for Production SOP steps."
    editor={<form className="space-y-4" onSubmit={submit}>
      {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</div> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="QC Check Name *"><input className={inputClass()} value={form.name} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
        <Field label="Result Mode"><SearchableSelect value={form.result_mode} options={resultModeOptions} placeholder="Select result mode" disabled={saving} onChange={(value) => setForm((current) => ({ ...current, result_mode: value }))} /></Field>
      </div>
      <Field label="Default Instructions"><textarea className={inputClass()} rows={3} value={form.description} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Save Changes" : "Create QC Check"}</button>
        {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={resetForm}>Cancel</button> : null}
      </div>
    </form>}
  />;
}
