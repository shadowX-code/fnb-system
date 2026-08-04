import { useEffect, useMemo, useRef, useState } from "react";
import AlertTriangle from "lucide-react/dist/esm/icons/alert-triangle";

const PAGE_SIZES = [20, 50, 100];

function storedPageSize(storageKey, fallback) {
  if (typeof window === "undefined") return fallback;
  const value = Number(window.localStorage.getItem(`factory.pagination.${storageKey}`));
  return PAGE_SIZES.includes(value) ? value : fallback;
}

export function factoryPageItems(page, totalPages) {
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const visible = [...pages].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  const items = [];
  visible.forEach((value, index) => {
    if (index && value - visible[index - 1] > 1) items.push(`ellipsis-${value}`);
    items.push(value);
  });
  return items;
}

export function useFactoryPagedQuery({ storageKey, enabled = true, querySignature, loadPage, defaultPageSize = 20, onError }) {
  const [state, setState] = useState(() => {
    const pageSize = storedPageSize(storageKey, defaultPageSize);
    return {
      rows: [],
      summary: {},
      requestedPage: 1,
      requestedPageSize: pageSize,
      loadedPage: 1,
      loadedPageSize: pageSize,
      loadedTotal: 0,
      loadedQuerySignature: "",
      hasLoaded: false,
      loading: false,
      error: "",
      retryToken: 0,
    };
  });
  const requestRef = useRef(0);
  const loadPageRef = useRef(loadPage);
  const onErrorRef = useRef(onError);
  loadPageRef.current = loadPage;
  onErrorRef.current = onError;

  useEffect(() => {
    const pageSize = storedPageSize(storageKey, defaultPageSize);
    setState((current) => ({
      ...current,
      rows: [],
      summary: {},
      requestedPage: 1,
      requestedPageSize: pageSize,
      loadedPage: 1,
      loadedPageSize: pageSize,
      loadedTotal: 0,
      loadedQuerySignature: "",
      hasLoaded: false,
      loading: false,
      error: "",
    }));
  }, [defaultPageSize, storageKey]);

  useEffect(() => {
    setState((current) => ({ ...current, requestedPage: 1 }));
  }, [querySignature]);

  useEffect(() => {
    if (!enabled) return undefined;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let active = true;
    const requestedPage = state.requestedPage;
    const requestedPageSize = state.requestedPageSize;
    setState((current) => ({ ...current, loading: true }));
    Promise.resolve(loadPageRef.current({ page: requestedPage, pageSize: requestedPageSize }))
      .then((result) => {
        if (!active || requestRef.current !== requestId) return;
        const totalCount = Number(result.totalCount || 0);
        const pageSize = Number(result.pageSize || requestedPageSize);
        const page = Number(result.page || requestedPage);
        const lastPage = Math.max(1, Math.ceil(totalCount / pageSize));
        if (page > lastPage) {
          setState((current) => ({ ...current, requestedPage: lastPage, loading: true }));
          return;
        }
        setState((current) => ({
          ...current,
          rows: result.rows || [],
          summary: result.summary || {},
          requestedPage: page,
          requestedPageSize: pageSize,
          loadedPage: page,
          loadedPageSize: pageSize,
          loadedTotal: totalCount,
          loadedQuerySignature: querySignature,
          hasLoaded: true,
          loading: false,
          error: "",
        }));
      })
      .catch((error) => {
        if (!active || requestRef.current !== requestId) return;
        setState((current) => ({ ...current, loading: false, error: error?.message || "Unable to load records." }));
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
      const normalized = PAGE_SIZES.includes(Number(pageSize)) ? Number(pageSize) : defaultPageSize;
      if (typeof window !== "undefined") window.localStorage.setItem(`factory.pagination.${storageKey}`, String(normalized));
      setState((current) => ({ ...current, requestedPage: 1, requestedPageSize: normalized }));
    },
    retry() {
      setState((current) => ({ ...current, retryToken: current.retryToken + 1 }));
    },
  }), [defaultPageSize, storageKey]);

  return [state, actions];
}

export function useFactoryClientPagination(storageKey, totalRows, defaultPageSize = 20, resetKey = "") {
  const [pageSize, setPageSizeState] = useState(() => storedPageSize(storageKey, defaultPageSize));
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);
  useEffect(() => {
    setPage(1);
  }, [resetKey]);
  return {
    page,
    pageSize,
    totalPages,
    from: totalRows ? (page - 1) * pageSize : 0,
    to: Math.min(page * pageSize, totalRows),
    setPage: (value) => setPage(Math.max(1, Math.min(Number(value) || 1, totalPages))),
    setPageSize(value) {
      const normalized = PAGE_SIZES.includes(Number(value)) ? Number(value) : defaultPageSize;
      if (typeof window !== "undefined") window.localStorage.setItem(`factory.pagination.${storageKey}`, String(normalized));
      setPageSizeState(normalized);
      setPage(1);
    },
  };
}

export function FactoryTableLoadState({ state, label, onRetry }) {
  return (
    <>
      {state.error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex min-w-0 items-start gap-2 text-sm font-semibold text-amber-900">
            <AlertTriangle className="mt-0.5 shrink-0" size={16} />
            <span>{state.hasLoaded ? `Unable to load the latest ${label}. Showing the last successfully loaded results.` : `Unable to load ${label}.`}</span>
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

export default function FactoryPagination({ page, pageSize, total, loading = false, onPageChange, onPageSizeChange }) {
  if (!total) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = ((page - 1) * pageSize) + 1;
  const to = Math.min(page * pageSize, total);
  const items = factoryPageItems(page, totalPages);
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="hidden items-center justify-between gap-4 md:flex">
        <div className="text-sm font-semibold text-text-secondary">Showing {from.toLocaleString("en-MY")}–{to.toLocaleString("en-MY")} of {total.toLocaleString("en-MY")} records</div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs font-semibold text-text-secondary">
            <span className="whitespace-nowrap">Rows per page</span>
            <select className="rounded-lg border border-border bg-white px-2 py-2 text-xs font-bold text-text-primary" value={pageSize} disabled={loading} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button className="btn-secondary px-3 py-2 text-xs" type="button" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
            {items.map((item) => typeof item === "number" ? (
              <button key={item} className={`h-9 min-w-9 rounded-lg border px-2 text-xs font-bold transition ${item === page ? "border-primary bg-primary text-white" : "border-border bg-white text-text-secondary hover:border-primary hover:text-primary"}`} type="button" disabled={loading} aria-current={item === page ? "page" : undefined} onClick={() => onPageChange(item)}>{item}</button>
            ) : <span key={item} className="px-1 text-sm font-bold text-text-muted">…</span>)}
            <button className="btn-secondary px-3 py-2 text-xs" type="button" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</button>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 md:hidden">
        <button className="btn-secondary px-3 py-2 text-xs" type="button" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</button>
        <span className="text-sm font-bold text-text-secondary">Page {page} of {totalPages}</span>
        <button className="btn-secondary px-3 py-2 text-xs" type="button" disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</button>
      </div>
    </div>
  );
}
