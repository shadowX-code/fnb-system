import { useOverviewAnalysisIntent } from './overviewNavigation.js';
import { useEffect, useState } from 'react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import MonthPickerField from '../../components/forms/MonthPickerField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import { createFixtureProvider, fixtureScopes } from './providers/fixtureProvider.js';
import { monthlyPeriod } from './foundation.js';
import { readFinanceAnalysis } from './analysis.js';
import { readFinanceOverview } from './financeService.js';
import { FinanceOverview } from './FinanceWorkspacePage.jsx';
import { FinanceAnalysis } from './FinanceAnalysisPage.jsx';
import { FinanceCosts } from './FinanceCostsPage.jsx';
import { FinanceCash } from './FinanceCashPage.jsx';
const views = { analysis: FinanceAnalysis, costs: FinanceCosts, cash: FinanceCash };
// Separate presentation tree. This never calls Reporting, persists data or supplies canonical financial state.
export default function FinanceDesignPreview({ section }) {
  const initial=useOverviewAnalysisIntent(true,section==='analysis');
  const [month,setMonth]=useState(initial?.month??'2026-10'), [scope,setScope]=useState(initial?`${initial.scope.kind}:${initial.scope.id}`:'group:demo-group'), [data,setData]=useState(null), [error,setError]=useState('');
  const requestKey = `${section}:${month}:${scope}`;
  useEffect(()=>{let active=true;const controller=new AbortController();setError('');const selected=fixtureScopes.find(entry=>entry.value===scope);const request={scope:{kind:selected.kind,id:selected.id,...(selected.legalEntityId?{legalEntityId:selected.legalEntityId}:{})},period:monthlyPeriod(month),currency:'MYR'};const provider=createFixtureProvider({development:true});const read=section==='overview'?readFinanceOverview(provider,request,{signal:controller.signal,allowDemo:true,outlets:fixtureScopes.filter(entry=>entry.kind==='outlet').map(entry=>({id:entry.id,name:entry.label,legalEntityId:entry.legalEntityId}))}):readFinanceAnalysis(provider,request,{allowDemo:true,outlets:section==='analysis'?fixtureScopes.filter(entry=>entry.kind==='outlet').map(entry=>({id:entry.id,name:entry.label,legalEntityId:entry.legalEntityId})):[]});read.then(result=>{if(active)setData({key:requestKey,value:result});}).catch(()=>{if(active)setError('Simulated evidence could not be loaded.');});return()=>{active=false;controller.abort();};},[month,scope,section]);
  const View=views[section];
  return <WorkspacePage className="finance-workspace finance-analysis-page" section="Finance" title={section[0].toUpperCase()+section.slice(1)} description="Design Preview · simulated financial evidence, never business records." controls={<AdminFilterToolbar outlet={<SelectField label="Simulated scope" value={scope} onChange={setScope} options={fixtureScopes}/>} period={<MonthPickerField label="Preview period" value={month} onChange={setMonth}/>}/>}>{error ? <p role="alert">{error}</p> : data?.key !== requestKey ? <p role="status">Loading simulated evidence…</p> : null}{data?.key.startsWith(`${section}:`) ? <div hidden={data.key !== requestKey || Boolean(error)} aria-busy={data.key !== requestKey || undefined}>{section==='overview' ? <FinanceOverview dataset={data.value}/> : <View analysis={data.value} initialView={initial?.view}/>}</div> : null}</WorkspacePage>;
}
