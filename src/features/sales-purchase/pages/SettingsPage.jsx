import { useEffect, useMemo, useState } from "react";
import { Edit3, GripVertical, MoreHorizontal, Plus, Settings, SquarePen, Trash2 } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import EntityModal from "../components/EntityModal.jsx";
import { getOutletTaxConfig } from "../utils/analytics.js";
import Modal from "../../../components/feedback/Modal.jsx";
import { FieldLabel, MonthSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import ActionMenu from "../../../components/ui/ActionMenu.jsx";
import { months } from "../data/mockData.js";
import { salesChannelService } from "../../../services/salesChannelService.js";
import { purchaseCategoryService } from "../../../services/purchaseCategoryService.js";
import { outletTaxConfigService } from "../../../services/outletTaxConfigService.js";

function latestPeriod(store) {
  const latest = [...store.salesRecords, ...store.purchaseRecords]
    .filter((record) => record.outlet_id)
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
    .at(-1);
  return { month: latest?.month ?? 1, year: latest?.year ?? new Date().getFullYear() };
}

function periodLabel(value) {
  if (!value) return "until further notice";
  const [year, month] = value.split("-");
  return new Date(Number(year), Number(month) - 1).toLocaleDateString("en-MY", { month: "short", year: "numeric" });
}

function selectedPeriodLabel(month, year) {
  return `${months.find((item) => item.value === Number(month))?.label ?? "Month"} ${year}`;
}

function periodKeyFromParts(month, year) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function previousMonthKey(value) {
  const date = new Date(`${value}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function TaxConfigModal({ store, values, setValues, onClose, onSubmit, ui }) {
  const enabled = values.enabled === true || values.enabled === "true";
  const mode = values.mode || "add";
  const isEditing = mode === "editFuture" || mode === "forceEdit";
  const isForceEdit = mode === "forceEdit";
  const [forceConfirmed, setForceConfirmed] = useState(false);
  const existingForScope = useMemo(
    () =>
      store.outletTaxConfigs
        .filter((config) => config.outlet_id === values.outlet_id && config.tax_type === values.tax_type && config.id !== values.sourceId)
        .sort((a, b) => b.effective_from.localeCompare(a.effective_from)),
    [store.outletTaxConfigs, values.outlet_id, values.sourceId, values.tax_type],
  );
  const latestConfig = existingForScope[0];
  const startsAfterLatest = values.effective_from && latestConfig ? values.effective_from > latestConfig.effective_from : true;

  useEffect(() => {
    if (!enabled && Number(values.rate || 0) !== 0) {
      setValues((current) => ({ ...current, rate: 0 }));
    }
    if (enabled && (!values.rate || Number(values.rate) === 0)) {
      setValues((current) => ({ ...current, rate: 6 }));
    }
  }, [enabled, setValues, values.rate]);

  function validateAndSubmit() {
    if (!values.outlet_id) return ui.notify({ title: "Outlet required", tone: "error" });
    if (!values.tax_type) return ui.notify({ title: "Tax type required", tone: "error" });
    if (!values.effective_from) return ui.notify({ title: "Effective From required", tone: "error" });
    if (enabled && Number(values.rate || 0) <= 0) return ui.notify({ title: "Rate required", message: "Enabled tax config requires a rate above 0%.", tone: "error" });
    if (values.effective_until && values.effective_until < values.effective_from) {
      return ui.notify({ title: "Invalid effective period", message: "Effective Until cannot be earlier than Effective From.", tone: "error" });
    }
    if (!isEditing && latestConfig && values.effective_from <= latestConfig.effective_from) {
      return ui.notify({
        title: "Invalid effective month",
        message: "Effective month must be after the latest config start month. Editing historical tax configuration is not supported in this prototype.",
        tone: "error",
      });
    }
    if (isForceEdit && !forceConfirmed) {
      return ui.notify({ title: "Confirmation required", message: "Owner confirmation is required for force edit.", tone: "error" });
    }
    return onSubmit({ ...values, enabled, rate: enabled ? Number(values.rate) : 0, effective_until: values.effective_until || null });
  }

  return (
    <Modal
      title={isEditing ? "Edit Tax Configuration" : "Add Tax Configuration"}
      description={isForceEdit ? "Owner-only overwrite of a financial tax configuration." : "Set outlet-level tax rules by effective month."}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" onClick={validateAndSubmit}>{isEditing ? "Save Changes" : "Save Tax Config"}</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <div className="font-bold text-blue-950">Historical months are protected.</div>
          <p className="mt-1 text-xs leading-5">This setting only applies from the effective month onward. Historical months will not be changed.</p>
          <p className="mt-1 text-xs leading-5">If this starts after the current active config, the previous config will automatically end one month before.</p>
        </div>
        {isForceEdit ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <div className="font-bold">Force edit affects historical financial configuration.</div>
            <p className="mt-1 text-xs leading-5">This may affect Net Sales, SST calculations, reports, and alerts. Owner confirmation is required and an audit trail will be written.</p>
            <label className="mt-3 flex items-center gap-2 text-xs font-bold">
              <input className="h-4 w-4 accent-rose-600" type="checkbox" checked={forceConfirmed} onChange={(event) => setForceConfirmed(event.target.checked)} />
              I confirm this force edit is approved by Owner.
            </label>
          </div>
        ) : null}

        <FieldLabel label="Outlet">
          <SelectField
            value={values.outlet_id}
            searchable
            options={store.outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
            onChange={(nextValue) => setValues((current) => ({ ...current, outlet_id: nextValue }))}
          />
        </FieldLabel>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Tax Type">
            <SelectField value={values.tax_type} options={[{ value: "SST", label: "SST" }]} onChange={(nextValue) => setValues((current) => ({ ...current, tax_type: nextValue }))} />
          </FieldLabel>
          <FieldLabel label="Status">
            <SelectField
              value={String(enabled)}
              options={[
                { value: "true", label: "Enabled" },
                { value: "false", label: "Disabled" },
              ]}
              onChange={(nextValue) => setValues((current) => ({ ...current, enabled: nextValue, rate: nextValue === "true" ? current.rate || 6 : 0 }))}
            />
          </FieldLabel>
        </div>

        <FieldLabel label="Rate (%)">
          <input
            className="control w-full disabled:bg-slate-100 disabled:text-text-muted"
            type="number"
            min="0"
            step="0.1"
            disabled={!enabled}
            value={values.rate}
            onChange={(event) => setValues((current) => ({ ...current, rate: event.target.value }))}
            placeholder={enabled ? "6" : "0"}
          />
          {!enabled ? <p className="mt-1 text-xs font-semibold text-text-secondary">SST disabled from selected effective month.</p> : null}
        </FieldLabel>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Effective From">
            <input className="control w-full" type="month" value={values.effective_from} onChange={(event) => setValues((current) => ({ ...current, effective_from: event.target.value }))} />
          </FieldLabel>
          <FieldLabel label="Effective Until">
            <input className="control w-full" type="month" value={values.effective_until || ""} onChange={(event) => setValues((current) => ({ ...current, effective_until: event.target.value }))} />
            <p className="mt-1 text-xs text-text-secondary">Leave empty for until further notice.</p>
          </FieldLabel>
        </div>

        {!isEditing && latestConfig && values.effective_from ? (
          <div className={`rounded-2xl border px-4 py-3 text-sm ${startsAfterLatest ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
            <div className="font-bold">
              {startsAfterLatest ? "Previous config will be closed automatically." : "Historical backdating is blocked."}
            </div>
            <p className="mt-1 text-xs leading-5">
              Latest config starts {periodLabel(latestConfig.effective_from)} and currently ends {periodLabel(latestConfig.effective_until)}.
              {startsAfterLatest
                ? " Saving this will end that config one month before the new effective month."
                : " Effective month must be after the latest config start month."}
            </p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default function SettingsPage({ store, setStore, ui, auth, initialTab = "channels", settingsMode = "all" }) {
  const [tab, setTab] = useState(initialTab);
  const [modal, setModal] = useState(null);
  const [taxValues, setTaxValues] = useState(null);
  const [revisionConfig, setRevisionConfig] = useState(null);
  const [endConfig, setEndConfig] = useState(null);
  const [endUntil, setEndUntil] = useState("");
  const [taxOutletFilter, setTaxOutletFilter] = useState("all");
  const [taxMonth, setTaxMonth] = useState(() => latestPeriod(store).month);
  const [taxYear, setTaxYear] = useState(() => latestPeriod(store).year);
  const [draggedCategoryId, setDraggedCategoryId] = useState(null);
  const [categoryUsage, setCategoryUsage] = useState({});
  const [categoryActionId, setCategoryActionId] = useState(null);
  const [categoryConfirm, setCategoryConfirm] = useState(null);
  const currentPeriodKey = periodKeyFromParts(latestPeriod(store).month, latestPeriod(store).year);
  const currentUser = { name: auth?.profile?.full_name ?? auth?.user?.email ?? "System User" };
  const isChannels = tab === "channels";
  const isCategories = tab === "categories";
  const isTax = tab === "tax";
  const canEditSettings = isChannels
    ? ((auth?.hasPermission?.("sales_channels.create") || auth?.hasPermission?.("sales_channels.edit") || auth?.hasPermission?.("sales_channels.delete")) ?? true)
    : isCategories
      ? ((auth?.hasPermission?.("purchase_categories.create") || auth?.hasPermission?.("purchase_categories.edit") || auth?.hasPermission?.("purchase_categories.delete")) ?? true)
      : (auth?.hasPermission?.("tax_settings.edit") ?? true);
  const canForceEdit = auth?.hasPermission?.("tax_settings.edit") ?? true;
  const categoryRows = useMemo(
    () => [...store.purchaseCategories].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)),
    [store.purchaseCategories],
  );
  const rows = isChannels ? store.salesChannels : isCategories ? categoryRows : store.outletTaxConfigs;
  const filteredTaxRows = taxOutletFilter === "all" ? store.outletTaxConfigs : store.outletTaxConfigs.filter((row) => row.outlet_id === taxOutletFilter);
  const supplierCountFallback = useMemo(() => {
    return store.suppliers.reduce((counts, supplier) => {
      if (supplier.status !== "active" || !supplier.default_category_id) return counts;
      counts[supplier.default_category_id] = (counts[supplier.default_category_id] ?? 0) + 1;
      return counts;
    }, {});
  }, [store.suppliers]);
  function getCategoryUsage(row) {
    return categoryUsage[row.id] ?? {
      activeSupplierCount: supplierCountFallback[row.id] ?? 0,
      purchaseRecordCount: store.purchaseRecords.filter((record) => record.category_id === row.id).length,
      isInUse: Boolean((supplierCountFallback[row.id] ?? 0) || store.purchaseRecords.some((record) => record.category_id === row.id)),
    };
  }
  const masterColumns = [
    { key: "name", header: "Sales Channel", sticky: true, render: (row) => <span className="font-semibold">{row.name}</span> },
    ...(isChannels ? [{ key: "type", header: "Type" }] : []),
    { key: "sort_order", header: "Sort Order", align: "right" },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    { key: "action", header: "Action", align: "right", render: (row) => <button className="icon-btn" disabled={!canEditSettings} onClick={() => setModal({ mode: "edit", row })}><Settings size={15} /></button> },
  ];
  const categoryColumns = [
    {
      key: "name",
      header: "Purchase Category",
      sticky: true,
      width: "42%",
      render: (row) => (
        <div className="flex items-center gap-2">
          <GripVertical size={15} className={`shrink-0 text-text-muted ${canEditSettings ? "cursor-grab" : "opacity-40"}`} aria-hidden="true" />
          <span className="font-semibold">{row.name}</span>
        </div>
      ),
    },
    {
      key: "supplier_count",
      header: "Supplier Count",
      render: (row) => {
        const count = getCategoryUsage(row).activeSupplierCount;
        return <span className="font-semibold text-text-primary">{count} supplier{count === 1 ? "" : "s"}</span>;
      },
    },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    {
      key: "action",
      header: "Actions",
      align: "right",
      width: "86px",
      render: (row) => {
        const usage = getCategoryUsage(row);
        const isActive = row.status === "active";
        return (
          <div className="flex justify-end" onClick={(event) => event.stopPropagation()}>
            <ActionMenu
              open={categoryActionId === row.id}
              onOpenChange={(nextOpen) => setCategoryActionId(nextOpen ? row.id : null)}
              width={224}
              ariaLabel="Purchase category actions"
              trigger={({ toggle, ariaLabel }) => (
                <button className="icon-btn" type="button" aria-label={ariaLabel} disabled={!canEditSettings} onClick={toggle}>
                  <MoreHorizontal size={15} />
                </button>
              )}
            >
              <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold hover:bg-slate-50" type="button" onClick={() => { setModal({ mode: "edit", row }); setCategoryActionId(null); }}>
                <Edit3 size={14} /> Edit
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-amber-700 hover:bg-amber-50"
                type="button"
                onClick={() => {
                  setCategoryConfirm({ type: "status", row, nextActive: !isActive });
                  setCategoryActionId(null);
                }}
              >
                <Settings size={14} /> {isActive ? "Deactivate" : "Reactivate"}
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                type="button"
                disabled={usage.isInUse}
                title={usage.isInUse ? "This category is in use. Deactivate it instead." : "Delete category"}
                onClick={() => {
                  setCategoryConfirm({ type: "delete", row });
                  setCategoryActionId(null);
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
            </ActionMenu>
          </div>
        );
      },
    },
  ];
  const taxColumns = [
    {
      key: "outlet",
      header: "Outlet",
      sticky: true,
      render: (row) => <span className="font-semibold">{store.outlets.find((outlet) => outlet.id === row.outlet_id)?.name ?? row.outlet_id}</span>,
    },
    { key: "tax_type", header: "Tax Type" },
    { key: "enabled", header: "Status", render: (row) => <Badge tone={row.enabled ? "success" : "neutral"}>{row.enabled ? "Enabled" : "Disabled"}</Badge> },
    { key: "rate", header: "Rate", align: "right", render: (row) => `${Number(row.rate || 0)}%` },
    { key: "effective_from", header: "Effective From" },
    { key: "effective_until", header: "Effective Until", render: (row) => row.effective_until || "Current" },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (row) => {
        const isFuture = row.effective_from > currentPeriodKey;
        return (
          <div className="flex justify-end gap-2">
            <button
              className="btn-secondary h-8 px-2 text-xs"
              type="button"
              disabled={!canEditSettings}
              onClick={() => {
                if (isFuture) {
                  setTaxValues({ ...row, enabled: String(Boolean(row.enabled)), mode: "editFuture", sourceId: row.id });
                  return;
                }
                setRevisionConfig(row);
              }}
            >
              <Edit3 size={13} /> Edit
            </button>
            <button className="btn-secondary h-8 px-2 text-xs" type="button" disabled={!canEditSettings} onClick={() => {
              setEndConfig(row);
              setEndUntil(row.effective_until || previousMonthKey(currentPeriodKey));
            }}>
              <SquarePen size={13} /> End
            </button>
          </div>
        );
      },
    },
  ];
  const fields = [
    { name: "name", label: "Name", placeholder: "Name" },
    ...(isChannels ? [{ name: "type", label: "Type", type: "select", options: [{ value: "channel", label: "Channel" }, { value: "total", label: "Total" }, { value: "adjustment", label: "Adjustment" }] }] : []),
    ...(isChannels ? [{ name: "sort_order", label: "Sort Order", placeholder: "1" }] : []),
    { name: "status", label: "Status", type: "select", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] },
  ];
  const currentTaxRows = store.outlets.map((outlet) => ({
    outlet,
    config: getOutletTaxConfig(store.outletTaxConfigs, outlet.id, taxMonth, taxYear, "SST"),
  }));
  const pageMeta = isChannels
    ? { section: "Sales", title: "Sales Channels", description: "Manage structured sales channels used by sales input, comparison and import templates." }
    : isCategories
      ? { section: "Purchases", title: "Purchase Categories", description: "Manage purchase categories used by supplier records, purchase comparison and import templates." }
      : { section: "Sales", title: "Tax Settings", description: "Manage outlet-level tax configuration history with effective dates." };

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!isCategories || !store.purchaseCategories.length) return undefined;
    let cancelled = false;
    purchaseCategoryService.getPurchaseCategoryUsageMap(store.purchaseCategories.map((category) => category.id))
      .then((usageMap) => {
        if (!cancelled) setCategoryUsage(usageMap);
      })
      .catch((error) => {
        console.error("Unable to load purchase category usage", error);
      });
    return () => {
      cancelled = true;
    };
  }, [isCategories, store.purchaseCategories]);

  async function refreshTaxConfigs() {
    const configs = await outletTaxConfigService.listOutletTaxConfigs();
    setStore((current) => ({ ...current, outletTaxConfigs: configs }));
    return configs;
  }

  async function handleTaxSubmit(values) {
    try {
      await outletTaxConfigService.saveOutletTaxConfig(values);
      await refreshTaxConfigs();
      setTaxValues(null);
      ui.notify({ title: "Tax configuration saved", message: "Saved to Supabase" });
    } catch (error) {
      console.error("Unable to save tax configuration", error);
      ui.notify({ title: "Unable to save tax configuration", message: error.message, tone: "error" });
    }
  }

  async function handleEndTaxConfig() {
    if (!endUntil || endUntil < endConfig.effective_from) {
      ui.notify({ title: "Invalid end month", message: "End month cannot be earlier than Effective From.", tone: "error" });
      return;
    }
    try {
      await outletTaxConfigService.endOutletTaxConfig(endConfig.id, endUntil);
      await refreshTaxConfigs();
      setEndConfig(null);
      ui.notify({ title: "Tax configuration ended", message: "Saved to Supabase" });
    } catch (error) {
      console.error("Unable to end tax configuration", error);
      ui.notify({ title: "Unable to end tax configuration", message: error.message, tone: "error" });
    }
  }

  async function handleMasterSubmit(values) {
    if (!values.name?.trim()) return ui.notify({ title: "Name required", tone: "error" });
    try {
      if (isChannels) {
        const saved = await salesChannelService.saveSalesChannel({ ...(modal.row ?? {}), ...values });
        setStore((current) => ({
          ...current,
          salesChannels: [
            ...current.salesChannels.filter((channel) => channel.id !== saved.id),
            saved,
          ].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)),
        }));
      } else {
        const saved = await purchaseCategoryService.savePurchaseCategory({ ...(modal.row ?? {}), ...values });
        setStore((current) => ({
          ...current,
          purchaseCategories: [
            ...current.purchaseCategories.filter((category) => category.id !== saved.id),
            saved,
          ].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)),
        }));
      }
      setModal(null);
      ui.notify({ title: "Settings saved", message: "Saved to Supabase" });
    } catch (error) {
      console.error("Unable to save settings", error);
      ui.notify({ title: "Unable to save settings", message: error.message, tone: "error" });
    }
  }

  async function handleCategoryDrop(targetCategoryId) {
    if (!canEditSettings || !draggedCategoryId || draggedCategoryId === targetCategoryId) {
      setDraggedCategoryId(null);
      return;
    }

    const currentOrder = [...categoryRows];
    const fromIndex = currentOrder.findIndex((category) => category.id === draggedCategoryId);
    const toIndex = currentOrder.findIndex((category) => category.id === targetCategoryId);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggedCategoryId(null);
      return;
    }

    const reordered = [...currentOrder];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const optimistic = reordered.map((category, index) => ({ ...category, sort_order: index + 1 }));

    setDraggedCategoryId(null);
    setStore((current) => ({ ...current, purchaseCategories: optimistic }));

    try {
      const saved = await purchaseCategoryService.updatePurchaseCategorySortOrder(optimistic);
      setStore((current) => ({ ...current, purchaseCategories: saved }));
      ui.notify({ title: "Purchase category order updated", message: "Saved to Supabase" });
    } catch (error) {
      console.error("Unable to reorder purchase categories", error);
      setStore((current) => ({ ...current, purchaseCategories: currentOrder }));
      ui.notify({ title: "Unable to reorder categories", message: error.message, tone: "error" });
    }
  }

  async function handleCategoryStatus(row, nextActive) {
    try {
      const saved = await purchaseCategoryService.setPurchaseCategoryActive(row, nextActive);
      setStore((current) => ({
        ...current,
        purchaseCategories: current.purchaseCategories
          .map((category) => (category.id === saved.id ? saved : category))
          .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name)),
      }));
      setCategoryConfirm(null);
      ui.notify({ title: nextActive ? "Purchase category reactivated" : "Purchase category deactivated", message: "Saved to Supabase" });
    } catch (error) {
      console.error("Unable to update purchase category status", error);
      ui.notify({ title: "Unable to update purchase category", message: error.message, tone: "error" });
    }
  }

  async function handleCategoryDelete(row) {
    try {
      await purchaseCategoryService.deletePurchaseCategory(row);
      setStore((current) => ({
        ...current,
        purchaseCategories: current.purchaseCategories.filter((category) => category.id !== row.id),
      }));
      setCategoryConfirm(null);
      ui.notify({ title: "Purchase category deleted", message: "Saved to Supabase" });
    } catch (error) {
      console.error("Unable to delete purchase category", error);
      ui.notify({ title: "Unable to delete purchase category", message: error.message, tone: "error" });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        section={pageMeta.section}
        title={pageMeta.title}
        description={pageMeta.description}
        actions={
          <button
            className="btn-primary"
            disabled={!canEditSettings}
            onClick={() => {
              if (isTax) {
                setTaxValues({ outlet_id: store.outlets[0]?.id, tax_type: "SST", enabled: "true", rate: 6, effective_from: "", effective_until: "" });
                return;
              }
              setModal({ mode: "add" });
            }}
          >
            <Plus size={16} /> Add
          </button>
        }
      />

      {settingsMode === "all" ? (
        <div className="card flex items-center p-2">
          <div className="flex gap-2">
            <button className={`h-10 rounded-xl px-4 text-sm font-semibold ${isChannels ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} onClick={() => setTab("channels")}>Sales Channels</button>
            <button className={`h-10 rounded-xl px-4 text-sm font-semibold ${isCategories ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} onClick={() => setTab("categories")}>Purchase Categories</button>
            <button className={`h-10 rounded-xl px-4 text-sm font-semibold ${isTax ? "bg-primary text-white" : "text-text-secondary hover:bg-slate-50"}`} onClick={() => setTab("tax")}>Tax Settings</button>
          </div>
        </div>
      ) : null}
      {isTax ? (
        <>
          <div className="card flex flex-wrap items-center justify-between gap-3 p-3">
            <div>
              <div className="text-sm font-bold text-text-primary">Resolve SST status for selected month</div>
              <p className="mt-1 text-xs text-text-secondary">Top cards use the same effective-date resolver as Sales Input, Data Health, and Alerts.</p>
            </div>
            <div className="flex items-center gap-2">
              <MonthSelector value={taxMonth} onChange={setTaxMonth} />
              <YearSelector value={taxYear} onChange={setTaxYear} />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {currentTaxRows.map(({ outlet, config }) => (
              <div key={outlet.id} className={`card p-4 ${config.missing ? "border-amber-200 bg-amber-50/50" : ""}`}>
                <div className="text-sm font-bold text-text-primary">{outlet.name}</div>
                <div className="mt-2 flex items-center justify-between">
                  <Badge tone={config.missing ? "warning" : config.enabled ? "success" : "neutral"}>
                    {config.missing ? "Missing Config" : `SST ${config.enabled ? "ON" : "OFF"}`}
                  </Badge>
                  <span className="text-sm font-bold text-text-primary">{Number(config.rate || 0)}%</span>
                </div>
                {config.missing ? (
                  <div className="mt-2 text-xs font-semibold text-amber-800">No tax config for selected month</div>
                ) : (
                  <div className="mt-2 text-xs text-text-secondary">
                    {selectedPeriodLabel(taxMonth, taxYear)}: {config.effective_from} → {config.effective_until || "Current"}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}
      <Card
        title={isChannels ? "Sales Channels" : isCategories ? "Purchase Categories" : "SST Configuration History"}
        description={isTax ? "Effective-date based tax history prevents future changes from rewriting historical months." : isCategories ? "Drag rows to set category order. Supplier counts and delete protection use live Supabase data." : "Structured master data powers future dashboards and imports."}
        action={isTax ? (
          <SelectField
            value={taxOutletFilter === "all" ? "" : taxOutletFilter}
            placeholder="All Outlets"
            className="w-44"
            searchable
            options={store.outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
            onChange={(nextValue) => setTaxOutletFilter(nextValue || "all")}
          />
        ) : null}
      >
        {isTax && !filteredTaxRows.length ? (
          <div className="p-6 text-sm font-semibold text-text-secondary">No tax configuration history found for this outlet.</div>
        ) : isCategories && !rows.length ? (
          <div className="p-6 text-sm font-semibold text-text-secondary">No purchase categories found.</div>
        ) : (
          <DataTable
            columns={isTax ? taxColumns : isCategories ? categoryColumns : masterColumns}
            rows={isTax ? filteredTaxRows : rows}
            getRowKey={(row) => row.id}
            density={isCategories ? "compact" : "normal"}
            getRowProps={isCategories ? (row) => ({
              draggable: canEditSettings,
              onDragStart: () => setDraggedCategoryId(row.id),
              onDragEnd: () => setDraggedCategoryId(null),
              onDragOver: (event) => {
                if (canEditSettings) event.preventDefault();
              },
              onDrop: (event) => {
                event.preventDefault();
                handleCategoryDrop(row.id);
              },
              className: draggedCategoryId === row.id ? "opacity-50" : "",
            }) : undefined}
          />
        )}
      </Card>
      {taxValues ? (
        <TaxConfigModal
          store={store}
          values={taxValues}
          setValues={setTaxValues}
          ui={ui}
          onClose={() => setTaxValues(null)}
          onSubmit={handleTaxSubmit}
        />
      ) : null}

      {revisionConfig ? (
        <Modal
          title="This configuration already affects historical records."
          description="Create a revision instead of silently overwriting financial configuration."
          onClose={() => setRevisionConfig(null)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setRevisionConfig(null)}>Cancel</button>
              {canForceEdit ? (
                <button
                  className="btn-secondary border-rose-200 text-rose-700 hover:bg-rose-50"
                  type="button"
                  onClick={() => {
                    setTaxValues({ ...revisionConfig, enabled: String(Boolean(revisionConfig.enabled)), mode: "forceEdit", sourceId: revisionConfig.id });
                    setRevisionConfig(null);
                  }}
                >
                  Force Edit
                </button>
              ) : null}
              <button
                className="btn-primary"
                type="button"
                onClick={() => {
                  const revisionStart = periodKeyFromParts(taxMonth, taxYear) > revisionConfig.effective_from ? periodKeyFromParts(taxMonth, taxYear) : currentPeriodKey;
                  setTaxValues({
                    outlet_id: revisionConfig.outlet_id,
                    tax_type: revisionConfig.tax_type,
                    enabled: String(Boolean(revisionConfig.enabled)),
                    rate: revisionConfig.rate,
                    effective_from: revisionStart,
                    effective_until: "",
                    mode: "add",
                  });
                  setRevisionConfig(null);
                }}
              >
                Create Revision
              </button>
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
              <div className="font-bold">Editing may affect:</div>
              <ul className="mt-2 space-y-1 text-xs leading-5">
                <li>- Net Sales</li>
                <li>- SST calculations</li>
                <li>- Reports</li>
                <li>- Alerts</li>
              </ul>
            </div>
            <p className="text-text-secondary">
              Current config: {revisionConfig.effective_from} → {revisionConfig.effective_until || "Current"} · {revisionConfig.enabled ? "Enabled" : "Disabled"} · {Number(revisionConfig.rate || 0)}%
            </p>
          </div>
        </Modal>
      ) : null}

      {endConfig ? (
        <Modal
          title="End Tax Configuration"
          description="Set the final month this configuration remains effective."
          onClose={() => setEndConfig(null)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setEndConfig(null)}>Cancel</button>
              <button
                className="btn-primary"
                type="button"
                onClick={handleEndTaxConfig}
              >
                End Config
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              <div className="font-bold">Current period</div>
              <p className="mt-1 text-xs">{endConfig.effective_from} → {endConfig.effective_until || "Current"}</p>
            </div>
            <FieldLabel label="Effective Until">
              <input className="control w-full" type="month" value={endUntil} onChange={(event) => setEndUntil(event.target.value)} />
            </FieldLabel>
          </div>
        </Modal>
      ) : null}

      {modal ? (
        <EntityModal
          title={`${modal.mode === "add" ? "Add" : "Edit"} ${isChannels ? "Sales Channel" : "Purchase Category"}`}
          fields={fields}
          initialValues={modal.row ?? { name: "", type: "channel", sort_order: rows.length + 1, status: "active" }}
          onClose={() => setModal(null)}
          onSubmit={handleMasterSubmit}
        />
      ) : null}

      {categoryConfirm ? (
        <Modal
          title={categoryConfirm.type === "delete" ? "Delete purchase category?" : `${categoryConfirm.nextActive ? "Reactivate" : "Deactivate"} ${categoryConfirm.row.name}?`}
          description={
            categoryConfirm.type === "delete"
              ? "This permanently removes the category. This is only allowed when it has no linked suppliers or purchase records."
              : categoryConfirm.nextActive
                ? "This category will become available for new supplier and import selections."
                : "Deactivating this category hides it from new supplier/import selections but keeps historical records intact."
          }
          onClose={() => setCategoryConfirm(null)}
          footer={
            <>
              <button className="btn-secondary" type="button" onClick={() => setCategoryConfirm(null)}>Cancel</button>
              {categoryConfirm.type === "delete" ? (
                <button className="btn-secondary border-rose-200 text-rose-700 hover:bg-rose-50" type="button" onClick={() => handleCategoryDelete(categoryConfirm.row)}>
                  Delete
                </button>
              ) : (
                <button className="btn-primary" type="button" onClick={() => handleCategoryStatus(categoryConfirm.row, categoryConfirm.nextActive)}>
                  {categoryConfirm.nextActive ? "Reactivate" : "Deactivate"}
                </button>
              )}
            </>
          }
        >
          <div className="rounded-2xl border border-border bg-slate-50 px-4 py-3 text-sm text-text-secondary">
            <div className="font-semibold text-text-primary">{categoryConfirm.row.name}</div>
            <div className="mt-1">
              {getCategoryUsage(categoryConfirm.row).activeSupplierCount} linked active suppliers · {getCategoryUsage(categoryConfirm.row).purchaseRecordCount} purchase records
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
