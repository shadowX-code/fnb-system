import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Download, Printer } from "lucide-react";
import Modal from "../feedback/Modal.jsx";
import AdminSegmentedControl from "../forms/AdminSegmentedControl.jsx";
import { a4Dimensions, a4ColumnBands, paginateA4Rows, A4_PX_PER_MM, A4_TABLE_STYLES } from "./a4TableLayout.js";
import { downloadA4TablePdf, printA4Table } from "./a4TableExport.js";
const noSelection = [];
const rowIdentity = row => row.id;

function Sheet({ title, columns, rows, orientation, number, total, subtitle }) {
  const { width, height } = a4Dimensions(orientation);
  const totalWidth = columns.reduce((sum,c) => sum+c.minWidth,0);
  return <article className="a4-sheet" style={{ width: width * A4_PX_PER_MM, height: height * A4_PX_PER_MM }}>
    <header><h3>{title}</h3><p>{subtitle}</p></header><table><colgroup>{columns.map(c => <col key={c.key} style={{ width: c.minWidth / totalWidth * 100 + "%" }} />)}</colgroup><thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map((row,index) => <tr key={row.id || index}>{columns.map(c => <td key={c.key}>{c.value(row) ?? "—"}</td>)}</tr>)}</tbody></table><footer>{number ? `Page ${number} / ${total}` : ""}</footer>
  </article>;
}

export default function A4TableExportModal({ title, rows, columns, sortOptions, selectedIds = noSelection, selectionKey = rowIdentity, subtitle = "", onClose, filename = "export.pdf" }) {
  const [orientation,setOrientation] = useState("landscape"), [scope,setScope] = useState("matching"), [sort,setSort] = useState(sortOptions[0].value);
  const [keys,setKeys] = useState(columns.filter(c=>c.defaultSelected).map(c=>c.key));
  const [pages,setPages] = useState([]), [busy,setBusy] = useState(false), [error,setError] = useState("");
  const measurement = useRef(null), preview = useRef(null), host = useRef(null);
  const [previewWidth,setPreviewWidth] = useState(700);
  const [zoom,setZoom] = useState("fit");
  const ordered = useMemo(() => {
    const result = scope === "selected" ? rows.filter(row => selectedIds.includes(selectionKey(row))) : rows;
    return [...result].sort(sortOptions.find(option => option.value === sort).compare);
  },[rows,scope,selectedIds,selectionKey,sortOptions,sort]);
  const visibleColumns = useMemo(() => columns.filter(c=>keys.includes(c.key)),[columns,keys]);
  const bands = useMemo(() => a4ColumnBands(visibleColumns,orientation),[visibleColumns,orientation]);
  useEffect(() => {
    if (!host.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry])=>setPreviewWidth(entry.contentRect.width));
    observer.observe(host.current); return ()=>observer.disconnect();
  },[]);
  useLayoutEffect(() => {
    let current = true;
    setPages([]); setError("");
    async function measure() {
      await document.fonts?.ready;
      if (!current || !measurement.current) return;
      try {
        const result = [];
        [...measurement.current.children].forEach((sheet,band) => {
          const height = (a4Dimensions(orientation).height-24)*A4_PX_PER_MM - sheet.querySelector("header").getBoundingClientRect().height - sheet.querySelector("thead").getBoundingClientRect().height - 10;
          paginateA4Rows([...sheet.querySelectorAll("tbody tr")].map(row=>row.getBoundingClientRect().height),height).forEach(indices=>result.push({ columns:bands[band], rows:indices.map(i=>ordered[i]) }));
        });
        setPages(result);
      } catch(error) { setError(error.message); }
    }
    measure(); return ()=>{current=false;};
  },[bands,ordered,orientation,subtitle,title]);
  async function exportFile(print) {
    if (busy) return;
    setBusy(true); setError("");
    try { const sheets=[...preview.current.querySelectorAll(".a4-sheet")]; if (print) await printA4Table(sheets,orientation); else await downloadA4TablePdf(sheets,orientation,filename); }
    catch(error) { setError(error.message || "Unable to export. Please retry."); }
    finally { setBusy(false); }
  }
  const dimensions=a4Dimensions(orientation), scale=zoom === "fit" ? Math.min(1,previewWidth/(dimensions.width*A4_PX_PER_MM)) : Number(zoom);
  return <Modal title="Print / Export" description={title} size="3xl" onClose={busy ? undefined : onClose} footer={<><button className="btn-secondary" disabled={busy || !pages.length} onClick={()=>exportFile(true)}><Printer size={16}/> Print</button><button className="btn-primary" disabled={busy || !pages.length} onClick={()=>exportFile(false)}><Download size={16}/> {busy ? "Preparing…" : "Download PDF"}</button></>}>
    <style>{A4_TABLE_STYLES}</style>
    <fieldset disabled={busy} className="mb-4 flex flex-wrap items-end gap-4"><AdminSegmentedControl label="Orientation" value={orientation} onChange={setOrientation} options={[{value:"portrait",label:"Portrait"},{value:"landscape",label:"Landscape"}]} /><label className="text-xs text-text-secondary">Scope<select aria-label="Export scope" className="control mt-1 block" value={scope} onChange={e=>setScope(e.target.value)}><option value="matching">All Matching</option><option value="selected">Selected Products</option></select></label><label className="text-xs text-text-secondary">Sort<select aria-label="Export sort" className="control mt-1 block" value={sort} onChange={e=>setSort(e.target.value)}>{sortOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="text-xs text-text-secondary">Zoom<select aria-label="Preview zoom" className="control mt-1 block" value={zoom} onChange={e=>setZoom(e.target.value)}><option value="fit">Fit</option><option value="1">100%</option><option value="1.5">150%</option></select></label></fieldset>
    <fieldset disabled={busy} className="mb-4 flex flex-wrap gap-x-4 gap-y-2"><legend className="mb-2 text-sm font-semibold">Columns</legend>{columns.map(column=><label className="inline-flex items-center gap-2 text-sm" key={column.key}><input type="checkbox" checked={keys.includes(column.key)} onChange={e=>setKeys(current=>e.target.checked ? [...current,column.key] : current.filter(key=>key!==column.key))}/>{column.label}</label>)}</fieldset>
    <p role="status" className="mb-3 text-xs text-text-secondary">{ordered.length} records · {pages.length} A4 pages{bands.length>1 ? " · Columns continue on additional sheets" : ""}</p>
    {error ? <p role="alert" className="mb-3 text-sm text-text-secondary">{error}</p> : null}
    {!ordered.length ? <p className="py-8 text-center text-sm text-text-secondary">No matching products selected.</p> : null}
    <div ref={measurement} aria-hidden="true" style={{ position:"fixed",left:-20000,top:0,pointerEvents:"none" }}>{bands.map((band,index)=><Sheet key={index} title={title} subtitle={subtitle} columns={band} rows={ordered} orientation={orientation}/>)}</div>
    <div ref={host} className="min-w-0 overflow-x-auto"><div ref={preview} className="space-y-4">{pages.map((page,index)=><div key={index} style={{height:dimensions.height*A4_PX_PER_MM*scale,width:dimensions.width*A4_PX_PER_MM*scale,overflow:"hidden"}}><div style={{transform:`scale(${scale})`,transformOrigin:"top left",width:dimensions.width*A4_PX_PER_MM}}><Sheet {...page} title={title} subtitle={subtitle} orientation={orientation} number={index+1} total={pages.length}/></div></div>)}</div></div>
  </Modal>;
}
