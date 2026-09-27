import {Fragment,useState,useMemo,useEffect,useRef,useCallback} from "react";
import {Download,Folder,ChevronDown} from "lucide-react";
import PageHeader from "../../../../components/layout/PageHeader.jsx";
import Badge from "../../../../components/ui/Badge.jsx";
import MetricCard from "../../../../components/ui/MetricCard.jsx";
import SelectField from "../../../../components/forms/SelectField.jsx";
import AdminFilterToolbar from "../../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../../components/forms/AdminSearchField.jsx";
import AdminSegmentedControl from "../../../../components/forms/AdminSegmentedControl.jsx";
import InventoryItemPhotoPreview from "../InventoryItemPhotoPreview.jsx";
import EmptyState from "../../../../components/feedback/EmptyState.jsx";
import {getAccessibleOutlets,hasPermission,notifyPermissionDenied} from "../../../../utils/accessControl.js";
import { normalizeInventoryItem, uniqueIds, buildOutletConfig, outletConfigForItem, isActiveInventoryItem, categoryForItem, outletDisplayName, outletDisplayCode } from "../inventoryItemModel.js";
import { InventoryCategoryIcon, SupplierAssignmentPicker, SectionCard, focusEditableGridInput, focusMatrixGridInput, selectInputText, parseNonNegativeNumber, csvEscape, downloadTextFile, todayInput } from "../InventorySharedPresentation.jsx";
import {persistRemoteParLevelConfig,loadInventoryParLevels} from "./inventoryParLevelsService.js";
export default function InventoryParLevelsPage({auth,ui,outlets:outletContext=[],suppliers=[]}) {
 const outlets=useMemo(()=>getAccessibleOutlets(auth,outletContext),[auth,outletContext]);
 const scopeKey=[auth?.user?.id||'',...outlets.map(row=>row.id)].join('|');
 const [data,setData]=useState({items:[],categories:[]});
 const [read,setRead]=useState({key:'',state:'loading',error:''});
 const readRequest=useRef(0),mutationEpoch=useRef(0);
 const [query,setQuery]=useState(''),[categoryFilter,setCategoryFilter]=useState('all'),[photoPreview,setPhotoPreview]=useState(null);
const [parLevelView, setParLevelView] = useState("outlet");
const [parLevelGroupBy, setParLevelGroupBy] = useState("category");
const [collapsedParCategoryIds, setCollapsedParCategoryIds] = useState(() => new Set());
const [parLevelOutletId, setParLevelOutletId] = useState(outlets[0]?.id ?? "");
const [parLevelSaveState, setParLevelSaveState] = useState("saved");
const parLevelGridRef = useRef(null);
const parLevelMatrixRef = useRef(null);
const parLevelSaveRequestsRef = useRef(new Map());
const parLevelSaveStatusRequestRef = useRef(0);
 const refresh=useCallback(async()=>{
  const id=++readRequest.current;
  setRead({key:scopeKey,state:'loading',error:''});
  try {const next=await loadInventoryParLevels(outlets.map(row=>row.id));if(id!==readRequest.current)return;setData(next);setRead({key:scopeKey,state:'ready',error:''});}
  catch(error){if(id===readRequest.current)setRead({key:scopeKey,state:error.readState||'error',error:error.message});}
 },[scopeKey]);
 useEffect(()=>{mutationEpoch.current++;parLevelSaveRequestsRef.current.clear();refresh();return()=>{readRequest.current++;mutationEpoch.current++;};},[refresh]);
 useEffect(()=>{if(!outlets.some(row=>row.id===parLevelOutletId))setParLevelOutletId(outlets[0]?.id||'');},[outlets,parLevelOutletId]);
 const can={editParLevels:hasPermission(auth,'inventory_par_levels.edit'),exportParLevels:hasPermission(auth,'inventory_par_levels.export')};
 const categoryById=useMemo(()=>new Map(data.categories.map(row=>[row.id,row])),[data.categories]);
 const outletById=useMemo(()=>new Map(outlets.map(row=>[row.id,row])),[outlets]);
 const sortedCategories=useMemo(()=>[...data.categories].sort((a,b)=>Number(a.sortOrder??0)-Number(b.sortOrder??0)||a.name.localeCompare(b.name)),[data.categories]);
 const notify=(title,message='',tone='success')=>ui?.notify?.({title,message,tone});
 const requirePermission=(allowed,action)=>{if(allowed)return true;notifyPermissionDenied(ui,action);return false;};
async function saveParLevelConfig(itemId, outletId, patch) {
    if (!requirePermission(can.editParLevels, "edit par levels")) return;
    const item = data.items.find((entry) => entry.id === itemId);
    if (!item) {
      notify("Unable to save Par Level", "Inventory item was not found.", "error");
      return;
    }
    const epoch=mutationEpoch.current;
    const configKey = `${itemId}:${outletId}`;
    const priorRequest = parLevelSaveRequestsRef.current.get(configKey);
    const currentConfig = outletConfigForItem(item, outletId);
    const baseConfig = priorRequest?.intentConfig || currentConfig;
    const intentConfig = {
      ...baseConfig,
      ...(Object.prototype.hasOwnProperty.call(patch, "parLevel") ? { parLevel: patch.parLevel } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "storageLocation") ? { storageLocation: patch.storageLocation } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "supplierIds") ? { supplierIds: uniqueIds(patch.supplierIds || []) } : {}),
    };
    const requestSequence = (priorRequest?.sequence || 0) + 1;
    const statusSequence = parLevelSaveStatusRequestRef.current + 1;
    parLevelSaveRequestsRef.current.set(configKey, { sequence: requestSequence, intentConfig });
    parLevelSaveStatusRequestRef.current = statusSequence;
    setParLevelSaveState("saving");
    const persistencePatch = {
      ...patch,
      parLevel: intentConfig.parLevel,
      storageLocation: intentConfig.storageLocation,
    };
    const isLatestRequest = () => epoch===mutationEpoch.current && parLevelSaveRequestsRef.current.get(configKey)?.sequence === requestSequence;
    const isLatestStatus = () => epoch===mutationEpoch.current && parLevelSaveStatusRequestRef.current === statusSequence;
    try {
      const savedConfig = await persistRemoteParLevelConfig(item, outletId, persistencePatch);
      if (isLatestRequest()) {
        parLevelSaveRequestsRef.current.set(configKey, { sequence: requestSequence, intentConfig: savedConfig });
        setData((current) => ({
          ...current,
          items: current.items.map((entry) => {
            if (entry.id !== itemId) return entry;
            const normalized = normalizeInventoryItem(entry);
            const linkedOutletIds = uniqueIds(normalized.linkedOutletIds);
            const existing = new Map((normalized.outletConfigs || []).map((config) => [config.outletId, config]));
            existing.set(outletId, savedConfig);
            const outletConfigs = linkedOutletIds.map((id) => buildOutletConfig({ ...normalized, linkedOutletIds }, id, existing.get(id)));
            return normalizeInventoryItem({ ...normalized, linkedOutletIds, outletConfigs });
          }),
        }));
      }
      if (isLatestStatus()) setParLevelSaveState("saved");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save Par Level config.", error);
      if (isLatestRequest()) {
        parLevelSaveRequestsRef.current.set(configKey, { sequence: requestSequence, intentConfig: currentConfig });
        if (isLatestStatus()) setParLevelSaveState("error");
        notify("Unable to save Par Level", error.message || "Please try again.", "error");
      }
    }
  }
function supplierNamesForConfig(config = {}) {
    return (config.supplierIds || [])
      .map((id) => suppliers.find((supplier) => supplier.id === id)?.name)
      .filter(Boolean)
      .join(", ");
  }
function exportParLevels() {
    const activeOutletId = parLevelOutletId || outlets[0]?.id || "";
    const scopedOutlets = parLevelView === "outlet"
      ? outlets.filter((outlet) => outlet.id === activeOutletId)
      : outlets;
    const rows = [];
    data.items
      .filter((item) => {
        const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
        const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter || item.category_id === categoryFilter;
        return matchesQuery && matchesCategory;
      })
      .forEach((item) => {
        const category = categoryForItem(item, categoryById);
        scopedOutlets.forEach((outlet) => {
          if (!item.linkedOutletIds?.includes(outlet.id)) return;
          const config = outletConfigForItem(item, outlet.id);
          rows.push({
            "Item Name": item.name,
            "SKU Code": item.sku_code || item.sku,
            Category: category?.name || "",
            Unit: item.uom_code || item.unit,
            Outlet: outlet.name,
            "Par Level": config.parLevel,
            "Storage Location": config.storageLocation,
            Suppliers: supplierNamesForConfig(config),
          });
        });
      });
    const columns = ["Item Name", "SKU Code", "Category", "UOM", "Outlet", "Par Level", "Storage Location", "Suppliers"];
    rows.forEach((row) => { row.UOM = row.Unit; delete row.Unit; });
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    downloadTextFile(`feedx-par-levels-${todayInput()}.csv`, csv);
    notify("Par levels exported successfully", `${rows.length} outlet item config${rows.length === 1 ? "" : "s"} exported.`);
  }
function renderParLevels() {
    const activeOutletId = parLevelOutletId || outlets[0]?.id || "";
    const operationalItems = data.items.filter(isActiveInventoryItem);
    const outletScopedItems = operationalItems.filter((item) => {
      const matchesOutlet = item.linkedOutletIds?.includes(activeOutletId);
      const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
      const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
      return matchesOutlet && matchesQuery && matchesCategory;
    });
    const parItems = operationalItems.filter((item) => {
      const hasLinkedOutlet = item.linkedOutletIds?.length;
      const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
      const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter;
      return hasLinkedOutlet && matchesQuery && matchesCategory;
    });
    const parItemGroups = [...outletScopedItems.reduce((groups, item) => {
      const category = categoryById.get(item.categoryId);
      const key = item.categoryId || "uncategorized";
      if (!groups.has(key)) groups.set(key, { id: key, category, items: [] });
      groups.get(key).items.push(item);
      return groups;
    }, new Map()).values()].sort((a, b) => Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999) || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));
    const matrixOutlets = outlets;
    const matrixItemGroups = [...parItems.reduce((groups, item) => {
      const category = categoryById.get(item.categoryId);
      const key = item.categoryId || "uncategorized";
      if (!groups.has(key)) groups.set(key, { id: key, category, items: [] });
      groups.get(key).items.push(item);
      return groups;
    }, new Map()).values()].sort((a, b) => Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999) || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));
    const visibleMatrixItems = matrixItemGroups.flatMap((group) => group.items);
    const visibleMatrixRowIndex = new Map(visibleMatrixItems.map((item, index) => [item.id, index]));
    const configuredMatrixCount = visibleMatrixItems.reduce((count, item) => count + matrixOutlets.filter((outlet) => {
      if (!item.linkedOutletIds?.includes(outlet.id)) return false;
      const value = outletConfigForItem(item, outlet.id).parLevel;
      return value !== "" && value !== null && value !== undefined;
    }).length, 0);
    const linkedMatrixCount = visibleMatrixItems.reduce((count, item) => count + matrixOutlets.filter((outlet) => item.linkedOutletIds?.includes(outlet.id)).length, 0);
    const matrixValuesByItem = new Map(visibleMatrixItems.map((item) => {
      const values = matrixOutlets
        .filter((outlet) => item.linkedOutletIds?.includes(outlet.id))
        .map((outlet) => Number(outletConfigForItem(item, outlet.id).parLevel))
        .filter((value) => Number.isFinite(value) && value > 0);
      return [item.id, values];
    }));
    const visibleParItems = parLevelGroupBy === "category"
      ? parItemGroups.flatMap((group) => collapsedParCategoryIds.has(group.id) ? [] : group.items)
      : outletScopedItems;
    const visibleParRowIndex = new Map(visibleParItems.map((item, index) => [item.id, index]));

    function handleParGridKeyDown(event, itemId, field) {
      const rowIndex = visibleParRowIndex.get(itemId);
      if (rowIndex === undefined) return;
      const keyMap = {
        Enter: event.shiftKey ? "previous-row" : "next-row",
        Tab: event.shiftKey ? "left" : "right",
        ArrowDown: "next-row",
        ArrowUp: "previous-row",
        ArrowRight: "right",
        ArrowLeft: "left",
      };
      const direction = keyMap[event.key];
      if (!direction) return;
      event.preventDefault();
      focusEditableGridInput(parLevelGridRef, rowIndex, field, direction);
    }

    function handleMatrixKeyDown(event, itemId, outletIndex) {
      const rowIndex = visibleMatrixRowIndex.get(itemId);
      if (rowIndex === undefined) return;
      const keyMap = {
        Enter: event.shiftKey ? "previous-row" : "next-row",
        ArrowDown: "next-row",
        ArrowUp: "previous-row",
        ArrowRight: "right",
        ArrowLeft: "left",
      };
      const direction = keyMap[event.key];
      if (!direction) return;
      event.preventDefault();
      focusMatrixGridInput(parLevelMatrixRef, rowIndex, outletIndex, direction);
    }

    function matrixInputClass(item, outlet) {
      const value = outletConfigForItem(item, outlet.id).parLevel;
      const numericValue = Number(value);
      const values = matrixValuesByItem.get(item.id) || [];
      const positiveValues = values.filter((entry) => entry > 0);
      const average = positiveValues.length ? positiveValues.reduce((sum, entry) => sum + entry, 0) / positiveValues.length : 0;
      const isMissing = value === "" || value === null || value === undefined;
      const isZero = !isMissing && Number(value) === 0;
      const isInvalid = !isMissing && numericValue < 0;
      const isOutlier = positiveValues.length >= 3 && numericValue > 0 && average > 0 && (numericValue > average * 2.2 || numericValue < average * 0.45);
      if (isInvalid) return "border-rose-300 bg-rose-50 text-rose-800 focus:ring-rose-200";
      if (isZero || isMissing) return "border-amber-200 bg-amber-50/60 text-amber-800 placeholder:text-amber-600 focus:ring-amber-100";
      if (isOutlier) return "border-sky-200 bg-sky-50/70 text-sky-800 focus:ring-sky-100";
      return "border-border bg-white text-text-primary";
    }

    const renderParRow = (item) => {
      const category = categoryById.get(item.categoryId);
      const config = outletConfigForItem(item, activeOutletId);
      const photo = item.photo || item.photo_url;
      const rowIndex = visibleParRowIndex.get(item.id) ?? -1;
      return (
        <tr key={item.id} className="transition hover:bg-primary/5">
          <td className="py-3.5">
            <div className="flex items-center gap-3">
              {photo ? (
                <button
                  className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl border border-border bg-slate-50 transition hover:border-primary/40 hover:shadow-sm"
                  type="button"
                  onClick={() => setPhotoPreview({ src: photo, title: item.name })}
                  aria-label={`View photo for ${item.name}`}
                >
                  <img className="h-full w-full object-cover" src={photo} alt={item.name} />
                </button>
              ) : (
                <InventoryCategoryIcon category={category} size="sm" />
              )}
              <div className="min-w-0">
                <div className="truncate font-bold text-text-primary">{item.name}</div>
                <div className="truncate type-caption text-text-secondary">{item.sku || "No SKU"} · {category?.name ?? "Uncategorized"}</div>
              </div>
            </div>
          </td>
          <td className="font-semibold text-text-secondary">{item.unit}</td>
          <td>
            <input
              className="control h-8 w-28 text-[13px]"
              type="number"
              min="0"
              value={config.parLevel ?? ""}
              placeholder="Enter quantity"
              data-grid-row={rowIndex}
              data-grid-field="par"
              onFocus={selectInputText}
              onKeyDown={(event) => handleParGridKeyDown(event, item.id, "par")}
              onChange={(event) => saveParLevelConfig(item.id, activeOutletId, { parLevel: parseNonNegativeNumber(event.target.value) })}
              disabled={!can.editParLevels}
            />
          </td>
          <td>
            <input
              className="control h-8 min-w-44 text-[13px]"
              value={config.storageLocation}
              data-grid-row={rowIndex}
              data-grid-field="storage"
              onFocus={selectInputText}
              onKeyDown={(event) => handleParGridKeyDown(event, item.id, "storage")}
              onChange={(event) => saveParLevelConfig(item.id, activeOutletId, { storageLocation: event.target.value })}
              placeholder="Optional"
              disabled={!can.editParLevels}
            />
          </td>
          <td>
            <SupplierAssignmentPicker
              suppliers={suppliers}
              outletId={activeOutletId}
              selectedIds={config.supplierIds}
              onSave={(supplierIds) => saveParLevelConfig(item.id, activeOutletId, { supplierIds })}
              disabled={!can.editParLevels}
            />
          </td>
        </tr>
      );
    };

    const contentActions = <div className="flex flex-wrap items-center justify-end gap-3">
      <span role="status" aria-live="polite">
        <Badge tone={parLevelSaveState === "saving" ? "info" : parLevelSaveState === "error" ? "danger" : "neutral"}>
          {parLevelSaveState === "saving" ? "Saving..." : parLevelSaveState === "error" ? "Save failed" : "Saved"}
        </Badge>
      </span>
      <AdminSegmentedControl label="Par Level view" value={parLevelView} onChange={setParLevelView} options={[
        { value: "outlet", label: "Outlet View" },
        { value: "matrix", label: "Matrix View" },
      ]} />
    </div>;

    return (
      <div className="space-y-4">
        <AdminFilterToolbar outlet={parLevelView === "outlet" ? (
              <SelectField
                label="Outlet"
                value={activeOutletId}
                options={outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))}
                onChange={setParLevelOutletId}
                searchable
              />
            ) : (
              <div className="min-w-0">
                <div className="mb-1 type-caption font-semibold text-text-secondary">Outlet Scope</div>
                <div className="control flex h-9 items-center justify-between text-[13px] font-semibold text-text-primary">
                  <span>All accessible outlets</span>
                  <Badge tone="info">{outlets.length}</Badge>
                </div>
              </div>
            )} search={<AdminSearchField label="Search item" value={query} onChange={setQuery} placeholder="Search item name or SKU" />} filters={<>
            <SelectField label="Category" value={categoryFilter} options={[{ value: "all", label: "All" }, ...sortedCategories.map((category) => ({ value: category.id, label: category.name }))]} onChange={setCategoryFilter} searchable />
            {parLevelView === "outlet" ? <SelectField label="Group by" value={parLevelGroupBy} options={[{ value: "category", label: "Category" }, { value: "none", label: "None" }]} onChange={setParLevelGroupBy} /> : null}
          </>} />

        {parLevelView === "outlet" ? (
          <SectionCard
            title={`${outletById.get(activeOutletId)?.name ?? "Outlet"} Par Levels`}
            description="Set the minimum quantity this outlet should keep for each linked item."
            action={contentActions}
          >
            {outletScopedItems.length ? (
              <div className="overflow-x-auto" ref={parLevelGridRef}>
                <table className="w-full min-w-[960px] text-left">
                  <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                    <tr className="border-b border-border">
                      <th className="py-2">Item</th>
                      <th>UOM</th>
                      <th>Par Level</th>
                      <th>Storage Location</th>
                      <th>Suppliers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-[13px]">
                    {parLevelGroupBy === "category" ? parItemGroups.map((group) => {
                      const collapsed = collapsedParCategoryIds.has(group.id);
                      return (
                        <Fragment key={group.id}>
                          <tr className="bg-primary/5">
                            <td className="py-2.5" colSpan={5}>
                              <button
                                className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-left transition hover:bg-primary/8"
                                type="button"
                                onClick={() => setCollapsedParCategoryIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(group.id)) next.delete(group.id);
                                  else next.add(group.id);
                                  return next;
                                })}
                              >
                                <span className="flex min-w-0 items-center gap-2.5">
                                  <Folder className="shrink-0 text-primary" size={18} strokeWidth={2.2} />
                                  <span className="min-w-0">
                                    <span className="block text-[15px] font-black leading-tight text-text-primary">{group.category?.name || "Uncategorized"}</span>
                                    <span className="block type-caption font-semibold text-text-secondary">{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
                                  </span>
                                </span>
                                <ChevronDown className={`text-text-muted transition ${collapsed ? "-rotate-90" : ""}`} size={16} />
                              </button>
                            </td>
                          </tr>
                          {collapsed ? null : group.items.map(renderParRow)}
                        </Fragment>
                      );
                    }) : outletScopedItems.map(renderParRow)}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState title="No linked items for this outlet" description="Link items to this outlet from Master Inventory before setting par levels." />}
          </SectionCard>
        ) : (
          <SectionCard title="Par Level Matrix" description="HQ view for comparing item par levels across outlets." action={contentActions}>
            {parItems.length ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <MetricCard label="Items" value={visibleMatrixItems.length} helper="Linked inventory rows" size="compact" />
                  <MetricCard label="Categories" value={matrixItemGroups.length} helper="Grouped for scanning" size="compact" />
                  <MetricCard label="Outlets" value={matrixOutlets.length} helper="All accessible outlets" size="compact" />
                  <MetricCard label="Configured" value={configuredMatrixCount} helper="Cells with par level" tone="success" size="compact" />
                  <MetricCard label="Missing" value={Math.max(0, linkedMatrixCount - configuredMatrixCount)} helper="Linked but not set" tone={linkedMatrixCount - configuredMatrixCount ? "warning" : "success"} size="compact" />
                </div>
                <div className="overflow-x-auto rounded-2xl border border-border" ref={parLevelMatrixRef}>
                  <table className="w-full min-w-[980px] border-separate border-spacing-0 text-left">
                    <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                      <tr className="border-b border-border">
                        <th className="sticky left-0 z-10 w-[260px] border-b border-border bg-surface px-3 py-2">Item</th>
                        <th className="sticky left-[260px] z-10 w-[120px] border-b border-border bg-surface px-3 py-2">Category / UOM</th>
                        {matrixOutlets.map((outlet) => (
                          <th key={outlet.id} className="min-w-[150px] border-b border-border bg-primary/5 px-3 py-2">
                            <div className="rounded-2xl border border-primary/10 bg-white/80 px-3 py-2 normal-case shadow-sm">
                              <div className="type-body-sm font-black text-text-primary" title={outletDisplayName(outlet)}>{outletDisplayCode(outlet)}</div>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-[13px]">
                      {matrixItemGroups.map((group) => (
                        <Fragment key={group.id}>
                          <tr className="bg-primary/5">
                            <td className="sticky left-0 z-10 border-b border-border bg-primary/5 px-3 py-2.5" colSpan={2}>
                              <div className="flex min-h-14 items-center gap-2.5 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3">
                                <Folder className="shrink-0 text-primary" size={18} strokeWidth={2.2} />
                                <div className="min-w-0">
                                  <div className="text-[15px] font-black leading-tight text-text-primary">{group.category?.name || "Uncategorized"}</div>
                                  <div className="type-caption font-semibold text-text-secondary">{group.items.length} item{group.items.length === 1 ? "" : "s"}</div>
                                </div>
                              </div>
                            </td>
                            <td className="border-b border-border bg-primary/5 px-3 py-2.5" colSpan={matrixOutlets.length} />
                          </tr>
                          {group.items.map((item) => {
                            const rowIndex = visibleMatrixRowIndex.get(item.id) ?? -1;
                            return (
                              <tr key={item.id} className="transition hover:bg-primary/5">
                                <td className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-3">
                                  <div className="font-bold text-text-primary">{item.name}</div>
                                  <div className="truncate type-caption text-text-secondary">{item.sku || "No SKU"}</div>
                                </td>
                                <td className="sticky left-[260px] z-10 border-b border-border bg-surface px-3 py-3">
                                  <div className="type-caption font-semibold text-text-secondary">{group.category?.name ?? "Uncategorized"}</div>
                                  <div className="type-body-sm font-black text-text-primary">{item.unit}</div>
                                </td>
                                {matrixOutlets.map((outlet, outletIndex) => {
                                  const linked = item.linkedOutletIds?.includes(outlet.id);
                                  const config = outletConfigForItem(item, outlet.id);
                                  return (
                                    <td key={outlet.id} className="border-b border-border px-3 py-3">
                                      {linked ? (
                                        <input
                                          className={`h-9 w-28 rounded-xl border px-3 text-[13px] font-bold outline-none transition focus:ring-2 ${matrixInputClass(item, outlet)}`}
                                          type="number"
                                          min="0"
                                          value={config.parLevel ?? ""}
                                          placeholder="Not set"
                                          data-matrix-row={rowIndex}
                                          data-matrix-column={outletIndex}
                                          onFocus={selectInputText}
                                          onKeyDown={(event) => handleMatrixKeyDown(event, item.id, outletIndex)}
                                          onChange={(event) => saveParLevelConfig(item.id, outlet.id, { parLevel: parseNonNegativeNumber(event.target.value) })}
                                          disabled={!can.editParLevels}
                                        />
                                      ) : (
                                        <span className="inline-flex h-9 w-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 type-body-sm font-black text-text-muted" title={`${item.name} is not linked to ${outlet.name}`}>⊘</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : <EmptyState title="No inventory items found" description="Adjust filters or create inventory items first." />}
          </SectionCard>
        )}
      </div>
    );
  }
 const ready=read.key===scopeKey&&read.state==='ready';
 return <div className="space-y-4"><PageHeader section="INVENTORY CONTROL" title="Par Levels" description="Bulk manage outlet-specific minimum stock levels." actions={ready?<button className="btn-secondary" type="button" onClick={()=>requirePermission(can.exportParLevels,'export par levels')&&exportParLevels()}><Download size={15}/> Export</button>:null}/>{ready?renderParLevels():<div className="card p-4" role={read.state==='loading'?'status':'alert'}><h2 className="font-semibold">{read.key!==scopeKey||read.state==='loading'?'Loading complete Par Level data…':'Par Level data unavailable or incomplete'}</h2>{read.key===scopeKey&&read.state!=='loading'?<><p className="mt-2 text-sm text-text-secondary">{read.error} No partial results are presented as complete.</p><button className="btn-secondary mt-3" type="button" onClick={refresh}>Retry</button></>:null}</div>}<InventoryItemPhotoPreview preview={photoPreview} onClose={()=>setPhotoPreview(null)}/></div>;
}
