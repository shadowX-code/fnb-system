import { useCallback, useEffect, useRef, useState } from "react";
import { hasCompleteEmployeeBankInfo } from "../../../constants/malaysiaBanks.js";
import { employeeService } from "../../../services/employeeService.js";

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
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);
  return { forEmployee: id => state?.key === key ? {error:state.error, employee:state.employees?.find(e => e.id === id)} : null, refresh,
    missingCount: state?.key === key && !state.error ? state.employees?.filter(e => !hasCompleteEmployeeBankInfo(e)).length : null };
}
