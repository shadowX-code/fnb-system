import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Download, RotateCcw, Upload } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { operationsService } from "../services/operationsService.js";
import { monthLabel } from "../utils/analytics.js";

const outletAliases = {
  HIPB: "outlet-001",
  "Hola Ipoh Bangsar": "outlet-001",
  HTTD: "outlet-002",
  "Hola TTDI": "outlet-002",
  HMK: "outlet-003",
  "Hola Mont Kiara": "outlet-003",
  HSBG: "outlet-004",
  "Hola Subang": "outlet-004",
};

const monthAliases = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const salesFieldOptions = ["Ignore", "Outlet", "Month", "Year", "Dine In", "Takeaway", "GrabFood", "FoodPanda", "ShopeeFood", "SST Deduction"];
const purchaseFieldOptions = ["Ignore", "Outlet", "Month", "Year", "Supplier", "Category", "Remark", "Amount"];

function normalize(value) {
  return String(value ?? "").trim();
}

function parseMonth(value) {
  const raw = normalize(value);
  const number = Number(raw);
  if (number >= 1 && number <= 12) return number;
  return monthAliases[raw.toLowerCase()] || null;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = lines[0]?.split(",").map((item) => item.trim()) ?? [];
  const rows = lines.slice(1).map((line, index) => {
    const cells = line.split(",");
    return headers.reduce((record, header, cellIndex) => ({ ...record, [header]: cells[cellIndex]?.trim() ?? "" }), { __row: index + 2 });
  });
  return { headers, rows };
}

function mockRows(importType) {
  if (importType === "Sales") {
    return {
      headers: ["Branch", "Month", "Year", "Dine In", "Takeaway", "Grab Delivery", "FoodPanda", "SST", "Notes"],
      rows: [
        { __row: 2, Branch: "HIPB", Month: "May", Year: "2026", "Dine In": "66000", Takeaway: "1400", "Grab Delivery": "6200", FoodPanda: "3100", SST: "4100", Notes: "month import" },
        { __row: 3, Branch: "UNKNOWN", Month: "May", Year: "2026", "Dine In": "1200", Takeaway: "200", "Grab Delivery": "100", FoodPanda: "0", SST: "90", Notes: "" },
        { __row: 4, Branch: "HIPB", Month: "13", Year: "2026", "Dine In": "1000", Takeaway: "50", "Grab Delivery": "0", FoodPanda: "0", SST: "60", Notes: "" },
      ],
    };
  }
  return {
    headers: ["Branch", "Month", "Year", "Supplier Name", "Category", "Remark", "Purchase Amount"],
    rows: [
      { __row: 2, Branch: "HIPB", Month: "May", Year: "2026", "Supplier Name": "Pasar Mini TLL", Category: "Chicken", Remark: "fresh chicken", "Purchase Amount": "10800" },
      { __row: 3, Branch: "HIPB", Month: "May", Year: "2026", "Supplier Name": "Unknown Supplier", Category: "Chicken", Remark: "", "Purchase Amount": "500" },
      { __row: 4, Branch: "HIPB", Month: "May", Year: "2026", "Supplier Name": "Best Marketing", Category: "Rice / Sauce", Remark: "bulk", "Purchase Amount": "abc" },
    ],
  };
}

function autoDetect(headers, importType) {
  const mappings = {};
  headers.forEach((header) => {
    const key = header.toLowerCase();
    if (["branch", "outlet", "outlet code"].includes(key)) mappings[header] = "Outlet";
    else if (key.includes("month")) mappings[header] = "Month";
    else if (key.includes("year")) mappings[header] = "Year";
    else if (key.includes("dine")) mappings[header] = "Dine In";
    else if (key.includes("take")) mappings[header] = "Takeaway";
    else if (key.includes("grab")) mappings[header] = "GrabFood";
    else if (key.includes("panda")) mappings[header] = "FoodPanda";
    else if (key.includes("shopee")) mappings[header] = "ShopeeFood";
    else if (key.includes("sst")) mappings[header] = "SST Deduction";
    else if (key.includes("supplier")) mappings[header] = "Supplier";
    else if (key.includes("category")) mappings[header] = "Category";
    else if (key.includes("remark") || key.includes("note")) mappings[header] = "Remark";
    else if (key.includes("amount") || key.includes("purchase")) mappings[header] = "Amount";
    else mappings[header] = "Ignore";
  });
  if (importType === "Purchases" && !Object.values(mappings).includes("Amount")) {
    const amountHeader = headers.find((header) => header.toLowerCase().includes("purchase"));
    if (amountHeader) mappings[amountHeader] = "Amount";
  }
  return mappings;
}

function mappedValue(row, mappings, field) {
  const column = Object.entries(mappings).find(([, mapped]) => mapped === field)?.[0];
  return column ? row[column] : "";
}

function existingPeriodHasData(store, importType, outletId, month, year) {
  const records = importType === "Sales" ? store.salesRecords : store.purchaseRecords;
  return records.some((record) => record.outlet_id === outletId && record.month === month && record.year === year);
}

function isLocked(store, outletId, month, year) {
  return store.monthlyLocks.some((lock) => lock.outlet_id === outletId && lock.month === month && lock.year === year && lock.is_locked);
}

function validateImport({ store, importType, rows, mappings }) {
  const warnings = [];
  const failures = [];
  const validRows = [];
  const unknownSuppliers = new Map();
  const required = importType === "Sales" ? ["Outlet", "Month", "Year"] : ["Outlet", "Month", "Year", "Supplier", "Category", "Amount"];
  const missingColumns = required.filter((field) => !Object.values(mappings).includes(field));
  if (missingColumns.length) {
    failures.push({ row: "-", reason: `Missing required columns: ${missingColumns.join(", ")}` });
  }

  rows.forEach((row) => {
    const outletRaw = mappedValue(row, mappings, "Outlet");
    const outletId = outletAliases[outletRaw] || store.outlets.find((outlet) => outlet.name.toLowerCase() === normalize(outletRaw).toLowerCase())?.id;
    const month = parseMonth(mappedValue(row, mappings, "Month"));
    const year = Number(mappedValue(row, mappings, "Year"));
    const rowFailures = [];

    if (!outletId) rowFailures.push("Invalid outlet");
    if (!month) rowFailures.push("Invalid month");
    if (!year || year < 2020) rowFailures.push("Invalid year");
    if (outletId && month && year && isLocked(store, outletId, month, year)) rowFailures.push("Locked month protection");

    if (importType === "Sales") {
      ["Dine In", "Takeaway", "GrabFood", "FoodPanda", "ShopeeFood", "SST Deduction"].forEach((field) => {
        if (!Object.values(mappings).includes(field)) return;
        const value = mappedValue(row, mappings, field);
        if (value === "") return;
        const amount = Number(value);
        if (Number.isNaN(amount)) rowFailures.push(`Invalid number format in ${field}`);
        if (amount < 0 && field !== "SST Deduction") rowFailures.push(`Negative sales value in ${field}`);
      });
    } else {
      const supplierName = mappedValue(row, mappings, "Supplier");
      const categoryName = mappedValue(row, mappings, "Category");
      const amount = Number(mappedValue(row, mappings, "Amount"));
      const supplierExists = store.suppliers.some((supplier) => supplier.name.toLowerCase() === normalize(supplierName).toLowerCase());
      if (!supplierExists && supplierName) {
        const name = normalize(supplierName);
        const current = unknownSuppliers.get(name) ?? { name, rows: [] };
        unknownSuppliers.set(name, { ...current, rows: [...current.rows, row.__row] });
      }
      if (!store.purchaseCategories.some((category) => category.name.toLowerCase() === normalize(categoryName).toLowerCase())) rowFailures.push("Unknown category");
      if (Number.isNaN(amount)) rowFailures.push("Invalid number format");
      if (amount < 0) rowFailures.push("Negative purchase value");
    }

    if (outletId && month && year && existingPeriodHasData(store, importType, outletId, month, year)) {
      warnings.push({ row: row.__row, reason: "Existing data conflict", outletId, month, year });
    }

    if (rowFailures.length) failures.push({ row: row.__row, reason: rowFailures.join("; ") });
    else validRows.push({ source: row, outletId, month, year });
  });

  const affected = validRows[0] ? { outletId: validRows[0].outletId, month: validRows[0].month, year: validRows[0].year } : null;
  return { warnings, failures, validRows, affected, unknownSuppliers: [...unknownSuppliers.values()] };
}

function getSuggestedSuppliers(store, importedName) {
  const terms = normalize(importedName).toLowerCase().split(/\s+/).filter(Boolean);
  return store.suppliers
    .map((supplier) => ({
      supplier,
      score: terms.reduce((total, term) => total + (supplier.name.toLowerCase().includes(term) ? 1 : 0), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.supplier);
}

function resolveSupplierId({ store, source, mappings, supplierResolutions = {}, createdSupplierIds = {} }) {
  const supplierName = normalize(mappedValue(source, mappings, "Supplier"));
  const supplier = store.suppliers.find((item) => item.name.toLowerCase() === supplierName.toLowerCase());
  if (supplier) return supplier.id;
  const resolution = supplierResolutions[supplierName];
  if (resolution?.action === "map") return resolution.supplier_id;
  if (resolution?.action === "create") return createdSupplierIds[supplierName] || `new:${supplierName}`;
  return null;
}

function buildImportedRecords({ store, importType, mappings, validRows, supplierResolutions = {}, createdSupplierIds = {} }) {
  if (!validRows.length) return [];
  if (importType === "Sales") {
    const row = validRows[0].source;
    return store.salesChannels
      .filter((channel) => ["Dine In", "Takeaway", "GrabFood", "FoodPanda", "ShopeeFood", "SST Deduction"].includes(channel.name))
      .map((channel) => ({
        channel_id: channel.id,
        channelName: channel.name,
        amount: Math.abs(Number(mappedValue(row, mappings, channel.name)) || 0),
        remark: "Imported file",
      }));
  }
  const rowsBySupplier = new Map();
  validRows.forEach(({ source }) => {
    const supplierId = resolveSupplierId({ store, source, mappings, supplierResolutions, createdSupplierIds });
    if (!supplierId) return;
    const category = store.purchaseCategories.find((item) => item.name.toLowerCase() === normalize(mappedValue(source, mappings, "Category")).toLowerCase());
    rowsBySupplier.set(supplierId, {
      supplier_id: supplierId,
      category_id: category?.id,
      remark: mappedValue(source, mappings, "Remark"),
      amount: Number(mappedValue(source, mappings, "Amount")) || 0,
    });
  });
  return [...rowsBySupplier.values()];
}

function getPurchaseImportStats(store, affected, importedRows, failuresCount, duplicateCount) {
  if (!affected) return { newRecords: 0, updatedRecords: 0, skippedRows: failuresCount, duplicateSuppliers: duplicateCount };
  const existingSupplierIds = new Set(
    store.purchaseRecords
      .filter((record) => record.outlet_id === affected.outletId && record.month === affected.month && record.year === affected.year)
      .map((record) => record.supplier_id),
  );
  const updatedRecords = importedRows.filter((row) => existingSupplierIds.has(row.supplier_id)).length;
  const newRecords = importedRows.filter((row) => !existingSupplierIds.has(row.supplier_id)).length;
  return {
    newRecords,
    updatedRecords,
    skippedRows: failuresCount + duplicateCount,
    duplicateSuppliers: duplicateCount,
  };
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function DataImportPage({ store, setStore, ui }) {
  const inputRef = useRef(null);
  const [importType, setImportType] = useState("Sales");
  const [step, setStep] = useState("upload");
  const [fileMeta, setFileMeta] = useState(null);
  const [parsed, setParsed] = useState({ headers: [], rows: [] });
  const [mappings, setMappings] = useState({});
  const [validation, setValidation] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [importMode, setImportMode] = useState("cancel");
  const [supplierResolutions, setSupplierResolutions] = useState({});

  const fieldOptions = importType === "Sales" ? salesFieldOptions : purchaseFieldOptions;
  const previewRows = parsed.rows.slice(0, 4);
  const canContinue = validation && validation.validRows.length && !validation.failures.some((item) => item.row === "-");
  const importedPreviewRows = validation ? buildImportedRecords({ store, importType, mappings, validRows: validation.validRows, supplierResolutions }) : [];
  const unresolvedUnknownSuppliers = validation?.unknownSuppliers?.filter((item) => {
    const resolution = supplierResolutions[item.name];
    if (!resolution) return true;
    if (resolution.action === "map") return !resolution.supplier_id;
    if (resolution.action === "create") return !resolution.category_id;
    return false;
  }) ?? [];
  const resolvedSupplierIdsForRows = validation && importType === "Purchases"
    ? validation.validRows.map(({ source }) => resolveSupplierId({ store, source, mappings, supplierResolutions })).filter(Boolean)
    : [];
  const duplicateSupplierCount = resolvedSupplierIdsForRows.length - new Set(resolvedSupplierIdsForRows).size;
  const skippedSupplierCount = Object.values(supplierResolutions).filter((item) => item.action === "skip").length;
  const purchasePreviewStats = importType === "Purchases"
    ? getPurchaseImportStats(store, validation?.affected, importedPreviewRows, (validation?.failures.length ?? 0) + skippedSupplierCount, duplicateSupplierCount)
    : null;

  async function handleFile(file) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "csv"].includes(extension)) {
      ui.notify({ title: "Unsupported file", message: "Please upload .xlsx or .csv only.", tone: "error" });
      return;
    }
    const result = extension === "csv" ? parseCsv(await file.text()) : mockRows(importType);
    const detected = autoDetect(result.headers, importType);
    setFileMeta({ name: file.name, extension });
    setParsed(result);
    setMappings(detected);
    setValidation(null);
    setSupplierResolutions({});
    setImportMode("cancel");
    setStep("mapping");
  }

  function runValidation() {
    const result = validateImport({ store, importType, rows: parsed.rows, mappings });
    setValidation(result);
    setStep(importType === "Purchases" && result.unknownSuppliers.length ? "unknown-suppliers" : "preview");
    if (result.failures.length) {
      ui.notify({ title: "Validation completed with failed rows", message: `${result.failures.length} rows need review.`, tone: "error" });
    } else {
      ui.notify({ title: "Validation ready", message: `${result.validRows.length} rows can be imported.` });
    }
  }

  function confirmImport(mode = importMode) {
    if (!validation?.affected) return;
    if (mode === "cancel") {
      setConflict(null);
      ui.notify({ title: "Import cancelled", message: "No records were changed.", tone: "info" });
      return;
    }
    const affected = validation.affected;
    let writeStats = { created_rows: validation.validRows.length, updated_rows: 0, replaced_rows: 0, skipped_rows: validation.failures.length };
    setStore((current) => {
      const rollbackData = { salesRecords: current.salesRecords, purchaseRecords: current.purchaseRecords };
      let next = current;
      const createdSupplierIds = {};
      if (importType === "Purchases") {
        Object.entries(supplierResolutions).forEach(([supplierName, resolution]) => {
          if (resolution.action === "create") {
            const result = operationsService.addSupplier(next, supplierName, resolution.category_id);
            next = result.state;
            createdSupplierIds[supplierName] = result.supplier.id;
          }
        });
      }
      const importedRows = buildImportedRecords({ store: next, importType, mappings, validRows: validation.validRows, supplierResolutions, createdSupplierIds });
      if (importType === "Sales") {
        next = operationsService.upsertSalesData(next, {
          outletId: affected.outletId,
          month: affected.month,
          year: affected.year,
          salesRows: importedRows,
        });
      } else {
        const result = operationsService.importPurchaseData(current, {
          outletId: affected.outletId,
          month: affected.month,
          year: affected.year,
          purchaseRows: importedRows,
          mode,
        });
        next = result.state;
        writeStats = { ...result.stats, skipped_rows: (result.stats.skipped_rows || 0) + skippedSupplierCount };
      }
      return operationsService.addImportRun(next, {
        file_name: fileMeta?.name || `${importType}_Import.csv`,
        import_type: importType,
        rows_count: parsed.rows.length,
        imported_rows: importedRows.length,
        failed_rows: validation.failures.length,
        warnings_count: validation.warnings.length,
        import_mode: "confirmed",
        conflict_mode: mode,
        affected_outlet_id: affected.outletId,
        affected_month: affected.month,
        affected_year: affected.year,
        rollback_until: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        rollback_data: rollbackData,
        ...writeStats,
      }).state;
    });
    setConflict(null);
    setStep("upload");
    setValidation(null);
    setSupplierResolutions({});
    setParsed({ headers: [], rows: [] });
    ui.notify({ title: "Import complete", message: `${validation.validRows.length} rows imported using ${mode}.` });
  }

  function continueImport() {
    if (!canContinue) return;
    const hasConflict = validation.warnings.some((warning) => warning.reason === "Existing data conflict");
    if (hasConflict) {
      setConflict(validation.affected);
      setImportMode(importType === "Purchases" ? "update_matching" : "cancel");
      return;
    }
    confirmImport(importType === "Purchases" ? "update_matching" : "replace");
  }

  function downloadTemplate() {
    const headers = importType === "Sales"
      ? ["Outlet", "Month", "Year", ...store.salesChannels.filter((channel) => channel.status === "active").map((channel) => channel.name)]
      : ["Outlet", "Month", "Year", "Supplier", "Category", "Remark", "Amount"];
    const hints = importType === "Purchases"
      ? store.suppliers.map((supplier) => {
          const category = store.purchaseCategories.find((item) => item.id === supplier.default_category_id)?.name ?? "Others";
          return `HIPB,May,2026,${supplier.name},${category},,0`;
        }).join("\n")
      : "HIPB,May,2026,0,0,0,0,0,0";
    downloadTextFile(`${importType}_Import_Template.csv`, `${headers.join(",")}\n${hints}`);
    ui.notify({ title: "Template downloaded", message: "Template uses current channels, suppliers and categories." });
  }

  function downloadErrorReport() {
    const skippedUnknowns = (validation?.unknownSuppliers ?? [])
      .filter((item) => supplierResolutions[item.name]?.action === "skip")
      .flatMap((item) => item.rows.map((row) => ({ row, reason: `Skipped unknown supplier: ${item.name}` })));
    const lines = ["Row,Error", ...(validation?.failures ?? []).map((item) => `${item.row},"${item.reason}"`), ...skippedUnknowns.map((item) => `${item.row},"${item.reason}"`)];
    downloadTextFile("Import_Error_Report.csv", lines.join("\n"));
  }

  const importColumns = [
    { key: "file_name", header: "File" },
    { key: "import_type", header: "Type" },
    { key: "rows_count", header: "Rows", align: "right" },
    { key: "conflict_mode", header: "Mode", render: (row) => row.conflict_mode || "-" },
    { key: "warnings_count", header: "Warnings", align: "right" },
    { key: "created_rows", header: "Created", align: "right", render: (row) => row.created_rows ?? "-" },
    { key: "updated_rows", header: "Updated", align: "right", render: (row) => row.updated_rows ?? "-" },
    { key: "replaced_rows", header: "Replaced", align: "right", render: (row) => row.replaced_rows ?? "-" },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "success" ? "success" : row.status === "rolled_back" ? "neutral" : "danger"}>{row.status}</Badge> },
    {
      key: "rollback",
      header: "Rollback",
      align: "right",
      render: (row) => (
        <button
          className="btn-secondary h-8 px-2 text-xs"
          type="button"
          disabled={!row.rollback_data || row.status === "rolled_back"}
          onClick={() => {
            setStore((current) => operationsService.rollbackImportRun(current, row.id, "Marcus Lee"));
            ui.notify({ title: "Import rolled back", message: row.file_name });
          }}
        >
          <RotateCcw size={13} /> Undo
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Data Import"
        description="Upload, map, validate, preview and confirm sales or purchase imports without silent overwrite."
        actions={<button className="btn-secondary" onClick={downloadTemplate}><Download size={16} /> Dynamic Template</button>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Import Workflow" description="Upload → Validate → Preview → Confirm → Import.">
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {["Sales", "Purchases"].map((type) => (
                <button key={type} className={`h-9 rounded-xl px-4 text-sm font-semibold ${importType === type ? "bg-primary text-white" : "bg-white text-text-secondary ring-1 ring-border hover:bg-slate-50"}`} onClick={() => setImportType(type)}>{type}</button>
              ))}
              <Badge tone="info">Step: {step}</Badge>
            </div>

            {step === "upload" ? (
              <button type="button" onClick={() => inputRef.current?.click()} className="w-full rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-8 text-center transition hover:bg-indigo-50">
                <Upload className="mx-auto text-primary" size={28} />
                <div className="mt-3 text-sm font-bold">Upload .xlsx or .csv</div>
                <div className="mt-1 text-sm text-text-secondary">Files are parsed into a mapping and validation workflow before import.</div>
                <input ref={inputRef} hidden type="file" accept=".xlsx,.csv" onChange={(event) => handleFile(event.target.files?.[0])} />
              </button>
            ) : null}

            {step === "mapping" ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-text-secondary">
                  {fileMeta?.name} · {parsed.rows.length} parsed rows · Auto detect ready
                </div>
                <div className="overflow-x-auto rounded-2xl border border-border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="table-head">
                      <tr>
                        <th className="px-3 py-2 text-left">Excel Column</th>
                        <th className="px-3 py-2 text-left">System Field</th>
                        <th className="px-3 py-2 text-left">Sample</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {parsed.headers.map((header) => (
                        <tr key={header}>
                          <td className="px-3 py-2 font-semibold">{header}</td>
                          <td className="px-3 py-2">
                            <SelectField
                              className="w-52"
                              buttonClassName="h-9"
                              value={mappings[header] || "Ignore"}
                              options={fieldOptions.map((option) => ({ value: option, label: option }))}
                              onChange={(nextValue) => setMappings((current) => ({ ...current, [header]: nextValue }))}
                            />
                          </td>
                          <td className="px-3 py-2 text-text-secondary">{previewRows[0]?.[header] || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => setStep("upload")}>Cancel</button>
                  <button className="btn-primary" type="button" onClick={runValidation}>Validate Import</button>
                </div>
              </div>
            ) : null}

            {step === "unknown-suppliers" && validation ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-bold">Unknown Supplier Review Required</div>
                  <p className="mt-1 text-xs leading-5">Import cannot be finalized until every unknown supplier is mapped, created, or skipped.</p>
                </div>
                <div className="space-y-3">
                  {validation.unknownSuppliers.map((item) => {
                    const resolution = supplierResolutions[item.name] ?? { action: "map", supplier_id: "", category_id: "" };
                    const suggestions = getSuggestedSuppliers(store, item.name);
                    return (
                      <div key={item.name} className="rounded-2xl border border-border p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-text-primary">{item.name}</div>
                            <div className="mt-1 text-xs text-text-secondary">Rows: {item.rows.join(", ")}</div>
                            {suggestions.length ? <div className="mt-1 text-xs text-text-secondary">Suggested: {suggestions.map((supplier) => supplier.name).join(", ")}</div> : null}
                          </div>
                          <SelectField
                            className="w-44"
                            buttonClassName="h-9"
                            value={resolution.action}
                            options={[
                              { value: "map", label: "Map to existing" },
                              { value: "create", label: "Create new supplier" },
                              { value: "skip", label: "Skip row" },
                            ]}
                            onChange={(nextValue) => setSupplierResolutions((current) => ({ ...current, [item.name]: { action: nextValue, supplier_id: "", category_id: "" } }))}
                          />
                        </div>
                        {resolution.action === "map" ? (
                          <SelectField
                            className="mt-3 w-full"
                            buttonClassName="h-9"
                            value={resolution.supplier_id}
                            placeholder="Select supplier"
                            searchable
                            options={store.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))}
                            onChange={(nextValue) => setSupplierResolutions((current) => ({ ...current, [item.name]: { ...resolution, supplier_id: nextValue } }))}
                          />
                        ) : null}
                        {resolution.action === "create" ? (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-text-secondary">Status: Active</div>
                            <SelectField
                              buttonClassName="h-9"
                              value={resolution.category_id}
                              placeholder="Select category"
                              searchable
                              options={store.purchaseCategories.map((category) => ({ value: category.id, label: category.name }))}
                              onChange={(nextValue) => setSupplierResolutions((current) => ({ ...current, [item.name]: { ...resolution, category_id: nextValue } }))}
                            />
                          </div>
                        ) : null}
                        {resolution.action === "skip" ? <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-text-secondary">This supplier row will be excluded and listed in skipped rows.</div> : null}
                      </div>
                    );
                  })}
                </div>
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => setStep("mapping")}>Back</button>
                  <button className="btn-primary" type="button" disabled={unresolvedUnknownSuppliers.length > 0} onClick={() => setStep("preview")}>Continue to Preview</button>
                </div>
              </div>
            ) : null}

            {step === "preview" && validation ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-4">
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Total Rows</div><div className="text-xl font-bold">{parsed.rows.length}</div></div>
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Warnings</div><div className="text-xl font-bold text-amber-700">{validation.warnings.length}</div></div>
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Failed Rows</div><div className="text-xl font-bold text-rose-700">{validation.failures.length}</div></div>
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Affected Period</div><div className="text-sm font-bold">{validation.affected ? `${monthLabel(validation.affected.month)} ${validation.affected.year}` : "-"}</div></div>
                </div>

                {importType === "Purchases" && purchasePreviewStats ? (
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-xl border border-border bg-slate-50 p-3"><div className="text-xs text-text-secondary">New Records</div><div className="text-xl font-bold">{purchasePreviewStats.newRecords}</div></div>
                    <div className="rounded-xl border border-border bg-slate-50 p-3"><div className="text-xs text-text-secondary">Updated Records</div><div className="text-xl font-bold text-primary">{purchasePreviewStats.updatedRecords}</div></div>
                    <div className="rounded-xl border border-border bg-slate-50 p-3"><div className="text-xs text-text-secondary">Skipped Rows</div><div className="text-xl font-bold text-amber-700">{purchasePreviewStats.skippedRows}</div></div>
                    <div className="rounded-xl border border-border bg-slate-50 p-3"><div className="text-xs text-text-secondary">Duplicate Suppliers</div><div className="text-xl font-bold text-amber-700">{purchasePreviewStats.duplicateSuppliers}</div></div>
                  </div>
                ) : null}

                {validation.warnings.length ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="flex items-center gap-2 font-bold"><AlertTriangle size={15} /> Warnings</div>
                    <ul className="mt-2 space-y-1 text-xs">
                      {validation.warnings.slice(0, 4).map((item) => <li key={`${item.row}-${item.reason}`}>Row {item.row}: {item.reason}</li>)}
                    </ul>
                  </div>
                ) : null}

                {validation.failures.length ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                    <div className="font-bold">Failed Rows</div>
                    <ul className="mt-2 space-y-1 text-xs">
                      {validation.failures.slice(0, 6).map((item) => <li key={`${item.row}-${item.reason}`}>Row {item.row}: {item.reason}</li>)}
                    </ul>
                    <button className="btn-secondary mt-3 h-8 text-xs" type="button" onClick={downloadErrorReport}>Download error report</button>
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => setStep("upload")}>Cancel</button>
                  <button className="btn-primary" type="button" disabled={!canContinue} onClick={continueImport}>Continue Import</button>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        <Card title="Import Guidelines">
          <div className="space-y-3 p-4 text-sm text-text-secondary">
            <p>Use outlet code, month, year, structured supplier and channel names.</p>
            <p>Amounts must be numeric. Sales deductions are imported as positive values and subtracted by the system.</p>
            <p>Locked months are protected. Existing data requires explicit merge or replace confirmation.</p>
            <p>Rollback is Owner-only in the real system and available within the configured rollback window.</p>
          </div>
        </Card>

        <Card title="Recent Imports" className="xl:col-span-2">
          <DataTable columns={importColumns} rows={store.importRuns} getRowKey={(row) => row.id} />
        </Card>
      </div>

      {conflict ? (
        <Modal
          title="Existing data found"
          description={`${monthLabel(conflict.month)} ${conflict.year} already has ${importType.toLowerCase()} data.`}
          onClose={() => setConflict(null)}
          footer={
            importType === "Purchases" ? (
              <>
                <button className="btn-secondary" type="button" onClick={() => confirmImport("cancel")}>Cancel import</button>
                <button className="btn-secondary" type="button" onClick={() => confirmImport("replace")}>Replace Existing Month</button>
                <button className="btn-secondary" type="button" onClick={() => confirmImport("merge")}>Merge Into Existing</button>
                <button className="btn-primary" type="button" onClick={() => confirmImport("update_matching")}>Update Matching Suppliers</button>
              </>
            ) : (
              <>
                <button className="btn-secondary" type="button" onClick={() => confirmImport("cancel")}>Cancel import</button>
                <button className="btn-secondary" type="button" onClick={() => confirmImport("merge")}>Merge into existing</button>
                <button className="btn-primary" type="button" onClick={() => confirmImport("replace")}>Replace existing</button>
              </>
            )
          }
        >
          {importType === "Purchases" ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-900">
                Recommended: Update Matching Suppliers Only. Matching key is Outlet + Year + Month + Supplier. Existing suppliers are updated; new suppliers are created. Duplicate suppliers in the file replace the amount, they are not added together.
              </div>
              {purchasePreviewStats ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-3">New records: <strong>{purchasePreviewStats.newRecords}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-3">Updated records: <strong>{purchasePreviewStats.updatedRecords}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-3">Skipped rows: <strong>{purchasePreviewStats.skippedRows}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-3">Duplicate suppliers: <strong>{purchasePreviewStats.duplicateSuppliers}</strong></div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Default is Cancel. Choose Replace only when this file is the source of truth. Merge is recorded in the audit log.
            </div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
