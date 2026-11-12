import {useState} from 'react';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';

export default function CampaignRecipientsTable({rows, columns, statuses, total, page, pageSize, onPageChange, loading, emptyMessage}) {
 const [search,setSearch]=useState('');
 const [status,setStatus]=useState('');
 const term=search.trim().toLowerCase();
 const filtered=rows.filter(row=>(!status||row.state===status) && (!term||
  [row.display_name,row.phone_e164].some(value=>value?.toLowerCase().includes(term))));
 return <section className="space-y-3" aria-label="Recipients & Delivery">
  <div className="outreach-section-heading mb-0">
   <h2 className="text-base font-semibold">Recipients &amp; Delivery</h2>
  </div>
  {rows.length>0&&<AdminFilterToolbar compact denseFields ariaLabel="Recipient filters"
   search={<AdminSearchField ariaLabel="Search recipients" placeholder={total>pageSize?'Search this page':'Name or number'} value={search} onChange={setSearch}/>}
   filters={<SelectField label={total>pageSize?'Status on this page':'Recipient status'} value={status} onChange={setStatus}
    options={[{value:'',label:'All'},...Object.entries(statuses).map(([value,label])=>({value,label}))]}/>}/>}
  {filtered.length>0?<div className="card overflow-hidden">
   <DataTable density="compact" mobileLayout="stack" minWidth={0} rows={filtered} columns={columns} getRowKey={row=>row.id}/>
  </div>:<p className="card p-4 text-sm text-text-secondary" role="status">
   {loading?'Loading recipients…':rows.length?'No recipients match these filters.':emptyMessage}
  </p>}
  {total>pageSize&&<AdminPagination noun="recipients" total={total} page={page} pageSize={pageSize} loading={loading} onPageChange={onPageChange}/>}
 </section>;
}
