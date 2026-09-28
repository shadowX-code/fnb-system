import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeInventoryRevalidation } from "../../../../services/inventoryRevalidation.js";
import { loadInventoryRecipes } from "./inventoryRecipeService.js";

export default function useInventoryRecipesRead({outletId, scopeKey, enabled}) {
  const request = useRef(0);
  const key = outletId + "|" + scopeKey;
  const liveScope = useRef(key);
  liveScope.current = key;
  const [read, setRead] = useState({state: "loading", data: null, error: ""});
  const refresh = useCallback(async () => {
    if (liveScope.current !== key) return;
    const id = ++request.current;
    if (!enabled || !outletId) { setRead({state: "empty", data: null, error: ""}); return; }
    setRead(current => ({...current, state: current.data ? "refreshing" : "loading", error: ""}));
    try {
      const data = await loadInventoryRecipes(outletId);
      if (request.current === id && liveScope.current === key) setRead({state: "complete", data, error: "", key});
    } catch (error) {
      if (request.current === id && liveScope.current === key) setRead({state: error.readState || "error", data: null, error: error.message, key});
    }
  }, [outletId, scopeKey, enabled]);
  useEffect(() => {
    setRead({state: "loading", data: null, error: ""});
    refresh();
    return () => { request.current += 1; };
  }, [refresh]);
  useEffect(() => subscribeInventoryRevalidation(context => {
    if (context?.owner === "recipes") return;
    if (!context?.outletId || context.outletId === outletId) refresh();
  }), [refresh, outletId]);
  return {...(read.key === key ? read : {state: "loading", data: null, error: ""}), refresh};
}
