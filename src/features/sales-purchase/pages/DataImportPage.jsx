import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { importService } from "../../../services/importService.js";
import { supplierService } from "../../../services/supplierService.js";
import { monthLabel } from "../utils/analytics.js";

const monthAliases = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const salesFields = ["Ignore", "Outlet", "Month", "Year", "Dine In", "FoodPanda", "GrabFood", "ShopeeFood", "Takeaway"];
const purchaseFields = ["Ignore", "Outlet", "Month", "Year", "Supplier", "Category", "Amount", "Remark"];
const salesImportChannels = ["Dine In", "FoodPanda", "GrabFood", "ShopeeFood", "Takeaway"];

function normalize(value) {
  return String(value ?? "").trim();
}

function canonical(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseMonth(value) {
  const raw = normalize(value);
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) return numeric;
  return monthAliases[raw.toLowerCase()] ?? null;
}

function parseAmount(value) {
  const cleaned = normalize(value).replace(/,/g, "");
  if (cleaned === "") return 0;
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
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

function columnNameToIndex(name) {
  return name.split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function inflateRaw(bytes) {
  if (!("DecompressionStream" in window)) {
    throw new Error("XLSX parsing requires browser DecompressionStream support. Please use CSV in this browser.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipXlsx(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid XLSX file.");
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = {};
  let offset = centralOffset;

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (data) files[name] = decoder.decode(data);
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return files;
}

function xmlText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.replace(/<[^>]+>/g, "") ?? "";
}

async function parseXlsx(file) {
  const files = await unzipXlsx(await file.arrayBuffer());
  const sharedStringsXml = files["xl/sharedStrings.xml"] || "";
  const sharedStrings = [...sharedStringsXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1], "t"));
  const sheetName = Object.keys(files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("No worksheet found in XLSX file.");
  const rows = [...files[sheetName].matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const cells = [];
    [...rowMatch[1].matchAll(/<c[^>]*r="([A-Z]+)\d+"[^>]*(?:t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g)].forEach((cellMatch) => {
      const index = columnNameToIndex(cellMatch[1]);
      const type = cellMatch[2];
      const value = xmlText(cellMatch[3], "v") || xmlText(cellMatch[3], "t");
      cells[index] = type === "s" ? sharedStrings[Number(value)] ?? "" : value;
    });
    return cells;
  });
  const headers = (rows[0] || []).map((header) => normalize(header));
  const dataRows = rows.slice(1).map((cells, index) => headers.reduce((record, header, cellIndex) => ({ ...record, [header]: cells[cellIndex] ?? "" }), { __row: index + 2 }));
  return { headers, rows: dataRows };
}

function autoDetect(headers, importType) {
  const mappings = {};
  headers.forEach((header) => {
    const key = canonical(header);
    if (["branch", "outlet", "outletcode", "code"].includes(key)) mappings[header] = "Outlet";
    else if (key.includes("month")) mappings[header] = "Month";
    else if (key.includes("year")) mappings[header] = "Year";
    else if (key.includes("dine")) mappings[header] = "Dine In";
    else if (key.includes("take")) mappings[header] = "Takeaway";
    else if (key.includes("grab")) mappings[header] = "GrabFood";
    else if (key.includes("foodpanda") || key.includes("panda")) mappings[header] = "FoodPanda";
    else if (key.includes("shopee")) mappings[header] = "ShopeeFood";
    else if (key.includes("supplier")) mappings[header] = "Supplier";
    else if (key.includes("category")) mappings[header] = "Category";
    else if (key.includes("remark") || key.includes("note")) mappings[header] = "Remark";
    else if (key.includes("amount") || key.includes("purchase")) mappings[header] = "Amount";
    else mappings[header] = "Ignore";
  });
  if (importType === "Purchases" && !Object.values(mappings).includes("Amount")) {
    const amountHeader = headers.find((header) => canonical(header).includes("purchase"));
    if (amountHeader) mappings[amountHeader] = "Amount";
  }
  return mappings;
}

function mappedValue(row, mappings, field) {
  const column = Object.entries(mappings).find(([, mapped]) => mapped === field)?.[0];
  return column ? row[column] : "";
}

function findOutlet(outlets, value) {
  const raw = canonical(value);
  return outlets.find((outlet) => canonical(outlet.code) === raw) || outlets.find((outlet) => canonical(outlet.name) === raw);
}

function findByName(items, value) {
  const raw = canonical(value);
  return items.find((item) => canonical(item.name) === raw);
}

function isLocked(store, outletId, month, year) {
  return store.monthlyLocks.some((lock) => lock.outlet_id === outletId && lock.month === month && lock.year === year && lock.is_locked);
}

function affectedRange(records) {
  const periods = records.map((record) => ({ month: record.month, year: record.year })).sort((a, b) => (a.year - b.year) || (a.month - b.month));
  if (!periods.length) return "-";
  const first = periods[0];
  const last = periods.at(-1);
  return first.year === last.year && first.month === last.month
    ? `${monthLabel(first.month)} ${first.year}`
    : `${monthLabel(first.month)} ${first.year} - ${monthLabel(last.month)} ${last.year}`;
}

function buildErrorReport(failures) {
  return ["Row,Status,Detail", ...failures.map((item) => `${item.row},"${item.severity}","${item.message.replace(/"/g, '""')}"`)].join("\n");
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
  const [preview, setPreview] = useState(null);
  const [unknownSuppliers, setUnknownSuppliers] = useState([]);
  const [supplierResolutions, setSupplierResolutions] = useState({});
  const [recentImports, setRecentImports] = useState([]);
  const [isImporting, setIsImporting] = useState(false);

  useEffect(() => {
    importService.listImportBatches()
      .then(setRecentImports)
      .catch((error) => {
        console.error("Unable to load import batches", error);
        setRecentImports([]);
      });
  }, []);

  const fieldOptions = importType === "Sales" ? salesFields : purchaseFields;
  const unresolvedUnknownSuppliers = unknownSuppliers.filter((item) => {
    const resolution = supplierResolutions[item.name];
    if (!resolution) return true;
    if (resolution.action === "map") return !resolution.supplier_id;
    if (resolution.action === "create") return !resolution.category_id;
    return false;
  });

  async function handleFile(file) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "csv"].includes(extension)) {
      ui.notify({ title: "Unsupported file", message: "Please upload .xlsx or .csv only.", tone: "error" });
      return;
    }
    try {
      const result = extension === "csv" ? parseCsv(await file.text()) : await parseXlsx(file);
      const detected = autoDetect(result.headers, importType);
      setFileMeta({ name: file.name, extension });
      setParsed(result);
      setMappings(detected);
      setPreview(null);
      setUnknownSuppliers([]);
      setSupplierResolutions({});
      setStep("mapping");
    } catch (error) {
      console.error("Unable to parse import file", error);
      ui.notify({ title: "Unable to parse file", message: error.message, tone: "error" });
    }
  }

  function buildSalesRecords() {
    const records = [];
    const issues = [];
    const required = ["Outlet", "Month", "Year"];
    required.filter((field) => !Object.values(mappings).includes(field)).forEach((field) => {
      issues.push({ row: "-", severity: "error", message: `Missing required column: ${field}` });
    });

    parsed.rows.forEach((row) => {
      const outlet = findOutlet(store.outlets, mappedValue(row, mappings, "Outlet"));
      const month = parseMonth(mappedValue(row, mappings, "Month"));
      const year = Number(mappedValue(row, mappings, "Year"));
      const rowIssues = [];
      if (!outlet) rowIssues.push("Invalid outlet");
      if (!month) rowIssues.push("Invalid month");
      if (!Number.isInteger(year) || year < 2020) rowIssues.push("Invalid year");
      if (outlet && month && year && isLocked(store, outlet.id, month, year)) rowIssues.push("Locked month protection");

      salesImportChannels.forEach((channelName) => {
        if (!Object.values(mappings).includes(channelName)) return;
        const channel = findByName(store.salesChannels, channelName);
        const amount = parseAmount(mappedValue(row, mappings, channelName));
        if (!channel) rowIssues.push(`Sales channel missing: ${channelName}`);
        if (amount === null) rowIssues.push(`Invalid number in ${channelName}`);
        if (amount !== null && amount < 0) rowIssues.push(`Negative sales value in ${channelName}`);
      });

      if (rowIssues.length) {
        issues.push({ row: row.__row, severity: "error", message: rowIssues.join("; ") });
        return;
      }

      salesImportChannels.forEach((channelName) => {
        if (!Object.values(mappings).includes(channelName)) return;
        const channel = findByName(store.salesChannels, channelName);
        const amount = parseAmount(mappedValue(row, mappings, channelName));
        if (!channel || amount === null) return;
        records.push({
          sourceRow: row.__row,
          outlet_id: outlet.id,
          outletName: outlet.name,
          outletCode: outlet.code,
          year,
          month,
          channel_id: channel.id,
          channel_name: channel.name,
          amount,
          remark: "Imported file",
        });
      });
    });
    return { records, issues };
  }

  function buildPurchaseRecords(createdSupplierMap = {}) {
    const records = [];
    const issues = [];
    const unknowns = new Map();
    const required = ["Outlet", "Month", "Year", "Supplier", "Category", "Amount"];
    required.filter((field) => !Object.values(mappings).includes(field)).forEach((field) => {
      issues.push({ row: "-", severity: "error", message: `Missing required column: ${field}` });
    });

    parsed.rows.forEach((row) => {
      const outlet = findOutlet(store.outlets, mappedValue(row, mappings, "Outlet"));
      const month = parseMonth(mappedValue(row, mappings, "Month"));
      const year = Number(mappedValue(row, mappings, "Year"));
      const supplierName = normalize(mappedValue(row, mappings, "Supplier"));
      const categoryName = normalize(mappedValue(row, mappings, "Category"));
      const amount = parseAmount(mappedValue(row, mappings, "Amount"));
      const supplier = findByName(store.suppliers, supplierName) || createdSupplierMap[supplierName];
      const category = findByName(store.purchaseCategories, categoryName);
      const rowIssues = [];
      const resolution = supplierResolutions[supplierName];

      if (!outlet) rowIssues.push("Invalid outlet");
      if (!month) rowIssues.push("Invalid month");
      if (!Number.isInteger(year) || year < 2020) rowIssues.push("Invalid year");
      if (outlet && month && year && isLocked(store, outlet.id, month, year)) rowIssues.push("Locked month protection");
      if (!supplierName) rowIssues.push("Missing supplier");
      if (!supplier && !resolution) {
        const current = unknowns.get(supplierName) ?? { name: supplierName, rows: [] };
        unknowns.set(supplierName, { ...current, rows: [...current.rows, row.__row] });
      }
      if (resolution?.action === "skip") return;
      if (!supplier && resolution?.action === "map" && !resolution.supplier_id) rowIssues.push("Unresolved supplier mapping");
      if (!supplier && resolution?.action === "create" && !resolution.category_id) rowIssues.push("New supplier category required");
      if (!category) rowIssues.push("Unknown category");
      if (amount === null) rowIssues.push("Invalid number format");
      if (amount !== null && amount < 0) rowIssues.push("Negative purchase value");

      if (rowIssues.length) {
        issues.push({ row: row.__row, severity: "error", message: rowIssues.join("; ") });
        return;
      }

      const finalSupplier = supplier || store.suppliers.find((item) => item.id === resolution?.supplier_id) || createdSupplierMap[supplierName];
      records.push({
        sourceRow: row.__row,
        outlet_id: outlet.id,
        outletName: outlet.name,
        outletCode: outlet.code,
        year,
        month,
        supplier_id: finalSupplier.id,
        supplier_name: finalSupplier.name,
        category_id: category.id,
        category_name: category.name,
        amount,
        remark: mappedValue(row, mappings, "Remark") || "",
      });
    });
    return { records, issues, unknownSuppliers: [...unknowns.values()] };
  }

  function describeConflict(record, existing) {
    if (importType === "Sales") {
      return `Existing sales record found for ${record.outletCode || record.outletName} ${monthLabel(record.month)} ${record.year} - ${record.channel_name}. This row will update the existing value.`;
    }
    return `Existing purchase record found for ${record.outletCode || record.outletName} ${monthLabel(record.month)} ${record.year} - ${record.supplier_name} / ${record.category_name}. This row will update the existing value.`;
  }

  async function validateImport() {
    setPreview(null);
    const base = importType === "Sales" ? buildSalesRecords() : buildPurchaseRecords();
    if (importType === "Purchases" && base.unknownSuppliers?.length) {
      setUnknownSuppliers(base.unknownSuppliers);
      setStep("unknown-suppliers");
      return;
    }
    await buildPreview(base.records, base.issues);
  }

  async function buildPreview(records, issues) {
    try {
      const conflicts = importType === "Sales"
        ? await importService.detectSalesConflicts(records)
        : await importService.detectPurchaseConflicts(records);
      const validationRows = records.map((record) => {
        const key = importType === "Sales"
          ? `${record.outlet_id}|${record.year}|${record.month}|${record.channel_id}`
          : `${record.outlet_id}|${record.year}|${record.month}|${record.supplier_id}|${record.category_id}`;
        const existing = conflicts.get(key);
        return {
          ...record,
          action: existing ? "update" : "create",
          message: existing ? describeConflict(record, existing) : "New record will be created.",
        };
      });
      const warnings = validationRows.filter((row) => row.action === "update").map((row) => ({ row: row.sourceRow, severity: "warning", message: row.message }));
      setPreview({
        records,
        validationRows,
        conflicts,
        failures: issues.filter((item) => item.severity === "error"),
        warnings,
        createCount: validationRows.filter((row) => row.action === "create").length,
        updateCount: validationRows.filter((row) => row.action === "update").length,
        affectedRange: affectedRange(records),
      });
      setStep("preview");
    } catch (error) {
      console.error("Unable to validate import against Supabase", error);
      ui.notify({ title: "Unable to validate import", message: error.message, tone: "error" });
    }
  }

  async function continueFromUnknownSuppliers() {
    if (unresolvedUnknownSuppliers.length) return;
    await buildPreview(buildPurchaseRecords().records, buildPurchaseRecords().issues);
  }

  async function runImport() {
    if (!preview || preview.failures.length) return;
    setIsImporting(true);
    try {
      let createdSupplierMap = {};
      let finalRecords = preview.records;
      let finalConflicts = preview.conflicts;

      if (importType === "Purchases") {
        for (const [name, resolution] of Object.entries(supplierResolutions)) {
          if (resolution.action !== "create") continue;
          const category = store.purchaseCategories.find((item) => item.id === resolution.category_id);
          const supplier = await supplierService.saveSupplier({
            name,
            default_category_id: resolution.category_id,
            category: category?.name || "",
            status: "active",
          });
          createdSupplierMap[name] = supplier;
        }
        const rebuilt = buildPurchaseRecords(createdSupplierMap);
        finalRecords = rebuilt.records;
        finalConflicts = await importService.detectPurchaseConflicts(finalRecords);
        if (Object.keys(createdSupplierMap).length) {
          setStore((current) => ({
            ...current,
            suppliers: [...current.suppliers, ...Object.values(createdSupplierMap)].sort((a, b) => a.name.localeCompare(b.name)),
          }));
        }
      }

      const result = importType === "Sales"
        ? await importService.importSales({
            fileName: fileMeta?.name || "sales-import.csv",
            records: finalRecords.map(({ sourceRow, outletName, outletCode, action, message, ...record }) => record),
            conflicts: finalConflicts,
            failedCount: preview.failures.length,
            warningCount: preview.warnings.length,
          })
        : await importService.importPurchases({
            fileName: fileMeta?.name || "purchase-import.csv",
            records: finalRecords.map(({ sourceRow, outletName, outletCode, action, message, ...record }) => record),
            conflicts: finalConflicts,
            failedCount: preview.failures.length,
            warningCount: preview.warnings.length,
          });

      setStore((current) => {
        const key = importType === "Sales"
          ? (record) => `${record.outlet_id}|${record.year}|${record.month}|${record.channel_id}`
          : (record) => `${record.outlet_id}|${record.year}|${record.month}|${record.supplier_id}|${record.category_id}`;
        const importedKeys = new Set(result.savedRows.map(key));
        const field = importType === "Sales" ? "salesRecords" : "purchaseRecords";
        return {
          ...current,
          [field]: [...current[field].filter((record) => !importedKeys.has(key(record))), ...result.savedRows],
        };
      });
      setRecentImports((current) => [result.batch, ...current]);
      setStep("upload");
      setPreview(null);
      setParsed({ headers: [], rows: [] });
      setSupplierResolutions({});
      setUnknownSuppliers([]);
      ui.notify({ title: "Import saved to Supabase", message: `${result.createdCount} created · ${result.updatedCount} updated.` });
    } catch (error) {
      console.error("Unable to import records", error);
      ui.notify({ title: "Import failed", message: error.message, tone: "error" });
    } finally {
      setIsImporting(false);
    }
  }

  function downloadTemplate() {
    const text = importType === "Sales"
      ? "Outlet,Month,Year,Dine In,FoodPanda,GrabFood,ShopeeFood,Takeaway\nHIPB,Jan,2026,0,0,0,0,0"
      : "Outlet,Month,Year,Supplier,Category,Amount,Remark\nHIPB,Jan,2026,ABC Supplier,Beverage,0,";
    downloadTextFile(`${importType}_Import_Template.csv`, text);
  }

  const previewColumns = [
    { key: "sourceRow", header: "Row", align: "right" },
    { key: "period", header: "Period", render: (row) => `${row.outletCode || row.outletName} · ${monthLabel(row.month)} ${row.year}` },
    { key: "record", header: "Record", render: (row) => importType === "Sales" ? row.channel_name : `${row.supplier_name} / ${row.category_name}` },
    { key: "amount", header: "Amount", align: "right", render: (row) => `RM ${Number(row.amount || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` },
    { key: "action", header: "Action", render: (row) => <Badge tone={row.action === "update" ? "warning" : "success"}>{row.action}</Badge> },
    { key: "message", header: "Validation", render: (row) => <span className="text-xs text-text-secondary">{row.message}</span> },
  ];
  const batchColumns = [
    { key: "source_filename", header: "File" },
    { key: "import_type", header: "Type", render: (row) => <Badge tone="info">{row.import_type}</Badge> },
    { key: "total_rows", header: "Rows", align: "right" },
    { key: "created_count", header: "Created", align: "right" },
    { key: "updated_count", header: "Updated", align: "right" },
    { key: "failed_count", header: "Failed", align: "right" },
    { key: "created_at", header: "Imported At", render: (row) => row.created_at ? new Date(row.created_at).toLocaleString("en-MY") : "-" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Data Import"
        description="Upload, validate, preview and upsert sales or purchase data into Supabase."
        actions={<button className="btn-secondary" type="button" onClick={downloadTemplate}><Download size={16} /> Download Template</button>}
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Card title="Import Engine" description="No silent overwrite. Existing records are detected by unique business key and updated only after preview.">
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {["Sales", "Purchases"].map((type) => (
                <button key={type} className={`h-9 rounded-xl px-4 text-sm font-semibold ${importType === type ? "bg-primary text-white" : "bg-white text-text-secondary ring-1 ring-border hover:bg-slate-50"}`} type="button" onClick={() => setImportType(type)}>{type}</button>
              ))}
              <Badge tone="info">Step: {step}</Badge>
            </div>

            {step === "upload" ? (
              <button type="button" onClick={() => inputRef.current?.click()} className="w-full rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-8 text-center transition hover:bg-primary/10">
                <Upload className="mx-auto text-primary" size={28} />
                <div className="mt-3 text-sm font-bold">Upload CSV or XLSX</div>
                <div className="mt-1 text-sm text-text-secondary">CSV is fully supported. XLSX is parsed in-browser when the browser supports ZIP decompression.</div>
                <input ref={inputRef} hidden type="file" accept=".xlsx,.csv" onChange={(event) => handleFile(event.target.files?.[0])} />
              </button>
            ) : null}

            {step === "mapping" ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-text-secondary">{fileMeta?.name} · {parsed.rows.length} source rows</div>
                <div className="overflow-x-auto rounded-2xl border border-border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="table-head">
                      <tr><th className="px-3 py-2 text-left">File Column</th><th className="px-3 py-2 text-left">System Field</th><th className="px-3 py-2 text-left">Sample</th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {parsed.headers.map((header) => (
                        <tr key={header}>
                          <td className="px-3 py-2 font-semibold">{header}</td>
                          <td className="px-3 py-2">
                            <SelectField className="w-56" buttonClassName="h-9" value={mappings[header] || "Ignore"} options={fieldOptions.map((field) => ({ value: field, label: field }))} onChange={(nextValue) => setMappings((current) => ({ ...current, [header]: nextValue }))} />
                          </td>
                          <td className="px-3 py-2 text-text-secondary">{parsed.rows[0]?.[header] || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => setStep("upload")}>Cancel</button>
                  <button className="btn-primary" type="button" onClick={validateImport}>Validate Against Supabase</button>
                </div>
              </div>
            ) : null}

            {step === "unknown-suppliers" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-bold">Unknown Supplier Review Required</div>
                  <p className="mt-1 text-xs">Map to an existing supplier, create a new active supplier, or skip the row before continuing.</p>
                </div>
                {unknownSuppliers.map((item) => {
                  const resolution = supplierResolutions[item.name] || { action: "map", supplier_id: "", category_id: "" };
                  return (
                    <div key={item.name} className="rounded-2xl border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-text-primary">{item.name || "Unknown Supplier"}</div>
                          <div className="mt-1 text-xs text-text-secondary">Rows: {item.rows.join(", ")}</div>
                        </div>
                        <SelectField className="w-48" value={resolution.action} options={[{ value: "map", label: "Map existing" }, { value: "create", label: "Create supplier" }, { value: "skip", label: "Skip row" }]} onChange={(action) => setSupplierResolutions((current) => ({ ...current, [item.name]: { action, supplier_id: "", category_id: "" } }))} />
                      </div>
                      {resolution.action === "map" ? (
                        <SelectField className="mt-3 w-full" searchable placeholder="Select supplier" value={resolution.supplier_id} options={store.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} onChange={(supplier_id) => setSupplierResolutions((current) => ({ ...current, [item.name]: { ...resolution, supplier_id } }))} />
                      ) : null}
                      {resolution.action === "create" ? (
                        <SelectField className="mt-3 w-full" searchable placeholder="Required category for new supplier" value={resolution.category_id} options={store.purchaseCategories.map((category) => ({ value: category.id, label: category.name }))} onChange={(category_id) => setSupplierResolutions((current) => ({ ...current, [item.name]: { ...resolution, category_id } }))} />
                      ) : null}
                    </div>
                  );
                })}
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => setStep("mapping")}>Back</button>
                  <button className="btn-primary" type="button" disabled={unresolvedUnknownSuppliers.length > 0} onClick={continueFromUnknownSuppliers}>Continue to Preview</button>
                </div>
              </div>
            ) : null}

            {step === "preview" && preview ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-5">
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Source Rows</div><div className="text-xl font-bold">{parsed.rows.length}</div></div>
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Create</div><div className="text-xl font-bold text-emerald-700">{preview.createCount}</div></div>
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Update</div><div className="text-xl font-bold text-amber-700">{preview.updateCount}</div></div>
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Failed</div><div className="text-xl font-bold text-rose-700">{preview.failures.length}</div></div>
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Affected Range</div><div className="text-sm font-bold">{preview.affectedRange}</div></div>
                </div>
                {preview.warnings.length ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="flex items-center gap-2 font-bold"><AlertTriangle size={15} /> Records that will update existing Supabase rows</div>
                    <ul className="mt-2 space-y-1 text-xs">{preview.warnings.slice(0, 6).map((item) => <li key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>)}</ul>
                  </div>
                ) : null}
                {preview.failures.length ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                    <div className="font-bold">Failed Rows</div>
                    <ul className="mt-2 space-y-1 text-xs">{preview.failures.slice(0, 8).map((item) => <li key={`${item.row}-${item.message}`}>Row {item.row}: {item.message}</li>)}</ul>
                    <button className="btn-secondary mt-3 h-8 text-xs" type="button" onClick={() => downloadTextFile("Import_Error_Report.csv", buildErrorReport(preview.failures))}>Download error report</button>
                  </div>
                ) : null}
                <DataTable columns={previewColumns} rows={preview.validationRows.slice(0, 100)} getRowKey={(row) => `${row.sourceRow}-${row.record}-${row.action}`} />
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => setStep("upload")}>Cancel</button>
                  <button className="btn-primary" type="button" disabled={isImporting || preview.failures.length > 0} onClick={runImport}>
                    {isImporting ? "Importing..." : <><CheckCircle2 size={16} /> Continue Import</>}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        <Card title="Import Rules">
          <div className="space-y-3 p-4 text-sm text-text-secondary">
            <p>Sales key: outlet + year + month + channel.</p>
            <p>Purchase key: outlet + year + month + supplier + category.</p>
            <p>Existing records are updated. New records are inserted. Failed rows block import.</p>
            <p>Outlet matching uses outlet code first, then outlet name.</p>
          </div>
        </Card>

        <Card title="Recent Supabase Imports" className="xl:col-span-2">
          <DataTable columns={batchColumns} rows={recentImports} getRowKey={(row) => row.id} />
        </Card>
      </div>
    </div>
  );
}
