import { useState } from "react";

export default function usePeriodFilters(store) {
  const [outletId, setOutletId] = useState(store.outlets[0]?.id ?? "");
  const [month, setMonth] = useState(5);
  const [year, setYear] = useState(2026);

  return { outletId, setOutletId, month, setMonth, year, setYear };
}
