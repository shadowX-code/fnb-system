import { useCallback, useEffect, useRef, useState } from "react";
import { payrollService } from "../../../services/payrollService.js";

// Fingerprints/readiness and every amount remain server-owned. Only open-run
// orchestration belongs here; failed commands wait for an explicit retry.
export function usePayrollRunRead(run, revision, enabled = true, canManage = false, canPrepareTime = false) {
  const [state, setState] = useState(null);
  const generation = useRef(0);
  const failures = useRef(new Map());
  const inFlight = useRef(new Map());
  const timeReviewActive = useRef(false);
  const sync = useRef(new Map());
  const dirtyEmployees = useRef(new Set());
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
  const refresh = useCallback(async ({ retryEmployeeId, skipAutomatic = false, retryTimeSync = false } = {}) => {
    if (timeReviewActive.current) return null;
    const request = ++generation.current;
    if (!enabled || !key) { setState(null); return null; }
    setState(previous => previous?.key === key ? {...previous,calculating:true} : previous);
    const read = async () => ["finalized", "paid"].includes(run.status)
      ? payrollService.readFinalizedRecord(run.id)
      : payrollService.readRunEvidence(run.id);
    try {
      // Coalesce the sequence before expensive run projections. Each command
      // validates current canonical fingerprints and open-run authority again.
      if (canManage && !skipAutomatic && ['draft','review_required'].includes(run.status)) {
        for (const id of dirtyEmployees.current) {
          if (!failures.current.has(`${key}:${id}`) || retryEmployeeId === id) {
            try { await recalculateEmployee(id); dirtyEmployees.current.delete(id); }
            catch { /* Keep stale and expose the existing recovery action. */ }
          }
        }
      }
      let data = await read();
      if (generation.current !== request) return null;
      if (retryEmployeeId) failures.current.delete(`${key}:${retryEmployeeId}`);
      const errors = Object.fromEntries([...dirtyEmployees.current].filter(id => failures.current.has(`${key}:${id}`)).map(id => [id,failures.current.get(`${key}:${id}`)]));
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
      const needsSync = data.time?.some(row => row.review_state?.state === 'unreconciled' && row.work_date <= today);
      if (!skipAutomatic && (canPrepareTime || retryTimeSync) && needsSync &&
        ['draft','review_required'].includes(run.status) && !run.foundation_only) {
        let attempt = sync.current.get(key);
        if (!attempt || (retryTimeSync && !attempt.command) || (!attempt.command && !attempt.error)) {
          attempt = {};
          attempt.command = payrollService.prepareRunTime(run.id)
            .then(summary => { attempt.summary = summary; })
            .catch(error => { attempt.error = error; })
            .finally(() => { attempt.command = null; });
          sync.current.set(key, attempt);
        }
        await attempt.command;
        if (generation.current !== request) return null;
        if (!attempt.error) data = await read();
        if (generation.current !== request) return null;
      }
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
      if (generation.current === request) setState(previous => ({ ...previous, key, data: previous?.key === key ? previous.data : null, calculating:false, error,
        calculationErrors:Object.fromEntries([...failures.current].filter(([workKey])=>workKey.startsWith(`${key}:`)).map(([workKey,message])=>[workKey.slice(key.length+1),message])) }));
      return null;
    }
  }, [enabled, key, canManage, canPrepareTime, run?.foundation_only, recalculateEmployee]);
  const setTimeReviewActive = useCallback(active => {
    timeReviewActive.current = active;
    if (active) {
      ++generation.current;
      setState(previous => previous ? {...previous, calculating:false} : previous);
    }
  }, []);
  const invalidateEmployee = useCallback(id => {
    dirtyEmployees.current.add(id);
    const stale = data => data && {...data, results: data.results?.map(row => row.employee_id === id ? {...row,is_stale:true} : row)};
    setState(previous => previous?.key === key ? {...previous, data: {...previous.data,
      calculation:stale(previous.data?.calculation),statutory:stale(previous.data?.statutory)}} : previous);
  }, [key]);
  useEffect(() => { timeReviewActive.current = false; dirtyEmployees.current.clear(); }, [key]);
  useEffect(() => { refresh(); return () => { ++generation.current; }; }, [refresh, revision]);
  useEffect(() => {
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);
  return { data: state?.key === key ? state.data : null, error: state?.key === key ? state.error ?? null : null,
    calculating: state?.key === key && state.calculating === true,
    calculationErrors: state?.key === key ? state.calculationErrors || {} : {},
    timeSyncError: sync.current.get(key)?.error,
    timeSyncSummary: sync.current.get(key)?.summary,
    retryTimeSync: () => refresh({ retryTimeSync: true }),
    retryCalculation: employeeId => refresh({ retryEmployeeId: employeeId }), recalculateEmployee, refresh,
    setTimeReviewActive, invalidateEmployee };
}
