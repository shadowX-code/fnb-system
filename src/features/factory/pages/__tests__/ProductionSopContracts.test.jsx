import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductionSopBuilderModal, ProductionSopDocumentModal, QcChecklistPresetManagerModal } from "../../modals/sop/FactoryProductionSopModals.jsx";

const family = { id: "family-1", name_en: "Sambal", name_cn: "叁巴酱", status: "active" };
const template = { id: "qc-1", name: "Temperature", result_mode: "checklist", description: "Check core temperature", is_active: true };
const draftSop = {
  id: "sop-1",
  finished_good_id: family.id,
  product_name: family.name_en,
  version: "v2",
  status: "draft",
  effective_date: "2026-08-09",
  recipe_id: "recipe-1",
  recipe_version: "v2",
  remarks: "Cook in sequence",
  steps: [{ id: "123e4567-e89b-42d3-a456-426614174000", step_no: 1, step_name: "Cook", description: "Cook until ready", estimated_time_minutes: 10, ingredient_material_ids: [], sub_steps: [], qc_checks: [{ id: "123e4567-e89b-42d3-a456-426614174001", sequence_no: 1, qc_type: "checklist", checklist_template_id: template.id, qc_name: template.name, instructions: template.description, is_required: true }], remarks: "Stir continuously" }],
};
const recipe = { id: "recipe-1", product_family_id: family.id, version: "v2", status: "active", yield_quantity: 10, uom: "kg", items: [] };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Production SOP builder, document, and QC preset contracts", () => {
  it("preserves the SOP builder payload for linkage, version, steps, timing, QC checks, and remarks", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProductionSopBuilderModal initialValue={draftSop} productFamilies={[family]} recipes={[recipe]} sops={[draftSop]} qcChecklistTemplates={[template]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save SOP" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: draftSop.id,
      finished_good_id: family.id,
      recipe_id: recipe.id,
      recipe_version: "v2",
      version: "v2",
      status: "draft",
      effective_date: "2026-08-09",
      title: "Sambal Production SOP · v2",
      estimated_minutes: 10,
      remarks: "Cook in sequence",
      steps: [expect.objectContaining({ step_no: 1, step_name: "Cook", estimated_time_minutes: 10, qc_checks: [expect.objectContaining({ checklist_template_id: template.id, qc_name: template.name, qc_type: "checklist" })] })],
    })));
  });

  it("renders active, draft, and legacy QC document paths without inventing missing history", () => {
    const activeView = render(<ProductionSopDocumentModal sop={{ ...draftSop, status: "active", linked_recipe: recipe, product_name_cn: family.name_cn }} onClose={vi.fn()} />);
    expect(screen.getAllByText("Sambal Production SOP · v2").length).toBeGreaterThan(0);
    expect(screen.getByText("Active")).not.toBeNull();
    expect(screen.getByText("Temperature")).not.toBeNull();
    activeView.unmount();

    render(<ProductionSopDocumentModal sop={{ ...draftSop, status: "draft", linked_recipe: null, steps: [{ id: "legacy-step", step_no: 1, process_name: "Cook", estimated_time_minutes: 8, qc_required: true, qc_label: "Legacy temperature", qc_target_value: "80C", ingredient_material_ids: [] }] }} onClose={vi.fn()} />);
    expect(screen.getByText("Draft")).not.toBeNull();
    expect(screen.getByText("No Recipe Linked")).not.toBeNull();
    expect(screen.getByText("Legacy temperature")).not.toBeNull();
  });

  it("keeps QC preset create, archive, restore, and unused delete presentation contracts intact", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onArchive = vi.fn().mockResolvedValue(undefined);
    const onRestore = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QcChecklistPresetManagerModal templates={[template, { ...template, id: "qc-2", name: "Remarks check", result_mode: "remarks", is_active: false }]} sops={[]} onClose={vi.fn()} onCreate={onCreate} onUpdate={vi.fn()} onArchive={onArchive} onRestore={onRestore} onDelete={onDelete} />);
    fireEvent.change(screen.getByLabelText("QC Check Name *"), { target: { value: "Visual" } });
    fireEvent.click(screen.getByRole("button", { name: "Create QC Check" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Visual", result_mode: "checklist" })));
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith(expect.objectContaining({ id: template.id })));
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "qc-2" })));
    fireEvent.click(screen.getAllByRole("button", { name: "Delete" })[0]);
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: template.id })));
  });
});
