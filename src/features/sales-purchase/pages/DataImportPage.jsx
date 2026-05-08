import { useState } from "react";
import { Download } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import { operationsService } from "../services/operationsService.js";

export default function DataImportPage({ store, setStore, ui }) {
  const [importType, setImportType] = useState("Sales");
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState(null);
  function runUpload() {
    setProgress(12);
    setSummary(null);
    const steps = [34, 68, 100];
    steps.forEach((value, index) => {
      window.setTimeout(() => {
        setProgress(value);
        if (value === 100) {
          const result = operationsService.addImportRun(store, importType, `${importType}_May2026.xlsx`);
          setStore(result.state);
          setSummary({ imported: 42, failed: 2 });
          ui.notify({ title: "Import complete", message: `${importType} import finished with mock summary.` });
        }
      }, 450 * (index + 1));
    });
  }
  const columns = [
    { key: "file_name", header: "File" },
    { key: "import_type", header: "Type" },
    { key: "created_at", header: "Imported At", render: (row) => new Date(row.created_at).toLocaleString() },
    { key: "imported_by", header: "Imported By" },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "success" ? "success" : "danger"}>{row.status}</Badge> },
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
      <Card title="Import Data" description="UI skeleton for future Excel / CSV import workflows.">
        <div className="p-5">
          <div className="mb-4 flex gap-2">
            <button className={`h-10 rounded-xl px-4 text-sm font-semibold ${importType === "Sales" ? "bg-primary text-white" : "bg-white text-text-secondary"}`} onClick={() => setImportType("Sales")}>Import Sales</button>
            <button className={`h-10 rounded-xl px-4 text-sm font-semibold ${importType === "Purchases" ? "bg-primary text-white" : "bg-white text-text-secondary"}`} onClick={() => setImportType("Purchases")}>Import Purchases</button>
          </div>
          <button onClick={runUpload} className="w-full rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-10 text-center transition hover:bg-indigo-50">
            <Download className="mx-auto text-primary" size={28} />
            <div className="mt-3 text-sm font-bold">Drag & drop file here</div>
            <div className="mt-1 text-sm text-text-secondary">Click to simulate uploading an Excel file.</div>
          </button>
          {progress ? (
            <div className="mt-5">
              <div className="mb-2 flex justify-between text-xs font-semibold text-text-secondary"><span>Import progress</span><span>{progress}%</span></div>
              <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
            </div>
          ) : null}
          {summary ? <div className="mt-4 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">Imported {summary.imported} rows. {summary.failed} rows need review.</div> : null}
        </div>
      </Card>
      <Card title="Import Guidelines" action={<button className="btn-secondary" onClick={() => ui.notify({ title: "Template downloaded", message: "Mock template action completed." })}><Download size={16} /> Template</button>}>
        <div className="space-y-3 p-5 text-sm text-text-secondary">
          <p>Use outlet code, month, year, structured supplier and channel names.</p>
          <p>Amounts must be numeric. Negative values are only expected for adjustments.</p>
          <p>Review import summary before locking the month.</p>
        </div>
      </Card>
      <Card title="Recent Imports" className="xl:col-span-2">
        <DataTable columns={columns} rows={store.importRuns} getRowKey={(row) => row.id} />
      </Card>
    </div>
  );
}
