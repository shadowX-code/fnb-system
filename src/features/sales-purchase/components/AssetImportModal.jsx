import { useState } from "react";
import { Download, UploadCloud } from "lucide-react";
import Modal from "../../../components/feedback/Modal.jsx";
import Badge from "../../../components/ui/Badge.jsx";
import MetricCard from "../../../components/ui/MetricCard.jsx";
import { assetImportColumns, buildAssetImportPreview, csvEscape, downloadTextFile, parseCsv, parseXlsx } from "../utils/assetImport.js";

function titleCase(value) {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function AssetImportModal({ assets, outlets, categories, onClose, onImport }) {
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
      setPreview(buildAssetImportPreview(parsed.rows, { assets, outlets, categories }));
    } catch (parseError) {
      setError(parseError.message || "Unable to parse import file.");
    }
  }

  function downloadTemplate() {
    const text = [
      assetImportColumns.join(","),
      ["Noodle Plate", "AST-PLATE-001", "FC", "Kitchenware", "20", "5", "Good", "Dry rack", "2026-05-30", "", "Active", "Standard noodle plate", ""].map(csvEscape).join(","),
    ].join("\n");
    downloadTextFile("feedx-asset-tracking-template.csv", text);
  }

  async function confirmImport() {
    setError("");
    setIsImporting(true);
    try {
      setComplete(await onImport(preview));
    } catch (importError) {
      setError(importError.message || "Unable to import asset records.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <Modal title="Import Assets" description="Upload CSV or XLSX, validate rows, preview changes, then import valid asset records." size="xl" onClose={onClose} footer={(
      <><button className="btn-secondary" type="button" onClick={onClose}>Close</button><button className="btn-primary" type="button" disabled={!validRows.length || Boolean(complete) || isImporting} onClick={confirmImport}>{isImporting ? "Importing..." : "Confirm Import"}</button></>
    )}>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-6 text-center transition hover:bg-primary/10">
            <UploadCloud size={22} className="text-primary" />
            <span className="mt-2 type-body-sm font-bold text-text-primary">{fileName || "Upload CSV or XLSX"}</span>
            <span className="type-caption text-text-secondary">Required: Asset Name, Outlet Code, Category, Quantity</span>
            <input className="sr-only" type="file" accept=".csv,.xlsx" onChange={(event) => handleFile(event.target.files?.[0])} />
          </label>
          <button className="btn-secondary" type="button" onClick={downloadTemplate}><Download size={15} /> Download Template</button>
        </div>
        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 type-body-sm font-semibold text-rose-700">{error}</div> : null}
        {preview.length ? <>
          <div className="grid gap-3 sm:grid-cols-3"><MetricCard label="Rows" value={preview.length} helper="Parsed from file" /><MetricCard label="Valid" value={validRows.length} helper="Ready to import" tone="success" /><MetricCard label="Failed" value={failedRows.length} helper="Can be skipped" tone={failedRows.length ? "danger" : "success"} /></div>
          <div className="overflow-x-auto rounded-2xl border border-border"><table className="w-full min-w-[980px] text-left"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-text-muted"><tr>{["Row", "Asset Name", "Outlet", "Category", "Quantity", "Condition", "Status", "Action", "Validation"].map((heading) => <th key={heading} className={heading === "Row" ? "px-3 py-2" : ""}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-border text-[13px]">{preview.slice(0, 120).map((row) => <tr key={row.rowNumber} className={row.errors.length ? "bg-rose-50/60" : "bg-white"}><td className="px-3 py-2 font-mono text-xs">{row.rowNumber}</td><td className="font-bold text-text-primary">{row.display.assetName || "-"}</td><td>{row.display.outlet || "-"}</td><td>{row.display.category || "-"}</td><td>{row.display.quantity || "-"}</td><td>{row.display.condition || "-"}</td><td>{row.display.status || "-"}</td><td><Badge tone={row.action === "error" ? "danger" : row.action === "create" ? "success" : "info"}>{row.action === "error" ? "Error" : titleCase(row.action)}</Badge></td><td className={row.errors.length ? "text-rose-700" : "text-emerald-700"}>{row.errors.length ? row.errors.join("; ") : "Ready"}</td></tr>)}</tbody></table></div>
          {complete ? <div className={`rounded-2xl border p-3 type-body-sm font-semibold ${complete.failed ? "border-amber-200 bg-amber-50 text-amber-800" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>Import complete: {complete.created} created · {complete.updated} updated · {complete.skipped} skipped · {complete.failed} failed.{complete.failures?.length ? <div className="mt-1 font-medium">{complete.failures.slice(0, 4).map((failure) => `Row ${failure.rowNumber}: ${failure.message}`).join(" · ")}</div> : null}</div> : null}
        </> : null}
      </div>
    </Modal>
  );
}
