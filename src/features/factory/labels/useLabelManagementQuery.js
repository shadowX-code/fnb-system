import { useCallback, useEffect, useRef, useState } from "react";
import { factoryLabelService } from "../../../services/factoryLabelService.js";

const EMPTY_LIST = { rows: [], total: 0 };
const POLL_INTERVAL = 10000;

export default function useLabelManagementQuery({ section, page, search, enabled, mutationLock }) {
  const scope = JSON.stringify([section, page, search]);
  const [result, setResult] = useState(null);
  const [now, setNow] = useState(Date.now);
  const refreshRef = useRef(null);
  const refresh = useCallback((options) => refreshRef.current?.(options), []);

  useEffect(() => {
    if (!enabled) return;
    let request;
    function load({ replace = false } = {}) {
      if (request && !replace) return request.promise;
      request?.controller.abort();
      const controller = new AbortController();
      const { signal } = controller;
      const promise = factoryLabelService.management(section, page, search, { signal })
        .then((data) => {
          if (!signal.aborted) setResult({ scope, data, error: "" });
        })
        .catch((error) => {
          if (signal.aborted) return;
          setResult((previous) => ({
            scope,
            data: previous?.scope === scope ? previous.data : null,
            error: error?.message || "Unable to load Label Management.",
          }));
        })
        .finally(() => {
          if (request?.controller === controller) request = null;
        });
      request = { controller, promise };
      return promise;
    }
    refreshRef.current = load;
    load();

    // Status freshness must advance even if the network request is pending or fails.
    setNow(Date.now());
    const timer = section === "printers" ? setInterval(() => {
      setNow(Date.now());
      if (!mutationLock.current) load();
    }, POLL_INTERVAL) : null;
    return () => {
      request?.controller.abort();
      refreshRef.current = null;
      clearInterval(timer);
    };
  }, [enabled, scope, section, page, search, mutationLock]);

  const current = result?.scope === scope ? result : null;
  return {
    data: current?.data || EMPTY_LIST,
    loading: enabled && !current,
    hasData: Boolean(current?.data),
    error: current?.error || "",
    refresh,
    now,
  };
}
