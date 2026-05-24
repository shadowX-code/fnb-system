import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, BarChart3, Clock, Download, FileSpreadsheet, History, PieChart, Sparkles, Upload } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel, MonthSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import TrendChart from "../../../components/charts/TrendChart.jsx";
import { months } from "../data/mockData.js";
import { monthLabel, percentageChange, toCurrency, toPercent } from "../utils/analytics.js";
import { canExport, canManage, hasPermission, notifyPermissionDenied } from "../../../utils/accessControl.js";
import { productAnalyticsService } from "../../../services/productAnalyticsService.js";

const requiredColumns = [
  "Category",
  "Product Name",
  "Variant",
  "Quantity",
  "Gross Sales",
  "Discount",
  "SST",
  "Service Charge",
  "Nett Sales",
];

function canonical(value) {
  return String(value ?? "").trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function parseAmount(value) {
  const cleaned = String(value ?? "").replace(/rm/gi, "").replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function parseCsv(text) {
  const rows = [];
  let cell = "";
  let row = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((item) => String(item).trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((item) => String(item).trim())) rows.push(row);
  const headers = (rows.shift() ?? []).map((header) => String(header).trim());
  return rows.map((values, index) => Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]))).map((item, index) => ({ ...item, __row: index + 2 }));
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
    throw new Error("XLSX parsing is not supported by this browser. Please export the report as CSV.");
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

function textFromNode(node, sharedStrings) {
  const type = node.getAttribute("t");
  if (type === "s") {
    const index = Number(node.querySelector("v")?.textContent ?? -1);
    return sharedStrings[index] ?? "";
  }
  if (type === "inlineStr") return [...node.querySelectorAll("t")].map((item) => item.textContent ?? "").join("");
  return node.querySelector("v")?.textContent ?? "";
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
  const rows = [...sheet.querySelectorAll("sheetData row")].map((rowNode) => {
    const values = [];
    [...rowNode.querySelectorAll("c")].forEach((cell) => {
      values[columnIndex(cell.getAttribute("r"))] = textFromNode(cell, sharedStrings);
    });
    return values;
  }).filter((row) => row.some((cell) => String(cell ?? "").trim()));
  const headers = (rows.shift() ?? []).map((header) => String(header ?? "").trim());
  return rows.map((values, index) => Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex] ?? ""]))).map((item, index) => ({ ...item, __row: index + 2 }));
}

function mapParsedRows(rows) {
  const headerMap = Object.fromEntries(Object.keys(rows[0] ?? {}).map((header) => [canonical(header), header]));
  const missing = requiredColumns.filter((column) => !headerMap[canonical(column)]);
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);
  return rows.map((row) => {
    const read = (column) => row[headerMap[canonical(column)]];
    const quantity = parseAmount(read("Quantity"));
    const grossSales = parseAmount(read("Gross Sales"));
    const discount = parseAmount(read("Discount"));
    const sst = parseAmount(read("SST"));
    const serviceCharge = parseAmount(read("Service Charge"));
    const nettSales = parseAmount(read("Nett Sales"));
    if ([quantity, grossSales, discount, sst, serviceCharge, nettSales].some((value) => value === null)) {
      throw new Error(`Row ${row.__row}: invalid number found.`);
    }
    const productName = String(read("Product Name") ?? "").trim();
    if (!productName) throw new Error(`Row ${row.__row}: product name is required.`);
    return {
      category_name: String(read("Category") ?? "Uncategorized").trim() || "Uncategorized",
      product_name: productName,
      variant_name: String(read("Variant") ?? "").trim(),
      quantity,
      gross_sales: grossSales,
      discount,
      sst,
      service_charge: serviceCharge,
      nett_sales: nettSales,
      source_row: row.__row,
    };
  });
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function productKey(item) {
  return `${item.product_name}${item.variant_name ? ` · ${item.variant_name}` : ""}`;
}

function aggregateItems(items) {
  const byProduct = new Map();
  const byCategory = new Map();
  items.forEach((item) => {
    const key = productKey(item);
    const product = byProduct.get(key) ?? {
      key,
      product: item.product_name,
      variant: item.variant_name,
      category: item.category_name,
      quantity: 0,
      nett_sales: 0,
      discount: 0,
      last_sold: item.created_at,
    };
    product.quantity += item.quantity;
    product.nett_sales += item.nett_sales;
    product.discount += item.discount;
    product.last_sold = item.created_at || product.last_sold;
    byProduct.set(key, product);

    const category = byCategory.get(item.category_name) ?? { name: item.category_name, quantity: 0, nett_sales: 0 };
    category.quantity += item.quantity;
    category.nett_sales += item.nett_sales;
    byCategory.set(item.category_name, category);
  });
  const products = [...byProduct.values()];
  const categories = [...byCategory.values()].sort((a, b) => b.nett_sales - a.nett_sales);
  const totals = products.reduce((sum, item) => ({
    quantity: sum.quantity + item.quantity,
    nett_sales: sum.nett_sales + item.nett_sales,
    discount: sum.discount + item.discount,
  }), { quantity: 0, nett_sales: 0, discount: 0 });
  return { products, categories, totals };
}

function KpiCard({ title, value, helper, icon: Icon }) {
  return (
    <div className="card min-h-[116px] p-4 transition hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-bold uppercase tracking-wide text-text-secondary">{title}</div>
        {Icon ? <span className="grid h-8 w-8 place-items-center rounded-xl bg-primary/10 text-primary"><Icon size={16} /></span> : null}
      </div>
      <div className="mt-3 text-2xl font-bold text-text-primary">{value}</div>
      <div className="mt-1 text-xs font-medium text-text-muted">{helper}</div>
    </div>
  );
}

function CategoryDonut({ categories, total }) {
  const colors = ["#10B981", "#3B82F6", "#F59E0B", "#F43F5E", "#8B5CF6", "#14B8A6"];
  let cursor = 0;
  const gradient = categories.length
    ? categories.map((category, index) => {
      const start = cursor;
      const share = total ? (category.nett_sales / total) * 100 : 0;
      cursor += share;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    }).join(", ")
    : "#E5E7EB 0% 100%";
  return (
    <div className="grid gap-4 p-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="mx-auto grid h-48 w-48 place-items-center rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="grid h-28 w-28 place-items-center rounded-full bg-white text-center shadow-sm">
          <div>
            <div className="text-xs font-bold text-text-muted">Net Sales</div>
            <div className="text-lg font-bold text-text-primary">{toCurrency(total)}</div>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        {categories.slice(0, 6).map((category, index) => (
          <div key={category.name} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-slate-50 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
              <span className="truncate text-sm font-semibold text-text-primary">{category.name}</span>
            </div>
            <div className="text-right text-xs font-bold text-text-secondary">
              <div>{toPercent(total ? (category.nett_sales / total) * 100 : 0)}</div>
              <div>{toCurrency(category.nett_sales)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerformanceMatrix({ products }) {
  const maxQty = Math.max(...products.map((item) => item.quantity), 1);
  const maxSales = Math.max(...products.map((item) => item.nett_sales), 1);
  const avgQty = products.reduce((sum, item) => sum + item.quantity, 0) / (products.length || 1);
  const avgSales = products.reduce((sum, item) => sum + item.nett_sales, 0) / (products.length || 1);
  return (
    <div className="p-4">
      <div className="relative h-80 rounded-2xl border border-border bg-gradient-to-br from-slate-50 to-white">
        <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
        <div className="absolute left-0 top-1/2 h-px w-full bg-border" />
        <div className="absolute left-4 top-4 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">Puzzle</div>
        <div className="absolute right-4 top-4 rounded-full bg-primary/10 px-2 py-1 text-[11px] font-bold text-primary">Star</div>
        <div className="absolute bottom-4 left-4 rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-500">Dog</div>
        <div className="absolute bottom-4 right-4 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">Plowhorse</div>
        {products.slice(0, 60).map((product) => {
          const x = Math.max(6, Math.min(94, (product.quantity / maxQty) * 90 + 5));
          const y = Math.max(6, Math.min(94, 100 - ((product.nett_sales / maxSales) * 90 + 5)));
          const highQty = product.quantity >= avgQty;
          const highSales = product.nett_sales >= avgSales;
          const color = highQty && highSales ? "bg-primary" : highSales ? "bg-blue-500" : highQty ? "bg-amber-500" : "bg-slate-400";
          return <span key={product.key} title={`${product.key}: ${toCurrency(product.nett_sales)} · ${product.quantity} qty`} className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${color} shadow-sm`} style={{ left: `${x}%`, top: `${y}%` }} />;
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] font-bold uppercase text-text-muted">
        <span>Quantity Sold</span>
        <span>Net Sales</span>
      </div>
    </div>
  );
}

export default function ProductAnalyticsPage({ store, ui, auth }) {
  const inputRef = useRef(null);
  const activeOutlets = useMemo(() => store.outlets.filter((outlet) => outlet.status === "active"), [store.outlets]);
  const [outletId, setOutletId] = useState("all");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [compareMode, setCompareMode] = useState("previous");
  const [reports, setReports] = useState([]);
  const [items, setItems] = useState([]);
  const [yearItems, setYearItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadModal, setUploadModal] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rankBy, setRankBy] = useState("sales");
  const [lowFilter, setLowFilter] = useState(5);
  const [uploadForm, setUploadForm] = useState({ outletId: "", month: new Date().getMonth() + 1, year: new Date().getFullYear(), file: null, parsedItems: [] });
  const canUpload = hasPermission(auth, "product_analytics.upload");
  const canExportReport = canExport(auth, "product_analytics");
  const canManageReports = canManage(auth, "product_analytics");
  const outletIds = useMemo(() => (outletId === "all" ? activeOutlets.map((outlet) => outlet.id) : [outletId].filter(Boolean)), [activeOutlets, outletId]);
  const previous = useMemo(() => (month === 1 ? { month: 12, year: year - 1 } : { month: month - 1, year }), [month, year]);
  const comparePeriod = useMemo(() => (compareMode === "previous" ? previous : null), [compareMode, previous]);

  useEffect(() => {
    if (!activeOutlets.length) return undefined;
    let cancelled = false;
    setLoading(true);
    productAnalyticsService.listReports({ outletIds: activeOutlets.map((outlet) => outlet.id) })
      .then((nextReports) => {
        if (!cancelled) setReports(nextReports);
      })
      .catch((error) => {
        console.error("Unable to load product reports", error);
        ui.notify({ title: "Unable to load product analytics", message: error.message, tone: "error" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOutlets, ui]);

  const currentReports = useMemo(() => reports.filter((report) => outletIds.includes(report.outlet_id) && report.report_month === month && report.report_year === year), [month, outletIds, reports, year]);
  const compareReports = useMemo(() => comparePeriod ? reports.filter((report) => outletIds.includes(report.outlet_id) && report.report_month === comparePeriod.month && report.report_year === comparePeriod.year) : [], [comparePeriod, outletIds, reports]);
  const yearReports = useMemo(() => reports.filter((report) => outletIds.includes(report.outlet_id) && report.report_year === year), [outletIds, reports, year]);

  useEffect(() => {
    let cancelled = false;
    const reportIds = [...new Set([...currentReports, ...compareReports].map((report) => report.id))];
    productAnalyticsService.listItemsByReportIds(reportIds)
      .then((nextItems) => {
        if (!cancelled) setItems(nextItems);
      })
      .catch((error) => {
        console.error("Unable to load product sales items", error);
      });
    return () => {
      cancelled = true;
    };
  }, [currentReports, compareReports]);

  useEffect(() => {
    let cancelled = false;
    productAnalyticsService.listItemsByReportIds(yearReports.map((report) => report.id))
      .then((nextItems) => {
        if (!cancelled) setYearItems(nextItems);
      })
      .catch((error) => console.error("Unable to load product trend items", error));
    return () => {
      cancelled = true;
    };
  }, [yearReports]);

  const currentReportIds = new Set(currentReports.map((report) => report.id));
  const compareReportIds = new Set(compareReports.map((report) => report.id));
  const currentItems = items.filter((item) => currentReportIds.has(item.report_id));
  const compareItems = items.filter((item) => compareReportIds.has(item.report_id));
  const current = aggregateItems(currentItems);
  const comparison = aggregateItems(compareItems);
  const topProducts = [...current.products].sort((a, b) => rankBy === "sales" ? b.nett_sales - a.nett_sales : b.quantity - a.quantity).slice(0, 10);
  const best = [...current.products].sort((a, b) => b.quantity - a.quantity)[0];
  const lowest = [...current.products].filter((item) => item.quantity > 0).sort((a, b) => a.nett_sales - b.nett_sales)[0];
  const topCategory = current.categories[0];
  const lowPerformers = current.products.filter((item) => item.quantity < Number(lowFilter)).sort((a, b) => a.quantity - b.quantity || a.nett_sales - b.nett_sales).slice(0, 12);
  const avgSpend = current.totals.quantity ? current.totals.nett_sales / current.totals.quantity : 0;
  const salesChange = percentageChange(current.totals.nett_sales, comparison.totals.nett_sales);
  const qtyChange = percentageChange(current.totals.quantity, comparison.totals.quantity);
  const trendProducts = topProducts.slice(0, 5).map((product) => product.key);
  const trendData = months.map((item) => {
    const periodReports = yearReports.filter((report) => report.report_month === item.value);
    const periodReportIds = new Set(periodReports.map((report) => report.id));
    const periodItems = yearItems.filter((row) => periodReportIds.has(row.report_id));
    const row = { label: item.label };
    trendProducts.forEach((product) => {
      row[product] = periodItems.filter((sale) => productKey(sale) === product).reduce((sum, sale) => sum + sale.nett_sales, 0);
    });
    return row;
  });
  const insights = [
    best ? { tone: "success", title: `${best.product} is the best seller.`, body: `${best.quantity} items sold with ${toCurrency(best.nett_sales)} net sales.` } : null,
    topCategory ? { tone: "info", title: `${topCategory.name} leads category contribution.`, body: `${toPercent(current.totals.nett_sales ? (topCategory.nett_sales / current.totals.nett_sales) * 100 : 0)} of net sales.` } : null,
    comparePeriod && current.totals.nett_sales ? { tone: salesChange >= 0 ? "success" : "warning", title: `Net sales ${salesChange >= 0 ? "increased" : "decreased"} ${toPercent(Math.abs(salesChange))}.`, body: `Compared with ${monthLabel(comparePeriod.month)} ${comparePeriod.year}. Quantity changed ${toPercent(qtyChange)}.` } : null,
    current.totals.discount > current.totals.nett_sales * 0.12 ? { tone: "warning", title: "Discount level is elevated.", body: `${toCurrency(current.totals.discount)} discount given this period.` } : null,
    lowPerformers.length ? { tone: "danger", title: `${lowPerformers.length} low-performing menu items detected.`, body: `Review items below ${lowFilter} quantity sold this month.` } : null,
  ].filter(Boolean);

  async function handleFile(file) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    try {
      if (!["csv", "xlsx"].includes(extension)) throw new Error("Please upload a CSV or XLSX file.");
      const rows = extension === "xlsx" ? await parseXlsx(file) : parseCsv(await file.text());
      if (!rows.length) throw new Error("The report has no product rows.");
      setUploadForm((currentForm) => ({ ...currentForm, file, parsedItems: mapParsedRows(rows) }));
    } catch (error) {
      console.error("Unable to parse product report", error);
      ui.notify({ title: "Unable to parse report", message: error.message, tone: "error" });
    }
  }

  async function submitUpload() {
    if (!canUpload) return notifyPermissionDenied(ui, "upload product reports");
    if (!uploadForm.outletId || !uploadForm.month || !uploadForm.year || !uploadForm.file) {
      ui.notify({ title: "Missing upload details", message: "Select outlet, month, year and report file.", tone: "error" });
      return;
    }
    if (!uploadForm.parsedItems.length) {
      ui.notify({ title: "No report rows", message: "Upload a valid report file first.", tone: "error" });
      return;
    }
    try {
      const existing = await productAnalyticsService.findReport(uploadForm.outletId, uploadForm.month, uploadForm.year);
      if (existing) {
        const confirmed = await ui.confirm({
          title: "Replace existing report?",
          message: `${monthLabel(uploadForm.month)} ${uploadForm.year} already has a product sales report for this outlet.`,
          confirmLabel: "Replace Report",
          danger: true,
        });
        if (!confirmed) return;
      }
      const report = await productAnalyticsService.replaceReport({
        outletId: uploadForm.outletId,
        month: Number(uploadForm.month),
        year: Number(uploadForm.year),
        fileName: uploadForm.file.name,
        items: uploadForm.parsedItems,
        existingReportId: existing?.id ?? null,
        metadata: { source_columns: requiredColumns, row_count: uploadForm.parsedItems.length },
      });
      const nextReports = await productAnalyticsService.listReports({ outletIds: activeOutlets.map((outlet) => outlet.id) });
      setReports(nextReports);
      setOutletId(report.outlet_id);
      setMonth(report.report_month);
      setYear(report.report_year);
      setUploadModal(false);
      setUploadForm({ outletId: "", month: new Date().getMonth() + 1, year: new Date().getFullYear(), file: null, parsedItems: [] });
      ui.notify({ title: "Product report uploaded", message: "Product analytics updated." });
    } catch (error) {
      console.error("Unable to upload product report", error);
      ui.notify({ title: "Unable to upload report", message: error.message, tone: "error" });
    }
  }

  function exportCurrent() {
    if (!canExportReport) return notifyPermissionDenied(ui, "export product analytics");
    downloadCsv(`product-analytics-${monthLabel(month)}-${year}.csv`, [
      ["Product", "Variant", "Category", "Quantity", "Net Sales", "Contribution"],
      ...topProducts.map((product) => [product.product, product.variant, product.category, product.quantity, product.nett_sales, current.totals.nett_sales ? product.nett_sales / current.totals.nett_sales : 0]),
    ]);
  }

  async function deleteReport(report) {
    if (!canManageReports) return notifyPermissionDenied(ui, "manage product report history");
    if (!(await ui.confirm({ title: "Delete product report?", message: `${report.file_name} will be removed from analytics.`, danger: true, confirmLabel: "Delete" }))) return;
    try {
      await productAnalyticsService.deleteReport(report);
      setReports((currentReports) => currentReports.filter((item) => item.id !== report.id));
      ui.notify({ title: "Product report deleted" });
    } catch (error) {
      console.error("Unable to delete product report", error);
      ui.notify({ title: "Unable to delete report", message: error.message, tone: "error" });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        section="Overview"
        title="Product Sales Analytics"
        description="Upload POS product sales reports to generate insights and grow your business."
        actions={
          <div className="flex flex-wrap gap-2">
            <button className="btn-secondary" type="button" onClick={() => setHistoryOpen(true)}><History size={16} /> Upload History</button>
            {canExportReport ? <button className="btn-secondary" type="button" onClick={exportCurrent}><Download size={16} /> Export</button> : null}
            {canUpload ? <button className="btn-primary" type="button" onClick={() => setUploadModal(true)}><Upload size={16} /> Upload Report</button> : <Badge tone="neutral">Read-only access</Badge>}
          </div>
        }
      />
      <FilterBar compact>
        <SelectField
          label="Outlet"
          value={outletId}
          searchable
          options={[{ value: "all", label: "All Outlets" }, ...activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]}
          onChange={setOutletId}
        />
        <MonthSelector value={month} onChange={setMonth} />
        <YearSelector value={year} onChange={setYear} />
        <SelectField
          label="Compare With"
          value={compareMode}
          options={[
            { value: "previous", label: `Previous Month (${monthLabel(previous.month)} ${previous.year})` },
            { value: "none", label: "No Comparison" },
          ]}
          onChange={setCompareMode}
        />
      </FilterBar>

      {!loading && !currentItems.length ? (
        <div className="card border-dashed p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><FileSpreadsheet size={22} /></div>
          <h2 className="mt-3 text-lg font-bold text-text-primary">Upload a POS product sales report to generate product analytics.</h2>
          <p className="mt-1 text-sm text-text-secondary">Choose an outlet, month and CSV report to unlock product performance insights.</p>
          {canUpload ? <button className="btn-primary mx-auto mt-4" type="button" onClick={() => setUploadModal(true)}><Upload size={16} /> Upload Report</button> : null}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Total Net Sales" value={toCurrency(current.totals.nett_sales)} helper={comparePeriod ? `${salesChange >= 0 ? "+" : ""}${toPercent(salesChange)} vs compare month` : "Current period"} icon={BarChart3} />
        <KpiCard title="Total Quantity Sold" value={current.totals.quantity.toLocaleString()} helper={comparePeriod ? `${qtyChange >= 0 ? "+" : ""}${toPercent(qtyChange)} quantity movement` : "Items sold"} icon={ArrowUpDown} />
        <KpiCard title="Average Spend / Item" value={toCurrency(avgSpend)} helper="Net sales divided by quantity" icon={PieChart} />
        <KpiCard title="Best Selling Product" value={best?.product ?? "—"} helper={best ? `${best.quantity} sold` : "No product data"} icon={Sparkles} />
        <KpiCard title="Lowest Performer" value={lowest?.product ?? "—"} helper={lowest ? `${lowest.quantity} sold · ${toCurrency(lowest.nett_sales)}` : "No product data"} icon={Clock} />
        <KpiCard title="Discount Given" value={toCurrency(current.totals.discount)} helper="Total discount in report" icon={Download} />
        <KpiCard title="Top Category" value={topCategory?.name ?? "—"} helper={topCategory ? toCurrency(topCategory.nett_sales) : "No category data"} icon={PieChart} />
        <KpiCard title="Menu Items Sold" value={current.products.length.toLocaleString()} helper="Unique product and variant rows" icon={FileSpreadsheet} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <Card
          title="Top 10 Best Selling Products"
          description="Ranked by product sales performance."
          action={<SelectField value={rankBy} options={[{ value: "sales", label: "By Net Sales" }, { value: "quantity", label: "By Quantity" }]} onChange={setRankBy} className="w-40" />}
        >
          <DataTable
            density="compact"
            columns={[
              { key: "rank", header: "Rank", render: (_, index) => `#${index + 1}` },
              { key: "product", header: "Product", render: (row) => <div><div className="font-bold text-text-primary">{row.product}</div><div className="text-xs text-text-muted">{row.variant || "Default"}</div></div> },
              { key: "category", header: "Category" },
              { key: "quantity", header: "Qty", align: "right", render: (row) => row.quantity.toLocaleString() },
              { key: "nett_sales", header: "Net Sales", align: "right", render: (row) => toCurrency(row.nett_sales) },
              { key: "contribution", header: "% Contribution", align: "right", render: (row) => toPercent(current.totals.nett_sales ? (row.nett_sales / current.totals.nett_sales) * 100 : 0) },
            ]}
            rows={topProducts}
            getRowKey={(row) => row.key}
          />
        </Card>
        <Card title="Category Contribution" description="Net sales contribution by category.">
          <CategoryDonut categories={current.categories} total={current.totals.nett_sales} />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Product Performance Matrix" description="Quantity sold against net sales performance.">
          <PerformanceMatrix products={current.products} />
        </Card>
        <Card title="AI-style Insights" description="Rule-based product performance highlights.">
          <div className="space-y-3 p-4">
            {insights.length ? insights.map((insight) => (
              <div key={insight.title} className="rounded-2xl border border-border bg-slate-50 p-3 transition hover:border-primary/20 hover:bg-primary/5">
                <Badge tone={insight.tone}>{insight.tone === "danger" ? "Warning" : "Insight"}</Badge>
                <div className="mt-2 text-sm font-bold text-text-primary">{insight.title}</div>
                <div className="mt-1 text-xs text-text-secondary">{insight.body}</div>
              </div>
            )) : <div className="p-4 text-sm text-text-secondary">Upload product data to generate insights.</div>}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card
          title="Dead Menu / Low Performers"
          description="Menu items that may need review."
          action={<SelectField value={lowFilter} options={[{ value: 5, label: "Qty < 5" }, { value: 10, label: "Qty < 10" }]} onChange={(value) => setLowFilter(Number(value))} className="w-32" />}
        >
          <DataTable
            density="compact"
            columns={[
              { key: "product", header: "Product", render: (row) => <span className="font-semibold">{row.product}</span> },
              { key: "category", header: "Category" },
              { key: "quantity", header: "Qty", align: "right" },
              { key: "nett_sales", header: "Net Sales", align: "right", render: (row) => toCurrency(row.nett_sales) },
              { key: "last_sold", header: "Last Sold", render: () => `${monthLabel(month)} ${year}` },
            ]}
            rows={lowPerformers}
            getRowKey={(row) => row.key}
          />
        </Card>
        <Card title="Monthly Trend" description="Top product net sales trend across uploaded months.">
          <div className="p-4">
            <TrendChart
              labels={trendData.map((row) => row.label)}
              series={trendProducts.map((product, index) => ({
                name: product,
                data: trendData.map((row) => row[product] ?? 0),
                stroke: ["#10B981", "#3B82F6", "#F59E0B", "#F43F5E", "#8B5CF6"][index],
                area: index === 0,
                format: toCurrency,
              }))}
              tickFormat={toCurrency}
            />
          </div>
        </Card>
      </div>

      {uploadModal ? (
        <Modal
          title="Upload Product Sales Report"
          description="Upload monthly POS product sales report in CSV format."
          size="lg"
          onClose={() => setUploadModal(false)}
          footer={<><button className="btn-secondary" type="button" onClick={() => setUploadModal(false)}>Cancel</button><button className="btn-primary" type="button" onClick={submitUpload}>Upload Report</button></>}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField label="Outlet" value={uploadForm.outletId} searchable options={activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={(value) => setUploadForm((currentForm) => ({ ...currentForm, outletId: value }))} required />
            <MonthSelector value={uploadForm.month} onChange={(value) => setUploadForm((currentForm) => ({ ...currentForm, month: value }))} />
            <YearSelector value={uploadForm.year} onChange={(value) => setUploadForm((currentForm) => ({ ...currentForm, year: value }))} />
          </div>
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-slate-50 p-5 text-center">
            <input ref={inputRef} hidden type="file" accept=".csv,.xlsx" onChange={(event) => handleFile(event.target.files?.[0])} />
            <button className="btn-secondary mx-auto" type="button" onClick={() => inputRef.current?.click()}><FileSpreadsheet size={16} /> Select Report File</button>
            <div className="mt-3 text-sm font-semibold text-text-primary">{uploadForm.file?.name ?? "No file selected"}</div>
            <div className="mt-1 text-xs text-text-secondary">{uploadForm.parsedItems.length ? `${uploadForm.parsedItems.length} product rows ready to import.` : "Required columns: Category, Product Name, Variant, Quantity, Gross Sales, Discount, SST, Service Charge, Nett Sales."}</div>
          </div>
        </Modal>
      ) : null}

      {historyOpen ? (
        <Modal title="Upload History" description="Monthly POS product reports uploaded for accessible outlets." size="xl" onClose={() => setHistoryOpen(false)} footer={<button className="btn-primary" type="button" onClick={() => setHistoryOpen(false)}>Done</button>}>
          <DataTable
            columns={[
              { key: "outlet", header: "Outlet", render: (row) => activeOutlets.find((outlet) => outlet.id === row.outlet_id)?.name ?? "Unknown Outlet" },
              { key: "month", header: "Month", render: (row) => `${monthLabel(row.report_month)} ${row.report_year}` },
              { key: "file_name", header: "File Name" },
              { key: "uploaded_at", header: "Uploaded At", render: (row) => row.uploaded_at ? new Date(row.uploaded_at).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "—" },
              { key: "status", header: "Status", render: (row) => <Badge tone="success">{row.status}</Badge> },
              { key: "actions", header: "Actions", align: "right", render: (row) => (
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary h-8 text-xs" type="button" onClick={() => { setOutletId(row.outlet_id); setMonth(row.report_month); setYear(row.report_year); setHistoryOpen(false); }}>View</button>
                  {canManageReports ? <button className="btn-secondary h-8 text-xs" type="button" onClick={() => {
                    setUploadForm({ outletId: row.outlet_id, month: row.report_month, year: row.report_year, file: null, parsedItems: [] });
                    setHistoryOpen(false);
                    setUploadModal(true);
                  }}>Replace</button> : null}
                  {canManageReports ? <button className="btn-danger h-8 text-xs" type="button" onClick={() => deleteReport(row)}>Delete</button> : null}
                </div>
              ) },
            ]}
            rows={reports}
            getRowKey={(row) => row.id}
          />
        </Modal>
      ) : null}
    </div>
  );
}
