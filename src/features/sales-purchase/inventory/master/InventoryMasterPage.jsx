import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, CheckCircle2, ChevronDown, ClipboardList, Download, Folder, GripVertical, PackagePlus, Plus, RefreshCw, Trash2, Upload, Warehouse } from 'lucide-react';
import PageHeader from '../../../../components/layout/PageHeader.jsx';
import Modal from '../../../../components/feedback/Modal.jsx';
import MetricCard from '../../../../components/ui/MetricCard.jsx';
import Badge from '../../../../components/ui/Badge.jsx';
import FloatingLayer from '../../../../components/ui/FloatingLayer.jsx';
import SelectField from '../../../../components/forms/SelectField.jsx';
import AdminFilterToolbar from '../../../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../../../components/forms/AdminSearchField.jsx';
import EmptyState from '../../../../components/feedback/EmptyState.jsx';
import { supabase } from '../../../../lib/supabase.ts';
import { subscribeInventoryRevalidation, invalidateInventoryReads } from '../../../../services/inventoryRevalidation.js';
import { getAccessibleOutletOptions, getAccessibleOutlets, hasAllOutletAccess, hasPermission, notifyPermissionDenied } from '../../../../utils/accessControl.js';
import { IMAGE_UPLOAD_ACCEPT, isImageDataUrl as isStandardImageDataUrl, optimizeImageFileForPreview, removeStorageObjectFromPublicUrl, uploadOptimizedImage } from '../../../../utils/imageUpload.js';
import { normalizeOutletRecord, normalizeInventoryItem, uniqueIds, buildOutletConfig, isActiveInventoryItem, categoryForItem, canonical, isUuid, outletDisplayCode, outletDisplayName } from '../inventoryItemModel.js';
import { InventoryCategoryIcon, SectionCard, TextArea, Field, selectInputText, csvEscape, downloadTextFile, todayInput } from '../InventorySharedPresentation.jsx';
import InventoryItemPhotoPreview from '../InventoryItemPhotoPreview.jsx';
import { loadInventoryMaster, normalizeUom, persistRemoteInventoryItem, persistRemoteInventoryCategory, persistRemoteInventoryUom, countRemoteInventoryItemsForCategory, countRemoteInventoryItemsForUom, uomSaveErrorMessage } from './inventoryMasterService.js';

const statuses = ['active', 'inactive', 'archived'];

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function debugLog(...args) {
  if (import.meta.env.DEV) console.log(...args);
}

function toTitle(value = "") {
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}



function formatInventoryCost(value, unit = "") {
  if (value === "" || value === null || value === undefined) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const formatted = amount.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `RM ${formatted}${unit ? ` / ${unit}` : ""}`;
}

function parseInventoryCostInput(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^\d+(\.\d{0,4})?$/.test(raw)) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}







function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}


function statusTone(status) {
  if (["active", "normal", "completed", "reviewed", "locked", "delivered", "fully_received"].includes(status)) return "success";
  if (["draft", "due today", "scheduled", "partial approved", "partial delivery", "partial_delivered", "partial_received"].includes(status)) return "warning";
  if (["critical", "shortage", "overdue", "missed", "rejected", "archived", "cancelled"].includes(status)) return "danger";
  if (["excess", "sent", "submitted", "confirmed", "supplier_confirmed", "ordered", "packing"].includes(status)) return "info";
  return "neutral";
}


function parseCsvLine(line = "") {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0] || "");
  const rows = lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    return headers.reduce((record, header, cellIndex) => ({ ...record, [header]: cells[cellIndex] ?? "" }), { __row: index + 2 });
  });
  return { headers, rows };
}

function readUInt16(view, offset) {
  return view.getUint16(offset, true);
}

function readUInt32(view, offset) {
  return view.getUint32(offset, true);
}

function columnIndex(cellRef = "") {
  const letters = String(cellRef).match(/[A-Z]+/i)?.[0] ?? "A";
  return [...letters.toUpperCase()].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("XLSX parsing requires browser ZIP support. Please use CSV in this browser.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsx(buffer) {
  const view = new DataView(buffer);
  let eocdOffset = -1;
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 66000); offset -= 1) {
    if (readUInt32(view, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Unable to read XLSX workbook.");
  const entryCount = readUInt16(view, eocdOffset + 10);
  let centralOffset = readUInt32(view, eocdOffset + 16);
  const files = {};
  const decoder = new TextDecoder();

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(view, centralOffset) !== 0x02014b50) break;
    const method = readUInt16(view, centralOffset + 10);
    const compressedSize = readUInt32(view, centralOffset + 20);
    const fileNameLength = readUInt16(view, centralOffset + 28);
    const extraLength = readUInt16(view, centralOffset + 30);
    const commentLength = readUInt16(view, centralOffset + 32);
    const localOffset = readUInt32(view, centralOffset + 42);
    const name = decoder.decode(new Uint8Array(buffer, centralOffset + 46, fileNameLength));
    const localNameLength = readUInt16(view, localOffset + 26);
    const localExtraLength = readUInt16(view, localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = new Uint8Array(buffer, dataOffset, compressedSize);
    const bytes = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (bytes) files[name] = decoder.decode(bytes);
    centralOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function textFromXlsxCell(cell, sharedStrings) {
  const type = cell.getAttribute("t");
  if (type === "s") {
    const index = Number(cell.querySelector("v")?.textContent ?? -1);
    return sharedStrings[index] ?? "";
  }
  if (type === "inlineStr") return [...cell.querySelectorAll("t")].map((item) => item.textContent ?? "").join("");
  return cell.querySelector("v")?.textContent ?? "";
}

async function parseXlsx(file) {
  const files = await unzipXlsx(await file.arrayBuffer());
  const parser = new DOMParser();
  const sharedStringsXml = files["xl/sharedStrings.xml"];
  const sharedStrings = sharedStringsXml
    ? [...parser.parseFromString(sharedStringsXml, "application/xml").querySelectorAll("si")].map((node) => [...node.querySelectorAll("t")].map((item) => item.textContent ?? "").join(""))
    : [];
  const sheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("No worksheet found in XLSX file.");
  const sheet = parser.parseFromString(files[sheetName], "application/xml");
  const rawRows = [...sheet.querySelectorAll("sheetData row")].map((rowNode) => {
    const values = [];
    [...rowNode.querySelectorAll("c")].forEach((cell) => {
      values[columnIndex(cell.getAttribute("r"))] = textFromXlsxCell(cell, sharedStrings);
    });
    return values;
  }).filter((row) => row.some((cell) => String(cell ?? "").trim()));
  const headers = rawRows[0]?.map((cell) => String(cell ?? "").trim()) ?? [];
  const rows = rawRows.slice(1).map((row, index) => headers.reduce((record, header, cellIndex) => ({ ...record, [header]: row[cellIndex] ?? "" }), { __row: index + 2 }));
  return { headers, rows };
}

async function uploadInventoryItemPhoto(file, itemId = "draft", previousPublicUrl = "") {
  const bucket = "inventory-item-photos";
  const path = `${itemId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webp`;
  return uploadOptimizedImage(file, { bucket, path, previousPublicUrl });
}



function sameIdSet(first = [], second = []) {
  const left = uniqueIds(first).sort();
  const right = uniqueIds(second).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isImageDataUrl(value) {
  return isStandardImageDataUrl(value);
}



function MultiOutletPicker({ outlets, selectedIds, onChange }) {
  const selected = new Set(selectedIds || []);
  return (
    <div className="rounded-2xl border border-border p-2">
      <div className="mb-2 type-caption font-semibold text-text-secondary">Linked Outlets</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {outlets.map((outlet) => (
          <button
            key={outlet.id}
            type="button"
            className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-[13px] font-semibold transition ${
              selected.has(outlet.id) ? "border-primary/40 bg-primary/8 text-primary" : "border-border text-text-secondary hover:bg-slate-50"
            }`}
            onClick={() => {
              const next = new Set(selected);
              if (next.has(outlet.id)) next.delete(outlet.id);
              else next.add(outlet.id);
              onChange([...next]);
            }}
          >
            <span>{outlet.name}</span>
            {selected.has(outlet.id) ? <CheckCircle2 size={15} /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function LinkedOutletsSummary({ item, outlets, onConfigure }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const normalizedOutlets = useMemo(() => outlets.map(normalizeOutletRecord), [outlets]);
  const outletById = useMemo(() => new Map(normalizedOutlets.map((outlet) => [outlet.id, outlet])), [normalizedOutlets]);
  const configs = normalizeInventoryItem(item).outletConfigs || [];
  const linkedOutletsRaw = useMemo(() => configs.map((config) => ({
    config,
    outlet: outletById.get(config.outletId) || null,
  })), [configs, outletById]);
  const mappedOutletLabels = linkedOutletsRaw.map(({ outlet }) => outlet ? outletDisplayCode(outlet) : "Outlet");
  const visibleCodes = mappedOutletLabels.slice(0, 3);
  const hiddenCount = Math.max(0, configs.length - visibleCodes.length);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    debugLog("[OutletChipDebug]", {
      browser: navigator.userAgent,
      linkedOutletsRaw,
      mappedOutletLabels,
    });
  }, [item.id, configs.length, linkedOutletsRaw, mappedOutletLabels]);

  const linkedOutletCards = configs.map((config) => {
    const outlet = outletById.get(config.outletId);
    return { config, outlet };
  });

  return (
    <div ref={anchorRef} className="inline-flex">
      <button
        className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 type-caption font-bold text-text-primary transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        {visibleCodes.length ? visibleCodes.map((code, index) => (
          <span key={`${code}-${index}`} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-text-secondary">{code}</span>
        )) : <span>No outlets</span>}
        {hiddenCount ? <span className="text-text-muted">+{hiddenCount}</span> : null}
        <ChevronDown size={13} />
      </button>
      <FloatingLayer open={open} onOpenChange={setOpen} anchorRef={anchorRef} align="start" width={320} estimatedHeight={280} className="p-0">
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="type-body-sm font-bold text-text-primary">Linked Outlets</div>
              <div className="type-caption text-text-secondary">{configs.length} linked outlet{configs.length === 1 ? "" : "s"}</div>
            </div>
            <Badge tone="info">{item.unit}</Badge>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {linkedOutletCards.length ? linkedOutletCards.map(({ config, outlet }) => {
              return (
                <div key={config.outletId} className="rounded-xl border border-border bg-slate-50/70 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="type-body-sm font-bold text-text-primary">{outlet ? outletDisplayName(outlet) : "Unknown outlet"}</div>
                      <div className="type-caption text-text-secondary">{outlet ? outletDisplayCode(outlet) : "No outlet code"}</div>
                    </div>
                    <Badge tone="success">Linked</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 type-caption text-text-secondary">
                    <span>Par <strong className="text-text-primary">{config.parLevel === "" || config.parLevel === null || config.parLevel === undefined ? "Not set" : config.parLevel}</strong></span>
                    <span>{config.storageLocation || "No location"}</span>
                  </div>
                </div>
              );
            }) : <EmptyState title="No linked outlets" description="Configure outlet stock settings before using this item operationally." />}
          </div>
          <button
            className="btn-secondary mt-3 w-full justify-center"
            type="button"
            onClick={() => {
              setOpen(false);
              onConfigure?.();
            }}
          >
            Open Par Level Setup
          </button>
        </div>
      </FloatingLayer>
    </div>
  );
}


function ItemPhotoPicker({ value, onChange }) {
  const [error, setError] = useState("");

  async function handleFile(file) {
    setError("");
    if (!file) return;
    try {
      const optimized = await optimizeImageFileForPreview(file);
      onChange(optimized.dataUrl, { localPreview: true, uploadFailed: false, file });
    } catch (readError) {
      setError(readError.message || "Unable to read image. Please try another file.");
    }
  }

  return (
    <div>
      <div className="mb-1 type-caption font-semibold text-text-secondary">Item Photo</div>
      <div className="rounded-2xl border border-border bg-slate-50/70 p-3">
        {value ? (
          <div className="flex items-center gap-3">
            <img className="h-20 w-20 rounded-2xl border border-border object-cover" src={value} alt="Item preview" />
            <div className="min-w-0 flex-1">
              <div className="type-body-sm font-bold text-text-primary">Photo selected</div>
              <div className="type-caption text-text-secondary">Photo uploads when you save the item.</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="btn-secondary h-8 cursor-pointer px-3 text-xs">
                  Replace photo
                  <input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => handleFile(event.target.files?.[0])} />
                </label>
                <button className="btn-secondary h-8 px-3 text-xs text-rose-600" type="button" onClick={() => { setError(""); onChange("", { removed: true, uploadFailed: false }); }}>Remove</button>
              </div>
            </div>
          </div>
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface px-4 py-5 text-center transition hover:border-primary/40 hover:bg-primary/5">
            <Upload size={18} className="text-primary" />
            <span className="mt-2 type-body-sm font-bold text-text-primary">Upload item photo</span>
            <span className="mt-0.5 type-caption text-text-muted">JPG/PNG/WebP · max 5MB</span>
            <input className="sr-only" type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
        )}
        {error ? <div className="mt-2 type-caption font-semibold text-amber-700">{error}</div> : null}
      </div>
    </div>
  );
}



function readImportValue(row, aliases) {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const found = entries.find(([key]) => canonical(key) === canonical(alias));
    if (found) return String(found[1] ?? "").trim();
  }
  return "";
}

function buildInventoryImportPreview(rows, { categories, outlets, items, uoms }) {
  const categoryByName = new Map(categories.map((category) => [canonical(category.name), category]));
  const uomByCode = new Map(uoms.map((uom) => [canonical(uom.code), uom]));
  const outletByCode = new Map(outlets.map((outlet) => {
    const normalized = normalizeOutletRecord(outlet);
    return [canonical(normalized.code || ""), normalized];
  }).filter(([key]) => key));
  const existingBySku = new Map(items.filter((item) => item.sku).map((item) => [canonical(item.sku), item]));
  const existingByName = new Map(items.map((item) => [canonical(item.name), item]));
  const seenSkus = new Map();
  const seenNamesWithoutSku = new Map();

  return rows.map((row) => {
    const name = readImportValue(row, ["Item Name", "Name", "Item"]);
    const sku = readImportValue(row, ["SKU Code", "SKU"]);
    const categoryName = readImportValue(row, ["Category"]);
    const unit = readImportValue(row, ["UOM", "Unit"]);
    const rawCost = readImportValue(row, ["Cost", "Default Cost"]);
    const description = readImportValue(row, ["Description"]);
    const status = (readImportValue(row, ["Status"]) || "active").toLowerCase();
    const linkedOutletText = readImportValue(row, ["Linked Outlet Codes", "Linked Outlets", "Outlets"]);
    const errors = [];
    const warnings = [];

    if (!name) errors.push("Missing Item Name");
    if (!categoryName) errors.push("Missing Category");
    const category = categoryByName.get(canonical(categoryName));
    if (categoryName && !category) errors.push("Unknown Category");
    if (!unit) errors.push("Missing UOM");
    const uom = unit ? uomByCode.get(canonical(unit)) : null;
    if (unit && !uom) errors.push("Unknown UOM");
    const parsedCost = rawCost ? parseInventoryCostInput(rawCost) : "";
    if (parsedCost === null) errors.push("Invalid Cost");
    if (!["active", "inactive", "archived"].includes(status)) errors.push("Invalid Status");

    const skuKey = canonical(sku);
    const nameKey = canonical(name);
    if (skuKey) {
      if (seenSkus.has(skuKey)) errors.push("Duplicate SKU in file");
      seenSkus.set(skuKey, row.__row);
    } else if (nameKey) {
      if (seenNamesWithoutSku.has(nameKey)) errors.push("Duplicate item name without SKU");
      seenNamesWithoutSku.set(nameKey, row.__row);
    }

    const linkedOutlets = linkedOutletText
      ? linkedOutletText.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const outlet = outletByCode.get(canonical(entry));
        if (!outlet) errors.push(`Unknown Outlet Code: ${entry}`);
        return outlet;
      }).filter(Boolean)
      : [];
    const linkedOutletCodes = linkedOutlets.map(outletDisplayCode).filter(Boolean);
    const existing = skuKey ? existingBySku.get(skuKey) : existingByName.get(nameKey);

    return {
      rowNumber: row.__row,
      source: row,
      action: errors.length ? "error" : existing ? "update" : "create",
      errors,
      warnings,
      item: {
        id: existing?.id || "",
        name,
        sku,
        categoryId: category?.id || "",
        unit: uom?.code || unit,
        cost: parsedCost === "" ? (existing?.cost ?? "") : parsedCost,
        description,
        defaultSupplierId: existing?.defaultSupplierId || "",
        status,
        photo: existing?.photo || existing?.photo_url || "",
        linkedOutletIds: linkedOutlets.length ? linkedOutlets.map((outlet) => outlet.id) : existing?.linkedOutletIds || [],
        linkedOutletCodes,
      },
    };
  });
}

function InventoryImportModal({ categories, outlets, items, uoms, onClose, onImport }) {
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState([]);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  const validRows = preview.filter((row) => !row.errors.length);
  const failedRows = preview.filter((row) => row.errors.length);

  async function handleFile(file) {
    setError("");
    setComplete(null);
    setPreview([]);
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["csv", "xlsx"].includes(extension)) {
      setError("Please upload CSV or XLSX only.");
      return;
    }
    try {
      setFileName(file.name);
      const parsed = extension === "xlsx" ? await parseXlsx(file) : parseCsv(await file.text());
      const built = buildInventoryImportPreview(parsed.rows, { categories, outlets, items, uoms });
      setPreview(built);
    } catch (parseError) {
      setError(parseError.message || "Unable to parse import file.");
    }
  }

  function downloadTemplate() {
    const text = [
      inventoryImportColumns.join(","),
      ["Sambal Sauce 三八", "RAW-SAM-001", "Raw Material", "kg", "6.5000", "House sambal batch", "Active", "FC,HLIPH"].map(csvEscape).join(","),
    ].join("\n");
    downloadTextFile("feedx-master-inventory-template.csv", text);
  }

  async function confirmImport() {
    setError("");
    setIsImporting(true);
    try {
      const result = await onImport(preview);
      setComplete(result);
    } catch (importError) {
      setError(importError.message || "Unable to import master inventory.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Modal
      title="Import Master Inventory"
      description="Upload CSV or XLSX, validate rows, preview changes, then import valid rows."
      size="xl"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Close</button>
          <button className="btn-primary" type="button" disabled={!validRows.length || Boolean(complete) || isImporting} onClick={confirmImport}>{isImporting ? "Importing..." : "Confirm Import"}</button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center transition hover:bg-primary/10">
            <Upload size={20} className="text-primary" />
            <span className="mt-2 type-body-sm font-bold text-text-primary">{fileName || "Upload CSV or XLSX"}</span>
            <span className="type-caption text-text-secondary">Required: Item Name, Category, UOM</span>
            <input className="sr-only" type="file" accept=".csv,.xlsx" onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
          <button className="btn-secondary" type="button" onClick={downloadTemplate}><Download size={15} /> Download Template</button>
        </div>
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 type-body-sm font-semibold text-rose-700">{error}</div> : null}
        {preview.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Rows" value={preview.length} helper="Parsed from file" />
              <MetricCard label="Valid" value={validRows.length} helper="Ready to import" tone="success" />
              <MetricCard label="Failed" value={failedRows.length} helper="Can be skipped" tone={failedRows.length ? "danger" : "success"} />
            </div>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted">
                  <tr>
                    <th className="px-3 py-2">Row</th>
                    <th>Action</th>
                    <th>Item</th>
                    <th>Category</th>
                    <th>UOM</th>
                    <th>Cost</th>
                    <th>Linked Outlet Codes</th>
                    <th>Validation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {preview.slice(0, 80).map((row) => (
                    <tr key={row.rowNumber} className={row.errors.length ? "bg-rose-50/50" : "bg-white"}>
                      <td className="px-3 py-2 font-mono text-xs">{row.rowNumber}</td>
                      <td><Badge tone={row.action === "error" ? "danger" : row.action === "create" ? "success" : "info"}>{row.action === "error" ? "Error" : toTitle(row.action)}</Badge></td>
                      <td className="font-bold text-text-primary">{row.item.name || "-"}</td>
                      <td>{categoryByIdName(categories, row.item.categoryId)}</td>
                      <td>{row.item.unit || "-"}</td>
                      <td>{formatInventoryCost(row.item.cost, row.item.unit)}</td>
                      <td>{row.item.linkedOutletCodes?.length ? row.item.linkedOutletCodes.join(", ") : "-"}</td>
                      <td className={row.errors.length ? "text-rose-700" : "text-emerald-700"}>{row.errors.length ? row.errors.join("; ") : "Ready"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {complete ? (
              <div className={`rounded-2xl border p-3 type-body-sm font-semibold ${complete.failed ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                Import complete: {complete.created} created · {complete.updated} updated · {complete.skipped} skipped · {complete.failed} failed.
                {complete.failures?.length ? <div className="mt-1 font-medium">{complete.failures.slice(0, 3).map((failure) => `Row ${failure.rowNumber}: ${failure.message}`).join(" · ")}</div> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Modal>
  );
}

function categoryByIdName(categories, categoryId) {
  return categories.find((category) => category.id === categoryId)?.name || "Uncategorized";
}


function UomModal({ uom, onClose, onSave }) {
  const [form, setForm] = useState(() => normalizeUom(uom ?? {
    id: "",
    code: "",
    displayName: "",
    uomType: "General",
    isActive: true,
    sortOrder: 1,
  }));
  const [touched, setTouched] = useState(false);
  const invalid = touched && (!form.code.trim() || !form.displayName.trim() || !form.uomType.trim());
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <Modal
      title={uom ? "Edit UOM" : "Add New UOM"}
      description="Manage units of measure used by master inventory items and imports."
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => {
              setTouched(true);
              if (!form.code.trim() || !form.displayName.trim() || !form.uomType.trim()) return;
              onSave(normalizeUom({
                ...form,
                id: form.id || makeId("uom"),
                code: form.code.trim(),
                displayName: form.displayName.trim(),
                uomType: form.uomType.trim(),
                updatedAt: new Date().toISOString(),
                createdAt: form.createdAt || new Date().toISOString(),
              }));
            }}
          >
            Save
          </button>
        </>
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="UOM Code" value={form.code} required onChange={(value) => update("code", value)} placeholder="kg" />
        <Field label="Display Name" value={form.displayName} required onChange={(value) => update("displayName", value)} placeholder="Kilogram" />
        <Field label="UOM Type" value={form.uomType} required onChange={(value) => update("uomType", value)} placeholder="Weight" />
        <Field label="Sort Order" type="number" value={form.sortOrder} onChange={(value) => update("sortOrder", Number(value || 0))} />
        <SelectField label="Status" value={form.isActive ? "active" : "inactive"} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} onChange={(value) => update("isActive", value === "active")} />
        {invalid ? <div className="md:col-span-2 type-caption font-semibold text-rose-600">UOM code, display name and type are required.</div> : null}
      </div>
    </Modal>
  );
}

function UomSettingsModal({ uoms, remoteRows, visibleRows, lastWriteStatus, canAdd, canEdit, canDelete, requirePermission, onAdd, onEdit, onArchive, onDelete, onClose }) {
  return (
    <Modal
      title="Inventory UOM Settings"
      description="Manage units of measure used by master inventory items, stock checks and imports."
      size="lg"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="type-caption text-text-secondary">{uoms.length} configured UOM{uoms.length === 1 ? "" : "s"}</div>
          <div className="type-caption text-text-muted">Only active UOMs appear in item forms and import validation.</div>
          <div className="mt-1 type-caption font-semibold text-text-muted">Remote UOM Rows: {remoteRows} · Visible UOM Rows: {visibleRows} · Last Write Status: {lastWriteStatus}</div>
        </div>
        <button className="btn-primary h-8 px-3 text-xs" type="button" onClick={() => requirePermission(canAdd, "add UOM") && onAdd()}>
          <PackagePlus size={14} /> Add UOM
        </button>
      </div>
      {uoms.length ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {uoms.map((uom) => (
            <div key={uom.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-primary/5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="truncate type-body-sm font-bold text-text-primary">{uom.code}</div>
                  <Badge tone={uom.isActive ? "success" : "neutral"}>{uom.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="mt-0.5 truncate type-caption text-text-secondary">{uom.displayName || "No display name"} · {uom.uomType || "General"}</div>
                <div className="mt-1 type-caption font-semibold text-text-muted">Sort {uom.sortOrder || 0}</div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canEdit, "edit UOM") && onEdit(uom)}>Edit</button>
                <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canEdit, "archive UOM") && onArchive(uom)}>{uom.isActive ? "Archive" : "Activate"}</button>
                <button className="icon-btn h-8 w-8 text-rose-600" type="button" onClick={() => requirePermission(canDelete, "delete UOM") && onDelete(uom)} title="Delete UOM">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="Create your first UOM." description="UOMs control the item form dropdown and Master Inventory import validation." />
      )}
    </Modal>
  );
}



function InventoryItemModal({ item, categories, outlets, uoms, canCreateUom, onAddUom, onClose, onSave }) {
  const initialItem = normalizeInventoryItem(item ?? {
    id: "",
    name: "",
    sku: "",
    categoryId: categories[0]?.id ?? "",
    unit: uoms.find((uom) => uom.isActive)?.code || "kg",
    cost: "",
    photo: "",
    description: "",
    inventoryType: item?.inventoryType ?? "",
    defaultSupplierId: "",
    status: "active",
    linkedOutletIds: outlets[0]?.id ? [outlets[0].id] : [],
  });
  const [form, setForm] = useState(initialItem);
  const [quickUomOpen, setQuickUomOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const parsedCost = parseInventoryCostInput(form.cost);
  const costInvalid = parsedCost === null;
  const invalid = touched && (!form.name.trim() || !form.categoryId || !form.unit || !form.linkedOutletIds?.length || costInvalid);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateLinkedOutlets(ids) {
    setForm((current) => {
      const next = { ...current, linkedOutletIds: ids, linked_outlet_ids: ids, linkedOutlets: [], linked_outlets: [] };
      const existing = new Map((current.outletConfigs || []).map((config) => [config.outletId, config]));
      next.outletConfigs = ids.map((outletId) => buildOutletConfig(current, outletId, existing.get(outletId)));
      next.outlet_configs = next.outletConfigs.map((config) => ({
        ...config,
        inventory_item_id: config.inventoryItemId,
        outlet_id: config.outletId,
      }));
      return next;
    });
  }

  return (
    <Modal
      title={item ? "Edit Inventory Item" : "Add Inventory Item"}
      description="Define the global item identity. Par levels are managed separately in Par Level Setup."
      size="lg"
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            type="button"
            onClick={() => {
              setTouched(true);
              if (!form.name.trim() || !form.categoryId || !form.unit || !form.linkedOutletIds?.length || costInvalid) return;
              const id = form.id || makeId("item");
              onSave({ ...form, id, cost: parsedCost === "" ? "" : parsedCost, outletConfigs: (form.outletConfigs || []).map((config) => ({ ...config, inventoryItemId: id })) });
            }}
          >
            Save Item
          </button>
        </>
      )}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Item Name" value={form.name} required onChange={(value) => update("name", value)} placeholder="Sambal Sauce" />
        <Field label="SKU Code" value={form.sku} onChange={(value) => update("sku", value)} placeholder="RAW-SAM-001" />
        <SelectField label="Category" value={form.categoryId} options={categories.map((category) => ({ value: category.id, label: category.name }))} onChange={(value) => update("categoryId", value)} searchable required />
        <SelectField
          label="UOM"
          value={form.unit}
          options={uoms.filter((uom) => uom.isActive).map((uom) => ({ value: uom.code, label: uomOptionLabel(uom) }))}
          onChange={(value) => update("unit", value)}
          footerAction={({ close }) => (
            <button
              className="flex w-full items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] font-bold text-primary transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:text-text-muted"
              type="button"
              disabled={!canCreateUom}
              onClick={() => {
                close();
                window.requestAnimationFrame(() => setQuickUomOpen(true));
              }}
            >
              <Plus size={14} /> Add New UOM
            </button>
          )}
        />
        <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => update("status", value)} />
        <label className="block">
          <div className="mb-1 type-caption font-semibold text-text-secondary">Default Cost</div>
          <input
            className="control h-9 w-full text-[13px]"
            type="number"
            min="0"
            step="0.0001"
            value={form.cost ?? ""}
            placeholder="0.00"
            onFocus={selectInputText}
            onChange={(event) => update("cost", event.target.value)}
          />
          <div className="mt-1 type-caption text-text-muted">Cost is per selected UOM. RM per {form.unit || "UOM"}.</div>
          {touched && costInvalid ? <div className="mt-1 type-caption font-semibold text-rose-600">Cost must be a non-negative number with up to 4 decimals.</div> : null}
        </label>
        <div className="md:col-span-2">
          <ItemPhotoPicker
            value={form.photo}
            onChange={(value, meta = {}) => {
              setForm((current) => ({
                ...current,
                photo: value,
                photoFile: meta.file || null,
                photoUploadFailed: meta.uploadFailed === true,
                photoLocalPreview: meta.localPreview === true,
              }));
            }}
          />
        </div>
        <div className="md:col-span-2">
          <TextArea label="Description" value={form.description} onChange={(value) => update("description", value)} placeholder="Short operational description." />
        </div>
        <div className="md:col-span-2">
          <MultiOutletPicker outlets={outlets} selectedIds={form.linkedOutletIds} onChange={updateLinkedOutlets} />
          <div className="mt-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2 type-caption text-text-secondary">
            Par levels can be managed in <span className="font-bold text-text-primary">Par Level Setup</span> after the item is saved.
          </div>
          {invalid ? <div className="mt-2 type-caption font-semibold text-rose-600">Item name, category, UOM and at least one linked outlet are required. Cost must be valid when entered.</div> : null}
        </div>
      </div>
      {quickUomOpen ? (
        <UomModal
          onClose={() => setQuickUomOpen(false)}
          onSave={(nextUom) => {
            Promise.resolve(onAddUom(nextUom)).then((saved) => {
              if (!saved?.code) return;
              update("unit", saved.code);
              setQuickUomOpen(false);
            });
          }}
        />
      ) : null}
    </Modal>
  );
}

function CategoryModal({ category, onClose, onSave }) {
  const [form, setForm] = useState(category ?? { id: "", name: "", description: "", sortOrder: 1, status: "active" });
  return (
    <Modal
      title={category ? "Edit Category" : "Add Category"}
      description="Inventory categories keep the master list clean and searchable."
      onClose={onClose}
      footer={(
        <>
          <button className="btn-secondary" type="button" onClick={onClose}>Cancel</button>
          <button className="btn-primary" type="button" disabled={!form.name.trim()} onClick={() => onSave({ ...form, id: form.id || makeId("inv_cat") })}>Save Category</button>
        </>
      )}
    >
      <div className="grid gap-3">
        <Field label="Category Name" value={form.name} required onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
        <TextArea label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} />
        <SelectField label="Status" value={form.status} options={statuses.map((status) => ({ value: status, label: toTitle(status) }))} onChange={(value) => setForm((current) => ({ ...current, status: value }))} />
      </div>
    </Modal>
  );
}

function CategorySettingsModal({ categories, itemCounts, canAdd, canEdit, canDelete, requirePermission, onAdd, onEdit, onArchive, onDelete, onSort, onClose }) {
  const [draggedId, setDraggedId] = useState(null);

  function handleDrop(targetId) {
    if (!draggedId || draggedId === targetId) return;
    onSort(draggedId, targetId);
    setDraggedId(null);
  }

  return (
    <Modal
      title="Inventory Category Settings"
      description="Manage categories used by master inventory items, stock checks and reports."
      size="xl"
      onClose={onClose}
      footer={<button className="btn-secondary" type="button" onClick={onClose}>Close</button>}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="type-caption text-text-secondary">{categories.length} configured categor{categories.length === 1 ? "y" : "ies"}</div>
          <div className="type-caption text-text-muted">Drag categories to control display order in inventory filters and item forms.</div>
        </div>
        <button className="btn-primary h-8 px-3 text-xs" type="button" onClick={() => requirePermission(canAdd, "add inventory categories") && onAdd()}>
          <PackagePlus size={14} /> Add Category
        </button>
      </div>

      {categories.length ? (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {categories.map((category) => {
            const linkedCount = itemCounts.get(category.id) || 0;
            return (
              <div
                key={category.id}
                draggable={canEdit}
                onDragStart={(event) => {
                  if (!canEdit) return;
                  setDraggedId(category.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => {
                  if (canEdit) event.preventDefault();
                }}
                onDrop={() => handleDrop(category.id)}
                className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-3 py-2.5 transition last:border-b-0 hover:bg-primary/5 ${
                  draggedId === category.id ? "bg-primary/8 opacity-70" : ""
                }`}
              >
                <button
                  className={`icon-btn h-8 w-8 cursor-grab text-text-muted ${canEdit ? "" : "opacity-40"}`}
                  type="button"
                  title={canEdit ? "Drag to reorder" : "Reordering requires edit permission"}
                  aria-label="Drag to reorder category"
                >
                  <GripVertical size={16} />
                </button>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="truncate type-body-sm font-bold text-text-primary">{category.name}</div>
                    <Badge tone={statusTone(category.status)}>{toTitle(category.status)}</Badge>
                  </div>
                  <div className="mt-0.5 truncate type-caption text-text-secondary">{category.description || "No description provided."}</div>
                  <div className="mt-1 type-caption font-semibold text-text-muted">{linkedCount} linked item{linkedCount === 1 ? "" : "s"}</div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canEdit, "edit inventory categories") && onEdit(category)}>Edit</button>
                  <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(canDelete, "archive inventory categories") && onArchive(category)}>Archive</button>
                  {linkedCount === 0 ? (
                    <button className="icon-btn h-8 w-8 text-rose-600" type="button" onClick={() => requirePermission(canDelete, "delete inventory categories") && onDelete(category)} title="Delete category">
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Create your first inventory category to organize items." description="Categories keep filters, item forms and reports easier to scan." />
      )}
    </Modal>
  );
}



function uomOptionLabel(uom = {}) {
  return uom.displayName && canonical(uom.displayName) !== canonical(uom.code) ? uom.code + ' · ' + uom.displayName : uom.code;
}

function useInventoryMasterData(scopeKey) {
  const [snapshot, setSnapshot] = useState({ scopeKey: '', data: null, state: 'loading', error: '' });
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    setSnapshot(current => current.scopeKey === scopeKey
      ? { ...current, state: current.data ? 'refreshing' : 'loading', error: '' }
      : { scopeKey, data: null, state: 'loading', error: '' });
    try {
      const data = await loadInventoryMaster();
      if (id !== request.current) return null;
      setSnapshot({ scopeKey, data, state: 'ready', error: '' });
      return data;
    } catch (error) {
      if (id !== request.current) return null;
      setSnapshot(current => {
        const sameScopeData = current.scopeKey === scopeKey ? current.data : null;
        return { scopeKey, data: sameScopeData, state: sameScopeData ? 'stale-error' : 'error', error: error.message || 'Unable to load Master Inventory.', completeness: error.readState || 'error' };
      });
      return null;
    }
  }, [scopeKey]);
  useEffect(() => {
    refresh();
    return () => { request.current += 1; };
  }, [refresh]);
  useEffect(() => subscribeInventoryRevalidation(context => { if (context?.source !== 'master') refresh(); }), [refresh]);
  const verified = snapshot.scopeKey === scopeKey ? snapshot : { scopeKey, data: null, state: 'loading', error: '' };
  const setData = useCallback(updater => setSnapshot(current => {
    if (current.scopeKey !== scopeKey || !current.data) return current;
    return { ...current, data: typeof updater === 'function' ? updater(current.data) : updater };
  }), [scopeKey]);
  return [verified.data || { items: [], categories: [], uoms: [], rawItemCount: 0, outletLinkCount: 0 }, setData, verified, refresh];
}

export default function InventoryMasterPage({ auth, ui, outlets }) {
  const accessibleOutletIds = useMemo(() => getAccessibleOutlets(auth, outlets).map(outlet => outlet.id), [auth, outlets]);
  const scopeKey = (auth?.user?.id || '') + ':' + (hasAllOutletAccess(auth) ? 'all' : accessibleOutletIds.join(',')) + ':' + outlets.map(outlet => outlet.id).join(',');
  const [data, setData, read, refreshMasterRead] = useInventoryMasterData(scopeKey);
  const refreshInventory = async () => {
    const result = await refreshMasterRead();
    if (result) invalidateInventoryReads({ source: 'master' });
    return result;
  };
  const inventoryMeta = { dataSource: read.state === 'ready' ? 'supabase' : read.state, rawItemsCount: data.rawItemCount, normalizedItemsCount: data.items.length, outletLinkCount: data.outletLinkCount, fallbackActive: false, lastFetchedAt: '' };
  const [selectedOutletId, setSelectedOutletId] = useState('all');
  const outletOptions = getAccessibleOutletOptions(auth, outlets);
  const effectiveOutletId = outletOptions.some(option => option.value === selectedOutletId) ? selectedOutletId : 'all';
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [masterGroupBy, setMasterGroupBy] = useState('category');
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState(() => new Set());
  const [uomWriteStatus, setUomWriteStatus] = useState('Not written');
  const [modal, setModal] = useState(null);
  const [editingCostItemId, setEditingCostItemId] = useState(null);
  const [editingCostValue, setEditingCostValue] = useState('');
  const [savingCostItemId, setSavingCostItemId] = useState(null);
  const skipCostBlurSaveRef = useRef(false);
  const [photoPreview, setPhotoPreview] = useState(null);
  const can = useMemo(() => ({
    importMaster: hasPermission(auth, 'inventory_master.import'), exportMaster: hasPermission(auth, 'inventory_master.export'),
    createMaster: hasPermission(auth, 'inventory_master.create'), editMaster: hasPermission(auth, 'inventory_master.edit'),
    deleteMaster: hasPermission(auth, 'inventory_master.delete'), editParLevels: hasPermission(auth, 'inventory_par_levels.edit'),
    viewCategories: hasPermission(auth, 'inventory_categories.view') || hasPermission(auth, 'inventory_master.view'),
    createCategory: hasPermission(auth, 'inventory_categories.create'), editCategory: hasPermission(auth, 'inventory_categories.edit'), deleteCategory: hasPermission(auth, 'inventory_categories.delete'),
    viewUoms: hasPermission(auth, 'inventory_uoms.view') || hasPermission(auth, 'inventory_master.view'),
    createUom: hasPermission(auth, 'inventory_uoms.create'), editUom: hasPermission(auth, 'inventory_uoms.edit'), deleteUom: hasPermission(auth, 'inventory_uoms.delete'),
  }), [auth]);
  const sortedCategories = useMemo(() => [...data.categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name)), [data.categories]);
  const sortedActiveCategories = useMemo(() => sortedCategories.filter((category) => String(category.status || "active").toLowerCase() === "active"), [sortedCategories]);
  const categoryById = useMemo(() => new Map(data.categories.map((category) => [category.id, category])), [data.categories]);
  const sortedUoms = useMemo(() => [...(data.uoms || [])].map(normalizeUom).sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.code.localeCompare(b.code)), [data.uoms]);
  const sortedActiveUoms = useMemo(() => sortedUoms.filter((uom) => uom.isActive), [sortedUoms]);
  const itemCountByCategory = useMemo(() => {
    const counts = new Map();
    data.items.forEach((item) => counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1));
    return counts;
  }, [data.items]);
  const outletById = useMemo(() => new Map(outlets.map((outlet) => [outlet.id, outlet])), [outlets]);
  const canSeeAllMasterItems = effectiveOutletId === "all" && hasAllOutletAccess(auth);
  const visibleItems = useMemo(() => data.items.filter((item) => {
    const linkedOutletIds = item.linkedOutletIds || [];
    const matchesOutlet = effectiveOutletId === "all"
      ? (canSeeAllMasterItems || linkedOutletIds.some((outletId) => accessibleOutletIds.includes(outletId)))
      : accessibleOutletIds.includes(effectiveOutletId) && linkedOutletIds.includes(effectiveOutletId);
    const matchesQuery = !query.trim() || `${item.name} ${item.sku}`.toLowerCase().includes(query.trim().toLowerCase());
    const itemCategory = categoryForItem(item, categoryById);
    const selectedCategory = categoryById.get(categoryFilter);
    const matchesCategory = categoryFilter === "all" || item.categoryId === categoryFilter || item.category_id === categoryFilter || (selectedCategory && canonical(itemCategory?.name) === canonical(selectedCategory.name));
    const itemStatus = String(item.status || "").toLowerCase();
    const selectedStatus = String(statusFilter || "all").toLowerCase();
    const matchesStatus = selectedStatus === "all" || itemStatus === selectedStatus;
    return matchesOutlet && matchesQuery && matchesCategory && matchesStatus;
  }), [data.items, effectiveOutletId, canSeeAllMasterItems, accessibleOutletIds, query, categoryFilter, categoryById, statusFilter]);
  const visibleItemGroups = useMemo(() => {
    const groups = new Map();
    visibleItems.forEach((item) => {
      const category = categoryForItem(item, categoryById);
      const key = item.categoryId || item.category_id || category?.id || "uncategorized";
      if (!groups.has(key)) groups.set(key, { id: key, category, items: [] });
      groups.get(key).items.push(item);
    });
    return [...groups.values()].sort((a, b) => Number(a.category?.sortOrder ?? 9999) - Number(b.category?.sortOrder ?? 9999) || (a.category?.name || "Uncategorized").localeCompare(b.category?.name || "Uncategorized"));
  }, [visibleItems, categoryById]);


  function notify(title, message = '', tone = 'success') { ui?.notify?.({ title, message, tone }); }
  function requirePermission(allowed, action) { if (allowed) return true; notifyPermissionDenied(ui, action); return false; }
  async function saveItem(item) {
    const existingItem = data.items.find((entry) => entry.id === item.id);
    const hasNewPhotoFile = typeof File !== "undefined" && item.photoFile instanceof File;
    const incomingPhoto = item.photo ?? item.photo_url ?? "";
    const isLocalPreview = isImageDataUrl(incomingPhoto);
    const isCreate = !isUuid(item.id);
    let uploadedPhotoUrl = "";
    let photoDebug = {
      itemId: isCreate ? null : item.id,
      hasNewPhotoFile,
      previewUrl: isLocalPreview ? incomingPhoto.slice(0, 80) : incomingPhoto,
      uploadBucket: "inventory-item-photos",
      uploadPath: "",
      uploadError: null,
      publicUrl: "",
      dbPayloadPhotoUrl: "",
      savedRowPhotoUrl: "",
    };
    if (hasNewPhotoFile) {
      try {
        const uploadResult = await uploadInventoryItemPhoto(item.photoFile, isCreate ? "draft" : item.id, existingItem?.photo || existingItem?.photo_url || "");
        uploadedPhotoUrl = uploadResult.publicUrl;
        photoDebug = {
          ...photoDebug,
          uploadBucket: uploadResult.bucket,
          uploadPath: uploadResult.path,
          publicUrl: uploadResult.publicUrl,
        };
      } catch (uploadError) {
        photoDebug = { ...photoDebug, uploadError };
        debugLog("[InventoryPhotoSaveDebug]", photoDebug);
        notify("Photo upload failed. Item was not updated.", uploadError.message || "Please check the inventory-item-photos bucket and try again.", "error");
        return;
      }
    }
    const photoUploadFailed = item.photoUploadFailed === true || (isLocalPreview && !hasNewPhotoFile);
    const safePhoto = uploadedPhotoUrl || (photoUploadFailed ? (existingItem?.photo || existingItem?.photo_url || "") : incomingPhoto);
    const normalizedItem = normalizeInventoryItem({ ...item, photo: safePhoto, photo_url: safePhoto, costUpdatedBy: auth?.profile?.id || "" });
    const photoChanged = !photoUploadFailed && (existingItem?.photo || existingItem?.photo_url || "") !== (normalizedItem.photo || normalizedItem.photo_url || "");
    const linkedOutletsChanged = !sameIdSet(existingItem?.linkedOutletIds || [], normalizedItem.linkedOutletIds || []);
    const existingOutletIdsForDebug = uniqueIds(existingItem?.linkedOutletIds || []);
    const selectedOutletIdsForDebug = uniqueIds(normalizedItem.linkedOutletIds || []);
    debugLog("[InventoryOutletSaveDebug]", {
      itemId: normalizedItem.id || null,
      existingOutletIds: existingOutletIdsForDebug,
      selectedOutletIds: selectedOutletIdsForDebug,
      outletsToAdd: selectedOutletIdsForDebug.filter((outletId) => !existingOutletIdsForDebug.includes(outletId)),
      outletsToRemove: existingOutletIdsForDebug.filter((outletId) => !selectedOutletIdsForDebug.includes(outletId)),
    });
    const nameChanged = !isCreate && Boolean(existingItem) && existingItem.name !== normalizedItem.name;
    const skuChanged = !isCreate && Boolean(existingItem) && (existingItem.sku || "") !== (normalizedItem.sku || "");
    const categoryChanged = !isCreate && Boolean(existingItem) && (existingItem.categoryId || "") !== (normalizedItem.categoryId || "");
    const uomChanged = !isCreate && Boolean(existingItem) && (existingItem.unit || "") !== (normalizedItem.unit || "");
    const statusChanged = !isCreate && Boolean(existingItem) && (existingItem.status || "active") !== (normalizedItem.status || "active");
    const descriptionChanged = !isCreate && Boolean(existingItem) && (existingItem.description || "") !== (normalizedItem.description || "");
    const costChanged = isCreate ? normalizedItem.cost !== "" : Boolean(existingItem) && Number(existingItem.cost ?? 0) !== Number(normalizedItem.cost ?? 0);
    const changeFlags = {
      nameChanged,
      skuChanged,
      categoryChanged,
      uomChanged,
      statusChanged,
      photoChanged,
      descriptionChanged,
      costChanged,
      linkedOutletsChanged,
    };
    const changeCount = Object.values(changeFlags).filter(Boolean).length;
    try {
      const remoteItem = await persistRemoteInventoryItem({ ...normalizedItem, costMetadataChanged: isCreate || costChanged }, auth?.user?.id, accessibleOutletIds);
      photoDebug = {
        ...photoDebug,
        itemId: remoteItem.id,
        dbPayloadPhotoUrl: normalizedItem.photo || normalizedItem.photo_url || "",
        savedRowPhotoUrl: remoteItem.photo || remoteItem.photo_url || "",
      };
      debugLog("[InventoryPhotoSaveDebug]", photoDebug);
      debugLog("[InventoryItemSaveDebug]", {
        itemId: remoteItem.id,
        payload: {
          name: normalizedItem.name,
          sku: normalizedItem.sku,
          categoryId: normalizedItem.categoryId,
          unit: normalizedItem.unit,
          cost: normalizedItem.cost,
          status: normalizedItem.status,
          photo_url: normalizedItem.photo || normalizedItem.photo_url || null,
        },
        selectedUom: normalizedItem.unit,
        savedUnit: remoteItem.unit || remoteItem.uom_code,
        photoUrl: remoteItem.photo || remoteItem.photo_url,
        linkedOutletIds: remoteItem.linkedOutletIds || [],
      });
      setData((current) => ({
        ...current,
        items: current.items.some((entry) => entry.id === normalizedItem.id || entry.id === remoteItem.id)
          ? current.items.map((entry) => (entry.id === normalizedItem.id || entry.id === remoteItem.id ? remoteItem : entry))
          : [remoteItem, ...current.items],
      }));
      const refreshedInventory = await refreshInventory();
      if (!hasNewPhotoFile && !normalizedItem.photo && (existingItem?.photo || existingItem?.photo_url)) {
        try {
          await removeStorageObjectFromPublicUrl("inventory-item-photos", existingItem.photo || existingItem.photo_url);
        } catch (removeError) {
          debugLog("[InventoryPhotoSaveDebug]", { ...photoDebug, removeError });
        }
      }
      if (hasNewPhotoFile) {
        const refetchedItem = (refreshedInventory?.items || []).find((entry) => entry.id === remoteItem.id);
        const refetchedPhotoUrl = refetchedItem?.photo || refetchedItem?.photo_url || "";
        debugLog("[InventoryPhotoSaveDebug]", { ...photoDebug, refetchedPhotoUrl });
        if (!refetchedPhotoUrl || refetchedPhotoUrl !== (normalizedItem.photo || normalizedItem.photo_url || "")) {
          notify("Photo uploaded, but item update failed.", "The item list did not return the saved photo URL after refetch.", "error");
          return;
        }
      }
      setModal(null);
      if (photoUploadFailed) {
        notify("Item saved, but photo upload failed", "The item details were saved. Please try uploading the photo again.", "warning");
      } else if (isCreate) {
        notify("Inventory item created", remoteItem.name);
      } else if (changeCount === 1 && linkedOutletsChanged) {
        notify("Linked outlets updated", remoteItem.name);
      } else if (changeCount === 1 && photoChanged) {
        notify("Inventory photo updated", remoteItem.name);
      } else if (changeCount === 1 && uomChanged) {
        notify("Inventory UOM updated", remoteItem.name);
      } else if (changeCount === 1 && categoryChanged) {
        notify("Inventory category updated", remoteItem.name);
      } else if (changeCount === 1 && statusChanged) {
        notify("Inventory status updated", remoteItem.name);
      } else if (changeCount === 1 && descriptionChanged) {
        notify("Inventory item details updated", remoteItem.name);
      } else if (changeCount === 1 && costChanged) {
        notify("Inventory cost updated", remoteItem.name);
      } else {
        notify("Inventory item updated", changeCount > 1 ? `${remoteItem.name} · ${changeCount} changes saved` : remoteItem.name);
      }
    } catch (error) {
      console.warn("[InventoryControl] Unable to save inventory item to Supabase.", error);
      if (hasNewPhotoFile) {
        debugLog("[InventoryPhotoSaveDebug]", { ...photoDebug, dbPayloadPhotoUrl: normalizedItem.photo || normalizedItem.photo_url || "", uploadError: null, dbError: error });
        notify("Photo uploaded, but item update failed.", error.message || "Please try again.", "error");
        return;
      }
      if (error?.debug) {
        debugLog("[InventorySaveDebug]", error.debug);
        debugLog("[InventoryItemSaveDebug]", error.debug);
      }
      await refreshInventory();
      if (error?.partialItemSaved) {
        notify("Linked outlet update failed", error.cause?.message || error.message || "Please check outlet access and try again.", "warning");
      } else {
        notify(isCreate ? "Failed to create Inventory Item" : "Failed to update Inventory Item", error.message || "Please try again.", "error");
      }
    }
  }

  function beginInlineCostEdit(item) {
    if (!requirePermission(can.editMaster, "edit inventory item cost")) return;
    skipCostBlurSaveRef.current = false;
    setEditingCostItemId(item.id);
    setEditingCostValue(item.cost === "" || item.cost === null || item.cost === undefined ? "" : String(item.cost));
  }

  function cancelInlineCostEdit() {
    skipCostBlurSaveRef.current = true;
    setEditingCostItemId(null);
    setEditingCostValue("");
  }

  async function saveInlineCost(item) {
    if (!requirePermission(can.editMaster, "edit inventory item cost")) return;
    const parsedCost = parseInventoryCostInput(editingCostValue);
    if (parsedCost === null) {
      notify("Failed to update inventory cost", "Cost must be a non-negative number with up to 4 decimals.", "error");
      return;
    }
    setSavingCostItemId(item.id);
    const payload = {
      cost: parsedCost === "" ? null : parsedCost,
      cost_updated_at: new Date().toISOString(),
      cost_updated_by: isUuid(auth?.profile?.id) ? auth.profile.id : null,
    };
    try {
      const result = await supabase
        .from("inventory_items")
        .update(payload)
        .eq("id", item.id)
        .select("*")
        .single();
      debugLog("[InventoryCostSaveDebug]", { itemId: item.id, payload, result: { data: result.data, error: result.error }, error: result.error });
      if (result.error) throw result.error;
      await refreshInventory();
      cancelInlineCostEdit();
      notify("Inventory cost updated", item.name);
    } catch (error) {
      console.warn("[InventoryControl] Unable to update inventory cost.", error);
      debugLog("[InventoryCostSaveDebug]", { itemId: item.id, payload, result: null, error });
      notify("Failed to update inventory cost", error.message || "Please try again.", "error");
    } finally {
      setSavingCostItemId(null);
    }
  }

  async function saveCategory(category) {
    const shouldReturnToSettings = modal?.returnToSettings;
    const normalized = {
      ...category,
      name: String(category.name || "").trim(),
      description: String(category.description || "").trim(),
      sortOrder: Number(category.sortOrder ?? category.sort_order ?? 0)
        || (data.categories.length ? Math.max(...data.categories.map((entry) => Number(entry.sortOrder || 0))) + 1 : 1),
      status: category.status || "active",
    };
    try {
      const savedCategory = await persistRemoteInventoryCategory(normalized);
      debugLog("[CategoryActionDebug]", {
        action: isUuid(category.id) ? "edit" : "create",
        categoryId: savedCategory.id,
        categoryName: savedCategory.name,
        linkedItemCount: itemCountByCategory.get(savedCategory.id) || 0,
        supabaseResult: savedCategory,
        error: null,
      });
      setData((current) => ({
        ...current,
        categories: current.categories.some((entry) => entry.id === savedCategory.id)
          ? current.categories.map((entry) => entry.id === savedCategory.id ? savedCategory : entry)
          : [...current.categories, savedCategory],
      }));
      await refreshInventory();
      setModal(shouldReturnToSettings ? { type: "category-settings" } : null);
      notify("Inventory category saved");
    } catch (error) {
      console.warn("[InventoryControl] Unable to save inventory category.", error);
      debugLog("[CategoryActionDebug]", {
        action: isUuid(category.id) ? "edit" : "create",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount: itemCountByCategory.get(category.id) || 0,
        supabaseResult: null,
        error,
      });
      notify("Unable to save category", error.message || "Please try again.", "error");
    }
  }

  async function saveUom(uom) {
    const normalized = normalizeUom({
      ...uom,
      code: String(uom.code || "").trim(),
      displayName: String(uom.displayName || "").trim(),
      uomType: String(uom.uomType || "").trim(),
      updatedAt: new Date().toISOString(),
      createdAt: uom.createdAt || new Date().toISOString(),
    });
    const shouldReturnToSettings = modal?.returnToSettings;
    try {
      setUomWriteStatus("Saving");
      const savedUom = await persistRemoteInventoryUom(normalized);
      setData((current) => ({
        ...current,
        uoms: current.uoms?.some((entry) => entry.id === savedUom.id)
          ? current.uoms.map((entry) => entry.id === savedUom.id ? savedUom : entry)
          : [...(current.uoms || []), savedUom],
      }));
      await refreshInventory();
      setUomWriteStatus(`Saved ${savedUom.code}`);
      setModal(shouldReturnToSettings ? { type: "uom-settings" } : null);
      notify("Inventory UOM saved", savedUom.code);
      return savedUom;
    } catch (error) {
      console.warn("[InventoryControl] Unable to save UOM.", error);
      debugLog("[UomSaveDebug]", { action: isUuid(normalized.id) ? "update" : "create", payload: normalized, result: null, error });
      const message = uomSaveErrorMessage(error);
      setUomWriteStatus(`Failed: ${message}`);
      notify("Unable to save UOM", message, "error");
      return null;
    }
  }

  async function saveQuickUom(uom) {
    const normalized = normalizeUom({
      ...uom,
      code: String(uom.code || "").trim(),
      displayName: String(uom.displayName || "").trim(),
      uomType: String(uom.uomType || "").trim(),
      updatedAt: new Date().toISOString(),
      createdAt: uom.createdAt || new Date().toISOString(),
    });
    try {
      setUomWriteStatus("Saving");
      const savedUom = await persistRemoteInventoryUom(normalized);
      setData((current) => ({
        ...current,
        uoms: current.uoms?.some((entry) => entry.id === savedUom.id)
          ? current.uoms.map((entry) => entry.id === savedUom.id ? savedUom : entry)
          : [...(current.uoms || []), savedUom],
      }));
      await refreshInventory();
      setUomWriteStatus(`Saved ${savedUom.code}`);
      notify("Inventory UOM saved", savedUom.code);
      return savedUom;
    } catch (error) {
      console.warn("[InventoryControl] Unable to save quick UOM.", error);
      debugLog("[UomSaveDebug]", { action: "create", payload: normalized, result: null, error });
      const message = uomSaveErrorMessage(error);
      setUomWriteStatus(`Failed: ${message}`);
      notify("Unable to save UOM", message, "error");
      return null;
    }
  }

  async function sortCategories(draggedId, targetId) {
    let sortedCategories = [];
    setData((current) => {
      const ordered = [...current.categories].sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) || a.name.localeCompare(b.name));
      const fromIndex = ordered.findIndex((category) => category.id === draggedId);
      const toIndex = ordered.findIndex((category) => category.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const [moved] = ordered.splice(fromIndex, 1);
      ordered.splice(toIndex, 0, moved);
      const sorted = ordered.map((category, index) => ({ ...category, sortOrder: index + 1 }));
      sortedCategories = sorted;
      const byId = new Map(sorted.map((category) => [category.id, category]));
      return {
        ...current,
        categories: current.categories.map((category) => byId.get(category.id) || category),
      };
    });
    try {
      const results = await Promise.all(sortedCategories
        .filter((category) => isUuid(category.id))
        .map((category) => supabase
          .from("inventory_categories")
          .update({ sort_order: category.sortOrder, updated_at: new Date().toISOString() })
          .eq("id", category.id)
        ));
      const sortError = results.find((result) => result.error)?.error;
      if (sortError) throw sortError;
      await refreshInventory();
      notify("Category order updated");
    } catch (error) {
      console.warn("[InventoryControl] Unable to persist category order.", error);
      notify("Unable to update category order", error.message || "Please try again.", "error");
      await refreshInventory();
    }
  }

  async function archiveCategory(category) {
    try {
      const savedCategory = await persistRemoteInventoryCategory({ ...category, status: "inactive" });
      debugLog("[CategoryActionDebug]", {
        action: "archive",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount: itemCountByCategory.get(category.id) || 0,
        supabaseResult: savedCategory,
        error: null,
      });
      setData((current) => ({
        ...current,
        categories: current.categories.map((entry) => entry.id === category.id ? savedCategory : entry),
      }));
      await refreshInventory();
      notify("Inventory category archived");
    } catch (error) {
      console.warn("[InventoryControl] Unable to archive inventory category.", error);
      debugLog("[CategoryActionDebug]", {
        action: "archive",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount: itemCountByCategory.get(category.id) || 0,
        supabaseResult: null,
        error,
      });
      notify("Unable to archive category", error.message || "Please try again.", "error");
    }
  }

  async function deleteCategory(category) {
    try {
      const linkedItemCount = await countRemoteInventoryItemsForCategory(category.id);
      if (linkedItemCount > 0) {
        debugLog("[CategoryActionDebug]", {
          action: "delete",
          categoryId: category.id,
          categoryName: category.name,
          linkedItemCount,
          supabaseResult: "blocked",
          error: null,
        });
        notify("Cannot delete this category", `Cannot delete this category because it is used by ${linkedItemCount} inventory item${linkedItemCount === 1 ? "" : "s"}. Archive it or reassign items first.`, "warning");
        return;
      }
      const { error } = await supabase
        .from("inventory_categories")
        .delete()
        .eq("id", category.id);
      if (error) throw error;
      debugLog("[CategoryActionDebug]", {
        action: "delete",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount,
        supabaseResult: "deleted",
        error: null,
      });
      setData((current) => ({
        ...current,
        categories: current.categories.filter((entry) => entry.id !== category.id),
      }));
      await refreshInventory();
      notify("Inventory category deleted");
    } catch (error) {
      console.warn("[InventoryControl] Unable to delete inventory category.", error);
      debugLog("[CategoryActionDebug]", {
        action: "delete",
        categoryId: category.id,
        categoryName: category.name,
        linkedItemCount: itemCountByCategory.get(category.id) || 0,
        supabaseResult: null,
        error,
      });
      notify("Unable to delete category", error.message || "Please try again.", "error");
    }
  }

  async function archiveUom(uom) {
    const action = uom.isActive ? "archive" : "activate";
    try {
      setUomWriteStatus(action === "archive" ? "Archiving" : "Activating");
      const savedUom = await persistRemoteInventoryUom({ ...uom, isActive: !uom.isActive });
      setData((current) => ({
        ...current,
        uoms: (current.uoms || []).map((entry) => entry.id === savedUom.id ? savedUom : entry),
      }));
      await refreshInventory();
      setUomWriteStatus(`${action === "archive" ? "Archived" : "Activated"} ${savedUom.code}`);
      notify(uom.isActive ? "Inventory UOM archived" : "Inventory UOM activated", savedUom.code);
    } catch (error) {
      console.warn("[InventoryControl] Unable to archive UOM.", error);
      debugLog("[UomSaveDebug]", { action, payload: uom, result: null, error });
      setUomWriteStatus(`Failed: ${error.message || "Unable to update"}`);
      notify("Unable to update UOM", error.message || "Please try again.", "error");
    }
  }

  async function deleteUom(uom) {
    try {
      setUomWriteStatus("Deleting");
      const linkedItemCount = await countRemoteInventoryItemsForUom(uom.code);
      if (linkedItemCount > 0) {
        debugLog("[UomSaveDebug]", { action: "delete", payload: uom, result: "blocked", linkedItemCount, error: null });
        setUomWriteStatus(`Blocked: ${uom.code} is used`);
        notify("Cannot delete this UOM", `Cannot delete this UOM because it is used by ${linkedItemCount} inventory item${linkedItemCount === 1 ? "" : "s"}. Archive it instead.`, "warning");
        return;
      }
      const result = await supabase
        .from("inventory_uoms")
        .delete()
        .eq("id", uom.id);
      debugLog("[UomSaveDebug]", { action: "delete", payload: uom, result: { data: result.data || null, error: result.error }, error: result.error });
      if (result.error) throw result.error;
      setData((current) => ({ ...current, uoms: (current.uoms || []).filter((entry) => entry.id !== uom.id) }));
      await refreshInventory();
      setUomWriteStatus(`Deleted ${uom.code}`);
      notify("Inventory UOM deleted", uom.code);
    } catch (error) {
      console.warn("[InventoryControl] Unable to delete UOM.", error);
      debugLog("[UomSaveDebug]", { action: "delete", payload: uom, result: null, error });
      setUomWriteStatus(`Failed: ${error.message || "Unable to delete"}`);
      notify("Unable to delete UOM", error.message || "Please try again.", "error");
    }
  }

  async function importInventoryRows(previewRows) {
    const validRows = previewRows.filter((row) => !row.errors.length);
    const invalidRows = previewRows.filter((row) => row.errors.length);
    let created = 0;
    let updated = 0;
    const failures = [];

    for (const row of validRows) {
      const incoming = row.item;
      const existing = data.items.find((item) => (
        incoming.sku ? canonical(item.sku) === canonical(incoming.sku) : canonical(item.name) === canonical(incoming.name)
      )) || null;
      const linkedOutletIds = uniqueIds(incoming.linkedOutletIds || []);
      const existingConfigs = new Map((existing?.outletConfigs || []).map((config) => [config.outletId, config]));
      const remoteItem = normalizeInventoryItem({
        ...(existing || {}),
        ...incoming,
        id: existing?.id || incoming.id || "",
        photo: existing?.photo || existing?.photo_url || incoming.photo || "",
        photo_url: existing?.photo_url || existing?.photo || incoming.photo || "",
        costUpdatedBy: auth?.profile?.id || "",
        costMetadataChanged: incoming.cost !== "" && incoming.cost !== null && incoming.cost !== undefined,
        linkedOutletIds,
        outletConfigs: linkedOutletIds.map((outletId) => buildOutletConfig(existing || incoming, outletId, existingConfigs.get(outletId))),
      });

      try {
        const result = await persistRemoteInventoryItem(remoteItem, auth?.user?.id, accessibleOutletIds);
        debugLog("[InventoryImportDebug]", {
          rowNumber: row.rowNumber,
          action: row.action,
          item: remoteItem.name,
          linkedOutletIds,
          result,
          error: null,
        });
        if (row.action === "update" || existing) updated += 1;
        else created += 1;
      } catch (error) {
        console.warn("[InventoryControl] Unable to import inventory row.", error);
        debugLog("[InventoryImportDebug]", {
          rowNumber: row.rowNumber,
          action: row.action,
          item: remoteItem.name,
          linkedOutletIds,
          result: null,
          error,
        });
        failures.push({ rowNumber: row.rowNumber, message: error?.cause?.message || error?.message || "Remote save failed" });
      }
    }

    await refreshInventory();
    const result = {
      created,
      updated,
      skipped: invalidRows.length,
      failed: failures.length,
      failures,
    };
    if (failures.length) {
      notify("Import completed", `${created} created · ${updated} updated · ${invalidRows.length} skipped · ${failures.length} failed.`, "warning");
    } else {
      notify("Import completed", `${created} created · ${updated} updated · ${invalidRows.length} skipped.`);
    }
    return result;
  }

  function exportMasterInventory() {
    const rows = visibleItems.map((item) => {
      const category = categoryForItem(item, categoryById);
      const linkedOutlets = (item.linkedOutletIds || []).map((id) => {
        const outlet = outletById.get(id);
        return outlet ? outletDisplayCode(outlet) : "";
      }).filter(Boolean).join(", ");
      return {
        "Item Name": item.name,
        "SKU Code": item.sku_code || item.sku,
        Category: category?.name || "",
        UOM: item.uom_code || item.unit,
        Cost: item.cost === "" || item.cost === null || item.cost === undefined ? "" : item.cost,
        Description: item.description,
        Status: item.status,
        "Linked Outlet Codes": linkedOutlets,
        "Created At": item.createdAt || "",
        "Updated At": item.updatedAt || "",
      };
    });
    const columns = ["Item Name", "SKU Code", "Category", "UOM", "Cost", "Description", "Status", "Linked Outlet Codes", "Created At", "Updated At"];
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\n");
    downloadTextFile(`feedx-master-inventory-${todayInput()}.csv`, csv);
    notify("Master inventory exported successfully", `${rows.length} item${rows.length === 1 ? "" : "s"} exported.`);
  }




  async function archiveItem(itemId) {
    const item = data.items.find((entry) => entry.id === itemId);
    if (!isUuid(itemId)) {
      notify("Failed to archive Inventory Item", "This item has not been saved to Supabase yet.", "error");
      return;
    }
    try {
      const result = await supabase
        .from("inventory_items")
        .update({ status: "inactive", updated_by: auth?.user?.id || null, updated_at: new Date().toISOString() })
        .eq("id", itemId)
        .select("*")
        .single();
      debugLog("[InventorySaveDebug]", { mode: "archive", payload: { itemId }, itemUpdateResult: { data: result.data, error: result.error }, error: result.error });
      if (result.error) throw result.error;
      setData((current) => ({
        ...current,
        items: current.items.map((item) => item.id === itemId ? { ...item, status: "inactive", updatedAt: result.data?.updated_at || new Date().toISOString() } : item),
      }));
      await refreshInventory();
      notify("Inventory item archived", item?.name || result.data?.item_name || result.data?.name || "");
    } catch (error) {
      console.warn("[InventoryControl] Unable to sync archived inventory item.", error);
      debugLog("[InventorySaveDebug]", { mode: "archive", payload: { itemId }, itemUpdateResult: null, error });
      notify("Failed to archive Inventory Item", error.message || "Please try again.", "error");
    }
  }


  function renderMasterInventory() {
    const masterSummary = {
      totalItems: visibleItems.length,
      categories: new Set(visibleItems.map((item) => item.categoryId || item.category_id || item.categoryName || item.category_name).filter(Boolean)).size,
      activeItems: visibleItems.filter(isActiveInventoryItem).length,
      outletsLinked: new Set(visibleItems.flatMap((item) => item.linkedOutletIds || [])).size,
    };

    const renderCostCell = (item, mobile = false) => {
      const editing = editingCostItemId === item.id;
      const saving = savingCostItemId === item.id;
      if (editing) {
        return (
          <input
            className={`control h-8 ${mobile ? "w-28 text-right" : "w-32"} text-[13px] font-semibold`}
            type="number"
            min="0"
            step="0.0001"
            value={editingCostValue}
            autoFocus
            disabled={saving}
            placeholder="0.00"
            onFocus={selectInputText}
            onChange={(event) => setEditingCostValue(event.target.value)}
            onBlur={() => {
              if (skipCostBlurSaveRef.current) {
                skipCostBlurSaveRef.current = false;
                return;
              }
              saveInlineCost(item);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                skipCostBlurSaveRef.current = true;
                saveInlineCost(item);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelInlineCostEdit();
              }
            }}
          />
        );
      }
      return (
        <button
          className={`${mobile ? "text-right" : "text-left"} rounded-lg px-2 py-1 text-[13px] font-bold text-text-primary transition hover:bg-primary/5 disabled:cursor-not-allowed disabled:text-text-muted`}
          type="button"
          disabled={!can.editMaster || saving}
          onClick={() => beginInlineCostEdit(item)}
          title={can.editMaster ? "Edit cost" : "Editing cost requires inventory master edit permission"}
        >
          {saving ? "Saving..." : formatInventoryCost(item.cost, item.uom_code || item.unit)}
        </button>
      );
    };

    const renderItemRow = (item) => {
      const category = categoryForItem(item, categoryById);
      const photo = item.photo_url || item.photo;
      return (
        <tr key={item.id} className="transition hover:bg-primary/5">
          <td className="py-3.5">
            <div className="flex items-center gap-3">
              {photo ? (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-slate-50 shadow-sm">
                  <img src={photo} alt="" className="h-full w-full object-cover" />
                </div>
              ) : <InventoryCategoryIcon category={category} />}
              <div>
                <div className="font-bold text-text-primary">{item.name}</div>
                <div className="type-caption text-text-secondary">{item.description || category?.name || "Inventory item"}</div>
              </div>
            </div>
          </td>
          {masterGroupBy === "none" ? <td>{category?.name ?? "Uncategorized"}</td> : null}
          <td className="font-mono text-xs text-text-secondary">{item.sku || "-"}</td>
          <td>{item.uom_code || item.unit}</td>
          <td>
            <LinkedOutletsSummary item={item} outlets={outlets} onConfigure={() => { if (requirePermission(can.editParLevels, "manage par levels")) ui?.navigate?.("inventory_par_levels"); }} />
          </td>
          <td>{renderCostCell(item)}</td>
          <td><Badge tone={statusTone(item.status)}>{toTitle(item.status)}</Badge></td>
          <td>
            <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
              <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.editMaster, "edit inventory items") && setModal({ type: "item", item })}>Edit</button>
              <button className="btn-secondary h-8 px-2.5 text-xs text-rose-700" type="button" onClick={() => requirePermission(can.deleteMaster, "archive inventory items") && archiveItem(item.id)}>Archive</button>
            </div>
          </td>
        </tr>
      );
    };

    const renderItemCard = (item) => {
      const category = categoryForItem(item, categoryById);
      const photo = item.photo_url || item.photo;
      return (
        <div key={item.id} className="rounded-2xl border border-border bg-surface p-3 shadow-sm">
          <div className="flex gap-3">
            {photo ? (
              <button
                className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-slate-50 shadow-sm"
                type="button"
                onClick={() => setPhotoPreview({ src: photo, title: item.name })}
                aria-label={`View photo for ${item.name}`}
              >
                <img src={photo} alt="" className="h-full w-full object-cover" />
              </button>
            ) : <InventoryCategoryIcon category={category} />}
            <div className="min-w-0 flex-1">
              <div className="font-bold text-text-primary">{item.name}</div>
              <div className="mt-0.5 type-caption text-text-secondary">{category?.name || "Uncategorized"} · {item.sku || "No SKU"}</div>
              {item.description ? <div className="mt-1 line-clamp-2 type-caption text-text-muted">{item.description}</div> : null}
            </div>
            <Badge tone={statusTone(item.status)}>{toTitle(item.status)}</Badge>
          </div>
          <div className="mt-3 grid gap-2 type-caption text-text-secondary">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">UOM</span>
              <span className="font-bold text-text-primary">{item.uom_code || item.unit || "-"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">Linked Outlets</span>
              <LinkedOutletsSummary item={item} outlets={outlets} onConfigure={() => { if (requirePermission(can.editParLevels, "manage par levels")) ui?.navigate?.("inventory_par_levels"); }} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">Cost</span>
              {renderCostCell(item, true)}
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2 border-t border-border pt-3" onClick={(event) => event.stopPropagation()}>
            <button className="btn-secondary h-8 px-2.5 text-xs" type="button" onClick={() => requirePermission(can.editMaster, "edit inventory items") && setModal({ type: "item", item })}>Edit</button>
            <button className="btn-secondary h-8 px-2.5 text-xs text-rose-700" type="button" onClick={() => requirePermission(can.deleteMaster, "archive inventory items") && archiveItem(item.id)}>Archive</button>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Boxes} label="Total Items" value={masterSummary.totalItems} helper="Master records" size="compact" />
          <MetricCard icon={ClipboardList} label="Categories" value={masterSummary.categories} helper="In current list" size="compact" />
          <MetricCard icon={CheckCircle2} label="Active Items" value={masterSummary.activeItems} helper="Available for operations" tone="success" size="compact" />
          <MetricCard icon={Warehouse} label="Outlets Linked" value={masterSummary.outletsLinked} helper="Unique outlet links" tone="info" size="compact" />
        </div>

      <AdminFilterToolbar>
          <AdminSearchField label="Search item" value={query} onChange={(value) => setQuery(value)} placeholder="Search item name or SKU" />
          <SelectField label="Outlet" value={effectiveOutletId} options={outletOptions} onChange={setSelectedOutletId} searchable />
          <SelectField label="Category" value={categoryFilter} options={[{ value: "all", label: "All" }, ...sortedCategories.map((category) => ({ value: category.id, label: category.name }))]} onChange={setCategoryFilter} searchable />
          <SelectField label="Status" value={statusFilter} options={[{ value: "all", label: "All" }, ...statuses.map((status) => ({ value: status, label: toTitle(status) }))]} onChange={setStatusFilter} />
          <div className="xl:col-start-4">
            <SelectField
              label="Group by"
              value={masterGroupBy}
              options={[{ value: "category", label: "Category" }, { value: "none", label: "None" }]}
              onChange={setMasterGroupBy}
            />
          </div>
          {import.meta.env.DEV ? (
            <button
              className="btn-secondary h-9 xl:col-start-4"
              type="button"
              onClick={async () => {
                await refreshInventory();
                notify("Inventory refreshed", "Browser inventory cache cleared and Supabase data reloaded.");
              }}
            >
              <RefreshCw size={15} /> Hard Refresh Inventory
            </button>
          ) : null}
        </AdminFilterToolbar>

        <SectionCard
          title="Inventory Items"
          description="Global item definitions. Outlet par levels are managed in Par Level Setup."
        >
          {visibleItems.length ? (
            <>
            <div className="space-y-3 md:hidden">
              {masterGroupBy === "category" ? visibleItemGroups.map((group) => {
                const collapsed = collapsedCategoryIds.has(group.id);
                return (
                  <div key={group.id} className="space-y-2">
                    <button
                      className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-left transition hover:bg-primary/8"
                      type="button"
                      onClick={() => setCollapsedCategoryIds((current) => {
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
                          <span className="type-caption font-semibold text-text-secondary">{group.items.length} item{group.items.length === 1 ? "" : "s"} · {new Set(group.items.flatMap((item) => item.linkedOutletIds || [])).size} outlets linked</span>
                        </span>
                      </span>
                      <ChevronDown className={`shrink-0 text-text-muted transition ${collapsed ? "-rotate-90" : ""}`} size={16} />
                    </button>
                    {collapsed ? null : group.items.map(renderItemCard)}
                  </div>
                );
              }) : visibleItems.map(renderItemCard)}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[980px] text-left">
                <thead className="text-[11px] uppercase tracking-wide text-text-muted">
                  <tr className="border-b border-border">
                    <th className="py-2">Item</th>
                    {masterGroupBy === "none" ? <th>Category</th> : null}
                    <th>SKU Code</th>
                    <th>UOM</th>
                    <th>Linked Outlets</th>
                    <th>Cost</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-[13px]">
                  {masterGroupBy === "category" ? visibleItemGroups.map((group) => {
                    const collapsed = collapsedCategoryIds.has(group.id);
                    return (
                      <Fragment key={group.id}>
                        <tr key={`${group.id}-header`} className="bg-primary/5">
                          <td className="py-2.5" colSpan={7}>
                            <button
                              className="flex min-h-14 w-full items-center justify-between rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-left transition hover:bg-primary/8"
                              type="button"
                              onClick={() => setCollapsedCategoryIds((current) => {
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
                                  <span className="type-caption font-semibold text-text-secondary">
                                    {group.items.length} item{group.items.length === 1 ? "" : "s"} · {new Set(group.items.flatMap((item) => item.linkedOutletIds || [])).size} outlets linked
                                  </span>
                                </span>
                              </span>
                              <ChevronDown className={`shrink-0 text-text-muted transition ${collapsed ? "-rotate-90" : ""}`} size={16} />
                            </button>
                          </td>
                        </tr>
                        {collapsed ? null : group.items.map(renderItemRow)}
                      </Fragment>
                    );
                  }) : visibleItems.map(renderItemRow)}
                </tbody>
              </table>
            </div>
            </>
          ) : <EmptyState title="No inventory items match your filters" description="Adjust search, outlet, category or status filters to view more inventory items." />}
        </SectionCard>
        {import.meta.env.DEV ? (
          <div className="rounded-2xl border border-dashed border-border bg-slate-50/80 px-3 py-2 type-caption font-semibold text-text-secondary">
            Remote Rows: {inventoryMeta.rawItemsCount || 0} · Normalized Rows: {inventoryMeta.normalizedItemsCount || data.items.length} · Visible Rows: {visibleItems.length} · Categories: {data.categories.length} · UOMs: {data.uoms.length} · Outlet Links: {inventoryMeta.outletLinkCount || 0} · Fallback Active: {inventoryMeta.fallbackActive ? "true" : "false"} · Build: {import.meta.env.VITE_APP_VERSION || import.meta.env.MODE} · Source: {inventoryMeta.dataSource}{inventoryMeta.lastFetchedAt ? ` · ${formatDate(inventoryMeta.lastFetchedAt)}` : ""}
          </div>
        ) : null}
      </div>
    );
  }



  const actions = <>
    <button className="btn-secondary" type="button" onClick={() => requirePermission(can.importMaster, 'import master inventory') && setModal({ type: 'inventory-import' })}><Upload size={15} /> Import</button>
    <button className="btn-secondary" type="button" onClick={() => requirePermission(can.exportMaster, 'export inventory') && exportMasterInventory()}><Download size={15} /> Export</button>
    <button className="btn-secondary" type="button" onClick={() => requirePermission(can.viewCategories, 'view inventory categories') && setModal({ type: 'category-settings' })}>Category Settings</button>
    <button className="btn-secondary" type="button" onClick={() => requirePermission(can.viewUoms, 'view inventory UOM settings') && setModal({ type: 'uom-settings' })}>UOM Settings</button>
    <button className="btn-primary" type="button" onClick={() => requirePermission(can.createMaster, 'add inventory items') && setModal({ type: 'item' })}><PackagePlus size={15} /> Add Item</button>
  </>;
  if (read.state === 'loading' || read.state === 'error') return <div className="space-y-4">
    <PageHeader section="INVENTORY CONTROL" title="Master Inventory" description="Create and manage all inventory items used across outlets." />
    <div className="card p-4" role={read.state === 'error' ? 'alert' : 'status'}>
      <h2 className="font-semibold">{read.state === 'error' ? 'Master Inventory unavailable or incomplete' : 'Loading complete Master Inventory…'}</h2>
      {read.state === 'error' ? <><p className="mt-2 text-sm text-text-secondary">{read.error} No partial results are presented as complete.</p><button type="button" className="btn-secondary mt-3" onClick={refreshInventory}>Retry</button></> : null}
    </div>
  </div>;
  return <div className="space-y-4">
    <PageHeader section="INVENTORY CONTROL" title="Master Inventory" description="Create and manage all inventory items used across outlets." actions={actions} />
    {read.state === 'refreshing' ? <p role="status" className="text-sm text-text-secondary">Refreshing Master Inventory. Showing the last verified complete read.</p> : null}
    {read.state === 'stale-error' ? <div className="card p-3" role="alert">{read.error} Showing the last verified Master Inventory read. <button type="button" className="btn-secondary ml-2" onClick={refreshInventory}>Retry</button></div> : null}
    {renderMasterInventory()}
      {modal?.type === "item" ? <InventoryItemModal item={modal.item} categories={sortedCategories} outlets={outlets} uoms={sortedUoms} canCreateUom={can.createUom} onAddUom={saveQuickUom} onClose={() => setModal(null)} onSave={saveItem} /> : null}
      {modal?.type === "inventory-import" ? (
        <InventoryImportModal
          categories={sortedCategories}
          outlets={outlets}
          items={data.items}
          uoms={sortedUoms}
          onClose={() => setModal(null)}
          onImport={importInventoryRows}
        />
      ) : null}
      {modal?.type === "category-settings" ? (
        <CategorySettingsModal
          categories={sortedActiveCategories}
          itemCounts={itemCountByCategory}
          canAdd={can.createCategory}
          canEdit={can.editCategory}
          canDelete={can.deleteCategory}
          requirePermission={requirePermission}
          onClose={() => setModal(null)}
          onAdd={() => setModal({ type: "category", returnToSettings: true })}
          onEdit={(category) => setModal({ type: "category", category, returnToSettings: true })}
          onArchive={archiveCategory}
          onDelete={deleteCategory}
          onSort={sortCategories}
        />
      ) : null}
      {modal?.type === "category" ? <CategoryModal category={modal.category} onClose={() => setModal(null)} onSave={saveCategory} /> : null}
      {modal?.type === "uom-settings" ? (
        <UomSettingsModal
          uoms={sortedActiveUoms}
          remoteRows={sortedUoms.length}
          visibleRows={sortedActiveUoms.length}
          lastWriteStatus={uomWriteStatus}
          canAdd={can.createUom}
          canEdit={can.editUom}
          canDelete={can.deleteUom}
          requirePermission={requirePermission}
          onClose={() => setModal(null)}
          onAdd={() => setModal({ type: "uom", returnToSettings: true })}
          onEdit={(uom) => setModal({ type: "uom", uom, returnToSettings: true })}
          onArchive={archiveUom}
          onDelete={deleteUom}
        />
      ) : null}
      {modal?.type === "uom" ? <UomModal uom={modal.uom} onClose={() => setModal(modal.returnToSettings ? { type: "uom-settings" } : null)} onSave={saveUom} /> : null}

    <InventoryItemPhotoPreview preview={photoPreview} onClose={() => setPhotoPreview(null)} />
  </div>;
}
