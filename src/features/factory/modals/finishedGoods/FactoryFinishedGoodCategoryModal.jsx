import { useMemo, useState } from "react";
import { Field, inputClass } from "../../components/FactoryBulkSelectionModal.jsx";
import FactoryMasterDataManagerModal from "../../components/FactoryMasterDataManagerModal.jsx";
import FactoryRowActions from "../../components/FactoryRowActions.jsx";
import FactoryStatusBadge from "../../components/FactoryStatusBadge.jsx";
import SearchableSelect from "../../components/SearchableSelect.jsx";
import { FactoryCellMuted, FactoryCellText } from "../../components/FactoryTableCell.jsx";

const emptyForm = () => ({ name: "", description: "", status: "active" });

export default function FinishedGoodCategoryModal({ categories = [], productFamilies = [], canEdit = false, onClose, onSave, onArchive }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const usageCounts = useMemo(() => productFamilies.reduce((counts, family) => {
    if (family.category_id) counts.set(family.category_id, (counts.get(family.category_id) || 0) + 1);
    return counts;
  }, new Map()), [productFamilies]);

  function resetForm() {
    setError("");
    setForm(emptyForm());
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!String(form.name || "").trim()) {
      setError("Category name is required.");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      resetForm();
    } catch (nextError) {
      setError(nextError.message || "Unable to save Finished Good Category.");
    } finally {
      setSaving(false);
    }
  }

  async function archive(category) {
    setError("");
    setSaving(true);
    try {
      await onArchive(category);
      if (form.id === category.id) resetForm();
    } catch (nextError) {
      setError(nextError.message || "Unable to archive Finished Good Category.");
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: "category", label: "Category", render: (category) => <FactoryCellText primary={category.name} secondary={category.description || "No description"} /> },
    { key: "usage", label: "Products", align: "right", render: (category) => <span className="font-medium text-text-primary">{usageCounts.get(category.id) || 0}</span> },
    { key: "status", label: "Status", render: (category) => <FactoryStatusBadge status={category.status === "archived" ? "Archived" : "Active"} /> },
    {
      key: "actions",
      label: "Actions",
      align: "right",
      render: (category) => canEdit ? <FactoryRowActions
        directSingleSecondary
        secondaryActions={[
          { label: "Edit", onClick: () => { setError(""); setForm({ id: category.id, name: category.name || "", description: category.description || "", status: category.status || "active" }); } },
          category.status !== "archived" && onArchive ? { label: "Archive", destructive: true, onClick: () => archive(category) } : null,
        ]}
      /> : <FactoryCellMuted />,
    },
  ];

  return (
    <FactoryMasterDataManagerModal
      title="Finished Good Categories"
      description="Group finished goods products for warehouse visibility and filtering."
      editorTitle={form.id ? "Edit category" : "Create category"}
      editorDescription="Archived categories remain attached to existing products and are unavailable for new active setup."
      saving={saving}
      onClose={onClose}
      columns={columns}
      rows={categories}
      emptyTitle="No categories"
      emptyDescription="Create a category before saving finished good products."
      editor={(
        <form className="space-y-3" onSubmit={submit}>
          {error ? <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</div> : null}
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_180px]">
            <Field label="Category Name *"><input className={inputClass()} value={form.name} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
            <Field label="Description"><input className={inputClass()} value={form.description || ""} disabled={saving} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></Field>
            <Field label="Status"><SearchableSelect value={form.status} disabled={saving} options={[{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }]} placeholder="Select status" onChange={(status) => setForm((current) => ({ ...current, status }))} /></Field>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : form.id ? "Save Changes" : "Create Category"}</button>
            {form.id ? <button className="btn-secondary" type="button" disabled={saving} onClick={resetForm}>Cancel</button> : null}
          </div>
        </form>
      )}
    />
  );
}
