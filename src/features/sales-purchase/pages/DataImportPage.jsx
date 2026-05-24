import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Upload } from "lucide-react";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { importService } from "../../../services/importService.js";
import { purchaseCategoryService } from "../../../services/purchaseCategoryService.js";
import { supplierService } from "../../../services/supplierService.js";
import { monthLabel } from "../utils/analytics.js";
import { canCreate, canImport, notifyPermissionDenied } from "../../../utils/accessControl.js";

const monthAliases = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

const salesFields = ["Ignore", "Outlet", "Month", "Year", "Dine In", "FoodPanda", "GrabFood", "ShopeeFood", "Takeaway"];
const purchaseFields = ["Ignore", "Outlet", "Month", "Year", "Supplier", "Category", "Amount", "Remark"];
const salesImportChannels = ["Dine In", "FoodPanda", "GrabFood", "ShopeeFood", "Takeaway"];
const highAmountThreshold = 1_000_000;

function normalize(value) {
  return String(value ?? "").trim();
}

function canonical(value) {
  return normalize(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function canonicalSingular(value) {
  const key = canonical(value);
  return key.endsWith("s") ? key.slice(0, -1) : key;
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
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
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

function findCategoryByName(items, value) {
  const raw = canonical(value);
  const singular = canonicalSingular(value);
  return items.find((item) => canonical(item.name) === raw)
    || items.find((item) => canonicalSingular(item.name) === singular);
}

function pendingCategoryId(name) {
  return `__new_category__:${name}`;
}

function pendingCategoryName(id) {
  return String(id ?? "").startsWith("__new_category__:") ? String(id).replace("__new_category__:", "") : "";
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

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildImportReport(preview) {
  const rows = [
    ["Row", "Status", "Action", "Record", "Amount", "Detail"],
    ...preview.validationRows.map((row) => [
      row.sourceRow,
      "valid",
      row.action,
      row.channel_name || `${row.supplier_name} / ${row.category_name}`,
      row.amount,
      row.message,
    ]),
    ...(preview.skippedRows ?? []).map((row) => [row.row, "skipped", "skip", "", "", row.message]),
    ...preview.warnings.map((row) => [row.row, "warning", "", "", "", row.message]),
    ...preview.failures.map((row) => [row.row, "failed", "failed", "", "", row.message]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function importRecordKey(importType, record) {
  return importType === "Sales"
    ? `${record.outlet_id}|${record.year}|${record.month}|${record.channel_id}`
    : `${record.outlet_id}|${record.year}|${record.month}|${record.supplier_id}|${record.category_id}`;
}

function collapseDuplicateRows(importType, records) {
  const byKey = new Map();
  const warnings = [];
  records.forEach((record) => {
    const key = importRecordKey(importType, record);
    const existing = byKey.get(key);
    if (existing) {
      warnings.push({
        row: record.sourceRow,
        severity: "warning",
        message: `Duplicate import key. Row ${record.sourceRow} will replace row ${existing.sourceRow} in this import preview.`,
      });
    }
    byKey.set(key, record);
  });
  return { records: [...byKey.values()], duplicateWarnings: warnings };
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

function withTimeout(promise, label, timeoutMs = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s. Please try again or check your connection.`)), timeoutMs);
    }),
  ]);
}

export default function DataImportPage({ store, setStore, ui, auth }) {
  const inputRef = useRef(null);
  const [importType, setImportType] = useState("Sales");
  const [step, setStep] = useState("upload");
  const [fileMeta, setFileMeta] = useState(null);
  const [parsed, setParsed] = useState({ headers: [], rows: [] });
  const [mappings, setMappings] = useState({});
  const [preview, setPreview] = useState(null);
  const [unknownSuppliers, setUnknownSuppliers] = useState([]);
  const [supplierResolutions, setSupplierResolutions] = useState({});
  const [unknownCategories, setUnknownCategories] = useState([]);
  const [categoryResolutions, setCategoryResolutions] = useState({});
  const [recentImports, setRecentImports] = useState([]);
  const [isImporting, setIsImporting] = useState(false);
  const [validationState, setValidationState] = useState({ loading: false, message: "", error: "" });
  const [importSummary, setImportSummary] = useState(null);
  const [confirmImport, setConfirmImport] = useState(false);
  const canRunImport = canImport(auth, "data_import");
  const canCreateImportSupplier = canCreate(auth, "suppliers");
  const canCreateImportCategory = canCreate(auth, "purchase_categories");

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
    if (resolution.action === "link") return !item.existingSupplierId || !(item.outletIds ?? []).length;
    return false;
  });
  const unresolvedUnknownCategories = unknownCategories.filter((item) => {
    const resolution = categoryResolutions[item.name];
    if (!resolution) return true;
    if (resolution.action === "map") return !resolution.category_id;
    return false;
  });
  const pendingCategoryOptions = useMemo(() => Object.entries(categoryResolutions)
    .filter(([, resolution]) => resolution.action === "create")
    .map(([name]) => ({ id: pendingCategoryId(name), name, isPending: true })), [categoryResolutions]);
  const supplierCategoryOptions = useMemo(() => [
    ...store.purchaseCategories.map((category) => ({ value: category.id, label: category.name })),
    ...pendingCategoryOptions.map((category) => ({ value: category.id, label: `${category.name} (new)` })),
  ], [pendingCategoryOptions, store.purchaseCategories]);

  async function handleFile(file) {
    if (!canRunImport) {
      notifyPermissionDenied(ui, "import data");
      return;
    }
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "csv"].includes(extension)) {
      ui.notify({ title: "Unsupported file", message: "Please upload .xlsx or .csv only.", tone: "error" });
      return;
    }
    try {
      const result = extension === "csv" ? parseCsv(await file.text()) : await parseXlsx(file);
      if (!result.headers.length) {
        throw new Error("Malformed header row. The file must include column headers.");
      }
      if (result.headers.some((header) => !header)) {
        throw new Error("Malformed header row. Empty column names are not supported.");
      }
      const normalizedHeaders = result.headers.map(canonical);
      if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
        throw new Error("Malformed header row. Duplicate column names are not supported.");
      }
      if (!result.rows.length) {
        throw new Error("Empty file detected. Add at least one data row before importing.");
      }
      const detected = autoDetect(result.headers, importType);
      console.info("[Import:file] parsed", { file: file.name, importType, headers: result.headers, rows: result.rows.length, detected });
      setFileMeta({ name: file.name, extension });
      setParsed(result);
      setMappings(detected);
      setPreview(null);
      setUnknownSuppliers([]);
      setSupplierResolutions({});
      setUnknownCategories([]);
      setCategoryResolutions({});
      setValidationState({ loading: false, message: "", error: "" });
      setImportSummary(null);
      setConfirmImport(false);
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
        if (amount !== null && amount > highAmountThreshold) {
          issues.push({ row: row.__row, severity: "warning", message: `${channelName} amount is unusually high. Review before importing.` });
        }
      });

      if (rowIssues.length) {
        issues.push({ row: row.__row, severity: "error", message: rowIssues.join("; "), rawSupplier: supplierName, rawCategory: categoryName, rawRow: row });
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
          rawRow: row,
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

  function buildPurchaseRecords(createdSupplierMap = {}, createdCategoryMap = {}, options = {}) {
    const records = [];
    const issues = [];
    const unknowns = new Map();
    const categoryUnknowns = new Map();
    const skippedRows = [];
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
      const categoryResolution = categoryResolutions[categoryName];
      const category = findCategoryByName(store.purchaseCategories, categoryName)
        || store.purchaseCategories.find((item) => item.id === categoryResolution?.category_id)
        || createdCategoryMap[categoryName]
        || (options.allowPendingCategoryCreate && categoryResolution?.action === "create"
          ? { id: pendingCategoryId(categoryName), name: categoryName }
          : null);
      const rowIssues = [];
      const resolution = supplierResolutions[supplierName];
      console.info("[Import:category-resolution]", {
        row: row.__row,
        rawCategory: categoryName,
        normalizedCategory: canonicalSingular(categoryName),
        matchedCategoryId: category?.id ?? null,
        resolution: categoryResolution?.action ?? null,
      });

      if (!outlet) rowIssues.push("Invalid outlet");
      if (!month) rowIssues.push("Invalid month");
      if (!Number.isInteger(year) || year < 2020) rowIssues.push("Invalid year");
      if (outlet && month && year && isLocked(store, outlet.id, month, year)) rowIssues.push("Locked month protection");
      if (!supplierName) rowIssues.push("Missing supplier");
      if (categoryResolution?.action === "skip") {
        skippedRows.push({ row: row.__row, severity: "skipped", message: `Skipped unknown category: ${categoryName}`, rawRow: row });
        return;
      }
      if (!supplier && !resolution) {
        const current = unknowns.get(supplierName) ?? { name: supplierName, rows: [] };
        const categoryIds = [...new Set([...(current.categoryIds ?? []), category?.id].filter(Boolean))];
        const categoryNames = [...new Set([...(current.categoryNames ?? []), category?.name].filter(Boolean))];
        const outletIds = [...new Set([...(current.outletIds ?? []), outlet?.id].filter(Boolean))];
        unknowns.set(supplierName, {
          ...current,
          rows: [...current.rows, row.__row],
          categoryIds,
          categoryNames,
          outletIds,
          default_category_id: categoryIds[0] ?? "",
        });
      }
      if (supplier && outlet && !(supplier.outletIds ?? supplier.assignedOutletIds ?? []).includes(outlet.id) && !resolution) {
        const current = unknowns.get(supplierName) ?? { name: supplierName, rows: [] };
        unknowns.set(supplierName, {
          ...current,
          existingSupplierId: supplier.id,
          rows: [...current.rows, row.__row],
          outletIds: [...new Set([...(current.outletIds ?? []), outlet.id])],
          categoryNames: [...new Set([...(current.categoryNames ?? []), category?.name].filter(Boolean))],
          default_category_id: supplier.default_category_id || category?.id || "",
        });
      }
      if (!categoryName) rowIssues.push("Missing category");
      if (categoryName && !category && !categoryResolution) {
        const current = categoryUnknowns.get(categoryName) ?? { name: categoryName, rows: [] };
        categoryUnknowns.set(categoryName, { ...current, rows: [...current.rows, row.__row] });
      }
      if (resolution?.action === "skip") {
        skippedRows.push({ row: row.__row, severity: "skipped", message: `Skipped unknown supplier: ${supplierName}`, rawRow: row });
        return;
      }
      if (!supplier && resolution?.action === "map" && !resolution.supplier_id) rowIssues.push("Unresolved supplier mapping");
      if (!supplier && resolution?.action === "create" && !resolution.category_id) rowIssues.push("New supplier category required");
      if (!category && categoryResolution?.action === "map" && !categoryResolution.category_id) rowIssues.push(`Unresolved category mapping for "${categoryName}"`);
      if (!category && categoryName) rowIssues.push(`Unknown category "${categoryName}"`);
      if (amount === null) rowIssues.push("Invalid number format");
      if (amount !== null && amount < 0) rowIssues.push("Negative purchase value");
      if (amount !== null && amount > highAmountThreshold) {
        issues.push({ row: row.__row, severity: "warning", message: "Purchase amount is unusually high. Review before importing." });
      }

      if (rowIssues.length) {
        issues.push({ row: row.__row, severity: "error", message: rowIssues.join("; ") });
        return;
      }

      const finalSupplier = supplier || store.suppliers.find((item) => item.id === resolution?.supplier_id) || createdSupplierMap[supplierName] || (
        options.allowPendingCreate && resolution?.action === "create"
          ? { id: `__new__:${supplierName}`, name: supplierName }
          : null
      );
      if (!finalSupplier) {
        issues.push({ row: row.__row, severity: "error", message: "Supplier resolution failed", rawSupplier: supplierName, rawCategory: categoryName, rawRow: row });
        return;
      }
      const linkResolutionAllowed = resolution?.action === "link" && resolution.existingSupplierId === finalSupplier.id;
      if (!(finalSupplier.outletIds ?? finalSupplier.assignedOutletIds ?? []).includes(outlet.id) && !String(finalSupplier.id).startsWith("__new__:") && !linkResolutionAllowed) {
        issues.push({
          row: row.__row,
          severity: "error",
          message: `Supplier "${finalSupplier.name}" is not assigned to ${outlet.name}. Link this supplier to the outlet or map to another supplier.`,
          rawSupplier: supplierName,
          rawCategory: categoryName,
          rawRow: row,
        });
        return;
      }
      records.push({
        sourceRow: row.__row,
        outlet_id: outlet.id,
        outletName: outlet.name,
        outletCode: outlet.code,
        rawRow: row,
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
    return { records, issues, skippedRows, unknownSuppliers: [...unknowns.values()], unknownCategories: [...categoryUnknowns.values()] };
  }

  function describeConflict(record, existing) {
    if (importType === "Sales") {
      return `Existing sales record found for ${record.outletCode || record.outletName} ${monthLabel(record.month)} ${record.year} - ${record.channel_name}. This row will update the existing value.`;
    }
    return `Existing purchase record found for ${record.outletCode || record.outletName} ${monthLabel(record.month)} ${record.year} - ${record.supplier_name} / ${record.category_name}. This row will update the existing value.`;
  }

  async function validateImport() {
    if (!canRunImport) {
      notifyPermissionDenied(ui, "import data");
      return;
    }
    console.info("[Import:validate] clicked", { importType, rows: parsed.rows.length, mappings });
    setPreview(null);
    setValidationState({ loading: true, message: "Validating file rows...", error: "" });
    try {
      const base = importType === "Sales" ? buildSalesRecords() : buildPurchaseRecords({}, {}, { allowPendingCreate: false, allowPendingCategoryCreate: false });
      console.info("[Import:validate] built records", {
        records: base.records.length,
        issues: base.issues.length,
        unknownCategories: base.unknownCategories?.length ?? 0,
        unknownSuppliers: base.unknownSuppliers?.length ?? 0,
      });
      if (importType === "Purchases" && base.unknownCategories?.length) {
        setValidationState({ loading: false, message: "", error: "" });
        setUnknownCategories(base.unknownCategories);
        setStep("unknown-categories");
        console.info("[Import:validate] moved to unknown category review", base.unknownCategories);
        return;
      }
      if (importType === "Purchases" && base.unknownSuppliers?.length) {
        setValidationState({ loading: false, message: "", error: "" });
        setUnknownSuppliers(base.unknownSuppliers);
        setStep("unknown-suppliers");
        console.info("[Import:validate] moved to unknown supplier review", base.unknownSuppliers);
        return;
      }
      await withTimeout(buildPreview(base.records, base.issues, base.skippedRows ?? []), "Import validation");
    } catch (error) {
      console.error("[Import:validate] failed", error);
      setValidationState({ loading: false, message: "", error: error.message });
      ui.notify({ title: "Unable to validate import", message: error.message, tone: "error" });
    }
  }

  async function buildPreview(records, issues, skippedRows = []) {
    try {
      const deduped = collapseDuplicateRows(importType, records);
      records = deduped.records;
      setValidationState({ loading: true, message: "Checking existing records...", error: "" });
      console.info("[Import:preview] conflict detection start", { importType, records: records.length, issues: issues.length, skippedRows: skippedRows.length, duplicateWarnings: deduped.duplicateWarnings.length });
      const conflicts = importType === "Sales"
        ? await importService.detectSalesConflicts(records)
        : await importService.detectPurchaseConflicts(records);
      console.info("[Import:preview] conflicts detected", { count: conflicts.size });
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
      const warnings = [
        ...issues.filter((item) => item.severity === "warning"),
        ...deduped.duplicateWarnings,
        ...validationRows.filter((row) => row.action === "update").map((row) => ({ row: row.sourceRow, severity: "warning", message: row.message })),
      ];
      setPreview({
        records,
        validationRows,
        conflicts,
        failures: issues.filter((item) => item.severity === "error"),
        warnings,
        skippedRows,
        createCount: validationRows.filter((row) => row.action === "create").length,
        updateCount: validationRows.filter((row) => row.action === "update").length,
        affectedRange: affectedRange(records),
      });
      console.info("[Import:preview] generated", {
        create: validationRows.filter((row) => row.action === "create").length,
        update: validationRows.filter((row) => row.action === "update").length,
        failed: issues.filter((item) => item.severity === "error").length,
        warnings: warnings.length,
      });
      setValidationState({ loading: false, message: "", error: "" });
      setStep("preview");
    } catch (error) {
      console.error("[Import:preview] failed", error);
      setValidationState({ loading: false, message: "", error: error.message });
      ui.notify({ title: "Unable to validate import", message: error.message, tone: "error" });
      throw error;
    }
  }

  async function continueFromUnknownSuppliers() {
    console.info("[Import:unknownSuppliers] continue", { unresolved: unresolvedUnknownSuppliers.length, resolutions: supplierResolutions });
    if (unresolvedUnknownSuppliers.length) {
      ui.notify({ title: "Resolve unknown suppliers first", message: `${unresolvedUnknownSuppliers.length} supplier resolutions are incomplete.`, tone: "error" });
      return;
    }
    setValidationState({ loading: true, message: "Resolving suppliers and generating preview...", error: "" });
    try {
      for (const item of unknownSuppliers) {
        const resolution = supplierResolutions[item.name];
        if (resolution?.action !== "link") continue;
        const supplierId = item.existingSupplierId || resolution.existingSupplierId;
        const supplier = store.suppliers.find((entry) => entry.id === supplierId);
        if (!supplier) throw new Error(`Supplier "${item.name}" could not be linked.`);
        await supplierService.saveSupplierOutlets(supplierId, [...new Set([...(supplier.outletIds ?? []), ...(item.outletIds ?? [])])]);
        setStore((current) => ({
          ...current,
          suppliers: current.suppliers.map((entry) => (
            entry.id === supplierId
              ? { ...entry, outletIds: [...new Set([...(entry.outletIds ?? []), ...(item.outletIds ?? [])])], assignedOutletIds: [...new Set([...(entry.assignedOutletIds ?? entry.outletIds ?? []), ...(item.outletIds ?? [])])] }
              : entry
          )),
        }));
      }
      const rebuilt = buildPurchaseRecords({}, {}, { allowPendingCreate: true, allowPendingCategoryCreate: true });
      console.info("[Import:unknownSuppliers] rebuilt records", { records: rebuilt.records.length, issues: rebuilt.issues.length, skippedRows: rebuilt.skippedRows.length });
      await withTimeout(buildPreview(rebuilt.records, rebuilt.issues, rebuilt.skippedRows), "Supplier resolution preview");
    } catch (error) {
      console.error("[Import:unknownSuppliers] failed", error);
      setValidationState({ loading: false, message: "", error: error.message });
      ui.notify({ title: "Unable to generate preview", message: error.message, tone: "error" });
    }
  }

  async function continueFromUnknownCategories() {
    console.info("[Import:unknownCategories] continue", { unresolved: unresolvedUnknownCategories.length, resolutions: categoryResolutions });
    if (unresolvedUnknownCategories.length) {
      ui.notify({ title: "Resolve unknown categories first", message: `${unresolvedUnknownCategories.length} category resolutions are incomplete.`, tone: "error" });
      return;
    }
    setValidationState({ loading: true, message: "Resolving categories and checking suppliers...", error: "" });
    try {
      const rebuilt = buildPurchaseRecords({}, {}, { allowPendingCreate: false, allowPendingCategoryCreate: true });
      console.info("[Import:unknownCategories] rebuilt records", {
        records: rebuilt.records.length,
        issues: rebuilt.issues.length,
        unknownSuppliers: rebuilt.unknownSuppliers?.length ?? 0,
        skippedRows: rebuilt.skippedRows.length,
      });
      if (rebuilt.unknownSuppliers?.length) {
        setValidationState({ loading: false, message: "", error: "" });
        setUnknownSuppliers(rebuilt.unknownSuppliers);
        setSupplierResolutions((current) => {
          const next = { ...current };
          rebuilt.unknownSuppliers.forEach((supplier) => {
            if (!next[supplier.name]) {
              next[supplier.name] = { action: "create", supplier_id: "", category_id: supplier.default_category_id || "" };
            }
          });
          return next;
        });
        setStep("unknown-suppliers");
        return;
      }
      await withTimeout(buildPreview(rebuilt.records, rebuilt.issues, rebuilt.skippedRows), "Category resolution preview");
    } catch (error) {
      console.error("[Import:unknownCategories] failed", error);
      setValidationState({ loading: false, message: "", error: error.message });
      ui.notify({ title: "Unable to resolve categories", message: error.message, tone: "error" });
    }
  }

  async function runImport() {
    if (!canRunImport) {
      notifyPermissionDenied(ui, "import data");
      return;
    }
    if (!preview || preview.failures.length) return;
    setIsImporting(true);
    try {
      let createdCategoryMap = {};
      let createdSupplierMap = {};
      let finalRecords = preview.records;
      let finalConflicts = preview.conflicts;

      if (importType === "Purchases") {
        for (const [name, resolution] of Object.entries(categoryResolutions)) {
          if (resolution.action !== "create") continue;
          if (!canCreateImportCategory) {
            throw new Error("You do not have permission to create purchase categories during import.");
          }
          const category = await purchaseCategoryService.savePurchaseCategory({
            name,
            status: "active",
          });
          createdCategoryMap[name] = category;
        }
        for (const [name, resolution] of Object.entries(supplierResolutions)) {
          if (resolution.action !== "create") continue;
          if (!canCreateImportSupplier) {
            throw new Error("You do not have permission to create suppliers during import.");
          }
          const pendingName = pendingCategoryName(resolution.category_id);
          const category = store.purchaseCategories.find((item) => item.id === resolution.category_id)
            || createdCategoryMap[pendingName];
          if (!category?.id) {
            throw new Error(`Default category is missing for new supplier "${name}".`);
          }
          const supplier = await supplierService.saveSupplier({
            name,
            default_category_id: category.id,
            category: category?.name || "",
            outletIds: resolution.outletIds || unknownSuppliers.find((item) => item.name === name)?.outletIds || [],
            status: "active",
          });
          createdSupplierMap[name] = supplier;
        }
        const rebuilt = buildPurchaseRecords(createdSupplierMap, createdCategoryMap);
        finalRecords = rebuilt.records;
        finalConflicts = await importService.detectPurchaseConflicts(finalRecords);
        if (Object.keys(createdSupplierMap).length || Object.keys(createdCategoryMap).length) {
          setStore((current) => ({
            ...current,
            purchaseCategories: [...current.purchaseCategories, ...Object.values(createdCategoryMap)].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)),
            suppliers: [...current.suppliers, ...Object.values(createdSupplierMap)].sort((a, b) => a.name.localeCompare(b.name)),
          }));
        }
      }

      const result = importType === "Sales"
        ? await importService.importSales({
            fileName: fileMeta?.name || "sales-import.csv",
            records: finalRecords,
            conflicts: finalConflicts,
            failedRows: preview.failures,
            skippedRows: preview.skippedRows ?? [],
            warningCount: preview.warnings.length,
          })
        : await importService.importPurchases({
            fileName: fileMeta?.name || "purchase-import.csv",
            records: finalRecords,
            conflicts: finalConflicts,
            failedRows: preview.failures,
            skippedRows: preview.skippedRows ?? [],
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
      setImportSummary({
        created: result.createdCount,
        updated: result.updatedCount,
        skipped: preview.skippedRows?.length ?? 0,
        failed: preview.failures.length,
        migrationWarning: result.batch?.migration_warning ?? "",
        report: buildImportReport(preview),
      });
      setConfirmImport(false);
      setStep("upload");
      setPreview(null);
      setParsed({ headers: [], rows: [] });
      setSupplierResolutions({});
      setUnknownSuppliers([]);
      setCategoryResolutions({});
      setUnknownCategories([]);
      ui.notify({ title: "Import completed", message: `${result.createdCount} created · ${result.updatedCount} updated.` });
    } catch (error) {
      console.error("Unable to import records", error);
      ui.notify({ title: "Import failed", message: error.message, tone: "error" });
    } finally {
      setConfirmImport(false);
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
    { key: "period", header: "Period", render: (row) => row.isFailure ? "-" : `${row.outletCode || row.outletName} · ${monthLabel(row.month)} ${row.year}` },
    { key: "record", header: "Record", render: (row) => row.isFailure ? row.record : importType === "Sales" ? row.channel_name : `${row.supplier_name} / ${row.category_name}` },
    { key: "amount", header: "Amount", align: "right", render: (row) => row.isFailure ? "-" : `RM ${Number(row.amount || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}` },
    { key: "action", header: "Action", render: (row) => <Badge tone={row.isFailure ? "danger" : row.action === "update" ? "warning" : "success"}>{row.action}</Badge> },
    { key: "message", header: "Validation", render: (row) => <span className="text-xs text-text-secondary">{row.message}</span> },
  ];
  const batchColumns = [
    { key: "source_filename", header: "File" },
    { key: "import_type", header: "Type", render: (row) => <Badge tone="info">{row.import_type}</Badge> },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "failed" ? "danger" : row.status === "partial_failed" ? "warning" : row.status === "completed" ? "success" : "info"}>{row.status || "completed"}</Badge> },
    { key: "total_rows", header: "Rows", align: "right" },
    { key: "created_count", header: "Created", align: "right" },
    { key: "updated_count", header: "Updated", align: "right" },
    { key: "failed_count", header: "Failed", align: "right" },
    { key: "created_at", header: "Imported At", render: (row) => row.created_at ? new Date(row.created_at).toLocaleString("en-MY") : "-" },
  ];
  const previewTableRows = useMemo(() => {
    if (!preview) return [];
    const failedRows = preview.failures.map((item) => ({
      sourceRow: item.row,
      record: importType === "Purchases"
        ? `${item.rawSupplier || "Unknown Supplier"} / ${item.rawCategory || "Unknown Category"}`
        : "Invalid row",
      action: "action required",
      message: item.message,
      isFailure: true,
    }));
    return [...preview.validationRows, ...failedRows];
  }, [importType, preview]);

  return (
    <div className="space-y-4">
      <PageHeader
        section="Operations"
        title="Data Import"
        description="Upload, validate, preview and import sales or purchase data."
        actions={<button className="btn-secondary" type="button" onClick={downloadTemplate}><Download size={16} /> Download Template</button>}
      />
      {!canRunImport ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          Read-only access. You need Data Import permission to validate and import files.
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <Card title="Import Engine" description="No silent overwrite. Existing records are detected as duplicates and updated only after preview.">
          <div className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {["Sales", "Purchases"].map((type) => (
                <button key={type} className={`h-9 rounded-xl px-4 text-sm font-semibold ${importType === type ? "bg-primary text-white" : "bg-white text-text-secondary ring-1 ring-border hover:bg-slate-50"}`} type="button" onClick={() => setImportType(type)}>{type}</button>
              ))}
              <Badge tone="info">Step: {step}</Badge>
            </div>

            {step === "upload" ? (
              <button type="button" disabled={!canRunImport} onClick={() => canRunImport ? inputRef.current?.click() : notifyPermissionDenied(ui, "import data")} className="w-full rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-8 text-center transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60">
                <Upload className="mx-auto text-primary" size={28} />
                <div className="mt-3 text-sm font-bold">Upload CSV or XLSX</div>
                <div className="mt-1 text-sm text-text-secondary">CSV is fully supported. XLSX is parsed in-browser when the browser supports ZIP decompression.</div>
                <input ref={inputRef} hidden type="file" accept=".xlsx,.csv" onChange={(event) => handleFile(event.target.files?.[0])} />
              </button>
            ) : null}

            {step === "mapping" ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm font-semibold text-text-secondary">{fileMeta?.name} · {parsed.rows.length} source rows</div>
                {importType === "Purchases" ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-xs font-semibold text-blue-800">
                    Column mapped. Values still need to match existing categories and suppliers.
                  </div>
                ) : null}
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
                {validationState.error ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                    {validationState.error}
                  </div>
                ) : null}
                {validationState.loading ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
                    {validationState.message || "Validating..."}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => setStep("upload")}>Cancel</button>
                  <button className="btn-primary" type="button" disabled={validationState.loading || !canRunImport} onClick={validateImport}>
                    {validationState.loading ? "Validating..." : "Validate Data"}
                  </button>
                </div>
              </div>
            ) : null}

            {step === "unknown-categories" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-bold">Unknown Category Review Required</div>
                  <p className="mt-1 text-xs">The Category column is mapped, but these category values do not match purchase category master data. Map them, create new categories, or skip affected rows.</p>
                </div>
                {unknownCategories.map((item) => {
                  const resolution = categoryResolutions[item.name] || { action: "map", category_id: "" };
                  return (
                    <div key={item.name} className="rounded-2xl border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-text-primary">{item.name || "Unknown Category"}</div>
                          <div className="mt-1 text-xs text-text-secondary">Rows: {item.rows.join(", ")}</div>
                        </div>
                        <SelectField
                          className="w-48"
                          value={resolution.action}
                          options={[{ value: "map", label: "Map existing" }, ...(canCreateImportCategory ? [{ value: "create", label: "Create category" }] : []), { value: "skip", label: "Skip rows" }]}
                          onChange={(action) => setCategoryResolutions((current) => ({ ...current, [item.name]: { action, category_id: "" } }))}
                        />
                      </div>
                      {resolution.action === "map" ? (
                        <SelectField
                          className="mt-3 w-full"
                          searchable
                          placeholder="Select category"
                          value={resolution.category_id}
                          options={store.purchaseCategories.map((category) => ({ value: category.id, label: category.name }))}
                          onChange={(category_id) => setCategoryResolutions((current) => ({ ...current, [item.name]: { ...resolution, category_id } }))}
                        />
                      ) : null}
                      {resolution.action === "create" ? (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                          New active category “{item.name}” will be created only when you confirm the import.
                        </div>
                      ) : null}
                      {resolution.action === "skip" ? (
                        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-text-secondary">
                          Rows {item.rows.join(", ")} will be excluded from this import.
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {validationState.error ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                    {validationState.error}
                  </div>
                ) : null}
                {validationState.loading ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
                    {validationState.message || "Resolving categories..."}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => setStep("mapping")}>Back</button>
                  <button className="btn-primary" type="button" disabled={validationState.loading || unresolvedUnknownCategories.length > 0} onClick={continueFromUnknownCategories}>
                    {validationState.loading ? "Checking..." : "Continue"}
                  </button>
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
                  const hasMultipleCategories = (item.categoryIds?.length ?? 0) > 1;
                  const resolution = supplierResolutions[item.name] || {
                    action: item.existingSupplierId ? "link" : "create",
                    supplier_id: "",
                    existingSupplierId: item.existingSupplierId || "",
                    category_id: item.default_category_id || "",
                  };
                  return (
                    <div key={item.name} className="rounded-2xl border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-bold text-text-primary">{item.name || "Unknown Supplier"}</div>
                          <div className="mt-1 text-xs text-text-secondary">Rows: {item.rows.join(", ")}</div>
                          {item.categoryNames?.length ? (
                            <div className="mt-1 text-xs text-text-secondary">Imported categories: {item.categoryNames.join(", ")}</div>
                          ) : null}
                        </div>
                        <SelectField
                          className="w-56"
                          value={resolution.action}
                          options={[
                            ...(item.existingSupplierId ? [{ value: "link", label: "Link supplier to outlet" }] : []),
                            { value: "map", label: "Map existing" },
                            ...(canCreateImportSupplier ? [{ value: "create", label: "Create supplier" }] : []),
                            { value: "skip", label: "Skip row" },
                          ]}
                          onChange={(action) => setSupplierResolutions((current) => ({ ...current, [item.name]: { action, supplier_id: "", existingSupplierId: item.existingSupplierId || "", category_id: item.default_category_id || "" } }))}
                        />
                      </div>
                      {resolution.action === "link" ? (
                        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                          This will assign the existing supplier to the outlet used by the import row.
                        </div>
                      ) : null}
                      {hasMultipleCategories && resolution.action === "create" ? (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                          Supplier appears under multiple categories. Choose the main supplier category. Purchase rows will still use their imported category.
                        </div>
                      ) : null}
                      {resolution.action === "map" ? (
                        <SelectField className="mt-3 w-full" searchable placeholder="Select supplier" value={resolution.supplier_id} options={store.suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name }))} onChange={(supplier_id) => setSupplierResolutions((current) => ({ ...current, [item.name]: { ...resolution, supplier_id } }))} />
                      ) : null}
                      {resolution.action === "create" ? (
                        <div className="mt-3 space-y-2">
                          <SelectField className="w-full" searchable placeholder="Default category for new supplier" value={resolution.category_id} options={supplierCategoryOptions} onChange={(category_id) => setSupplierResolutions((current) => ({ ...current, [item.name]: { ...resolution, category_id } }))} />
                          <p className="text-xs font-medium text-text-secondary">This sets the supplier’s default category. Purchase rows will still use their imported category.</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {validationState.error ? (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                    {validationState.error}
                  </div>
                ) : null}
                {validationState.loading ? (
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm font-semibold text-blue-800">
                    {validationState.message || "Resolving suppliers..."}
                  </div>
                ) : null}
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => setStep("mapping")}>Back</button>
                  <button className="btn-primary" type="button" disabled={validationState.loading || unresolvedUnknownSuppliers.length > 0} onClick={continueFromUnknownSuppliers}>
                    {validationState.loading ? "Generating preview..." : "Continue to Preview"}
                  </button>
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
                  <div className="rounded-xl border border-border p-3"><div className="text-xs text-text-secondary">Warnings</div><div className="text-xl font-bold text-blue-700">{preview.warnings.length}</div></div>
                </div>
                <div className="rounded-xl border border-border bg-slate-50 px-3 py-2 text-xs font-semibold text-text-secondary">
                  Affected range: {preview.affectedRange} · Skipped rows: {preview.skippedRows?.length ?? 0}
                </div>
                {!preview.validationRows.length ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="font-bold">No valid rows to import</div>
                    <p className="mt-1 text-xs">Fix failed rows, resolve suppliers, or check column mappings before continuing.</p>
                  </div>
                ) : null}
                {preview.warnings.length ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <div className="flex items-center gap-2 font-bold"><AlertTriangle size={15} /> Records that will update existing data</div>
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
                <DataTable columns={previewColumns} rows={previewTableRows.slice(0, 100)} getRowKey={(row) => `${row.sourceRow}-${row.channel_id || row.supplier_id || row.record}-${row.category_id || ""}-${row.action}`} />
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary" type="button" onClick={() => downloadTextFile(`${importType}_Import_Report.csv`, buildImportReport(preview))}>
                    <Download size={15} /> Download report
                  </button>
                  <button className="btn-secondary" type="button" onClick={() => setStep("upload")}>Cancel</button>
                  <button className="btn-primary" type="button" disabled={isImporting || preview.failures.length > 0 || !preview.validationRows.length || !canRunImport} onClick={() => setConfirmImport(true)}>
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

        <Card title="Recent Imports" className="xl:col-span-2">
          <DataTable columns={batchColumns} rows={recentImports} getRowKey={(row) => row.id} />
        </Card>
      </div>

      {confirmImport && preview ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-border bg-surface p-5 shadow-2xl">
            <div className="text-lg font-bold text-text-primary">
              Confirm import
            </div>
            <p className="mt-2 text-sm text-text-secondary">
              You are about to update {preview.updateCount} existing rows and create {preview.createCount} new rows.
            </p>
            {preview.updateCount > 0 ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="font-bold">Existing records will be overwritten</div>
                <p className="mt-1 text-xs">Matching rows use the imported value as the source of truth. This cannot be undone from this screen; use the import report and audit log for review.</p>
              </div>
            ) : null}
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-2xl border border-border p-3"><div className="text-xs text-text-secondary">Create</div><div className="text-xl font-bold text-emerald-700">{preview.createCount}</div></div>
              <div className="rounded-2xl border border-border p-3"><div className="text-xs text-text-secondary">Update</div><div className="text-xl font-bold text-amber-700">{preview.updateCount}</div></div>
              <div className="rounded-2xl border border-border p-3"><div className="text-xs text-text-secondary">Skipped</div><div className="text-xl font-bold text-text-secondary">{preview.skippedRows?.length ?? 0}</div></div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" type="button" disabled={isImporting} onClick={() => setConfirmImport(false)}>Cancel</button>
              <button className="btn-primary" type="button" disabled={isImporting} onClick={runImport}>
                {isImporting ? "Importing..." : "Confirm Import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importSummary ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 px-4">
          <div className="w-full max-w-md rounded-3xl border border-border bg-surface p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-lg font-bold text-text-primary">
              <CheckCircle2 className="text-emerald-600" size={20} /> Import complete
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl border border-border p-3"><div className="text-xs text-text-secondary">Created</div><div className="text-xl font-bold text-emerald-700">{importSummary.created}</div></div>
              <div className="rounded-2xl border border-border p-3"><div className="text-xs text-text-secondary">Updated</div><div className="text-xl font-bold text-amber-700">{importSummary.updated}</div></div>
              <div className="rounded-2xl border border-border p-3"><div className="text-xs text-text-secondary">Skipped</div><div className="text-xl font-bold text-text-secondary">{importSummary.skipped}</div></div>
              <div className="rounded-2xl border border-border p-3"><div className="text-xs text-text-secondary">Failed</div><div className="text-xl font-bold text-rose-700">{importSummary.failed}</div></div>
            </div>
            {importSummary.migrationWarning ? (
              <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
                Import history is not fully available yet. The import itself has completed.
              </div>
            ) : null}
            <div className="mt-4 flex justify-end">
              {importSummary.report ? (
                <button className="btn-secondary mr-2" type="button" onClick={() => downloadTextFile(`${importType}_Import_Report.csv`, importSummary.report)}>
                  <Download size={15} /> Download report
                </button>
              ) : null}
              <button className="btn-primary" type="button" onClick={() => setImportSummary(null)}>Done</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
