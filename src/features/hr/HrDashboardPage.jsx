import {useEffect,useMemo,useState} from 'react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminSummaryGrid from '../../components/ui/AdminSummaryGrid.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import Badge from '../../components/ui/Badge.jsx';
import RecordViewAction from '../../components/ui/RecordViewAction.jsx';
import {employeeService} from '../../services/employeeService.js';
import {legalEntityService} from '../../services/legalEntityService.js';
import {payrollService} from '../../services/payrollService.js';
import {hasPermission} from '../../utils/accessControl.js';
import useAdminLocation from '../../app/useAdminLocation.js';
import {navigateAdminRoute} from '../../app/routeOwnership.js';
import {classificationLabel,companyName,payrollOverview,workforceOverview} from './workforceOverview.js';

function Distribution({title,rows,total}) {
  return <section className="min-w-0" aria-label={title}><h3 className="mb-3 text-sm font-semibold">{title}</h3>
    {rows.length ? <ul className="space-y-3">{rows.map(row=><li key={row.key}>
      <div className="mb-1 flex justify-between gap-3 text-sm"><span>{row.label}</span><span className="shrink-0 tabular-nums">{row.count} · {row.percentage.toFixed(1)}%</span></div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${row.label}: ${row.count} of ${total} employee records`}><div className="h-full rounded-full bg-primary" style={{width:`${row.percentage}%`}}/></div>
    </li>)}</ul> : <p className="text-sm text-text-secondary">No employee records in this selection.</p>}
  </section>;
}

export default function HrDashboardPage({auth}) {
  const location=useAdminLocation();
  const company=location?.query.company || 'all';
  const canEmployees=hasPermission(auth,'employees.view'),canPayroll=hasPermission(auth,'payroll.view'),canEntities=hasPermission(auth,'legal_entities.view');
  const scope=auth.profile||{};
  const key=JSON.stringify([auth.user?.id,canEmployees,canPayroll,canEntities,scope.role_id,scope.role_outlet_access_type??scope.role?.outlet_access_type,scope.role_outlet_ids??scope.roleOutletIds??[]]);
  const [read,setRead]=useState({key:null,values:{},errors:[]}),[attempt,setAttempt]=useState(0),[sort,setSort]=useState({key:'active',direction:'desc'});
  useEffect(()=>{
    let active=true;
    const reads=[...(canEmployees?[['employees',()=>employeeService.readWorkforce()]]:[]),...(canEntities?[['companies',()=>legalEntityService.list()]]:[]),...(canPayroll?[['payroll',()=>payrollService.read()]]:[])];
    setRead({key:null,values:{},errors:[]});
    Promise.allSettled(reads.map(([,load])=>load())).then(results=>{
      if(!active)return;
      const values={},errors=[];results.forEach((result,index)=>{if(result.status==='fulfilled')values[reads[index][0]]=result.value;else errors.push(reads[index][0]);});
      setRead({key,values,errors});
    });
    return ()=>{active=false;};
  },[key,attempt]);
  const loading=read.key!==key,values=loading?{}:read.values;
  const records=values.employees;
  const companies=useMemo(()=>{
    const result=new Map();
    for(const entity of [...(values.payroll?.legal_entities||[]),...(values.companies||[])])result.set(entity.id,{id:entity.id,name:companyName(entity)});
    for(const row of records||[])if(row.legal_entity_id&&!result.has(row.legal_entity_id))result.set(row.legal_entity_id,{id:row.legal_entity_id,name:'Company name unavailable'});
    return [...result.values()].sort((a,b)=>a.name.localeCompare(b.name));
  },[values.payroll,values.companies,records]);
  const names=new Map(companies.map(row=>[row.id,row.name]));
  const invalidCompany=!loading && company!=='all' && !names.has(company);
  const workforce=records&&!invalidCompany?workforceOverview(records,company):null;
  const companyRows=workforce?.companies.map(row=>({...row,name:row.id==='unassigned'?'Unassigned':names.get(row.id)||'Company name unavailable'}))||[];
  companyRows.sort((a,b)=>((typeof a[sort.key]==='number'?a[sort.key]-b[sort.key]:a[sort.key].localeCompare(b[sort.key]))*(sort.direction==='asc'?1:-1))||a.name.localeCompare(b.name));
  const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).format(new Date());
  const periods=values.payroll&&!invalidCompany?payrollOverview(values.payroll.periods||[],company,month):[];
  const companyOptions=[{value:'all',label:'All'},...companies.map(row=>({value:row.id,label:row.name}))];
  if(company!=='all'&&!names.has(company))companyOptions.push({value:company,label:loading?'Loading company…':'Company unavailable'});
  const setCompany=value=>navigateAdminRoute('hr_dashboard',{},value==='all'?{}:{company:value},{replace:true});
  const openEmployees=id=>navigateAdminRoute('employees',{},{company:id});
  const changeSort=column=>setSort(current=>({key:column,direction:current.key===column&&current.direction==='asc'?'desc':'asc'}));
  const sortable=(column,header)=>({key:column,header,onSort:()=>changeSort(column),sortDirection:sort.key===column?sort.direction:undefined});
  const missingNames=companyRows.some(row=>row.name==='Company name unavailable');
  const payrollCompanyAvailable=company==='all'||values.payroll?.legal_entities?.some(entity=>entity.id===company);
  return <WorkspacePage title="HR Dashboard" description="Workforce overview · current employment records in your access." density="compact"
    controls={<AdminFilterToolbar compact ariaLabel="HR company filter" outlet={<SelectField label="Company" value={company} options={companyOptions} onChange={setCompany} searchable="auto"/>}/> }>
    {invalidCompany && <p role="alert" className="text-sm text-amber-700">This company is not available in your access or its source could not be loaded. Select All or retry.</p>}
    {!loading&&read.errors.length>0&&<div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-amber-700"><span>Partial overview: {read.errors.join(', ')} unavailable. Missing sources are not counted as zero.</span><button type="button" className="btn-secondary" onClick={()=>setAttempt(value=>value+1)}>Retry overview</button></div>}
    {canEmployees ? <>
      <AdminSummaryGrid variant="compact" mobileColumns={2} ariaLabel="Workforce summary" items={[
        {key:'active',label:'Active Employees',value:workforce?.active??'—',helper:'Employment status Active'},
        {key:'records',label:'Total Employee Records',value:workforce?.total??'—',helper:'One record per employee'},
        {key:'companies',label:'Companies with Employees',value:workforce?.companyCount??'—',helper:'Assigned Legal Entities only'},
      ].map(metric=>({...metric,state:loading?'loading':workforce?'ready':'error',wrapLabel:true,helperClassName:'whitespace-normal'}))}/>
      <section aria-labelledby="workforce-distribution"><h2 id="workforce-distribution" className="mb-1 text-base font-semibold">Workforce Distribution</h2><p className="mb-4 text-xs text-text-secondary">All employee records in the selected scope. Percentages are rounded.</p>
        {workforce ? <div className="grid gap-6 md:grid-cols-2"><Distribution title="Employment Type" rows={workforce.types} total={workforce.total}/><Distribution title="Employment Status" rows={workforce.statuses} total={workforce.total}/></div>:<p className="text-sm text-text-secondary">{loading?'Loading workforce…':'Employee records unavailable.'}</p>}
      </section>
      <section aria-labelledby="employees-by-company"><h2 id="employees-by-company" className="mb-3 text-base font-semibold">Employees by Company</h2>
        {missingNames&&<p className="mb-3 text-sm text-text-secondary">Some company names are unavailable. Their visible employee records remain included in the totals.</p>}
        {workforce ? companyRows.length ? <DataTable density="compact" mobileLayout="stack" minWidth={620} columns={[
          sortable('name','Legal Entity'),{...sortable('active','Active Employees'),align:'right'}, {...sortable('total','Employee Records'),align:'right'},
          {key:'types',header:'Employment Type Breakdown',render:row=><div className="flex flex-wrap gap-x-3 gap-y-1">{row.types.map(type=><span key={type.key} className="whitespace-nowrap">{type.label} <strong className="tabular-nums">{type.count}</strong></span>)}</div>},
          {key:'action',header:'',align:'right',render:row=><RecordViewAction label={`View ${row.name} employees`} onClick={()=>openEmployees(row.id)}/>},
        ]} rows={companyRows} onRowClick={row=>openEmployees(row.id)} getRowKey={row=>row.id} footer={<tr><td className="p-3 font-semibold">Total</td><td className="p-3 text-right tabular-nums">{workforce.active}</td><td className="p-3 text-right tabular-nums">{workforce.total}</td><td colSpan={2} className="p-3 text-xs text-text-secondary">{workforce.companies.some(row=>row.id==='unassigned')?'Unassigned records included; not counted as a company.':'Employee records in this selection.'}</td></tr>}/>:<p className="text-sm text-text-secondary">No employee records in this selection.</p>:<p className="text-sm text-text-secondary">{loading?'Loading companies…':'Employee records unavailable.'}</p>}
      </section>
    </>:<p className="text-sm text-text-secondary">Employee view permission is required for workforce statistics.</p>}
    {canPayroll&&<section aria-labelledby="payroll-overview"><h2 id="payroll-overview" className="mb-1 text-base font-semibold">Payroll Overview</h2><p className="mb-3 text-xs text-text-secondary">Current month first, then other open periods. Status comes from the existing Payroll Run.</p>
      {loading?<p className="text-sm text-text-secondary">Loading Payroll periods…</p>:!values.payroll||invalidCompany?<p className="text-sm text-text-secondary">Payroll periods unavailable for this selection.</p>:!payrollCompanyAvailable?<p className="text-sm text-text-secondary">Payroll access is unavailable for this company.</p>:periods.length?<>
        <DataTable density="compact" mobileLayout="stack" minWidth={560} columns={[
          {key:'company',header:'Company',render:row=>names.get(row.legal_entity_id)||'Company name unavailable'},
          {key:'period_start',header:'Pay Period',render:row=>new Intl.DateTimeFormat('en-MY',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(row.period_start+'T00:00:00Z'))},
          {key:'status',header:'Status',render:row=><Badge tone={row.run.status==='ready'?'success':row.run.status==='review_required'?'warning':'neutral'}>{classificationLabel(row.run.status)}</Badge>},
          {key:'action',header:'',align:'right',render:row=><button type="button" className="btn-secondary" onClick={()=>navigateAdminRoute('payroll',{},{company:row.legal_entity_id,period:row.period_start.slice(0,7),run:row.run.id})}>Open Payroll Run</button>},
        ]} rows={periods.slice(0,6)} getRowKey={row=>row.id}/>
        {periods.length>6&&<button type="button" className="btn-secondary mt-3" onClick={()=>navigateAdminRoute('payroll',{},company==='all'?{}:{company})}>View remaining Payroll periods</button>}
      </>:<p className="text-sm text-text-secondary">No current or open Payroll periods in this selection.</p>}
    </section>}
  </WorkspacePage>;
}
