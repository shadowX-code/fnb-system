import { useEffect, useState } from "react";

const storageKey = "salesPurchase.periodFilters";

function loadSavedFilters(store) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    const outletExists = store.outlets.some((outlet) => outlet.id === saved.outletId);
    return {
      outletId: outletExists ? saved.outletId : store.outlets[0]?.id ?? "",
      month: Number(saved.month) || 5,
      year: Number(saved.year) || 2026,
    };
  } catch {
    return { outletId: store.outlets[0]?.id ?? "", month: 5, year: 2026 };
  }
}

export default function usePeriodFilters(store) {
  const initial = loadSavedFilters(store);
  const [outletId, setOutletId] = useState(initial.outletId);
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);

  useEffect(() => {
    if (!store.outlets.length) return;
    const outletExists = store.outlets.some((outlet) => outlet.id === outletId);
    if (!outletExists) setOutletId(store.outlets[0]?.id ?? "");
  }, [outletId, store.outlets]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify({ outletId, month, year }));
  }, [month, outletId, year]);

  return { outletId, setOutletId, month, setMonth, year, setYear };
}
