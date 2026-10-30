import { useEffect, useState } from "react";
import { factoryPerformanceSnapshot, isFactoryTraceEnabled, recordFactoryPerformance, observeFactoryResources } from "../utils/factoryRuntimePerformance.js";

export default function FactoryPerformanceDiagnostics({ route }) {
  const enabled = isFactoryTraceEnabled() && new URLSearchParams(window.location.search).get("qa") === "factory-performance";
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    let timer;
    const update = () => { clearTimeout(timer); timer = setTimeout(() => setEntries(factoryPerformanceSnapshot()), 100); };
    window.addEventListener("feedx:factory-runtime", update);
    const stopResources = observeFactoryResources();
    update();
    return () => { stopResources(); clearTimeout(timer); window.removeEventListener("feedx:factory-runtime", update); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const started = performance.now();
    let done = false;
    let frame;
    let armed = false;
    const check = () => {
      if (!armed || done || ![...document.querySelectorAll("main table tbody tr")].some(row => row.innerText.trim() && !/loading/i.test(row.innerText))) return;
      done = true;
      recordFactoryPerformance({ type: "first-data-row", route, durationMs: Math.round(performance.now() - started), documentMs: Math.round(performance.now()), at: Date.now() });
      frame = requestAnimationFrame(() => requestAnimationFrame(() => recordFactoryPerformance({ type: "interactive-proxy", route, durationMs: Math.round(performance.now() - started), at: Date.now() })));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
    frame = requestAnimationFrame(() => { armed = true; check(); });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [route, enabled]);
  if (!enabled) return null;
  return <details className="border-t border-border p-3 text-xs"><summary>Factory performance diagnostics</summary><p>Local metadata only. First data row and two-frame interactivity proxy exclude earlier authentication. React timings require a profiling build. Body → service completion includes SDK/JSON processing, not a separate pure parse measurement.</p><pre aria-label="Factory performance metadata" className="max-h-80 overflow-auto">{JSON.stringify(entries, null, 2)}</pre></details>;
}
