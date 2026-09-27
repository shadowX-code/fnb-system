import { useMemo, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import Modal from "../../../../components/feedback/Modal.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import { frequencies, statuses, shifts, weekdays, groupCategoryIds, isActiveInventoryItem, itemHasActiveOutletLink, toTitle } from "./inventoryGroupsModel.js";
function toDateInputValue(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getBusinessDateInput(timeZone = "Asia/Kuala_Lumpur", value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return toDateInputValue(new Date());
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (byType.year && byType.month && byType.day) return `${byType.year}-${byType.month}-${byType.day}`;
  } catch {
    // Fall back to browser local date if the requested timezone is unavailable.
  }
  return toDateInputValue(date);
}
function todayInput(timeZone = "Asia/Kuala_Lumpur") {
  return getBusinessDateInput(timeZone);
}
function normalizeBusinessDate(value, fallback = todayInput()) {
  if (value instanceof Date) return toDateInputValue(value) || fallback;
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  return toDateInputValue(raw) || fallback;
}
function businessDateToLocalDate(value) {
  const [year, month, day] = normalizeBusinessDate(value).split("-").map(Number);
  return new Date(year, month - 1, day);
}
function weekdayName(value = todayInput()) {
  return businessDateToLocalDate(value).toLocaleDateString("en-MY", { weekday: "long" });
}
function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
function Field({ label, value, onChange, type = "text", placeholder, required = false, onBlur, error }) {
  return (
    <label className="block">
      <div className="mb-1 type-caption font-semibold text-text-secondary">
        {label} {required ? <span className="text-rose-500">*</span> : null}
      </div>
      <input
        className="control h-9 w-full text-[13px]"
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value ?? ""}
        placeholder={placeholder}
        onFocus={type === "number" ? (event) => event.target.select() : undefined}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
      />
      {error ? <div className="mt-1 type-caption font-semibold text-rose-600">{error}</div> : null}
    </label>
  );
}
function TextArea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <div className="mb-1 type-caption font-semibold text-text-secondary">{label}</div>
      <textarea className="control min-h-20 w-full resize-none text-[13px]" value={value ?? ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
export default function GroupModal({ group, outletId, outlets, items, categories, onClose, onSave }) {
  const initialGroup = group ? {
    ...group,
    categoryIds: groupCategoryIds(group, items),
    frequency: frequencies.includes(group.frequency) ? group.frequency : "custom",
    checkDays: group.checkDays?.length ? group.checkDays : [weekdayName()],
  } : {
    id: "",
    outletId: outletId || outlets[0]?.id || "",
    name: "",
    description: "",
    categoryIds: [],
    itemIds: [],
    frequency: "custom",
    checkDays: [weekdayName()],
    monthDay: 1,
    shift: "Closing",
    assignedStaff: "",
    status: "active",
    lastChecked: "",
  };
  const [form, setForm] = useState(initialGroup);
  const selected = new Set(form.categoryIds || []);
  const categoryCounts = useMemo(() => {
    const counts = new Map();
    items
      .filter(isActiveInventoryItem)
      .filter((item) => itemHasActiveOutletLink(item, form.outletId))
      .forEach((item) => counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1));
    return counts;
  }, [items, form.outletId]);
  const allowedCategories = useMemo(() => categories
    .filter((category) => category.status !== "archived")
    .filter((category) => (categoryCounts.get(category.id) || 0) > 0 || selected.has(category.id)),
  [categories, categoryCounts, selected]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <Modal
      title={group ? "Edit Stock Check Group" : "Add Stock Check Group"}
      description="Group the categories this outlet needs to count for the selected schedule."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!form.name.trim() || !form.outletId || !form.categoryIds.length} onClick={() => onSave({ ...form, id: form.id || makeId("group"), itemIds: [] })}>Save Group</button>
        </>
      )}
    >
      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-3">
          <div className="rounded-2xl border border-border bg-slate-50 p-3">
            <div className="type-caption font-semibold text-text-secondary">Outlet</div>
            <div className="mt-1 type-body-sm font-bold text-text-primary">{outlets.find((outlet) => outlet.id === form.outletId)?.name || "Selected outlet"}</div>
          </div>
          <Field label="Group Name" value={form.name} required onChange={(value) => update("name", value)} placeholder="Kitchen Daily" />
          <TextArea label="Description" value={form.description} onChange={(value) => update("description", value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Check Frequency" value={form.frequency} options={frequencies.map((frequency) => ({ value: frequency, label: toTitle(frequency) }))} onChange={(value) => update("frequency", value)} />
            <SelectField label="Shift" value={form.shift} options={shifts.map((shift) => ({ value: shift, label: shift }))} onChange={(value) => update("shift", value)} />
          </div>
          {form.frequency === "monthly" ? (
            <SelectField
              label="Monthly Rule"
              value={String(form.monthDay || 1)}
              options={[
                ...Array.from({ length: 28 }, (_, index) => {
                  const day = index + 1;
                  const suffix = day === 1 ? "st" : day === 2 ? "nd" : day === 3 ? "rd" : "th";
                  return { value: String(day), label: `${day}${suffix} day of month` };
                }),
                { value: "last", label: "Last day of month" },
              ]}
              onChange={(value) => update("monthDay", value === "last" ? "last" : Number(value))}
            />
          ) : null}
          {form.frequency === "custom" ? (
            <div className="rounded-2xl border border-border p-2">
              <div className="mb-2 type-caption font-semibold text-text-secondary">Check Days</div>
              <div className="flex flex-wrap gap-2">
                {weekdays.map((day) => {
                  const active = (form.checkDays || []).includes(day);
                  return (
                    <button
                      key={day}
                      className={`rounded-full border px-2.5 py-1 type-caption font-semibold transition ${active ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-text-secondary hover:bg-slate-50"}`}
                      type="button"
                      onClick={() => {
                        const next = new Set(form.checkDays || []);
                        if (next.has(day)) next.delete(day);
                        else next.add(day);
                        update("checkDays", [...next]);
                      }}
                    >
                      {day.slice(0, 3)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => update("status", value)} />
        </div>
        <div className="rounded-2xl border border-border bg-slate-50/70 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="type-title font-bold text-text-primary">Linked Categories</div>
              <div className="type-caption text-text-secondary">Items are loaded automatically from the selected categories for this outlet.</div>
            </div>
            <Badge tone="info">{selected.size} selected</Badge>
          </div>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {allowedCategories.length ? allowedCategories.map((category) => {
              const active = selected.has(category.id);
              const linkedCount = categoryCounts.get(category.id) || 0;
              return (
                <button
                  key={category.id}
                  className={`flex w-full items-start justify-between gap-3 rounded-2xl border p-3 text-left transition ${active ? "border-primary/40 bg-white shadow-sm" : "border-border bg-white/70 hover:border-slate-300"}`}
                  type="button"
                  onClick={() => {
                    const next = new Set(selected);
                    if (next.has(category.id)) next.delete(category.id);
                    else next.add(category.id);
                    update("categoryIds", [...next]);
                  }}
                >
                  <span>
                    <span className="block type-body-sm font-bold text-text-primary">{category.name}</span>
                    <span className="mt-1 block type-caption text-text-secondary">{linkedCount} linked active item{linkedCount === 1 ? "" : "s"} for {outlets.find((outlet) => outlet.id === form.outletId)?.name || "selected outlet"}</span>
                  </span>
                  {active ? <CheckCircle2 className="text-primary" size={18} /> : null}
                </button>
              );
            }) : <EmptyState title="No linked categories" description="Only categories with active items linked to this outlet are shown." />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

