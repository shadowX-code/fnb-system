import { useCallback, useEffect, useRef } from "react";

// Prevent a previous route/tab request from replacing newer visible state.
export default function useFactoryLatestRequest() {
  const requestRef = useRef(0);

  const run = useCallback(async (load, { onStart, onSuccess, onError, onFinally } = {}) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    onStart?.();
    try {
      const result = await load();
      if (requestRef.current === requestId) onSuccess?.(result);
      return result;
    } catch (error) {
      if (requestRef.current === requestId) onError?.(error);
      return undefined;
    } finally {
      if (requestRef.current === requestId) onFinally?.();
    }
  }, []);

  useEffect(() => () => { requestRef.current += 1; }, []);
  return run;
}
