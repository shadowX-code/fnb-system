import { useCallback, useEffect, useRef, useState } from "react";
import { hasCompleteEmployeeBankInfo } from "../../../constants/malaysiaBanks.js";
import { employeeService, EMPLOYEE_BANK_CHANGE_KEY } from "../../../services/employeeService.js";

// One scoped Employee read shared across Run stages. Focus revalidates edits made
// in canonical People; no persistent cache or Payroll-owned bank mutation.
export function useEmployeeBankRead(runId, employeeIds, enabled = true) {
  const ids = JSON.stringify([...new Set(employeeIds)].sort());
  const key = `${runId || ""}:${ids}`;
  const [state, setState] = useState(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!enabled || !runId || !JSON.parse(ids).length) return;
    try {
      const employees = await employeeService.readBankInfo(JSON.parse(ids));
      if (request === generation.current) setState({key, employees});
    } catch { if (request === generation.current) setState({key, error:true}); }
  }, [key, enabled]);
  useEffect(() => { refresh(); return () => { ++generation.current; }; }, [refresh]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const onBankChanged = event => {
      if (event.key !== EMPLOYEE_BANK_CHANGE_KEY) return;
      try { if (JSON.parse(ids).includes(JSON.parse(event.newValue)?.id)) refresh(); } catch { /* Ignore malformed invalidation signals. */ }
    };
    window.addEventListener("storage", onBankChanged);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onBankChanged);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);
  return { forEmployee: id => state?.key === key ? {error:state.error, employee:state.employees?.find(e => e.id === id)} : null, refresh,
    missingCount: state?.key === key && !state.error ? state.employees?.filter(e => !hasCompleteEmployeeBankInfo(e)).length : null };
}
