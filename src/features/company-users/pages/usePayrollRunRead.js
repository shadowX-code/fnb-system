import { useCallback, useEffect, useRef, useState } from "react";
import { payrollService } from "../../../services/payrollService.js";

// Run-scoped loading ownership; obsolete successes AND failures cannot replace this scope.
export function usePayrollRunRead(run, revision, enabled = true) {
  const [state, setState] = useState(null);
  const generation = useRef(0);
  const key = run?.id ? `${run.id}:${run.status}` : "";
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    if (!enabled || !key) { setState(null); return null; }
    try {
      const data = ["finalized", "paid"].includes(run.status)
        ? await payrollService.readFinalizedRecord(run.id)
        : await Promise.all([payrollService.readPreparation(run.id), payrollService.readCalculation(run.id), payrollService.readStatutory(run.id)])
          .then(([preparation, calculation, statutory]) => ({ preparation, calculation, statutory }));
      if (generation.current !== request) return null;
      setState({ key, data }); return data;
    } catch (error) {
      if (generation.current === request) setState({ key, error });
      return null;
    }
  }, [enabled, key]);
  useEffect(() => { setState(null); refresh(); return () => { ++generation.current; }; }, [refresh, revision]);
  return { data: state?.key === key ? state.data : null, error: state?.key === key ? state.error ?? null : null, refresh };
}
