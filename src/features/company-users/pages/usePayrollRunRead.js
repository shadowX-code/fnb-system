import { useCallback, useEffect, useRef, useState } from "react";
import { payrollService } from "../../../services/payrollService.js";

// Fingerprints/readiness and every amount remain server-owned. Only open-run
// orchestration belongs here; failed commands wait for an explicit retry.
export function usePayrollRunRead(run, revision, enabled = true, canManage = false) {
  const [state, setState] = useState(null);
  const generation = useRef(0);
  const failures = useRef(new Map());
  const inFlight = useRef(new Map());
  const key = run?.id ? `${run.id}:${run.status}` : "";
  const recalculateEmployee = useCallback(async id => {
    const workKey = `${key}:${id}`;
    failures.current.delete(workKey);
    let command = inFlight.current.get(workKey);
    if (!command) {
      command = payrollService.recalculateEmployee(run.id, id);
      inFlight.current.set(workKey, command);
    }
    try { return await command; }
    catch (cause) {
      const message = cause.message || 'Unable to calculate Payroll.';
      failures.current.set(workKey, message);
      setState(previous => previous?.key === key ? {...previous, calculationErrors: {...previous.calculationErrors, [id]: message}} : previous);
      throw cause;
    }
    finally { if (inFlight.current.get(workKey) === command) inFlight.current.delete(workKey); }
  }, [key]);
  const refresh = useCallback(async ({ retryEmployeeId, skipAutomatic = false } = {}) => {
    const request = ++generation.current;
    if (!enabled || !key) { setState(null); return null; }
    const read = async () => ["finalized", "paid"].includes(run.status)
      ? payrollService.readFinalizedRecord(run.id)
      : Promise.all([payrollService.readPreparation(run.id), payrollService.readCalculation(run.id), payrollService.readStatutory(run.id)])
        .then(([preparation, calculation, statutory]) => ({ preparation, calculation, statutory }));
    try {
      let data = await read();
      if (generation.current !== request) return null;
      if (retryEmployeeId) failures.current.delete(`${key}:${retryEmployeeId}`);
      const errors = {};
      const attempted = new Set();
      if (canManage && !skipAutomatic && ["draft", "review_required"].includes(run.status) && !run.foundation_only) {
        setState({ key, data, calculating: true });
        for (const member of data.preparation?.results || []) {
          if (generation.current !== request) return null;
          const id = member.employee_id;
          const calculation = data.calculation?.results?.find(row => row.employee_id === id);
          const statutory = data.statutory?.results?.find(row => row.employee_id === id);
          const workKey = `${key}:${id}`;
          if (!calculation || !statutory || calculation.is_stale || statutory.is_stale) {
            if (!failures.current.has(workKey)) {
              attempted.add(id);
              try { await recalculateEmployee(id); }
              catch { /* Recovery is explicit; the shared command retains its error. */ }
            }
            if (failures.current.has(workKey)) errors[id] = failures.current.get(workKey);
          } else failures.current.delete(workKey);
        }
        if (attempted.size && generation.current === request) data = await read();
      }
      if (generation.current !== request) return null;
      for (const member of data.preparation?.results || []) {
        const id = member.employee_id;
        const calculation = data.calculation?.results?.find(row => row.employee_id === id);
        const statutory = data.statutory?.results?.find(row => row.employee_id === id);
        if (calculation && statutory && !calculation.is_stale && !statutory.is_stale) {
          failures.current.delete(`${key}:${id}`); delete errors[id];
        } else if (attempted.has(id) && !failures.current.has(`${key}:${id}`)) {
          const message = 'Inputs changed during calculation. Retry Calculation to use the latest evidence.';
          failures.current.set(`${key}:${id}`, message); errors[id] = message;
        }
      }
      setState({ key, data, calculationErrors: errors }); return data;
    } catch (error) {
      if (generation.current === request) setState(previous => ({ key, data: previous?.key === key ? previous.data : null, error }));
      return null;
    }
  }, [enabled, key, canManage, run?.foundation_only, recalculateEmployee]);
  useEffect(() => { refresh(); return () => { ++generation.current; }; }, [refresh, revision]);
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return { data: state?.key === key ? state.data : null, error: state?.key === key ? state.error ?? null : null,
    calculating: state?.key === key && state.calculating === true,
    calculationErrors: state?.key === key ? state.calculationErrors || {} : {},
    retryCalculation: employeeId => refresh({ retryEmployeeId: employeeId }), recalculateEmployee, refresh };
}
