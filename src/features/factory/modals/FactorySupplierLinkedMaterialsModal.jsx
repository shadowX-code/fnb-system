import { useEffect, useMemo, useState } from "react";
import { Link2, Unlink } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import { FactoryDataSurface, FactoryTable } from "../components/FactoryDataDisplay.jsx";
import FactoryFilterBar from "../components/FactoryFilterBar.jsx";
import SearchableSelect from "../components/SearchableSelect.jsx";
import { Field, inputClass } from "../components/FactoryBulkSelectionModal.jsx";
import { FactoryCellEntity } from "../components/FactoryTableCell.jsx";

export default function FactorySupplierLinkedMaterialsModal({ supplier, loadEligibility, onSave, onClose }) {
  const [materials, setMaterials] = useState([]);
  const [linkedIds, setLinkedIds] = useState(() => new Set(supplier?.linked_material_ids || []));
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [linkedOnly, setLinkedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    loadEligibility(supplier.id)
      .then((rows) => {
        if (!active) return;
        setMaterials(rows || []);
        setLinkedIds(new Set((rows || []).filter((row) => row.is_linked).map((row) => row.id)));
      })
      .catch((loadError) => active && setError(loadError.message || "Unable to load linked Raw Materials."))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [loadEligibility, supplier.id]);

  const categories = useMemo(() => [...new Set(materials.map((material) => material.category).filter(Boolean))].sort(), [materials]);
  const visibleMaterials = useMemo(() => materials.filter((material) => {
    const matchesSearch = !search || `${material.name || ""} ${material.name_en || ""} ${material.material_code || ""}`.toLowerCase().includes(search.toLowerCase());
    return matchesSearch && (!category || material.category === category) && (!linkedOnly || linkedIds.has(material.id));
  }), [category, linkedIds, linkedOnly, materials, search]);
  const changed = useMemo(() => {
    const initial = new Set(supplier.linked_material_ids || []);
    return initial.size !== linkedIds.size || [...initial].some((id) => !linkedIds.has(id));
  }, [linkedIds, supplier.linked_material_ids]);

  function toggleMaterial(id) {
    setLinkedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setVisibleLinked(shouldLink) {
    setLinkedIds((current) => {
      const next = new Set(current);
      visibleMaterials.forEach((material) => shouldLink ? next.add(material.id) : next.delete(material.id));
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(supplier, [...linkedIds]);
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Unable to save linked Raw Materials.");
    } finally {
      setSaving(false);
    }
  }

  const activeFilters = [
    search && { key: "search", label: "Search", value: search, onRemove: () => setSearch("") },
    category && { key: "category", label: "Category", value: category, onRemove: () => setCategory("") },
    linkedOnly && { key: "linked", label: "Linked", value: "Only", onRemove: () => setLinkedOnly(false) },
  ].filter(Boolean);

  return <Modal title="Manage Linked Materials" description={supplier.supplier_name} size="xl" onClose={saving ? undefined : onClose} footer={<><div className="mr-auto text-sm font-semibold text-text-secondary">{linkedIds.size} linked</div><button className="btn-secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="btn-primary" type="button" disabled={saving || !changed} onClick={save}>{saving ? "Saving..." : "Save Changes"}</button></>}>
    <div className="space-y-4">
      {error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</div> : null}
      <FactoryFilterBar activeFilters={activeFilters} onClear={() => { setSearch(""); setCategory(""); setLinkedOnly(false); }}>
        <Field label="Search"><input className={inputClass()} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Raw Material" /></Field>
        {categories.length > 1 ? <Field label="Category"><SearchableSelect value={category} options={[{ value: "", label: "All" }, ...categories.map((value) => ({ value, label: value }))]} placeholder="All" onChange={setCategory} /></Field> : null}
        <Field label="View"><label className="flex h-10 items-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-text-primary"><input className="h-4 w-4 accent-primary" type="checkbox" checked={linkedOnly} onChange={(event) => setLinkedOnly(event.target.checked)} />Linked only</label></Field>
      </FactoryFilterBar>
      <div className="flex flex-wrap justify-end gap-2"><button className="btn-secondary h-9 px-3 text-sm" type="button" disabled={!visibleMaterials.length} onClick={() => setVisibleLinked(true)}><Link2 size={14} /> Link visible</button><button className="btn-secondary h-9 px-3 text-sm" type="button" disabled={!visibleMaterials.some((material) => linkedIds.has(material.id))} onClick={() => setVisibleLinked(false)}><Unlink size={14} /> Unlink visible</button></div>
      <FactoryDataSurface>
        <FactoryTable loading={loading} rows={visibleMaterials} columns={[
          { key: "material", label: "Raw Material", render: (row) => <FactoryCellEntity name={row.name || row.name_en || "—"} code={row.name_cn || ""} /> },
          { key: "code", label: "Code", render: (row) => <span className="font-semibold text-text-primary">{row.material_code || "—"}</span> },
          { key: "category", label: "Category", render: (row) => row.category || "—" },
          { key: "uom", label: "UOM", render: (row) => row.uom || "—" },
          { key: "linked", label: "Linked", align: "right", render: (row) => <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-text-primary"><input className="h-4 w-4 accent-primary" type="checkbox" checked={linkedIds.has(row.id)} onChange={() => toggleMaterial(row.id)} /><span className="sr-only">{linkedIds.has(row.id) ? "Unlink" : "Link"} {row.name || row.name_en}</span></label> },
        ]} emptyTitle={linkedOnly ? "No linked Raw Materials" : "No active Raw Materials"} emptyDescription={linkedOnly ? "Remove the Linked only filter to manage active Raw Materials." : "Create active Raw Materials before linking them to this Supplier."} />
      </FactoryDataSurface>
    </div>
  </Modal>;
}
