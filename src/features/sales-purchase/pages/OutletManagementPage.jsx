import { useEffect, useState, useRef } from "react";
import { Plus, Settings, Trash2 } from "lucide-react";
import Badge from "../../../components/ui/Badge.jsx";
import Card from "../../../components/ui/Card.jsx";
import DataTable from "../../../components/tables/DataTable.jsx";
import PageHeader from "../../../components/layout/PageHeader.jsx";
import useAdminLocation from '../../../app/useAdminLocation.js';
import {navigateAdminRoute} from '../../../app/routeOwnership.js';
import OutletEditor from '../../../components/forms/OutletEditor.jsx';
import { outletService } from "../../../services/outletService.js";
import AdminFilterToolbar from "../../../components/layout/AdminFilterToolbar.jsx";
import AdminSearchField from "../../../components/forms/AdminSearchField.jsx";
import SelectField from "../../../components/forms/SelectField.jsx";
import AdminPagination from "../../../components/tables/AdminPagination.jsx";
import {useAuth} from "../../../auth/AuthContext.jsx";
import {brandService} from "../../../services/brandService.js";
import { getOutletTaxConfig } from "../utils/analytics.js";

function latestPeriod(store) {
  const latest = [...store.salesRecords, ...store.purchaseRecords]
    .filter((record) => record.outlet_id)
    .sort((a, b) => (a.year - b.year) || (a.month - b.month))
    .at(-1);
  return { month: latest?.month ?? 1, year: latest?.year ?? new Date().getFullYear() };
}

export default function OutletManagementPage({ store, setStore, ui }) {
  const auth=useAuth();
  const route=useAdminLocation(),requestedOutlet=route?.query?.outletId,handledOutlet=useRef(null);
  const [sourceLinkError,setSourceLinkError]=useState('');
  const [links,setLinks]=useState([]),[linksError,setLinksError]=useState(''),[search,setSearch]=useState(''),[status,setStatus]=useState('active'),[page,setPage]=useState(1),[size,setSize]=useState(20);
  useEffect(()=>{let live=true;brandService.outletBrands().then(r=>{if(live)setLinks(r)}).catch(e=>{if(live)setLinksError(e.message)});return()=>{live=false}},[]);
  useEffect(()=>{setPage(1)},[search,status]);
  const [outlets, setOutlets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [modal, setModal] = useState(null);
  const currentPeriod = latestPeriod(store);
  useEffect(()=>{
    if(!requestedOutlet){handledOutlet.current=null;setSourceLinkError('');return}
    if(loading||loadError||handledOutlet.current===requestedOutlet)return;
    handledOutlet.current=requestedOutlet;
    const target=outlets.find(outlet=>outlet.id===requestedOutlet);
    setModal(target?{mode:'edit',row:target,section:route.query.section||'general'}:null);setSourceLinkError(target?'':'This Outlet is unavailable for your access. Choose an accessible Outlet below.');
  },[requestedOutlet,loading,loadError,outlets]);
  function closeEditor(){setModal(null);if(requestedOutlet)navigateAdminRoute('outlets',{}, {},{replace:true})}


  useEffect(() => {
    let ignore = false;
    async function loadOutlets() {
      setLoading(true);
      setLoadError("");
      try {
        const rows = await outletService.listOutlets();
        if (ignore) return;
        setOutlets(rows);
        setStore((current) => ({ ...current, outlets: rows.filter((outlet) => outlet.is_active) }));
      } catch (error) {
        console.error("Unable to load outlets", error);
        if (!ignore) setLoadError(error.message || "Unable to load outlets.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }
    loadOutlets();
    return () => {
      ignore = true;
    };
  }, [setStore]);

  const rows=outlets.filter(o=>(!status||o.status===status)&&(!search||[o.name,o.code,o.location].join(' ').toLowerCase().includes(search.toLowerCase())));
  const safePage=Math.min(page,Math.max(1,Math.ceil(rows.length/size)));
  const columns = [
    { key: "name", header: "Outlet Name", sticky: true, render: (row) => <span className="font-semibold">{row.name}</span> },
    { key: "code", header: "Code" },
    { key: "location", header: "Location" },
    { key: "brands", header: "Linked Brands",render:row=>{const item=links.find(l=>l.outlet_id===row.id);return linksError||!item||item.visibility==='unavailable'?<span className="text-text-secondary">Unavailable</span>:item.brands.length?<div className="flex flex-wrap gap-1">{item.brands.map(b=><Badge key={b.id} tone={b.is_active?'info':'neutral'}>{b.name}{b.is_active?'':' · Inactive'}</Badge>)}</div>:<span className="text-text-secondary">No visible linked brands</span>;} },
    {
      key: "sst",
      header: "Current SST",
      render: (row) => {
        const config = getOutletTaxConfig(store.outletTaxConfigs, row.id, currentPeriod.month, currentPeriod.year, "SST");
        return (
          <div className="flex items-center gap-2">
            <Badge tone={config.enabled ? "success" : "neutral"}>{config.enabled ? "ON" : "OFF"}</Badge>
            <span className="text-xs font-semibold text-text-secondary">{config.enabled ? `${config.rate}%` : "No SST"}</span>
          </div>
        );
      },
    },
    { key: "status", header: "Status", render: (row) => <Badge tone={row.status === "active" ? "success" : "neutral"}>{row.status}</Badge> },
    {
      key: "action",
      header: "Action",
      align: "right",
      render: (row) => (
        <div className="flex justify-end gap-2">
          <button className="icon-btn" disabled={!auth.hasPermission("outlets.edit")} aria-label={`Edit ${row.name}`} onClick={() => setModal({ mode: "edit", row })}><Settings size={15} /></button>
          <button className="icon-btn" disabled={row.status!=="active"||!auth.hasPermission("outlets.delete")} aria-label={`Deactivate ${row.name}`} onClick={async () => {
            if (await ui.confirm({ title: "Deactivate outlet?", message: `${row.name} will stay in historical records but be hidden from default active selectors.`, danger: true, confirmLabel: "Deactivate" })) {
              try {
                const saved = await outletService.deactivateOutlet(row);
                setOutlets((current) => current.map((outlet) => (outlet.id === saved.id ? saved : outlet)));
                setStore((current) => ({ ...current, outlets: current.outlets.filter((outlet) => outlet.id !== saved.id) }));
                ui.notify({ title: "Outlet updated", message: `${row.name} deactivated.` });
              } catch (error) {
                console.error("Unable to deactivate outlet", error);
                ui.notify({ title: "Unable to deactivate outlet", message: error.message || "Please try again.", tone: "error" });
              }
            }
          }}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-5">
      <PageHeader
        section="System"
        title="Outlets"
        description="Manage outlets used by sales, purchase, reporting, and attendance workflows."
        actions={auth.hasPermission("outlets.create")?<button className="btn-primary" onClick={() => setModal({ mode: "add" })}><Plus size={16} /> Add Outlet</button>:null}
      />
      <AdminFilterToolbar compact search={<AdminSearchField label="Search" value={search} onChange={setSearch} placeholder="Search name, code or location…"/>} filters={<SelectField label="Status" value={status} onChange={setStatus} options={[{value:'',label:'All'},{value:'active',label:'Active'},{value:'inactive',label:'Inactive'}]}/>} onClear={()=>{setSearch('');setStatus('active')}}/>
      {linksError?<p className="text-sm text-text-secondary" role="status">Linked Brand information is unavailable. Outlet management remains available.</p>:null}
      {sourceLinkError?<p role="alert" className="text-sm text-text-secondary">{sourceLinkError}</p>:null}
      <Card>
        {loading ? (
          <div className="p-8 text-center text-sm font-semibold text-text-secondary">Loading outlets...</div>
        ) : loadError ? (
          <div className="p-8 text-center text-sm font-semibold text-rose-700">{loadError}</div>
        ) : (
          rows.length?<DataTable columns={columns} rows={rows.slice((safePage-1)*size,safePage*size)} density="compact" getRowKey={(row) => row.id} />:<p className="p-5 text-sm text-text-secondary">No Outlets match your filters.</p>
        )}
      </Card>
      <AdminPagination page={safePage} pageSize={size} total={rows.length} onPageChange={setPage} onPageSizeChange={v=>{setSize(v);setPage(1)}} noun="outlets"/>
      {modal?<OutletEditor key={modal.row?.id||'new'} outlet={modal.row} initialSection={modal.section} canEdit={auth.hasPermission('outlets.edit')} canCreate={auth.hasPermission('outlets.create')} onClose={closeEditor} onSaved={saved=>{
        setOutlets(current=>current.some(row=>row.id===saved.id)?current.map(row=>row.id===saved.id?saved:row):[saved,...current]);
        setStore(current=>({...current,outlets:saved.is_active?current.outlets.some(row=>row.id===saved.id)?current.outlets.map(row=>row.id===saved.id?saved:row):[...current.outlets,saved]:current.outlets.filter(row=>row.id!==saved.id)}));
        ui.notify({title:'Outlet saved',message:saved.name});
      }}/>:null}
    </div>
  );
}
