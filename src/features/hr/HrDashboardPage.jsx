import { useEffect, useState } from 'react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import { employeeService } from '../../services/employeeService.js';
import { payrollService } from '../../services/payrollService.js';
import { recruitmentService } from '../recruitment/recruitmentService.js';
import { hasPermission } from '../../utils/accessControl.js';

export default function HrDashboardPage({auth,ui}) {
  const allowed = ['employees','recruitment','payroll'].filter(id=>hasPermission(auth,`${id}.view`)).join(',');
  const [read,setRead] = useState({key:null,values:{},errors:[]});
  const [attempt,setAttempt] = useState(0);
  const scope = auth.profile || {};
  const key = JSON.stringify([auth.user?.id, allowed, scope.role_id, scope.role_outlet_access_type ?? scope.role?.outlet_access_type, scope.role_outlet_ids ?? scope.roleOutletIds ?? []]);
  useEffect(()=>{
    let active=true;
    const reads = {employees:()=>employeeService.listEmployees(),recruitment:()=>recruitmentService.workspace(),payroll:()=>payrollService.read()};
    const ids = allowed ? allowed.split(',') : [];
    setRead({key:null,values:{},errors:[]});
    Promise.allSettled(ids.map(id=>reads[id]())).then(results=>{
      if(!active)return;
      const values={},errors=[];
      results.forEach((result,index)=>{if(result.status==='fulfilled')values[ids[index]]=result.value;else errors.push(ids[index]);});
      setRead({key,values,errors});
    });
    return ()=>{active=false;};
  },[key,attempt]);
  const values = read.key===key ? read.values : {};
  const loading = read.key!==key;
  const metrics=[], actions=[];
  if (allowed.split(',').includes('employees')) {
    const employees=values.employees;
    metrics.push({key:'employees',label:'Employees',value:employees?.length??'—',helper:'Employee records in your access',state:loading?'loading':employees?'ready':'error',onClick:()=>ui.navigate('employees')});
    if(employees) metrics.push({key:'active',label:'Active employees',value:employees.filter(row=>row.employment_status==='active').length,helper:'Current employment status',onClick:()=>ui.navigate('employees')});
  }
  if (allowed.split(',').includes('recruitment')) {
    const summary=values.recruitment?.summary;
    metrics.push({key:'recruitment',label:'Open roles',value:summary?.open_roles??'—',helper:'Recruitment in your access',state:loading?'loading':summary?'ready':'error',onClick:()=>ui.navigate('recruitment')});
    if(summary?.needs_review>0)actions.push({id:'recruitment',name:'Candidate review',detail:'Candidates awaiting review',count:summary.needs_review});
  }
  if (allowed.split(',').includes('payroll')) {
    const periods=values.payroll?.periods;
    const open=periods?.filter(period=>(period.runs || []).some(run=>['draft','review_required','ready'].includes(run.status)));
    metrics.push({key:'payroll',label:'Open payroll periods',value:open?.length??'—',helper:'Not finalized · across accessible entities',state:loading?'loading':periods?'ready':'error',onClick:()=>ui.navigate('payroll')});
    if(open?.length)actions.push({id:'payroll',name:'Payroll preparation',detail:'Open periods · check each Run’s readiness',count:open.length});
  }
  return <WorkspacePage title="HR Dashboard" description="People, recruitment and Payroll in your access." density="compact">
    {metrics.length>0 && <AdminSummaryGrid mobileColumns={2} variant="compact" ariaLabel="HR summary" items={metrics}/>}
    {read.key===key && read.errors.length>0 && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-text-secondary"><span>Some summaries are unavailable: {read.errors.join(', ')}. No totals have been assumed.</span><button type="button" className="btn-secondary" onClick={()=>setAttempt(value=>value+1)}>Retry summaries</button></div>}
    <section aria-labelledby="hr-pending-heading">
      <h2 id="hr-pending-heading" className="mb-3 text-base font-semibold text-text-primary">Needs attention</h2>
      {actions.length ? <DataTable mobileLayout="stack" minWidth={480} density="compact" columns={[
        {key:'name',header:'Work queue'},{key:'detail',header:'Next step'},{key:'count',header:'Items',align:'right'},
        {key:'action',header:'',align:'right',render:row=><button type="button" className="btn-secondary" onClick={()=>ui.navigate(row.id)}>Continue</button>},
      ]} rows={actions} getRowKey={row=>row.id}/> : <p className="text-sm text-text-secondary">{loading?'Loading work queues…':read.errors.length?'Open the owning module to check unavailable work queues.':'No pending items reported by the available summaries.'}</p>}
    </section>
    {!metrics.length && <p className="text-sm text-text-secondary">Use the HR sidebar to open your authorized organization and compliance modules.</p>}
  </WorkspacePage>;
}
