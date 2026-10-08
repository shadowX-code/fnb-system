import { useOverviewAnalysisIntent } from './overviewNavigation.js';
import FinancePreviewBoundary from './FinancePreviewBoundary.jsx';
import { useEffect, useMemo, useState } from 'react';
import WorkspacePage from '../../components/layout/WorkspacePage.jsx';
import AdminFilterToolbar from '../../components/layout/AdminFilterToolbar.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import MonthPickerField from '../../components/forms/MonthPickerField.jsx';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import { getAccessibleOutlets } from '../../utils/accessControl.js';
import { financeDemoEnabled, getFinanceProvider } from './financeService.js';
import { monthlyPeriod, previousPeriod } from './foundation.js';
import { readFinanceAnalysis, shiftMonth } from './analysis.js';
import { currentFinanceMonth } from './presentation.js';
import './finance.css';
import './analysis.css';
function LiveFinanceComparisonWorkspace({ store = {}, auth, title, description, includeOutlets = false, children }) {
  const initial=useOverviewAnalysisIntent(false,title==='Analysis');
  const [mode, setMode] = useState('operational');
  const [month, setMonth] = useState(initial?.month ?? currentFinanceMonth);
  const [comparisonMode, setComparisonMode] = useState('previous');
  const [customMonth, setCustomMonth] = useState(() => previousPeriod(monthlyPeriod(currentFinanceMonth())).start.slice(0, 7));
  const [outletId, setOutletId] = useState(initial?.scope.kind === 'outlet' ? initial.scope.id : 'all');
  const [demoScope, setDemoScope] = useState('group:demo-group');
  const [demoScopes, setDemoScopes] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  // Auth/store wrappers can rerender when shared controls open. Only changed authorized identities
  // or labels invalidate this read; equal scope must preserve the user's analytical selection.
  const outletSignature = JSON.stringify(getAccessibleOutlets(auth, store.outlets ?? []).map((outlet) => ({ id: outlet.id, name: outlet.name })));
  const outlets = useMemo(() => JSON.parse(outletSignature), [outletSignature]);
  const comparisonMonth = comparisonMode === 'custom' ? customMonth : shiftMonth(monthlyPeriod(month), comparisonMode === 'year' ? -12 : -1).start.slice(0, 7);
  useEffect(() => {
    if (!financeDemoEnabled || mode !== 'demo') return;
    let active = true;
    import('./providers/fixtureProvider.js').then(({ fixtureScopes }) => { if (active) setDemoScopes(fixtureScopes); }).catch(() => { if (active) { setError('Development evidence could not be loaded.'); setLoading(false); } });
    return () => { active = false; };
  }, [mode]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setAnalysis(null);
    const scope = mode === 'demo' ? demoScopes.find((entry) => entry.value === demoScope) : outletId === 'all' ? { kind: 'authorized_outlets', id: null } : outlets.some((outlet) => outlet.id === outletId) ? { kind: 'outlet', id: outletId } : null;
    if (!scope) { if (mode !== 'demo' || demoScopes.length) { setError('Choose an available financial scope.'); setLoading(false); } return () => controller.abort(); }
    const request = { scope: { kind: scope.kind, id: scope.id, ...(scope.legalEntityId ? { legalEntityId: scope.legalEntityId } : {}) }, period: monthlyPeriod(month), currency: 'MYR' };
    const eligible = mode === 'demo' ? demoScopes.filter((entry) => entry.kind === 'outlet').map((entry) => ({ id: entry.id, name: entry.label, legalEntityId: entry.legalEntityId })) : outlets;
    getFinanceProvider(mode).then((provider) => readFinanceAnalysis(provider, request, { comparisonPeriod: monthlyPeriod(comparisonMonth), outlets: includeOutlets ? eligible : [], allowDemo: financeDemoEnabled && mode === 'demo', signal: controller.signal })).then((result) => { if (!controller.signal.aborted) setAnalysis(result); }).catch((failure) => { if (!controller.signal.aborted) setError(failure.message === 'Choose a complete comparison month before the current period.' ? failure.message : 'Financial evidence could not be loaded. Retry the read or review Data Sources.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [mode, month, comparisonMonth, outletId, demoScope, demoScopes, outlets, attempt, includeOutlets]);
  return <WorkspacePage className="finance-workspace finance-analysis-page" section="Finance" title={title} description={description} controls={<AdminFilterToolbar outlet={<SelectField label={mode === 'demo' ? 'Demo scope' : 'Outlet scope'} value={mode === 'demo' ? demoScope : outletId} onChange={mode === 'demo' ? setDemoScope : setOutletId} options={mode === 'demo' ? demoScopes : [{ value: 'all', label: 'All authorized outlets' }, ...outlets.map((outlet) => ({ value: outlet.id, label: outlet.name }))]} />} period={<MonthPickerField label="Current period" value={month} onChange={setMonth} />}>
      {financeDemoEnabled ? <SelectField label="Evidence" value={mode} onChange={setMode} options={[{ value: 'operational', label: 'FeedX operational' }, { value: 'demo', label: 'Development demo' }]} /> : null}
      <SelectField label="Compare with" value={comparisonMode} onChange={setComparisonMode} options={[{ value: 'previous', label: 'Previous month' }, { value: 'year', label: 'Same month last year' }, { value: 'custom', label: 'Selected month' }]} />
      {comparisonMode === 'custom' ? <MonthPickerField label="Comparison period" value={customMonth} onChange={setCustomMonth} /> : null}
    </AdminFilterToolbar>}>
    <AsyncDataSurface loading={loading} error={error} hasData={Boolean(analysis)} loadingRows={6} onRetry={() => setAttempt((value) => value + 1)}>{analysis ? <div key={`${mode}:${month}:${comparisonMonth}:${outletId}:${demoScope}`}>{children(analysis, initial)}</div> : null}</AsyncDataSurface>
  </WorkspacePage>;
}

export default function FinanceComparisonWorkspace(props) { return <FinancePreviewBoundary auth={props.auth} section={props.title.toLowerCase()}><LiveFinanceComparisonWorkspace {...props}/></FinancePreviewBoundary>; }
