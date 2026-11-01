import { useSyncExternalStore } from "react";
import { Download, X } from "lucide-react";
import { clearRecipeFailure, getLatestRecipeFailure, subscribeRecipeFailure } from "../../../services/factoryRecipeDiagnostics.js";
import { formatFactoryDateTime } from "../utils/factoryDates.js";

export default function FactoryRecipeFailureDiagnostics({ auth }) {
  const report = useSyncExternalStore(subscribeRecipeFailure, getLatestRecipeFailure, () => null);
  if (!auth?.isProtectedRole || !auth?.hasPermission?.("factory_product_recipes.view") || !report) return null;
  function download() {
    const current = getLatestRecipeFailure();
    if (!current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "feedx-recipe-read-failure.json";
    link.click();
    URL.revokeObjectURL(url);
  }
  return <aside aria-label="Recipe read diagnostics" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 text-sm">
    <div><p className="font-semibold text-text-primary">Recipe read diagnostic available</p><p className="text-xs text-text-secondary">{formatFactoryDateTime(report.failedAt)} · Latest failure in this tab. Retained for 30 minutes; cleared on reload or sign-out.</p></div>
    <div className="flex gap-2"><button type="button" className="btn-secondary" onClick={download}><Download size={14} /> Export diagnostic report</button><button type="button" className="btn-secondary" onClick={clearRecipeFailure}><X size={14} /> Clear report</button></div>
  </aside>;
}
