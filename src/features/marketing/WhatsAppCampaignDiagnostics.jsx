import {useEffect,useState} from 'react';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import WhatsAppCampaignRehearsal from './WhatsAppCampaignRehearsal.jsx';
import {outreachService} from './outreachService.js';

export default function WhatsAppCampaignDiagnostics({organizationId,brandId,canRehearse}) {
 const [campaigns,setCampaigns]=useState([]);
 const [id,setId]=useState('');
 const [page,setPage]=useState(1);
 const [run,setRun]=useState(null);
 const [error,setError]=useState('');
 const [loading,setLoading]=useState(true);
 const campaign=campaigns.find(item=>item.id===id);
 useEffect(()=>{
  let active=true;
  outreachService.read(organizationId,brandId)
   .then(result=>{if(active)setCampaigns(result.campaigns.filter(item=>(item.delivery_mode||item.adapter)==='whatsapp_cloud'));})
   .catch(failure=>{if(active)setError(failure.message);})
   .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[organizationId,brandId]);
 useEffect(()=>{
  if(!id)return;
  let active=true;
  setRun(null);setError('');
  outreachService.whatsappExecution(organizationId,brandId,id,page)
   .then(result=>{if(active)setRun(result);}).catch(failure=>{if(active)setError(failure.message);});
  return()=>{active=false;};
 },[organizationId,brandId,id,page]);
 return <section className="mt-5 space-y-3 border-t border-border pt-4" aria-label="Campaign diagnostics">
  <h3 className="font-semibold">Campaign diagnostics</h3>
  {loading?<p role="status">Loading Cloud API campaigns…</p>:campaigns.length?<SelectField label="Cloud API campaign" value={id}
   options={[{value:'',label:'Select campaign'},...campaigns.map(item=>({value:item.id,label:item.title}))]}
   onChange={value=>{setId(value);setPage(1);setRun(null);}}/>:!error&&<p>No Cloud API campaigns for this Brand.</p>}
  {error&&<p role="alert">{error}</p>}
  {campaign&&<>
   <dl className="outreach-profile-grid">
    <div><dt>Campaign revision</dt><dd>{campaign.revision}</dd></div>
    <div><dt>Approved revision</dt><dd>{campaign.approved_revision??'None'}</dd></div>
    <div><dt>Audience revision</dt><dd>{campaign.audience_revision??'Not reviewed'}</dd></div>
    {run&&<div><dt>Run ID</dt><dd>{run.id}</dd></div>}
   </dl>
   {canRehearse&&campaign.status==='ready'&&<WhatsAppCampaignRehearsal key={campaign.id}
    organizationId={organizationId} brandId={brandId} campaign={campaign}/>}
   {run&&<>
    <h4 className="font-semibold">Provider receipts</h4>
    <ul className="space-y-2">
     {run.rows.map(row=><li key={row.id} className="break-words"><strong>{row.display_name}</strong> · Batch {row.batch} · {row.state}
      {row.reason&&<p>{row.reason}</p>}
      {row.provider_message_id&&<code className="break-all">{row.provider_message_id}</code>}
     </li>)}
    </ul>
    <AdminPagination noun="recipients" page={page} pageSize={20} total={run.total} onPageChange={setPage}/>
   </>}
  </>}
 </section>;
}
