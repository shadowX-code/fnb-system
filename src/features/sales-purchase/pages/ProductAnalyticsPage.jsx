import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUpDown, BarChart3, Clock, Download, FileSpreadsheet, History, Info, PieChart, Sparkles, Upload } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import FilterBar from "../../../components/forms/FilterBar.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import { FieldLabel, MonthSelector, YearSelector } from "../../../components/forms/Selectors.jsx";
import Modal from "../../../components/feedback/Modal.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import TrendChart from "../../../components/charts/TrendChart.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { months } from "../data/mockData.js";
import { monthLabel, percentageChange, toCurrency, toPercent } from "../utils/analytics.js";
import { canExport, canManage, getAccessibleOutletOptions, hasPermission, notifyPermissionDenied } from "../../../utils/accessControl.js";
import { productAnalyticsService } from "../../../services/productAnalyticsService.js";
import { buildDynamicYearOptions, yearsFromRecords } from "../../../utils/yearOptions.js";

const productColumnAliases = {
  category: ["Category", "Cat", "Item Category", "Product Category", "Menu Category"],
  productName: ["Product Name", "Item Name", "Item", "Product", "Menu Item", "Name"],
  code: ["Code", "Item Code", "Product Code", "SKU Code"],
  variant: ["Variant", "Option", "Variation", "SKU", "Size", "Modifier", "Variant Name"],
  quantity: ["Quantity", "Qty", "Sold Qty", "Total Qty", "Qty Sold", "Count"],
  grossSales: ["Gross Sales", "Gross", "Sales", "Total Sales", "Gross Amount"],
  discount: ["Discount", "Discount Amount", "Disc"],
  billDiscount: ["Bill Discount", "Bill Disc"],
  itemDiscount: ["Item Discount", "Item Disc"],
  sst: ["SST", "Tax", "Tax Amount", "Service Tax"],
  serviceCharge: ["Service Charge", "Svc Charge", "Service", "SC"],
  nettSales: ["Nett Sales", "Net Sales", "Nett", "Net", "Amount", "Total Amount", "Sales Amount"],
};

const productColumnLabels = {
  category: "Category",
  productName: "Product Name",
  code: "Code",
  variant: "Variant",
  quantity: "Quantity",
  grossSales: "Gross Sales",
  discount: "Discount",
  billDiscount: "Bill Discount",
  itemDiscount: "Item Discount",
  sst: "SST",
  serviceCharge: "Service Charge",
  nettSales: "Nett Sales",
};

const requiredProductFields = ["productName", "quantity", "nettSales"];

function canonical(value) {
  return String(value ?? "").trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

function normalizedHeader(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  return rows;
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
  return rows;
}

function detectColumnMapping(rawRows) {
  const aliasLookup = Object.fromEntries(
    Object.entries(productColumnAliases).flatMap(([field, aliases]) => aliases.map((alias) => [canonical(alias), field])),
  );
  const candidates = rawRows.slice(0, 20).map((row, rowIndex) => {
    const mapping = {};
    row.forEach((header, columnIndexValue) => {
      const field = aliasLookup[canonical(normalizedHeader(header))];
      if (field && mapping[field] === undefined) {
        mapping[field] = { index: columnIndexValue, header: normalizedHeader(header) };
      }
    });
    return {
      rowIndex,
      mapping,
      requiredMatches: requiredProductFields.filter((field) => mapping[field]).length,
      totalMatches: Object.keys(mapping).length,
    };
  });
  return candidates
    .filter((candidate) => candidate.totalMatches)
    .sort((a, b) => b.requiredMatches - a.requiredMatches || b.totalMatches - a.totalMatches)[0] ?? { rowIndex: -1, mapping: {}, requiredMatches: 0, totalMatches: 0 };
}

function buildMissingFieldError(missingFields) {
  return `We could not detect these required fields:\n${missingFields.map((field) => `- ${productColumnLabels[field]}`).join("\n")}\n\nPlease check your POS export format.`;
}

const cjkPattern = /[\u3400-\u9fff\uf900-\ufaff]/;

function hasCjk(value) {
  return cjkPattern.test(String(value ?? ""));
}

function splitBilingualLabel(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text === "—") return { primary: "—", secondary: "" };

  const separatedParts = text.split(/\s*(?:\/|\||\n)\s*/).map((part) => part.trim()).filter(Boolean);
  if (separatedParts.length > 1) {
    const englishPart = separatedParts.find((part) => !hasCjk(part));
    const chinesePart = separatedParts.find((part) => hasCjk(part) && part !== englishPart);
    return {
      primary: englishPart || separatedParts[0],
      secondary: chinesePart || "",
    };
  }

  const firstCjkIndex = [...text].findIndex((char) => hasCjk(char));
  if (firstCjkIndex > 0) {
    return {
      primary: text.slice(0, firstCjkIndex).trim(),
      secondary: text.slice(firstCjkIndex).trim(),
    };
  }

  return { primary: text, secondary: "" };
}

function KpiNameValue({ value }) {
  const { primary, secondary } = splitBilingualLabel(value);
  return (
    <span className="block min-w-0">
      <span className="block truncate text-[22px] font-semibold leading-[28px] text-text-primary">{primary}</span>
      {secondary ? <span className="mt-0.5 block truncate text-[13px] font-medium leading-tight text-text-secondary">{secondary}</span> : null}
    </span>
  );
}

const productAnalyticsNumericKpiClass = "text-[30px] leading-[36px] font-bold";

function extractFeedMeMetadata(rawRows) {
  const metadata = {};
  rawRows.slice(0, 20).forEach((row) => {
    const cells = row.map((cell) => String(cell ?? "").trim()).filter(Boolean);
    const joined = cells.join(" ");
    const key = canonical(cells[0] ?? "");
    const value = cells.slice(1).join(" ").replace(/^[:\s]+/, "");
    if (!cells.length) return;
    if (key.includes("merchant")) metadata.merchant = value || joined.replace(/merchant/i, "").replace(/^[:\s]+/, "");
    if (key.includes("date")) metadata.report_date_range = value || joined.replace(/date/i, "").replace(/^[:\s]+/, "");
    if (key.includes("generated")) metadata.generated_at = value || joined.replace(/generated(?: by| at)?/i, "").replace(/^[:\s]+/, "");
    if (key.includes("time")) metadata.time_range = value || joined.replace(/time/i, "").replace(/^[:\s]+/, "");
    if (!metadata.report_title && /product|sales|report/i.test(joined)) metadata.report_title = joined;
  });
  return metadata;
}

function isSummaryRow(row, detected, read) {
  const productName = String(read(row, "productName") ?? "").trim();
  const category = String(read(row, "category") ?? "").trim();
  const rowText = row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" ").toLowerCase();
  if (!productName) return true;
  if (/^(total|grand total|subtotal|summary)$/i.test(productName)) return true;
  if (/^(total|grand total|subtotal|summary)$/i.test(category)) return true;
  if (detected.rowIndex >= 0 && rowText.includes("total") && !canonical(productName).replace(/total/g, "")) return true;
  return false;
}

function mapParsedRows(rawRows) {
  const detected = detectColumnMapping(rawRows);
  const missingFields = requiredProductFields.filter((field) => !detected.mapping[field]);
  if (missingFields.length) throw new Error(buildMissingFieldError(missingFields));
  const dataRows = rawRows.slice(detected.rowIndex + 1).filter((row) => row.some((cell) => String(cell ?? "").trim()));
  const read = (row, field) => {
    const column = detected.mapping[field];
    return column ? row[column.index] : "";
  };
  const items = dataRows.map((row, index) => {
    if (isSummaryRow(row, detected, read)) return null;
    const quantity = parseAmount(read(row, "quantity"));
    const nettSales = parseAmount(read(row, "nettSales"));
    const baseDiscount = detected.mapping.discount ? parseAmount(read(row, "discount")) : 0;
    const billDiscount = detected.mapping.billDiscount ? parseAmount(read(row, "billDiscount")) : 0;
    const itemDiscount = detected.mapping.itemDiscount ? parseAmount(read(row, "itemDiscount")) : 0;
    const discount = [baseDiscount, billDiscount, itemDiscount].some((value) => value === null) ? null : baseDiscount + billDiscount + itemDiscount;
    const sst = parseAmount(read(row, "sst"));
    const serviceCharge = parseAmount(read(row, "serviceCharge"));
    const explicitGrossSales = detected.mapping.grossSales ? parseAmount(read(row, "grossSales")) : null;
    const grossSales = explicitGrossSales ?? (nettSales !== null && discount !== null ? nettSales + discount : 0);
    const productName = String(read(row, "productName") ?? "").trim();
    if (!productName) return null;
    if ([quantity, grossSales, discount, sst, serviceCharge, nettSales].some((value) => value === null)) {
      throw new Error(`Row ${detected.rowIndex + index + 2}: invalid number found.`);
    }
    return {
      category_name: String(read(row, "category") ?? "Uncategorized").trim() || "Uncategorized",
      product_name: productName,
      variant_name: String(read(row, "variant") ?? "").trim(),
      quantity,
      gross_sales: grossSales,
      discount: discount ?? 0,
      sst: sst ?? 0,
      service_charge: serviceCharge ?? 0,
      nett_sales: nettSales,
      source_row: detected.rowIndex + index + 2,
    };
  }).filter(Boolean);
  return {
    items,
    metadata: {
      ...extractFeedMeMetadata(rawRows),
      header_row: detected.rowIndex + 1,
    },
    mapping: Object.fromEntries(
      Object.entries(productColumnLabels).map(([field, label]) => [
        field,
        {
          label,
          detected: detected.mapping[field]?.header ?? "",
          required: requiredProductFields.includes(field),
        },
      ]),
    ),
  };
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

function normalizeProductName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function productKey(item) {
  return `${normalizeProductName(item.category_name)}::${normalizeProductName(item.product_name)}`;
}

function variantKey(item) {
  return `${productKey(item)}::${normalizeProductName(item.variant_name || "Default")}`;
}

function productContribution(product, total) {
  return total ? (product.nett_sales / total) * 100 : 0;
}

function productStatus(product, total) {
  const contribution = productContribution(product, total);
  const discountRate = product.gross_sales ? (product.discount / product.gross_sales) * 100 : 0;
  if (contribution >= 12 || product.rank <= 3) return { label: "Best Seller", tone: "success" };
  if (product.quantity <= 0) return { label: "No Movement", tone: "neutral" };
  if (discountRate >= 20) return { label: "High Discount", tone: "warning" };
  if (product.quantity < 5 || contribution < 1) return { label: "Low Performer", tone: "danger" };
  return { label: "New", tone: "info" };
}

function lowPerformerAction(product) {
  const discountRate = product.gross_sales ? (product.discount / product.gross_sales) * 100 : 0;
  if (product.quantity <= 0) return "Archive candidate.";
  if (product.quantity < 3) return "Consider removing or seasonal only.";
  if (discountRate >= 20 && product.nett_sales < product.gross_sales * 0.8) return "Review pricing/promo.";
  if (product.quantity < 5) return "Review menu visibility.";
  return "Monitor and test promotion.";
}

function aggregateItems(items, options = {}) {
  const { includeVariants = false } = options;
  const byProduct = new Map();
  const byCategory = new Map();
  items.forEach((item) => {
    const key = includeVariants ? variantKey(item) : productKey(item);
    const variantName = String(item.variant_name ?? "").trim();
    const product = byProduct.get(key) ?? {
      key,
      product: item.product_name,
      variant: includeVariants ? variantName : "",
      category: item.category_name,
      quantity: 0,
      gross_sales: 0,
      nett_sales: 0,
      discount: 0,
      last_sold: item.created_at,
      variant_count: 0,
      variants: new Map(),
    };
    product.quantity += item.quantity;
    product.gross_sales += item.gross_sales;
    product.nett_sales += item.nett_sales;
    product.discount += item.discount;
    product.last_sold = item.created_at || product.last_sold;
    const variantDisplay = variantName || "Default";
    const variant = product.variants.get(variantDisplay) ?? {
      variant: variantDisplay,
      quantity: 0,
      gross_sales: 0,
      discount: 0,
      sst: 0,
      service_charge: 0,
      nett_sales: 0,
    };
    variant.quantity += item.quantity;
    variant.gross_sales += item.gross_sales;
    variant.discount += item.discount;
    variant.sst += item.sst;
    variant.service_charge += item.service_charge;
    variant.nett_sales += item.nett_sales;
    product.variants.set(variantDisplay, variant);
    product.variant_count = product.variants.size;
    byProduct.set(key, product);

    const category = byCategory.get(item.category_name) ?? { name: item.category_name, quantity: 0, nett_sales: 0 };
    category.quantity += item.quantity;
    category.nett_sales += item.nett_sales;
    byCategory.set(item.category_name, category);
  });
  const products = [...byProduct.values()].map((product) => ({
    ...product,
    variants: [...product.variants.values()].sort((a, b) => b.nett_sales - a.nett_sales),
  }));
  const categories = [...byCategory.values()].sort((a, b) => b.nett_sales - a.nett_sales);
  const totals = products.reduce((sum, item) => ({
    quantity: sum.quantity + item.quantity,
    nett_sales: sum.nett_sales + item.nett_sales,
    discount: sum.discount + item.discount,
  }), { quantity: 0, nett_sales: 0, discount: 0 });
  return { products, categories, totals };
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
    <div className="grid gap-5 p-4 md:grid-cols-[180px_minmax(0,1fr)]">
      <div className="mx-auto grid h-40 w-40 place-items-center rounded-full shadow-sm" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="grid h-24 w-24 place-items-center rounded-full bg-white text-center shadow-sm">
          <div>
            <div className="text-[11px] font-bold text-text-muted">Mix</div>
            <div className="text-base font-bold text-text-primary">{categories.length}</div>
            <div className="text-[10px] font-semibold text-text-muted">categories</div>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {categories.slice(0, 8).map((category, index) => {
          const share = total ? (category.nett_sales / total) * 100 : 0;
          return (
            <div key={category.name}>
              <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
                  <span className="truncate font-bold text-text-primary">{category.name}</span>
                </div>
                <div className="shrink-0 text-right font-semibold text-text-secondary">
                  {toPercent(share)} · {toCurrency(category.nett_sales)}
                </div>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full" style={{ width: `${Math.min(100, share)}%`, backgroundColor: colors[index % colors.length] }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function quadrantFor(product, avgQty, avgSales) {
  const highQty = product.quantity >= avgQty;
  const highSales = product.nett_sales >= avgSales;
  if (highQty && highSales) return { label: "Star Performer", color: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50", action: "Protect and promote this item." };
  if (!highQty && highSales) return { label: "Growth Potential", color: "bg-blue-500", text: "text-blue-700", bg: "bg-blue-50", action: "High revenue but lower volume. Improve visibility or bundle it." };
  if (highQty && !highSales) return { label: "High Volume Low Margin", color: "bg-orange-500", text: "text-orange-700", bg: "bg-orange-50", action: "High volume but lower revenue. Consider upsell or price review." };
  return { label: "Low Performer", color: "bg-rose-500", text: "text-rose-700", bg: "bg-rose-50", action: "Low sales and low revenue. Review, rename, promote, or remove." };
}

function matrixInsightsForProduct(product, total, avgQty, avgSales) {
  if (!product) return [];
  const quadrant = quadrantFor(product, avgQty, avgSales);
  const contribution = productContribution(product, total);
  const avgPrice = product.quantity ? product.nett_sales / product.quantity : 0;
  const discountRate = product.gross_sales ? (product.discount / product.gross_sales) * 100 : 0;
  return [
    {
      type: "Insight",
      tone: "info",
      finding: `${product.product} sits in ${quadrant.label}.`,
      why: `${toPercent(contribution)} of current net sales with ${product.quantity.toLocaleString()} units sold.`,
      action: quadrant.action,
      metric: `${toPercent(contribution)} contribution · ${product.quantity.toLocaleString()} sold`,
    },
    {
      type: "Opportunity",
      tone: contribution >= 8 ? "success" : "info",
      finding: `Average selling price is ${toCurrency(avgPrice)}.`,
      why: "Price and volume together explain whether this item is driving sales efficiently.",
      action: avgPrice < 8 ? "Test add-ons, bundles, or a small price review." : "Keep monitoring price acceptance and bundle potential.",
      metric: `${toCurrency(avgPrice)} per item`,
    },
    discountRate >= 15 ? {
      type: "Warning",
      tone: "warning",
      finding: `Discount rate is ${toPercent(discountRate)}.`,
      why: "High discount dependency can hide weak menu economics.",
      action: "Review promotion mechanics and compare full-price demand.",
      metric: `${toPercent(discountRate)} discount rate`,
    } : {
      type: "Recommendation",
      tone: "success",
      finding: "Discount pressure appears controlled.",
      why: "Lower discount reliance gives cleaner product performance signals.",
      action: "Use this item as a benchmark when reviewing discounted products.",
      metric: `${toPercent(discountRate)} discount rate`,
    },
    {
      type: "Trend",
      tone: "neutral",
      finding: "Track this item across future monthly uploads.",
      why: "A single month shows current position; trend confirms whether the move is durable.",
      action: "Upload next month’s POS report and compare ranking movement.",
      metric: "Trend needs more months",
    },
  ];
}

function spreadMatrixPoints(points) {
  const occupied = new Map();
  return points.map((point) => {
    const bucket = `${Math.round(point.x / 4)}-${Math.round(point.y / 4)}`;
    const count = occupied.get(bucket) ?? 0;
    occupied.set(bucket, count + 1);
    if (!count) return point;
    const angle = count * 2.39996;
    const radius = Math.min(7, 2.5 + count * 0.9);
    return {
      ...point,
      x: Math.max(5, Math.min(95, point.x + Math.cos(angle) * radius)),
      y: Math.max(5, Math.min(95, point.y + Math.sin(angle) * radius)),
    };
  });
}

function ProductTooltip({ point, total, position }) {
  if (!point) return null;
  const product = point.product;
  const contribution = productContribution(product, total);
  const viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  const left = Math.max(132, Math.min((position?.x ?? viewportWidth / 2) + 16, viewportWidth - 132));
  const top = Math.max(80, Math.min((position?.y ?? viewportHeight / 2) - 18, viewportHeight - 150));
  const tooltip = (
    <div
      className="pointer-events-none fixed z-[9999] w-64 rounded-2xl border border-slate-200/80 bg-white/95 p-3 text-xs shadow-[0_20px_48px_rgba(15,23,42,0.16)] backdrop-blur"
      style={{ left, top, transform: "translate(-50%, -100%)" }}
    >
      <div className="text-sm font-black leading-tight text-text-primary">{product.product}</div>
      <div className="mt-3 space-y-1.5">
        {[
          ["Net sales", toCurrency(product.nett_sales)],
          ["Qty sold", product.quantity.toLocaleString()],
          ["Contribution", toPercent(contribution)],
        ].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4">
            <span className="font-bold text-text-muted">{label}</span>
            <span className="font-black text-text-primary">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(tooltip, document.body);
}

function PerformanceMatrix({ products, total, categoryFilter, onCategoryFilter, focusedProductKey, onProductFocus }) {
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState(null);
  const categories = ["all", ...new Set(products.map((product) => product.category).filter(Boolean))];
  const visibleProducts = categoryFilter === "all" ? products : products.filter((product) => product.category === categoryFilter);
  const maxQty = Math.max(...visibleProducts.map((item) => item.quantity), 1);
  const maxSales = Math.max(...visibleProducts.map((item) => item.nett_sales), 1);
  const avgQty = products.reduce((sum, item) => sum + item.quantity, 0) / (products.length || 1);
  const avgSales = products.reduce((sum, item) => sum + item.nett_sales, 0) / (products.length || 1);
  const matrixPoints = spreadMatrixPoints(visibleProducts.slice(0, 100).map((product) => {
    const x = Math.max(6, Math.min(94, (product.quantity / maxQty) * 90 + 5));
    const y = Math.max(6, Math.min(94, 100 - ((product.nett_sales / maxSales) * 90 + 5)));
    const quadrant = quadrantFor(product, avgQty, avgSales);
    const size = Math.max(12, Math.min(34, 12 + (product.nett_sales / maxSales) * 22));
    return { product, x, y, quadrant, size };
  }));
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <button
              key={category}
              className={`rounded-full border px-3 py-1 text-xs font-bold transition ${categoryFilter === category ? "border-primary bg-primary/10 text-primary" : "border-border bg-white text-text-secondary hover:bg-slate-50"}`}
              type="button"
              onClick={() => onCategoryFilter(category)}
            >
              {category === "all" ? "All" : category}
            </button>
          ))}
        </div>
        <div className="text-xs font-semibold text-text-secondary">Hover bubbles to inspect products</div>
      </div>
      <div className="relative h-[390px] overflow-hidden touch-manipulation rounded-2xl border border-slate-200 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:h-80">
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2">
          <div className="bg-gradient-to-br from-blue-50/70 to-white" />
          <div className="bg-gradient-to-bl from-emerald-50/80 to-white" />
          <div className="bg-gradient-to-tr from-rose-50/60 to-white" />
          <div className="bg-gradient-to-tl from-orange-50/65 to-white" />
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[size:48px_48px]" />
        <div className="absolute left-1/2 top-0 h-full w-px border-l border-dashed border-slate-300/70" />
        <div className="absolute left-0 top-1/2 h-px w-full border-t border-dashed border-slate-300/70" />
        <div className="absolute left-5 top-5 text-[10px] font-black uppercase tracking-[0.14em] text-blue-700/40">Growth Potential</div>
        <div className="absolute right-5 top-5 text-right text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700/40">Star Performer</div>
        <div className="absolute bottom-5 left-5 text-[10px] font-black uppercase tracking-[0.14em] text-rose-700/40">Low Performer</div>
        <div className="absolute bottom-5 right-5 text-right text-[10px] font-black uppercase tracking-[0.14em] text-orange-700/40">Slow Selling</div>
        {matrixPoints.map((point) => {
          const product = point.product;
          const isFocused = focusedProductKey === product.key;
          return (
            <button
              key={product.key}
              type="button"
              aria-label={`Inspect ${product.product}`}
              onClick={() => onProductFocus(product)}
              onMouseEnter={(event) => {
                setHoveredPoint(point);
                setTooltipPosition({ x: event.clientX, y: event.clientY });
                onProductFocus(product);
              }}
              onMouseMove={(event) => setTooltipPosition({ x: event.clientX, y: event.clientY })}
              onMouseLeave={() => {
                setHoveredPoint(null);
                setTooltipPosition(null);
              }}
              onFocus={(event) => {
                setHoveredPoint(point);
                const rect = event.currentTarget.getBoundingClientRect();
                setTooltipPosition({ x: rect.left + rect.width / 2, y: rect.top });
                onProductFocus(product);
              }}
              onBlur={() => {
                setHoveredPoint(null);
                setTooltipPosition(null);
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full ${point.quadrant.color} shadow-[0_6px_22px_rgba(15,23,42,0.16)] ring-white transition duration-300 ease-out hover:scale-125 hover:shadow-[0_12px_34px_rgba(16,185,129,0.28)] focus:outline-none focus:ring-4 ${isFocused ? "scale-125 opacity-100 ring-4 shadow-[0_14px_38px_rgba(16,185,129,0.25)]" : "opacity-85 ring-2"}`}
              style={{ left: `${point.x}%`, top: `${point.y}%`, width: point.size, height: point.size }}
            />
          );
        })}
        <ProductTooltip point={hoveredPoint} total={total} position={tooltipPosition} />
      </div>
      <div className="mt-2 flex justify-between text-[11px] font-bold uppercase text-text-muted">
        <span>Slow Selling</span>
        <span>Fast Selling</span>
      </div>
      <div className="-mt-1 flex justify-center gap-2 text-[11px] font-bold uppercase text-text-muted">
        <span>Low Revenue</span>
        <span>→</span>
        <span>High Revenue</span>
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
  const [fullTableOpen, setFullTableOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productCategory, setProductCategory] = useState("all");
  const yearOptions = useMemo(() => buildDynamicYearOptions(yearsFromRecords(reports, "report_year")), [reports]);
  const [productSort, setProductSort] = useState("net_sales");
  const [productPage, setProductPage] = useState(1);
  const [productViewMode, setProductViewMode] = useState("summary");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [focusedMatrixProductKey, setFocusedMatrixProductKey] = useState("");
  const [matrixInfoOpen, setMatrixInfoOpen] = useState(false);
  const [matrixCategory, setMatrixCategory] = useState("all");
  const [rankBy, setRankBy] = useState("sales");
  const [lowFilter, setLowFilter] = useState("lt5");
  const [uploadBanner, setUploadBanner] = useState(null);
  const [uploadForm, setUploadForm] = useState({ outletId: "", month: new Date().getMonth() + 1, year: new Date().getFullYear(), file: null, parsedItems: [], columnMapping: null, reportMetadata: {}, parseError: "" });
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
  const currentVariantDetail = aggregateItems(currentItems, { includeVariants: true });
  const comparison = aggregateItems(compareItems);
  const rankedProducts = [...current.products]
    .sort((a, b) => b.nett_sales - a.nett_sales)
    .map((product, index) => ({ ...product, rank: index + 1 }));
  const rankedVariantProducts = [...currentVariantDetail.products]
    .sort((a, b) => b.nett_sales - a.nett_sales)
    .map((product, index) => ({ ...product, rank: index + 1 }));
  const tableProducts = productViewMode === "variant" ? rankedVariantProducts : rankedProducts;
  const topProducts = [...rankedProducts].sort((a, b) => rankBy === "sales" ? b.nett_sales - a.nett_sales : b.quantity - a.quantity).slice(0, 10);
  const matrixAvgQty = rankedProducts.reduce((sum, item) => sum + item.quantity, 0) / (rankedProducts.length || 1);
  const matrixAvgSales = rankedProducts.reduce((sum, item) => sum + item.nett_sales, 0) / (rankedProducts.length || 1);
  const focusedMatrixProduct = rankedProducts.find((product) => product.key === focusedMatrixProductKey) ?? null;
  const best = [...current.products].sort((a, b) => b.quantity - a.quantity)[0];
  const lowest = [...current.products].filter((item) => item.quantity > 0).sort((a, b) => a.nett_sales - b.nett_sales)[0];
  const topCategory = current.categories[0];
  const reportMonthsWithData = [...new Set(yearReports.map((report) => `${report.report_year}-${String(report.report_month).padStart(2, "0")}`))];
  const hasTrendHistory = reportMonthsWithData.length >= 2;
  const recentWindowSize = lowFilter === "last2" ? 2 : lowFilter === "last3" ? 3 : 0;
  const lowThreshold = lowFilter === "lt3" ? 3 : lowFilter === "lt10" ? 10 : 5;
  const recentMonthKeys = recentWindowSize
    ? [...new Set([...yearReports]
      .sort((a, b) => (b.report_year - a.report_year) || (b.report_month - a.report_month))
      .map((report) => `${report.report_year}-${report.report_month}`))]
      .slice(0, recentWindowSize)
    : [];
  const recentReportIds = new Set(yearReports
    .filter((report) => recentMonthKeys.includes(`${report.report_year}-${report.report_month}`))
    .map((report) => report.id));
  const recentProductQuantity = yearItems
    .filter((item) => recentReportIds.has(item.report_id))
    .reduce((map, item) => {
      const key = productKey(item);
      map.set(key, (map.get(key) ?? 0) + item.quantity);
      return map;
    }, new Map());
  const lowPerformers = rankedProducts
    .map((item) => recentWindowSize ? { ...item, recent_quantity: recentProductQuantity.get(item.key) ?? 0 } : item)
    .filter((item) => (recentWindowSize ? item.recent_quantity : item.quantity) < lowThreshold)
    .sort((a, b) => (recentWindowSize ? a.recent_quantity - b.recent_quantity : a.quantity - b.quantity) || a.nett_sales - b.nett_sales)
    .slice(0, 12);
  const avgSpend = current.totals.quantity ? current.totals.nett_sales / current.totals.quantity : 0;
  const salesChange = percentageChange(current.totals.nett_sales, comparison.totals.nett_sales);
  const qtyChange = percentageChange(current.totals.quantity, comparison.totals.quantity);
  const trendProducts = topProducts.slice(0, 5).map((product) => ({ key: product.key, name: product.product }));
  const trendData = months.map((item) => {
    const periodReports = yearReports.filter((report) => report.report_month === item.value);
    const periodReportIds = new Set(periodReports.map((report) => report.id));
    const periodItems = yearItems.filter((row) => periodReportIds.has(row.report_id));
    const row = { label: item.label };
    trendProducts.forEach((product) => {
      row[product.key] = periodItems.filter((sale) => productKey(sale) === product.key).reduce((sum, sale) => sum + sale.nett_sales, 0);
    });
    return row;
  });
  const productCategories = ["all", ...new Set(tableProducts.map((product) => product.category).filter(Boolean))];
  const filteredProducts = tableProducts
    .filter((product) => productCategory === "all" || product.category === productCategory)
    .filter((product) => {
      const search = productSearch.trim().toLowerCase();
      if (!search) return true;
      return [product.product, product.variant, product.category, product.key].some((value) => String(value ?? "").toLowerCase().includes(search));
    });
  const sortedProducts = [...filteredProducts].sort((a, b) => {
    if (productSort === "quantity") return b.quantity - a.quantity;
    if (productSort === "lowest_sales") return a.nett_sales - b.nett_sales;
    if (productSort === "highest_discount") return b.discount - a.discount;
    if (productSort === "product_name") return a.product.localeCompare(b.product);
    return b.nett_sales - a.nett_sales;
  });
  const pageSize = 12;
  const totalProductPages = Math.max(1, Math.ceil(sortedProducts.length / pageSize));
  const pagedProducts = sortedProducts.slice((productPage - 1) * pageSize, productPage * pageSize);
  const historyReports = reports.filter((report) => outletId === "all" || report.outlet_id === outletId);

  useEffect(() => {
    if (productPage > totalProductPages) setProductPage(totalProductPages);
  }, [productPage, totalProductPages]);

  useEffect(() => {
    setProductCategory("all");
    setProductPage(1);
  }, [productViewMode]);
  const insights = focusedMatrixProduct
    ? matrixInsightsForProduct(focusedMatrixProduct, current.totals.nett_sales, matrixAvgQty, matrixAvgSales)
    : [
      best ? { tone: "success", type: "Insight", finding: `${best.product} is leading sales.`, why: `${best.quantity} items sold with ${toCurrency(best.nett_sales)} net sales.`, action: "Keep it visible and protect preparation consistency.", metric: `${best.quantity} sold` } : null,
      topCategory ? { tone: "info", type: "Opportunity", finding: `${topCategory.name} is the strongest category.`, why: `${toPercent(current.totals.nett_sales ? (topCategory.nett_sales / current.totals.nett_sales) * 100 : 0)} of net sales comes from this category.`, action: "Use it for bundles, placement, or menu highlights.", metric: toCurrency(topCategory.nett_sales) } : null,
      comparePeriod && current.totals.nett_sales ? { tone: salesChange >= 0 ? "success" : "warning", type: "Trend", finding: `Net sales ${salesChange >= 0 ? "increased" : "decreased"} ${toPercent(Math.abs(salesChange))}.`, why: `Compared with ${monthLabel(comparePeriod.month)} ${comparePeriod.year}.`, action: salesChange >= 0 ? "Repeat the products that drove the lift." : "Review top decliners and discount dependency.", metric: `${toPercent(qtyChange)} qty movement` } : null,
      current.totals.discount > current.totals.nett_sales * 0.12 ? { tone: "warning", type: "Warning", finding: "Discount level is elevated.", why: `${toCurrency(current.totals.discount)} discount given this period.`, action: "Compare full-price demand before repeating the promo.", metric: toCurrency(current.totals.discount) } : null,
      lowPerformers.length ? { tone: "danger", type: "Recommendation", finding: `${lowPerformers.length} low performers need review.`, why: `These items sold below the ${lowThreshold} quantity threshold.`, action: "Review visibility, naming, promotion, or removal.", metric: `${lowPerformers.length} items` } : null,
    ].filter(Boolean);
  const suggestedActions = insights.slice(0, 4).map((insight) => insight.action).filter(Boolean);

  async function handleFile(file) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    try {
      if (!["csv", "xlsx"].includes(extension)) throw new Error("Please upload a CSV or XLSX file.");
      const rows = extension === "xlsx" ? await parseXlsx(file) : parseCsv(await file.text());
      if (!rows.length) throw new Error("The report has no product rows.");
      const parsedReport = mapParsedRows(rows);
      const groupedReport = aggregateItems(parsedReport.items);
      setUploadForm((currentForm) => ({
        ...currentForm,
        file,
        parsedItems: parsedReport.items,
        columnMapping: parsedReport.mapping,
        reportMetadata: {
          ...parsedReport.metadata,
          grouped_product_count: groupedReport.products.length,
          variant_row_count: parsedReport.items.filter((item) => String(item.variant_name ?? "").trim()).length,
        },
        parseError: "",
      }));
    } catch (error) {
      console.error("Unable to parse product report", error);
      setUploadForm((currentForm) => ({ ...currentForm, file, parsedItems: [], columnMapping: null, reportMetadata: {}, parseError: error.message }));
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
        metadata: { ...uploadForm.reportMetadata, column_mapping: uploadForm.columnMapping, row_count: uploadForm.parsedItems.length },
      });
      const nextReports = await productAnalyticsService.listReports({ outletIds: activeOutlets.map((outlet) => outlet.id) });
      setReports(nextReports);
      setOutletId(report.outlet_id);
      setMonth(report.report_month);
      setYear(report.report_year);
      setUploadModal(false);
      setUploadBanner({
        rows: uploadForm.parsedItems.length,
        netSales: uploadForm.parsedItems.reduce((sum, item) => sum + item.nett_sales, 0),
        skipped: Number(uploadForm.reportMetadata?.skipped_rows ?? 0),
      });
      setUploadForm({ outletId: "", month: new Date().getMonth() + 1, year: new Date().getFullYear(), file: null, parsedItems: [], columnMapping: null, reportMetadata: {}, parseError: "" });
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
          options={getAccessibleOutletOptions(auth, activeOutlets)}
          onChange={setOutletId}
        />
        <MonthSelector value={month} onChange={setMonth} />
        <YearSelector value={year} onChange={setYear} years={yearOptions} />
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

      {uploadBanner ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="font-bold">{uploadBanner.rows} products imported successfully.</div>
          <div className="mt-1 font-semibold">{toCurrency(uploadBanner.netSales)} net sales analyzed. Data quality: Healthy.</div>
          {uploadBanner.skipped ? <div className="mt-1 font-semibold text-amber-700">{uploadBanner.skipped} rows skipped. Review upload details.</div> : null}
        </div>
      ) : null}

      {!loading && !currentItems.length ? (
        <div className="card border-dashed p-8 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><FileSpreadsheet size={22} /></div>
          <h2 className="mt-3 text-lg font-bold text-text-primary">No product sales report uploaded yet.</h2>
          <p className="mt-1 text-sm text-text-secondary">Use the Upload Report button above to import POS sales data.</p>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard variant="compact" label="Total Net Sales" value={toCurrency(current.totals.nett_sales)} helper={comparePeriod ? `${salesChange >= 0 ? "+" : ""}${toPercent(salesChange)} vs compare month` : "Current period"} icon={BarChart3} valueClassName={productAnalyticsNumericKpiClass} />
        <MetricCard variant="compact" label="Total Quantity Sold" value={current.totals.quantity.toLocaleString()} helper={comparePeriod ? `${qtyChange >= 0 ? "+" : ""}${toPercent(qtyChange)} quantity movement` : "Items sold"} icon={ArrowUpDown} valueClassName={productAnalyticsNumericKpiClass} />
        <MetricCard variant="compact" label="Average Spend / Item" value={toCurrency(avgSpend)} helper="Net sales divided by quantity" icon={PieChart} valueClassName={productAnalyticsNumericKpiClass} />
        <MetricCard variant="compact" label="Best Selling Product" value={<KpiNameValue value={best?.product} />} helper={best ? `${best.quantity} sold` : "No product data"} icon={Sparkles} valueClassName="text-base" />
        <MetricCard variant="compact" label="Lowest Performer" value={<KpiNameValue value={lowest?.product} />} helper={lowest ? `${lowest.quantity} sold · ${toCurrency(lowest.nett_sales)}` : "No product data"} icon={Clock} valueClassName="text-base" />
        <MetricCard variant="compact" label="Discount Given" value={toCurrency(current.totals.discount)} helper="Total discount in report" icon={Download} valueClassName={productAnalyticsNumericKpiClass} />
        <MetricCard variant="compact" label="Top Category" value={<KpiNameValue value={topCategory?.name} />} helper={topCategory ? toCurrency(topCategory.nett_sales) : "No category data"} icon={PieChart} valueClassName="text-base" />
        <MetricCard variant="compact" label="Menu Items Sold" value={current.products.length.toLocaleString()} helper="Unique products after variant grouping" icon={FileSpreadsheet} valueClassName={productAnalyticsNumericKpiClass} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <Card
          title="Top 10 Best Selling Products"
          description="Ranked by product sales performance."
          action={<div className="flex items-center gap-2"><button className="btn-secondary h-9 text-xs" type="button" onClick={() => setFullTableOpen(true)}>View all products →</button><SelectField value={rankBy} options={[{ value: "sales", label: "By Net Sales" }, { value: "quantity", label: "By Quantity" }]} onChange={setRankBy} className="w-40" /></div>}
        >
          <DataTable
            density="compact"
            columns={[
              { key: "rank", header: "Rank", render: (_, index) => `#${index + 1}` },
              { key: "product", header: "Product", render: (row) => <div><div className="font-bold text-text-primary">{row.product}</div>{row.variant_count > 1 ? <div className="text-xs text-text-muted">{row.variant_count} variants</div> : null}</div> },
              { key: "category", header: "Category" },
              { key: "quantity", header: "Qty", align: "right", render: (row) => row.quantity.toLocaleString() },
              { key: "nett_sales", header: "Net Sales", align: "right", render: (row) => toCurrency(row.nett_sales) },
              { key: "contribution", header: "% Contribution", align: "right", render: (row) => toPercent(current.totals.nett_sales ? (row.nett_sales / current.totals.nett_sales) * 100 : 0) },
            ]}
            rows={topProducts}
            getRowKey={(row) => row.key}
            onRowClick={(row) => setSelectedProduct(row)}
          />
        </Card>
        <Card title="Category Contribution" description="Net sales contribution by category.">
          <CategoryDonut categories={current.categories} total={current.totals.nett_sales} />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card
          title="Product Performance Matrix"
          description="BI-style product map by revenue contribution and sales velocity."
          action={<button className="btn-secondary h-9 text-xs" type="button" onClick={() => setMatrixInfoOpen(true)}><Info size={14} /> How to read</button>}
        >
          <PerformanceMatrix
            products={rankedProducts}
            total={current.totals.nett_sales}
            categoryFilter={matrixCategory}
            onCategoryFilter={setMatrixCategory}
            focusedProductKey={focusedMatrixProductKey}
            onProductFocus={(product) => setFocusedMatrixProductKey(product.key)}
          />
        </Card>
        <Card
          title={focusedMatrixProduct ? `AI-style Insights · ${focusedMatrixProduct.product}` : "AI-style Insights"}
          description={focusedMatrixProduct ? "Rule-based drill-down for the selected matrix product." : "Rule-based product performance highlights."}
          action={focusedMatrixProduct ? <button className="btn-secondary h-9 text-xs" type="button" onClick={() => setFocusedMatrixProductKey("")}>Clear selection</button> : null}
        >
          <div className="space-y-3 p-4">
            {focusedMatrixProduct ? (
              <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 to-white p-4">
                <div className="text-[11px] font-black uppercase tracking-wide text-primary">Selected Product</div>
                <div className="mt-1 text-lg font-black text-text-primary">{focusedMatrixProduct.product}</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-xl bg-white/80 p-2"><div className="text-text-muted">Net sales</div><div className="font-black text-text-primary">{toCurrency(focusedMatrixProduct.nett_sales)}</div></div>
                  <div className="rounded-xl bg-white/80 p-2"><div className="text-text-muted">Qty</div><div className="font-black text-text-primary">{focusedMatrixProduct.quantity.toLocaleString()}</div></div>
                  <div className="rounded-xl bg-white/80 p-2"><div className="text-text-muted">Contribution</div><div className="font-black text-text-primary">{toPercent(productContribution(focusedMatrixProduct, current.totals.nett_sales))}</div></div>
                </div>
              </div>
            ) : null}
            {insights.length ? insights.map((insight) => (
              <div key={`${insight.type}-${insight.finding}`} className="rounded-2xl border border-border bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <Badge tone={insight.tone}>{insight.type}</Badge>
                  {insight.metric ? <span className="text-xs font-black text-text-muted">{insight.metric}</span> : null}
                </div>
                <div className="mt-2 text-sm font-black text-text-primary">{insight.finding}</div>
                <div className="mt-1 text-xs font-medium text-text-secondary">{insight.why}</div>
                <div className="mt-2 text-xs font-bold text-primary">{insight.action}</div>
              </div>
            )) : <div className="p-4 text-sm text-text-secondary">Upload product data to generate insights.</div>}
            {suggestedActions.length ? (
              <div className="rounded-2xl border border-border bg-slate-50 p-3">
                <div className="text-xs font-bold uppercase tracking-wide text-text-muted">Suggested Actions</div>
                <div className="mt-2 grid gap-2">
                  {suggestedActions.map((action) => (
                    <button key={action} type="button" className="rounded-xl border border-border bg-white px-3 py-2 text-left text-xs font-bold text-text-secondary transition hover:border-primary/25 hover:bg-primary/5 hover:text-primary">
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card
          title="Dead Menu / Low Performers"
          description="Menu items that may need review."
          action={<SelectField value={lowFilter} options={[{ value: "lt3", label: "Qty < 3" }, { value: "lt5", label: "Qty < 5" }, { value: "lt10", label: "Qty < 10" }, { value: "last2", label: "Last 2 uploaded months" }, { value: "last3", label: "Last 3 uploaded months" }]} onChange={setLowFilter} className="w-48" />}
        >
          <DataTable
            density="compact"
            columns={[
              { key: "product", header: "Product", render: (row) => <span className="font-semibold">{row.product}</span> },
              { key: "category", header: "Category" },
              { key: "quantity", header: "Qty", align: "right" },
              { key: "nett_sales", header: "Net Sales", align: "right", render: (row) => toCurrency(row.nett_sales) },
              { key: "last_sold", header: "Last Sold", render: () => `${monthLabel(month)} ${year}` },
              { key: "action", header: "Suggested Action", render: (row) => <span className="text-xs font-semibold text-text-secondary">{lowPerformerAction(row)}</span> },
            ]}
            rows={lowPerformers}
            getRowKey={(row) => row.key}
          />
        </Card>
        <Card title="Monthly Trend" description="Top product net sales trend across uploaded months.">
          <div className="p-4">
            {hasTrendHistory ? (
              <TrendChart
                labels={trendData.map((row) => row.label)}
                series={trendProducts.map((product, index) => ({
                  name: product.name,
                  data: trendData.map((row) => row[product.key] ?? 0),
                  stroke: ["#10B981", "#3B82F6", "#F59E0B", "#F43F5E", "#8B5CF6"][index],
                  area: index === 0,
                  format: toCurrency,
                }))}
                tickFormat={toCurrency}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-slate-50 p-8 text-center text-sm font-semibold text-text-secondary">
                Upload more monthly reports to view trend.
              </div>
            )}
          </div>
        </Card>
      </div>

      {fullTableOpen ? (
        <Modal
          title="Product Performance Table"
          description="Full product list with contribution, pricing and performance tags."
          size="2xl"
          onClose={() => setFullTableOpen(false)}
          footer={<button className="btn-primary" type="button" onClick={() => setFullTableOpen(false)}>Done</button>}
        >
          <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_190px_190px_220px]">
            <FieldLabel label="Search product">
              <input
                className="input"
                value={productSearch}
                onChange={(event) => {
                  setProductSearch(event.target.value);
                  setProductPage(1);
                }}
                placeholder="Search product or variant"
              />
            </FieldLabel>
            <SelectField
              label="View Mode"
              value={productViewMode}
              options={[
                { value: "summary", label: "Product Summary" },
                { value: "variant", label: "Variant Detail" },
              ]}
              onChange={setProductViewMode}
            />
            <SelectField
              label="Category"
              value={productCategory}
              options={productCategories.map((category) => ({ value: category, label: category === "all" ? "All Categories" : category }))}
              onChange={(value) => {
                setProductCategory(value);
                setProductPage(1);
              }}
            />
            <SelectField
              label="Sort by"
              value={productSort}
              options={[
                { value: "net_sales", label: "Net Sales" },
                { value: "quantity", label: "Quantity" },
                { value: "lowest_sales", label: "Lowest Sales" },
                { value: "highest_discount", label: "Highest Discount" },
                { value: "product_name", label: "Product Name" },
              ]}
              onChange={(value) => {
                setProductSort(value);
                setProductPage(1);
              }}
            />
          </div>
          <DataTable
            density="compact"
            columns={[
              { key: "rank", header: "Rank", render: (row) => `#${row.rank}` },
              { key: "product", header: "Product", render: (row) => <div><div className="font-bold text-text-primary">{row.product}</div>{productViewMode === "summary" && row.variant_count > 1 ? <div className="text-xs text-text-muted">{row.variant_count} variants</div> : null}</div> },
              { key: "variant", header: "Variant", render: (row) => productViewMode === "variant" ? (row.variant || "Default") : row.variant_count > 1 ? `${row.variant_count} variants` : "Default" },
              { key: "category", header: "Category" },
              { key: "quantity", header: "Qty", align: "right", render: (row) => row.quantity.toLocaleString() },
              { key: "gross_sales", header: "Gross Sales", align: "right", render: (row) => toCurrency(row.gross_sales) },
              { key: "discount", header: "Discount", align: "right", render: (row) => toCurrency(row.discount) },
              { key: "nett_sales", header: "Nett Sales", align: "right", render: (row) => toCurrency(row.nett_sales) },
              { key: "contribution", header: "% Contribution", align: "right", render: (row) => toPercent(productContribution(row, current.totals.nett_sales)) },
              { key: "avg_selling_price", header: "Avg Selling Price", align: "right", render: (row) => toCurrency(row.quantity ? row.nett_sales / row.quantity : 0) },
              { key: "status", header: "Status Tag", render: (row) => {
                const status = productStatus(row, current.totals.nett_sales);
                return <Badge tone={status.tone}>{status.label}</Badge>;
              } },
            ]}
            rows={pagedProducts}
            getRowKey={(row) => row.key}
            onRowClick={(row) => setSelectedProduct(row)}
          />
          <div className="mt-4 flex flex-col gap-3 text-sm text-text-secondary sm:flex-row sm:items-center sm:justify-between">
            <span>{sortedProducts.length.toLocaleString()} products found</span>
            <div className="flex items-center justify-end gap-2">
              <button className="btn-secondary h-9 text-xs" type="button" disabled={productPage <= 1} onClick={() => setProductPage((page) => Math.max(1, page - 1))}>Previous</button>
              <span className="min-w-24 text-center text-xs font-bold text-text-primary">Page {productPage} of {totalProductPages}</span>
              <button className="btn-secondary h-9 text-xs" type="button" disabled={productPage >= totalProductPages} onClick={() => setProductPage((page) => Math.min(totalProductPages, page + 1))}>Next</button>
            </div>
          </div>
        </Modal>
      ) : null}

      {matrixInfoOpen ? (
        <Modal
          title="How to read this matrix"
          description="Use the matrix to decide which products to protect, promote, review, or remove."
          size="md"
          onClose={() => setMatrixInfoOpen(false)}
          footer={<button className="btn-primary" type="button" onClick={() => setMatrixInfoOpen(false)}>Got it</button>}
        >
          <div className="space-y-3 text-sm text-text-secondary">
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <div className="font-bold text-text-primary">X-axis: Selling Speed</div>
              <p className="mt-1">Left means slow selling; right means fast selling based on quantity sold.</p>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <div className="font-bold text-text-primary">Y-axis: Revenue</div>
              <p className="mt-1">Lower means lower net sales; higher means higher net sales. Bubble size also grows with net sales volume.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-800"><strong>Star Performer</strong><br />Protect quality and promote.</div>
              <div className="rounded-2xl bg-blue-50 p-3 text-blue-800"><strong>Growth Potential</strong><br />Improve visibility or bundle.</div>
              <div className="rounded-2xl bg-orange-50 p-3 text-orange-800"><strong>High Volume Low Margin</strong><br />Review pricing and upsell.</div>
              <div className="rounded-2xl bg-rose-50 p-3 text-rose-800"><strong>Low Performer</strong><br />Review, rename, promote, or remove.</div>
            </div>
            <p className="text-xs font-semibold text-text-muted">Click or tap a bubble to update the insights panel for that product.</p>
          </div>
        </Modal>
      ) : null}

      {selectedProduct ? (
        <Modal
          title={selectedProduct.product}
          description={`${selectedProduct.category} product performance and variant breakdown.`}
          size="lg"
          onClose={() => setSelectedProduct(null)}
          footer={<button className="btn-primary" type="button" onClick={() => setSelectedProduct(null)}>Done</button>}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase text-text-muted">Total Qty</div>
              <div className="mt-2 text-2xl font-bold text-text-primary">{selectedProduct.quantity.toLocaleString()}</div>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase text-text-muted">Total Nett</div>
              <div className="mt-2 text-2xl font-bold text-text-primary">{toCurrency(selectedProduct.nett_sales)}</div>
            </div>
            <div className="rounded-2xl border border-border bg-slate-50 p-4">
              <div className="text-xs font-bold uppercase text-text-muted">Variants</div>
              <div className="mt-2 text-2xl font-bold text-text-primary">{selectedProduct.variant_count || 1}</div>
            </div>
          </div>
          <div className="mt-5">
            <div className="mb-3 text-sm font-bold text-text-primary">Variant Breakdown</div>
            <DataTable
              density="compact"
              columns={[
                { key: "variant", header: "Variant", render: (row) => row.variant || "Default" },
                { key: "quantity", header: "Qty", align: "right", render: (row) => row.quantity.toLocaleString() },
                { key: "gross_sales", header: "Gross Sales", align: "right", render: (row) => toCurrency(row.gross_sales) },
                { key: "discount", header: "Discount", align: "right", render: (row) => toCurrency(row.discount) },
                { key: "nett_sales", header: "Nett Sales", align: "right", render: (row) => toCurrency(row.nett_sales) },
              ]}
              rows={selectedProduct.variants?.length ? selectedProduct.variants : [{ variant: selectedProduct.variant || "Default", quantity: selectedProduct.quantity, gross_sales: selectedProduct.gross_sales, discount: selectedProduct.discount, nett_sales: selectedProduct.nett_sales }]}
              getRowKey={(row) => row.variant}
            />
          </div>
        </Modal>
      ) : null}

      {uploadModal ? (
        <Modal
          title="Upload Product Sales Report"
          description="Upload monthly POS product sales report in CSV or XLSX format."
          size="lg"
          onClose={() => setUploadModal(false)}
          footer={<><button className="btn-secondary" type="button" onClick={() => setUploadModal(false)}>Cancel</button><button className="btn-primary" type="button" onClick={submitUpload}>Upload Report</button></>}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <SelectField label="Outlet" value={uploadForm.outletId} searchable options={activeOutlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))} onChange={(value) => setUploadForm((currentForm) => ({ ...currentForm, outletId: value }))} required />
            <MonthSelector value={uploadForm.month} onChange={(value) => setUploadForm((currentForm) => ({ ...currentForm, month: value }))} />
            <YearSelector value={uploadForm.year} onChange={(value) => setUploadForm((currentForm) => ({ ...currentForm, year: value }))} years={yearOptions} />
          </div>
          <div className="mt-4 rounded-2xl border border-dashed border-border bg-slate-50 p-5 text-center">
            <input ref={inputRef} hidden type="file" accept=".csv,.xlsx" onChange={(event) => handleFile(event.target.files?.[0])} />
            <button className="btn-secondary mx-auto" type="button" onClick={() => inputRef.current?.click()}><FileSpreadsheet size={16} /> Select Report File</button>
            <div className="mt-3 text-sm font-semibold text-text-primary">{uploadForm.file?.name ?? "No file selected"}</div>
            <div className="mt-1 text-xs text-text-secondary">{uploadForm.parsedItems.length ? `${uploadForm.parsedItems.length} product rows ready to import.` : "Required fields: Product Name, Quantity and Nett Sales. Category and other amount fields are detected when available."}</div>
            {uploadForm.parsedItems.length ? (
              <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs font-semibold text-text-secondary">
                <span className="rounded-full bg-white px-3 py-1">{uploadForm.parsedItems.length} raw rows detected</span>
                <span className="rounded-full bg-white px-3 py-1">{Number(uploadForm.reportMetadata.grouped_product_count ?? 0).toLocaleString()} products after grouping</span>
                <span className="rounded-full bg-white px-3 py-1">{Number(uploadForm.reportMetadata.variant_row_count ?? 0).toLocaleString()} variant rows detected</span>
              </div>
            ) : null}
          </div>
          {uploadForm.parseError ? (
            <div className="mt-4 whitespace-pre-line rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
              {uploadForm.parseError}
            </div>
          ) : null}
          {uploadForm.columnMapping ? (
            <div className="mt-4 rounded-2xl border border-border bg-white p-4">
              <div className="text-sm font-bold text-text-primary">Detected mapping</div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {Object.entries(uploadForm.columnMapping).map(([field, mapping]) => (
                  <div key={field} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                    <span className="font-bold text-text-secondary">{mapping.label}</span>
                    <span className={mapping.detected ? "font-semibold text-text-primary" : "font-semibold text-text-muted"}>
                      {mapping.detected ? `“${mapping.detected}”` : mapping.required ? "Not detected" : "Optional"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {uploadForm.columnMapping && Object.keys(uploadForm.reportMetadata ?? {}).length ? (
            <div className="mt-4 rounded-2xl border border-border bg-slate-50 p-4">
              <div className="text-sm font-bold text-text-primary">Report details detected</div>
              <div className="mt-3 grid gap-2 text-xs font-semibold text-text-secondary md:grid-cols-2">
                {uploadForm.reportMetadata.merchant ? <div>Merchant: <span className="text-text-primary">{uploadForm.reportMetadata.merchant}</span></div> : null}
                {uploadForm.reportMetadata.report_date_range ? <div>Date: <span className="text-text-primary">{uploadForm.reportMetadata.report_date_range}</span></div> : null}
                {uploadForm.reportMetadata.time_range ? <div>Time: <span className="text-text-primary">{uploadForm.reportMetadata.time_range}</span></div> : null}
                {uploadForm.reportMetadata.generated_at ? <div>Generated: <span className="text-text-primary">{uploadForm.reportMetadata.generated_at}</span></div> : null}
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {historyOpen ? (
        <Modal title="Upload History" description="Monthly POS product reports uploaded for accessible outlets." size="xl" onClose={() => setHistoryOpen(false)} footer={<button className="btn-primary" type="button" onClick={() => setHistoryOpen(false)}>Done</button>}>
          <DataTable
            columns={[
              { key: "outlet", header: "Outlet", render: (row) => activeOutlets.find((outlet) => outlet.id === row.outlet_id)?.name ?? "Unknown Outlet" },
              { key: "month", header: "Month", render: (row) => monthLabel(row.report_month) },
              { key: "year", header: "Year", render: (row) => row.report_year },
              { key: "file_name", header: "File Name" },
              { key: "uploaded_by", header: "Uploaded By", render: (row) => row.uploaded_by || "—" },
              { key: "uploaded_at", header: "Uploaded At", render: (row) => row.uploaded_at ? new Date(row.uploaded_at).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" }) : "—" },
              { key: "rows", header: "Rows Imported", align: "right", render: (row) => Number(row.raw_metadata?.row_count ?? 0).toLocaleString() },
              { key: "total", header: "Total Net Sales", align: "right", render: (row) => toCurrency(row.total_net_sales) },
              { key: "status", header: "Status", render: (row) => <Badge tone="success">{row.status}</Badge> },
              { key: "actions", header: "Actions", align: "right", render: (row) => (
                <div className="flex justify-end gap-2">
                  <button className="btn-secondary h-8 text-xs" type="button" onClick={() => { setOutletId(row.outlet_id); setMonth(row.report_month); setYear(row.report_year); setHistoryOpen(false); }}>View</button>
                  {canManageReports ? <button className="btn-secondary h-8 text-xs" type="button" onClick={() => {
                    setUploadForm({ outletId: row.outlet_id, month: row.report_month, year: row.report_year, file: null, parsedItems: [], columnMapping: null, reportMetadata: {}, parseError: "" });
                    setHistoryOpen(false);
                    setUploadModal(true);
                  }}>Replace</button> : null}
                  {canManageReports ? <button className="btn-danger h-8 text-xs" type="button" onClick={() => deleteReport(row)}>Delete</button> : null}
                </div>
              ) },
            ]}
            rows={historyReports}
            getRowKey={(row) => row.id}
          />
        </Modal>
      ) : null}
    </div>
  );
}
