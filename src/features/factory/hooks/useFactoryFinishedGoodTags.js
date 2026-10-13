import { useCallback, useEffect, useRef, useState } from "react";
import { factoryService } from "../../../services/factoryService.js";

export default function useFactoryFinishedGoodTags(enabled) {
  const [state, setState] = useState({ tags: [], assignments: [], loading: true, error: "" });
  const owner = useRef(0);
  const reload = useCallback(async () => {
    const request = ++owner.current;
    setState(current => ({ ...current, loading: true, error: "" }));
    try {
      const result = await factoryService.getFinishedGoodTags();
      if (request === owner.current) setState({ ...result, loading: false, error: "" });
      return result;
    } catch (error) {
      if (request === owner.current) setState(current => ({ ...current, loading: false, error: "Unable to load tags. Please retry." }));
      throw error;
    }
  }, []);
  useEffect(() => {
    if (enabled) reload().catch(() => {});
    else setState({ tags: [], assignments: [], loading: false, error: "" });
    return () => { owner.current += 1; };
  }, [enabled, reload]);
  return { ...state, reload };
}
