import { useEffect, useMemo, useRef, useState } from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import FloatingLayer from "../../../components/ui/FloatingLayer.jsx";

const PAGE_SIZES = [20, 50, 100];

function validPageSize(value, fallback = 20) {
  const normalizedFallback = PAGE_SIZES.includes(Number(fallback)) ? Number(fallback) : 20;
  return PAGE_SIZES.includes(Number(value)) ? Number(value) : normalizedFallback;
}

function nonNegativeTotal(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}

function positivePage(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 1 ? Math.trunc(numeric) : 1;
}

function PageSizeSelect({ value, loading, onChange }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, PAGE_SIZES.indexOf(value)));
  const anchorRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);

  useEffect(() => {
    if (!open) return undefined;
    const selectedIndex = Math.max(0, PAGE_SIZES.indexOf(value));
    setActiveIndex(selectedIndex);
    const frame = window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, value]);

  function selectPageSize(pageSize) {
    onChange?.(pageSize);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(direction) {
    const next = (activeIndex + direction + PAGE_SIZES.length) % PAGE_SIZES.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  }

  function handleOpenChange(nextOpen) {
    setOpen(nextOpen);
    if (!nextOpen) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function handleTriggerKeyDown(event) {
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    setOpen(true);
  }

  function handleMenuKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : PAGE_SIZES.length - 1;
      setActiveIndex(next);
      optionRefs.current[next]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPageSize(PAGE_SIZES[activeIndex]);
    }
  }

  return (
    <div ref={anchorRef} className="relative w-[72px] shrink-0">
      <button
        ref={triggerRef}
        className={`flex h-9 w-full items-center justify-between gap-1.5 rounded-lg border bg-surface px-2.5 text-xs font-bold text-text-primary transition focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-70 disabled:text-text-muted ${open ? "border-primary/40 shadow-sm" : "border-border hover:border-slate-300 hover:bg-slate-50"}`}
        type="button"
        aria-label="Rows per page"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={loading}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{value}</span>
        <ChevronDown className={`shrink-0 text-text-muted transition ${open ? "rotate-180" : ""}`} size={14} />
      </button>
      <FloatingLayer
        open={open}
        onOpenChange={handleOpenChange}
        anchorRef={anchorRef}
        align="end"
        minWidth={104}
        estimatedHeight={126}
        placement="auto"
        focusOnOpen
        className="rounded-xl p-1.5"
      >
        <div role="listbox" aria-label="Rows per page" className="space-y-1" onKeyDown={handleMenuKeyDown}>
          {PAGE_SIZES.map((size, index) => {
            const selected = size === value;
            return (
              <button
                key={size}
                ref={(node) => { optionRefs.current[index] = node; }}
                className={`flex h-8 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-xs font-bold transition focus:outline-none focus:ring-2 focus:ring-primary/15 ${selected ? "bg-emerald-50 text-emerald-800" : "text-text-secondary hover:bg-emerald-50/60 hover:text-text-primary"}`}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={index === activeIndex ? 0 : -1}
                onFocus={() => setActiveIndex(index)}
                onClick={() => selectPageSize(size)}
              >
                <span>{size}</span>
                {selected ? <Check className="text-emerald-600" size={13} strokeWidth={3} /> : null}
              </button>
            );
          })}
        </div>
      </FloatingLayer>
    </div>
  );
}

function storedPageSize(storageKey, fallback) {
  if (typeof window === "undefined") return validPageSize(fallback);
  const value = Number(window.localStorage.getItem(`factory.pagination.${storageKey}`));
  return validPageSize(value, fallback);
}

export function factoryPageItems(page = 1, totalPages = 1) {
  const safeTotalPages = positivePage(totalPages);
  const safePage = Math.min(positivePage(page), safeTotalPages);
  const pages = new Set([1, safeTotalPages, safePage - 1, safePage, safePage + 1]);
  const visible = [...pages].filter((value) => value >= 1 && value <= safeTotalPages).sort((a, b) => a - b);
  const items = [];
  visible.forEach((value, index) => {
    if (index && value - visible[index - 1] > 1) items.push(`ellipsis-${value}`);
    items.push(value);
  });
  return items;
}

export function useFactoryPagedQuery({ storageKey, enabled = true, querySignature, loadPage, defaultPageSize = 20, onError, shouldClearOnError, mapError }) {
  const [state, setState] = useState(() => {
    const pageSize = storedPageSize(storageKey, defaultPageSize);
    return {
      rows: [],
      summary: {},
      summaryError: "",
      requestedPage: 1,
      requestedPageSize: pageSize,
      loadedPage: 1,
      loadedPageSize: pageSize,
      loadedTotal: 0,
      loadedQuerySignature: "",
      loadedStorageKey: "",
      hasLoaded: false,
      loading: false,
      error: "",
      errorKind: "",
      retryToken: 0,
    };
  });
  const requestRef = useRef(0);
  const stateRef = useRef(state);
  const querySignatureRef = useRef(querySignature);
  const skipNextLoadKeyRef = useRef("");
  const loadPageRef = useRef(loadPage);
  const onErrorRef = useRef(onError);
  const shouldClearOnErrorRef = useRef(shouldClearOnError);
  const mapErrorRef = useRef(mapError);
  loadPageRef.current = loadPage;
  onErrorRef.current = onError;
  shouldClearOnErrorRef.current = shouldClearOnError;
  mapErrorRef.current = mapError;
  stateRef.current = state;
  querySignatureRef.current = querySignature;

  useEffect(() => {
    const pageSize = storedPageSize(storageKey, defaultPageSize);
    setState((current) => ({
      ...current,
      rows: [],
      summary: {},
      summaryError: "",
      requestedPage: 1,
      requestedPageSize: pageSize,
      loadedPage: 1,
      loadedPageSize: pageSize,
      loadedTotal: 0,
      loadedQuerySignature: "",
      loadedStorageKey: "",
      hasLoaded: false,
      loading: false,
      error: "",
      errorKind: "",
    }));
  }, [defaultPageSize, storageKey]);

  useEffect(() => {
    setState((current) => ({ ...current, requestedPage: 1 }));
  }, [querySignature]);

  useEffect(() => {
    const loadKey = JSON.stringify([querySignature, state.requestedPage, state.requestedPageSize]);
    if (skipNextLoadKeyRef.current === loadKey) {
      skipNextLoadKeyRef.current = "";
      return undefined;
    }
    if (!enabled) {
      requestRef.current += 1;
      setState((current) => current.loading ? { ...current, loading: false } : current);
      return undefined;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let active = true;
    const requestedPage = state.requestedPage;
    const requestedPageSize = state.requestedPageSize;
    setState((current) => ({ ...current, loading: true }));
    Promise.resolve(loadPageRef.current({ page: requestedPage, pageSize: requestedPageSize }))
      .then((result) => {
        if (!active || requestRef.current !== requestId) return;
        const payload = result && typeof result === "object" ? result : {};
        const totalCount = nonNegativeTotal(payload.totalCount);
        const pageSize = validPageSize(payload.pageSize, requestedPageSize);
        const page = positivePage(payload.page || requestedPage);
        const lastPage = Math.max(1, Math.ceil(totalCount / pageSize));
        if (page > lastPage) {
          setState((current) => ({ ...current, requestedPage: lastPage, loading: true }));
          return;
        }
        setState((current) => ({
          ...current,
          rows: Array.isArray(payload.rows) ? payload.rows : [],
          summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
          summaryError: payload.summaryError ? "Unable to load summary." : "",
          requestedPage: page,
          requestedPageSize: pageSize,
          loadedPage: page,
          loadedPageSize: pageSize,
          loadedTotal: totalCount,
          loadedQuerySignature: querySignature,
          loadedStorageKey: storageKey,
          hasLoaded: true,
          loading: false,
          error: "",
          errorKind: "",
        }));
      })
      .catch((error) => {
        if (!active || requestRef.current !== requestId) return;
        const mappedError = mapErrorRef.current?.(error) || {};
        const errorKind = mappedError.kind === "permission" ? "permission" : "load";
        const errorMessage = mappedError.message || "Unable to load records.";
        setState((current) => shouldClearOnErrorRef.current?.(error)
          ? {
              ...current,
              rows: [],
              summary: {},
              summaryError: "",
              loadedTotal: 0,
              loadedQuerySignature: "",
              loadedStorageKey: "",
              hasLoaded: false,
              loading: false,
              error: errorMessage,
              errorKind,
            }
          : { ...current, loading: false, error: errorMessage, errorKind });
        onErrorRef.current?.(error);
      });
    return () => {
      active = false;
    };
  }, [enabled, querySignature, state.requestedPage, state.requestedPageSize, state.retryToken]);

  useEffect(() => () => {
    requestRef.current += 1;
  }, []);

  const actions = useMemo(() => ({
    requestPage(page) {
      setState((current) => ({ ...current, requestedPage: Math.max(1, Number(page) || 1) }));
    },
    requestPageSize(pageSize) {
      const normalized = validPageSize(pageSize, defaultPageSize);
      if (typeof window !== "undefined") window.localStorage.setItem(`factory.pagination.${storageKey}`, String(normalized));
      setState((current) => ({ ...current, requestedPage: 1, requestedPageSize: normalized }));
    },
    retry() {
      setState((current) => ({ ...current, retryToken: current.retryToken + 1 }));
    },
    updateLoadedSnapshot(updater) {
      requestRef.current += 1;
      setState((current) => {
        if (!current.hasLoaded || typeof updater !== "function") return current;
        const update = updater({
          rows: current.rows,
          summary: current.summary,
          total: current.loadedTotal,
          page: current.loadedPage,
          pageSize: current.loadedPageSize,
        }) || {};
        return {
          ...current,
          rows: Array.isArray(update.rows) ? update.rows : current.rows,
          summary: update.summary && typeof update.summary === "object" ? update.summary : current.summary,
          loadedTotal: update.total == null ? current.loadedTotal : nonNegativeTotal(update.total),
          loading: false,
          error: "",
          errorKind: "",
        };
      });
    },
    async refreshNow({ page, pageSize, errorMessage = "Unable to load the latest records." } = {}) {
      const snapshot = stateRef.current;
      const refreshSignature = querySignatureRef.current;
      const pageLoader = loadPageRef.current;
      let targetPage = positivePage(page ?? snapshot.loadedPage ?? snapshot.requestedPage);
      const targetPageSize = validPageSize(pageSize ?? snapshot.loadedPageSize ?? snapshot.requestedPageSize, defaultPageSize);
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      setState((current) => ({ ...current, loading: true }));
      try {
        let result = await pageLoader({ page: targetPage, pageSize: targetPageSize });
        if (requestRef.current !== requestId || querySignatureRef.current !== refreshSignature) return null;
        let payload = result && typeof result === "object" ? result : {};
        let totalCount = nonNegativeTotal(payload.totalCount);
        const normalizedPageSize = validPageSize(payload.pageSize, targetPageSize);
        const lastPage = Math.max(1, Math.ceil(totalCount / normalizedPageSize));
        if (targetPage > lastPage) {
          targetPage = lastPage;
          result = await pageLoader({ page: targetPage, pageSize: normalizedPageSize });
          if (requestRef.current !== requestId || querySignatureRef.current !== refreshSignature) return null;
          payload = result && typeof result === "object" ? result : {};
          totalCount = nonNegativeTotal(payload.totalCount);
        }
        const loadedPage = positivePage(payload.page || targetPage);
        const loadedPageSize = validPageSize(payload.pageSize, normalizedPageSize);
        if (snapshot.requestedPage !== loadedPage || snapshot.requestedPageSize !== loadedPageSize) {
          skipNextLoadKeyRef.current = JSON.stringify([refreshSignature, loadedPage, loadedPageSize]);
        }
        setState((current) => ({
          ...current,
          rows: Array.isArray(payload.rows) ? payload.rows : [],
          summary: payload.summary && typeof payload.summary === "object" ? payload.summary : {},
          summaryError: payload.summaryError ? "Unable to load summary." : "",
          requestedPage: loadedPage,
          requestedPageSize: loadedPageSize,
          loadedPage,
          loadedPageSize,
          loadedTotal: totalCount,
          loadedQuerySignature: refreshSignature,
          loadedStorageKey: storageKey,
          hasLoaded: true,
          loading: false,
          error: "",
          errorKind: "",
        }));
        return payload;
      } catch (error) {
        if (requestRef.current !== requestId || querySignatureRef.current !== refreshSignature) return null;
        const mappedError = mapErrorRef.current?.(error) || {};
        const permissionDenied = shouldClearOnErrorRef.current?.(error);
        const errorKind = mappedError.kind === "permission" ? "permission" : "load";
        setState((current) => permissionDenied
          ? {
              ...current,
              rows: [],
              summary: {},
              summaryError: "",
              loadedTotal: 0,
              loadedQuerySignature: "",
              loadedStorageKey: "",
              hasLoaded: false,
              loading: false,
              error: mappedError.message || "Some data is hidden by your current role.",
              errorKind,
            }
          : { ...current, loading: false, error: errorMessage, errorKind });
        throw error;
      }
    },
    clearForPermission(message = "Some data is hidden by your current role.") {
      requestRef.current += 1;
      setState((current) => ({
        ...current,
        rows: [],
        summary: {},
        summaryError: "",
        loadedTotal: 0,
        loadedQuerySignature: "",
        loadedStorageKey: "",
        hasLoaded: false,
        loading: false,
        error: message,
        errorKind: "permission",
      }));
    },
  }), [defaultPageSize, storageKey]);

  const stateForCurrentListing = state.loadedStorageKey && state.loadedStorageKey !== storageKey
    ? {
        ...state,
        rows: [],
        summary: {},
        summaryError: "",
        loadedTotal: 0,
        loadedQuerySignature: "",
        loadedStorageKey: "",
        hasLoaded: false,
      }
    : state;

  return [stateForCurrentListing, actions];
}

export function useFactoryClientPagination(storageKey, totalRows = 0, defaultPageSize = 20, resetKey = "") {
  const [pageSize, setPageSizeState] = useState(() => storedPageSize(storageKey, defaultPageSize));
  const [page, setPage] = useState(1);
  const safeTotalRows = nonNegativeTotal(totalRows);
  const safePageSize = validPageSize(pageSize, defaultPageSize);
  const totalPages = Math.max(1, Math.ceil(safeTotalRows / safePageSize));
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  return {
    page,
    pageSize: safePageSize,
    totalPages,
    from: safeTotalRows ? (page - 1) * safePageSize : 0,
    to: Math.min(page * safePageSize, safeTotalRows),
    setPage: (value) => setPage(Math.max(1, Math.min(Number(value) || 1, totalPages))),
    setPageSize(value) {
      const normalized = validPageSize(value, defaultPageSize);
      if (typeof window !== "undefined") window.localStorage.setItem(`factory.pagination.${storageKey}`, String(normalized));
      setPageSizeState(normalized);
      setPage(1);
    },
  };
}

export function FactoryTableLoadState({ state, label, onRetry, permissionMessage = "Some data is hidden by your current role.", staleMessage = "" }) {
  const message = state.errorKind === "permission"
    ? permissionMessage
    : state.hasLoaded
      ? staleMessage || `Unable to load the latest ${label}. Showing the last successfully loaded results.`
      : `Unable to load ${label}.`;
  return (
    <>
      {state.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex min-w-0 items-start gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="mt-0.5 shrink-0" size={16} />
            <span>{message}</span>
          </div>
          <button className="btn-secondary px-3 py-1.5 text-xs" type="button" disabled={state.loading} onClick={onRetry}>Retry</button>
        </div>
      ) : null}
      {state.loading ? (
        <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs font-bold text-sky-800">
          {state.hasLoaded && state.requestedPage !== state.loadedPage ? `Loading page ${state.requestedPage}…` : "Updating results…"}
        </div>
      ) : null}
    </>
  );
}

export default function FactoryPagination({ page = 1, pageSize = 20, total = 0, loading = false, noun = "records", onPageChange, onPageSizeChange }) {
  const safeTotal = nonNegativeTotal(total);
  if (!safeTotal) return null;
  const safePageSize = validPageSize(pageSize);
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safePage = Math.min(positivePage(page), totalPages);
  const from = ((safePage - 1) * safePageSize) + 1;
  const to = Math.min(safePage * safePageSize, safeTotal);
  const items = factoryPageItems(safePage, totalPages);
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="hidden items-center justify-between gap-4 md:flex">
        <div className="text-sm font-semibold text-text-secondary">Showing {from.toLocaleString("en-MY")}–{to.toLocaleString("en-MY")} of {safeTotal.toLocaleString("en-MY")}{noun ? ` ${noun}` : ""}</div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
            <span className="whitespace-nowrap">Rows per page</span>
            <PageSizeSelect value={safePageSize} loading={loading} onChange={onPageSizeChange} />
          </div>
          <div className="flex items-center gap-1">
            <button className="btn-secondary px-3 py-2 text-xs" type="button" disabled={loading || safePage <= 1} onClick={() => onPageChange?.(safePage - 1)}>Previous</button>
            {items.map((item) => typeof item === "number" ? (
              <button key={item} className={`h-9 min-w-9 rounded-lg border px-2 text-xs font-bold transition ${item === safePage ? "border-primary bg-primary text-white" : "border-border bg-surface text-text-secondary hover:border-primary hover:text-primary"}`} type="button" disabled={loading} aria-current={item === safePage ? "page" : undefined} onClick={() => onPageChange?.(item)}>{item}</button>
            ) : <span key={item} className="px-1 text-sm font-bold text-text-muted">…</span>)}
            <button className="btn-secondary px-3 py-2 text-xs" type="button" disabled={loading || safePage >= totalPages} onClick={() => onPageChange?.(safePage + 1)}>Next</button>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 md:hidden">
        <button className="btn-secondary px-3 py-2 text-xs" type="button" disabled={loading || safePage <= 1} onClick={() => onPageChange?.(safePage - 1)}>Previous</button>
        <span className="text-sm font-bold text-text-secondary">Page {safePage} of {totalPages}</span>
        <button className="btn-secondary px-3 py-2 text-xs" type="button" disabled={loading || safePage >= totalPages} onClick={() => onPageChange?.(safePage + 1)}>Next</button>
      </div>
    </div>
  );
}
