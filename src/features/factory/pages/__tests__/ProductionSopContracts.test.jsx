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
const equipment = { id: "equipment-1", equipment_code: "MX-01", name: "Mixer 01", status: "active", location: { location_name: "Cooking Room" } };
const secondEquipment = { id: "equipment-2", equipment_code: "ST-02", name: "Steam Kettle", status: "active", location: { location_name: "Cooking Room" } };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("Production SOP builder, document, and QC preset contracts", () => {
  it("preserves the SOP builder payload for linkage, version, steps, timing, QC checks, and remarks", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProductionSopBuilderModal initialValue={draftSop} productFamilies={[family]} recipes={[recipe]} equipment={[equipment]} sops={[draftSop]} qcChecklistTemplates={[template]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "SOP Settings" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Mixer 01.*Cooking Room.*MX-01/i }));
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
      equipment_ids: [equipment.id],
      steps: [expect.objectContaining({ step_no: 1, step_name: "Cook", estimated_time_minutes: 10, qc_checks: [expect.objectContaining({ checklist_template_id: template.id, qc_name: template.name, qc_type: "checklist" })] })],
    })));
  });

  it("allows a Draft SOP to save without Equipment and shows the activation configuration requirement", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ProductionSopBuilderModal initialValue={{ ...draftSop, equipment_ids: [] }} productFamilies={[family]} recipes={[recipe]} equipment={[equipment]} sops={[draftSop]} qcChecklistTemplates={[template]} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "SOP Settings" }));
    expect(screen.getByText("Equipment configuration is incomplete. Drafts can be saved; assign at least one active Equipment before activation.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save SOP" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", equipment_ids: [] })));
  });

  it("reviews and applies a newer active Recipe to an unused Draft without changing SOP structure", async () => {
    const currentRecipe = { id: "recipe-v1", product_family_id: family.id, version: "v1", status: "archived", yield_quantity: 10, uom: "kg", items: [{ raw_material_id: "rm-1", raw_material_name: "Soy Sauce", quantity_used: 2, uom: "kg" }] };
    const nextRecipe = { id: "recipe-v2", product_family_id: family.id, version: "v2", status: "active", yield_quantity: 10, uom: "kg", items: [...currentRecipe.items, { raw_material_id: "rm-2", raw_material_name: "Chicken Stock", quantity_used: 1, uom: "kg" }] };
    const initial = { ...draftSop, recipe_id: currentRecipe.id, recipe_version: currentRecipe.version, steps: [{ ...draftSop.steps[0], ingredient_material_ids: ["rm-1"] }] };
    const onUpdateRecipe = vi.fn().mockResolvedValue({ ...initial, recipe_id: nextRecipe.id, recipe_version: nextRecipe.version, linked_recipe: nextRecipe });
    render(<ProductionSopBuilderModal initialValue={initial} productFamilies={[family]} recipes={[currentRecipe, nextRecipe]} equipment={[equipment]} sops={[initial]} qcChecklistTemplates={[template]} onClose={vi.fn()} onSave={vi.fn()} onUpdateRecipe={onUpdateRecipe} />);

    expect(screen.getByText("v2 update available")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review Update" }));
    expect(screen.getByText("Chicken Stock · 1 kg")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Update Draft to Recipe v2" }));
    await waitFor(() => expect(onUpdateRecipe).toHaveBeenCalledWith(expect.objectContaining({ id: initial.id, recipe_id: currentRecipe.id, steps: expect.arrayContaining([expect.objectContaining({ step_name: "Cook", ingredient_material_ids: ["rm-1"] })]) }), nextRecipe));
    expect(screen.getByText("1 recipe ingredient needs review.")).not.toBeNull();
    expect(screen.getByText("Chicken Stock")).not.toBeNull();
  });

  it("uses a collapsed builder outline with progressive step, QC, and sub-step editing", () => {
    const multiStepSop = {
      ...draftSop,
      steps: [
        ...draftSop.steps,
        { id: "step-2", step_no: 2, step_name: "Pack", estimated_time_minutes: 5, ingredient_material_ids: [], sub_steps: [{ id: "sub-2", sequence_no: 1, instruction: "Fill pack", estimated_minutes: 5, remarks: "" }], qc_checks: [], remarks: "" },
      ],
    };
    render(<ProductionSopBuilderModal initialValue={multiStepSop} productFamilies={[family]} recipes={[recipe]} equipment={[equipment]} sops={[multiStepSop]} qcChecklistTemplates={[template]} onClose={vi.fn()} onSave={vi.fn()} />);

    expect(screen.getByText("2 steps · 1 sub-steps · 1 QC")).not.toBeNull();
    expect(screen.queryByLabelText("Step Name *")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /01 Cook/ }));
    expect(screen.getByLabelText("Step Name *")).not.toBeNull();
    expect(screen.getByText("Temperature")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("QC Check *")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse All" }));
    expect(screen.queryByLabelText("Step Name *")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand All" }));
    expect(screen.getAllByLabelText("Step Name *")).toHaveLength(2);
    expect(screen.getByText("2.1")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Duplicate step" })[0]);
    expect(screen.getByText("3 steps · 1 sub-steps · 2 QC")).not.toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Remove step" })[1]);
    expect(screen.getByText("2 steps · 1 sub-steps · 1 QC")).not.toBeNull();
  });

  it("keeps Description optional and does not repeat a redundant Description in the timeline", () => {
    const sopWithSubSteps = {
      ...draftSop,
      steps: [{
        ...draftSop.steps[0],
        step_name: "Prepare ingredients",
        description: "Prepare ingredients",
        sub_steps: [{ id: "sub-1", sequence_no: 1, instruction: "Wash and drain the ingredients", estimated_minutes: 5, remarks: "" }],
      }],
    };
    const editor = render(<ProductionSopBuilderModal initialValue={sopWithSubSteps} productFamilies={[family]} recipes={[recipe]} equipment={[equipment]} sops={[sopWithSubSteps]} qcChecklistTemplates={[template]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /01 Prepare ingredients/ }));
    expect(screen.getByText("Optional — add only if extra execution guidance is needed.")).not.toBeNull();
    editor.unmount();

    render(<ProductionSopDocumentModal sop={sopWithSubSteps} onClose={vi.fn()} />);
    expect(screen.getAllByText("Prepare ingredients")).toHaveLength(1);
    expect(screen.getByText("Wash and drain the ingredients")).not.toBeNull();
  });

  it("renders active, draft, and legacy QC document paths without inventing missing history", () => {
    const activeView = render(<ProductionSopDocumentModal sop={{ ...draftSop, status: "active", linked_recipe: recipe, product_name_cn: family.name_cn, equipment_links: [{ equipment_id: equipment.id, equipment }, { equipment_id: secondEquipment.id, equipment: secondEquipment }] }} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Sambal SOP · v2" })).not.toBeNull();
    expect(screen.getByText("Active")).not.toBeNull();
    expect(screen.getByText("Temperature")).not.toBeNull();
    expect(screen.getByText("Production Setup")).not.toBeNull();
    expect(screen.getByText("Mixer 01")).not.toBeNull();
    expect(screen.getByText("Steam Kettle")).not.toBeNull();
    expect(screen.getAllByText("Cooking Room · MX-01")).toHaveLength(1);
    activeView.unmount();

    render(<ProductionSopDocumentModal sop={{ ...draftSop, status: "draft", linked_recipe: null, steps: [{ id: "legacy-step", step_no: 1, process_name: "Cook", estimated_time_minutes: 8, qc_required: true, qc_label: "Legacy temperature", qc_target_value: "80C", ingredient_material_ids: [] }] }} onClose={vi.fn()} />);
    expect(screen.getByText("Draft")).not.toBeNull();
    expect(screen.getByText("No Recipe Linked")).not.toBeNull();
    expect(screen.getByText("Legacy temperature")).not.toBeNull();
    expect(screen.getByText("No equipment linked")).not.toBeNull();
  });

  it("keeps the SOP reader compact and omits unset duration semantics", () => {
    const processSop = {
      ...draftSop,
      effective_date: "",
      linked_recipe: { ...recipe, items: [{ raw_material_id: "rm-1", raw_material_name: "Pepper", quantity_used: 1, uom: "kg" }] },
      equipment_links: [{ equipment_id: equipment.id, equipment }],
      steps: [{
        ...draftSop.steps[0],
        ingredient_material_ids: ["rm-1"],
        ingredient_references: [{ raw_material_id: "rm-1", raw_material_name: "Pepper" }],
        estimated_time_minutes: 0,
        sub_steps: [
          { id: "sub-1", instruction: "Grind pepper", estimated_minutes: 5, remarks: "" },
          { id: "sub-2", instruction: "Check texture", estimated_minutes: 0, remarks: "" },
        ],
      }],
    };
    render(<ProductionSopDocumentModal sop={processSop} onClose={vi.fn()} />);

    expect(screen.getByText("Production Setup")).not.toBeNull();
    expect(screen.getByText("Sambal v2 · 10 kg output · 1/1 ingredients")).not.toBeNull();
    expect(screen.getByText("1.1")).not.toBeNull();
    expect(screen.getByText("Grind pepper")).not.toBeNull();
    expect(screen.getAllByText("5 mins").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 mins")).toBeNull();
    expect(screen.queryByText("Process Step")).toBeNull();
    expect(screen.queryByText("Effective Date")).toBeNull();
  });

  it("renders vertical Equipment identities, suppresses repeated descriptions, and keeps QC compact", () => {
    const documentSop = {
      ...draftSop,
      linked_recipe: recipe,
      equipment_links: [
        { equipment_id: equipment.id, equipment },
        { equipment_id: "equipment-3", equipment: { id: "equipment-3", name: "Bench Scale" } },
      ],
      steps: [
        {
          ...draftSop.steps[0],
          step_name: "Sautéing Dried Shrimp",
          description: "Sautéing Dried Shrimp.",
          qc_checks: [
            { ...draftSop.steps[0].qc_checks[0], qc_name: "Temperature", instructions: "90–100°C", is_required: true },
            { id: "qc-optional", qc_name: "Visual check", instructions: "No residue", is_required: false },
          ],
        },
        { id: "meaningful-step", step_no: 2, step_name: "Cool product", description: "Allow the product to cool before packaging.", estimated_time_minutes: 5, ingredient_material_ids: [], sub_steps: [], qc_checks: [] },
      ],
    };
    render(<ProductionSopDocumentModal sop={documentSop} onClose={vi.fn()} />);

    expect(screen.getByText("Mixer 01")).not.toBeNull();
    expect(screen.getByText("Cooking Room · MX-01")).not.toBeNull();
    expect(screen.getByText("Bench Scale")).not.toBeNull();
    expect(screen.getAllByText("Sautéing Dried Shrimp")).toHaveLength(1);
    expect(screen.getByText("Allow the product to cool before packaging.")).not.toBeNull();
    expect(screen.getByText("Required")).not.toBeNull();
    expect(screen.getByText("Optional")).not.toBeNull();
    expect(screen.getByText("90–100°C")).not.toBeNull();
  });

  it("keeps Equipment identity readable when optional Location or code is absent", () => {
    render(<ProductionSopBuilderModal initialValue={draftSop} productFamilies={[family]} recipes={[recipe]} equipment={[{ id: "equipment-3", name: "Bench Scale", status: "active" }]} sops={[draftSop]} qcChecklistTemplates={[template]} onClose={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "SOP Settings" }));
    expect(screen.getByRole("checkbox", { name: "Bench Scale" })).not.toBeNull();
    expect(screen.getByText("Bench Scale")).not.toBeNull();
  });

  it("keeps QC preset create, archive, restore, and unused delete presentation contracts intact", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onArchive = vi.fn().mockResolvedValue(undefined);
    const onRestore = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<QcChecklistPresetManagerModal templates={[template, { ...template, id: "qc-2", name: "Remarks check", result_mode: "remarks", is_active: false }]} sops={[]} onClose={vi.fn()} onCreate={onCreate} onUpdate={vi.fn()} onArchive={onArchive} onRestore={onRestore} onDelete={onDelete} />);
    expect(screen.getByRole("columnheader", { name: "SOP Usage" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("QC Check Name *"), { target: { value: "Visual" } });
    fireEvent.click(screen.getByRole("button", { name: "Create QC Check" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "Visual", result_mode: "checklist" })));
    fireEvent.click(screen.getAllByRole("button", { name: "More row actions" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith(expect.objectContaining({ id: template.id })));
    fireEvent.click(screen.getAllByRole("button", { name: "More row actions" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "qc-2" })));
    fireEvent.click(screen.getAllByRole("button", { name: "More row actions" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: template.id })));
  });
});
