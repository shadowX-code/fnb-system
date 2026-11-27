import { useEffect, useRef, useState } from 'react';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import Drawer from '../../components/ui/Drawer.jsx';
import FinanceClassificationLibrary from './FinanceClassificationLibrary.jsx';
import { analyzeMappingExceptions, readMappingAssistance, readAccountMapping, confirmAccountMapping } from './dataSources.js';

const statuses = {
  suggested: 'Suggested', manual_review: 'Needs classification', new: 'New account', changed: 'Source changed',
  confirmed: 'Confirmed', group: 'Group only', ambiguous: 'Hierarchy review',
};
const filters = [
  ['all', 'All accounts'], ['exceptions', 'Exceptions'], ['unresolved', 'Needs review'], ['suggested', 'With suggestions'],
  ['confirmed', 'Confirmed'], ['changed', 'Changed or new'], ['group', 'Group accounts'], ['posted', 'Used in accepted GL'],
];
const issues = {
  hierarchy: 'Parent chain is missing, circular or too deep.',
  group_postings: 'This group also has direct GL postings. Review it in the source.',
};
const maxSelected = 500;
const noSelection = new Map();
const industries = [
  { value: 'core', label: 'Core only' }, { value: 'restaurant', label: 'Restaurant' },
  { value: 'manufacturing', label: 'Manufacturing' }, { value: 'retail', label: 'Retail' },
];
const assistanceReasons = {
  source_support: 'Source type and description support this category.',
  keep_rule: 'The source evidence supports the existing rule.',
  ambiguous: 'The description could fit more than one purpose.',
  tax_treatment: 'Verify the source tax treatment.',
  source_conflict: 'Resolve conflicting source or approval evidence.',
  insufficient: 'More source evidence is needed.',
};
const analysisNotices = {
  cached: 'This chart already has a review for these exceptions. No new AI tokens used.',
  running: 'An analysis is already running for this Account Book.',
  limited: 'This Account Book has reached its daily analysis limit.',
  provider_unconfigured: 'The FeedX AI connection is unavailable. Rule suggestions and manual review are still available.',
  provider_rate_limited: 'The AI provider is busy. Try again later.',
  chart_changed: 'The accepted chart changed. Reload the latest review.',
};

function ancestors(entry, classes) {
  const path = [entry];
  let parent = classes.get(entry.parent_id);
  while (parent && path.length < 12) {
    path.unshift(parent);
    parent = classes.get(parent.parent_id);
  }
  return path;
}

function matches(row, status) {
  switch (status) {
    case 'all': return true;
    case 'unresolved': return row.role !== 'group' && row.status !== 'confirmed';
    case 'changed': return ['changed', 'new'].includes(row.status);
    case 'group': return row.role === 'group';
    case 'posted': return row.posted;
    default: return row.status === status;
  }
}

function MappingReviewTable({ review, timestamp, onSaved, onReload, onDraftChange }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('exceptions');
  const [industry, setIndustry] = useState('core');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [drafts, setDrafts] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);
  const [assistance, setAssistance] = useState(null);
  const [analysisNotice, setAnalysisNotice] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [remember, setRemember] = useState(false);
  const [drawer, setDrawer] = useState(null);
  const staged = drafts[industry] ?? noSelection;
  const otherDrafts = Object.entries(drafts).reduce((count, [scope, items]) => count + (scope !== industry ? items.size : 0), 0);
  const hasDrafts = otherDrafts + staged.size > 0;

  useEffect(() => { onDraftChange(hasDrafts || saving || analyzing); }, [hasDrafts, saving, analyzing, onDraftChange]);

  function setStaged(update) {
    setDrafts((current) => ({ ...current, [industry]: typeof update === 'function' ? update(current[industry] ?? noSelection) : update }));
  }

  useEffect(() => {
    const controller = new AbortController();
    readMappingAssistance(review.connectionId, industry, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setAssistance({ industry, result }); })
      .catch(() => { if (!controller.signal.aborted) setAssistance({ industry, result: null }); });
    return () => controller.abort();
  }, [review, industry]);

  const assist = assistance?.industry === industry && assistance.result?.snapshotId === review.snapshotId ? assistance.result : null;
  const assistanceFor = (row) => assist?.rows[row.account_key];

  const classes = new Map(review.classifications.map((entry) => [entry.id, entry]));
  const label = (id) => classes.has(id) ? classes.get(id).label : '—';
  const ruleFor = (row) => {
    const candidate = classes.get(row.suggestion);
    return candidate?.industry && candidate.industry !== industry ? row.core_suggestion : row.suggestion;
  };
  const suggestionFor = (row) => {
    const support = assistanceFor(row);
    return support?.conflict ? null : support?.memory ?? support?.proposal ?? ruleFor(row);
  };
  const isException = (row) => {
    const support = assistanceFor(row);
    return row.status === 'changed' || row.role === 'ambiguous' || (row.role === 'posting' && row.status !== 'confirmed'
      && (support?.conflict || (!support?.memory && (support?.targeted ? !support.proposal : !row.suggestion))));
  };
  const choicesByScope = new Map();
  const paths = new Map(review.classifications.map((entry) => [entry.id, ancestors(entry, classes)]));
  for (const entry of review.classifications) {
    if (!entry.selectable || (entry.industry && entry.industry !== industry)) continue;
    const path = paths.get(entry.id);
    const group = (path[1]?.selectable === false ? path[1] : path[0]).label;
    const fullPath = path.map((node) => node.label);
    const option = { value: entry.id, label: entry.label, group,
      description: fullPath.slice(1, -1).join(' / '), searchText: fullPath.join(' / ') };
    for (const scope of entry.source_scopes) {
      if (!choicesByScope.has(scope)) choicesByScope.set(scope, new Map());
      const groups = choicesByScope.get(scope);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(option);
    }
  }
  function choices(row, selected) {
    const groups = choicesByScope.get(row.source_scope);
    const registered = groups ? [...groups.values()].flat() : [];
    if (selected && !registered.some((option) => option.value === selected)) {
      return [{ value: selected, label: label(selected), group: 'Current selection', disabled: true }, ...registered];
    }
    return registered;
  }
  const reviewable = review.rows.filter((row) => row.role === 'posting' && row.version == null
    && row.status !== 'confirmed' && !isException(row) && suggestionFor(row));
  const needle = search.trim().toLowerCase();
  const filtered = review.rows.filter((row) => (filter === 'exceptions' ? isException(row) : filter === 'suggested'
    ? reviewable.includes(row) : matches(row, filter)) &&
    [row.account_key, row.description, row.parent_key, row.parent_description, row.source_type, label(suggestionFor(row)), label(row.classification)]
      .some((value) => value?.toLowerCase().includes(needle)));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const suggestions = reviewable.filter((row) => !staged.has(row.account_key));
  const pageSuggestions = suggestions.filter((row) => visible.includes(row));
  const entries = review.rows.filter((row) => staged.has(row.account_key));
  const blocked = stale || saving;

  function stage(row, classificationId) {
    setStaged((prev) => {
      const next = new Map(prev);
      if (!classificationId || (row.status === 'confirmed' && row.classification === classificationId)) next.delete(row.account_key);
      else if (next.has(row.account_key) || next.size < maxSelected) next.set(row.account_key, classificationId);
      return next;
    });
    setNotice('');
  }
  function addSuggestions(rows) {
    setStaged((prev) => {
      const next = new Map(prev);
      for (const row of rows.filter((item) => !next.has(item.account_key)).slice(0, maxSelected - next.size)) {
        next.set(row.account_key, suggestionFor(row));
      }
      return next;
    });
    setNotice('');
  }
  async function analyze() {
    setAnalyzing(true);
    setAnalysisNotice('');
    try {
      const outcome = await analyzeMappingExceptions(review.connectionId, industry);
      if (outcome.review) setAssistance({ industry, result: outcome.review });
      setAnalysisNotice(outcome.state === 'completed' ? `${outcome.review.lastRun.accounts} accounts analyzed.`
        : analysisNotices[outcome.state] ?? 'Analysis could not be completed. Rule suggestions and manual review are still available.');
      if (outcome.state === 'chart_changed') setStale(true);
      if (outcome.state === 'completed') { setFilter('exceptions'); setPage(1); }
    } catch {
      setAnalysisNotice('Analysis could not be completed. Rule suggestions and manual review are still available.');
    } finally {
      setAnalyzing(false);
    }
  }
  async function save() {
    setSaving(true);
    setError('');
    try {
      const next = await confirmAccountMapping(review.connectionId, review.snapshotId, entries.map((row) => ({
        accountKey: row.account_key, classificationId: staged.get(row.account_key), expectedVersion: row.version,
        ...(remember ? { remember: true } : {}),
      })));
      setDrafts((current) => Object.fromEntries(Object.entries(current).map(([scope, items]) => [scope,
        new Map([...items].filter(([key]) => scope !== industry && !staged.has(key))),
      ])));
      setConfirming(false);
      setNotice(`${entries.length} ${entries.length === 1 ? 'classification' : 'classifications'} confirmed.`);
      onSaved(next);
    } catch (failure) {
      if (failure.code === 'PT409') {
        setStale(true);
        setConfirming(false);
        setError('The chart or a mapping changed during review. Reload the latest review before confirming.');
      } else if (failure.code === 'PT422') {
        setError('One or more selections are incompatible with the accepted source type. Review the selected classifications.');
      } else {
        setError('Classifications could not be confirmed. Your selections are still available.');
      }
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { key: 'select', header: <span className="sr-only">Select</span>, width: 38, render: (row) => {
      const suggestion = suggestionFor(row);
      if (row.role !== 'posting' || (!suggestion && !staged.has(row.account_key)) || row.status === 'confirmed' && !staged.has(row.account_key)) return null;
      return <input type="checkbox" aria-label={`Select ${row.account_key}`} checked={staged.has(row.account_key)}
        disabled={blocked || (staged.size >= maxSelected && !staged.has(row.account_key))}
        onChange={(event) => stage(row, event.target.checked ? suggestion : '')} />;
    }},
    { key: 'account', header: 'Source account', width: 230, render: (row) => <div>
      <strong>{row.account_key}</strong> <span>{row.description || 'No description'}</span>
      <p className="type-caption text-text-secondary">{[row.source_type && `Source type ${row.source_type}`, row.parent_key && `Parent ${row.parent_key}`, row.posted && 'Observed in accepted GL'].filter(Boolean).join(' · ') || 'No source type'}</p>
    </div> },
    { key: 'state', header: 'Review status', width: 155, render: (row) => <div className="grid justify-items-start gap-1">
      <StatusBadge status={row.status === 'confirmed' ? 'success' : ['changed', 'ambiguous', 'manual_review', 'new'].includes(row.status) ? 'warning' : 'neutral'}>{statuses[row.status]}</StatusBadge>
      {row.issue && <p className="type-caption text-text-secondary">{issues[row.issue]}</p>}
    </div> },
    { key: 'classification', header: 'Analytical classification', width: 320, render: (row) => {
      const selected = staged.get(row.account_key) ?? (row.status === 'confirmed' ? row.classification : '');
      const suggestion = suggestionFor(row);
      const support = assistanceFor(row);
      const origin = support?.memory ? 'Approved memory' : support?.proposal ? 'AI suggestion' : 'Rule suggestion';
      const originLabel = selected && staged.has(row.account_key) && selected !== suggestion ? 'Manual selection'
        : suggestion && row.status !== 'confirmed' ? origin : null;
      return <div className="grid min-w-0 gap-1">
        {row.role === 'posting' && row.source_scope && <SelectField
          ariaLabel={`Classification for ${row.account_key}`} searchable placeholder={suggestion ? label(suggestion) : 'Choose classification'}
          value={selected} options={choices(row, selected)}
          disabled={blocked || (staged.size >= maxSelected && !staged.has(row.account_key))}
          onChange={(value) => stage(row, value)} />}
        {originLabel && <p className="type-caption text-text-secondary">{originLabel}
          {selected && suggestion && selected !== suggestion ? ` · Suggested ${label(suggestion)}` : ''}</p>}
        {support?.conflict ? <p className="type-caption text-text-secondary">Approved memory conflicts. Review individually.</p>
          : support?.checked && <p className="type-caption text-text-secondary">{assistanceReasons[support.basis]}</p>}
        {row.role === 'posting' && !row.source_scope && <span className="type-caption text-text-secondary">
          {selected ? `${label(selected)} · ` : ''}Source type needs verification
        </span>}
        {row.status === 'changed' && <p className="type-caption text-text-secondary">Previous confirmation · {label(row.classification)}</p>}
        {row.role !== 'posting' && row.status !== 'changed' && <span className="type-caption text-text-secondary">Excluded from confirmation</span>}
      </div>;
    }},
  ];

  const { confirmed, removed } = review.summary;
  const posting = review.summary.posting ?? review.rows.filter((row) => row.role === 'posting').length;
  const exceptions = review.rows.filter(isException).length;
  return <div className="grid min-w-0 gap-3">
    <div className="grid gap-2 rounded-lg border border-border bg-surface px-3 py-2 sm:px-4" aria-label="Mapping progress">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap gap-x-4 gap-y-1 type-body-sm text-text-secondary" aria-live="polite">
          {[[posting, 'posting accounts'], [reviewable.length, 'reviewable suggestions'], [exceptions, 'exceptions'], [confirmed, 'confirmed']]
            .map(([count, text]) => <span key={text}><strong className="text-text-primary">{count}</strong> {text}</span>)}
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" type="button" onClick={() => setDrawer('library')}>Classification Library</button>
          <button className="btn-secondary" type="button" onClick={() => setDrawer('analysis')}>Analysis Details</button>
        </div>
      </div>
      {posting > 0 && <progress className="h-1.5 w-full accent-primary" aria-label="Posting account confirmation progress" value={confirmed} max={posting} />}
      {removed > 0 && <p className="type-caption text-text-secondary">{removed} previously reviewed accounts absent.</p>}
    </div>
    <div className="flex flex-wrap items-end gap-2" aria-label="Mapping filters">
      <AdminSearchField label="Find accounts" value={search} maxLength={128} onChange={(value) => { setSearch(value); setPage(1); }} />
      <label className="grid gap-1 type-caption">Filter accounts
        <select className="control" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
          {filters.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <SelectField label="Classification scope" value={industry} options={industries} disabled={analyzing}
        onChange={(value) => { setIndustry(value); setAnalysisNotice(''); setPage(1); }} />
    </div>
    {analysisNotice && <p role="status" className="type-body-sm text-text-secondary">{analysisNotice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2">
      <p className="type-body-sm text-text-secondary" aria-live="polite"><strong className="text-text-primary">{entries.length} selected</strong> across pages
        {otherDrafts > 0 ? ` · ${otherDrafts} in other scopes` : ''}</p>
      <div className="flex flex-wrap items-center gap-2">
        {assist?.pending > 0 && <button className="btn-secondary" type="button" disabled={blocked || analyzing} onClick={analyze}>
          {analyzing ? 'Analyzing…' : `Analyze exceptions (${assist.pending})`}
        </button>}
        {pageSuggestions.length > 0 && <button className="btn-secondary" type="button" disabled={blocked || staged.size >= maxSelected}
          onClick={() => addSuggestions(pageSuggestions)}>Select page ({Math.min(pageSuggestions.length, maxSelected - staged.size)})</button>}
        {suggestions.length > 0 && <button className="btn-secondary" type="button" disabled={blocked || staged.size >= maxSelected}
          title="Includes reviewable suggestions on every page in this classification scope" onClick={() => addSuggestions(suggestions)}>
          {staged.size ? 'Add remaining' : 'Select all suggestions'} ({Math.min(suggestions.length, maxSelected - staged.size)})
        </button>}
        {staged.size > 0 && <button className="btn-secondary" type="button" disabled={saving} onClick={() => setStaged(new Map())}>Clear selection</button>}
        <button className="btn-primary" type="button" disabled={blocked || !entries.length} onClick={() => { setError(''); setRemember(false); setConfirming(true); }}>Review selected ({entries.length})</button>
      </div>
    </div>
    {notice && <p role="status" className="type-body-sm">{notice}</p>}
    {error && !confirming && <p role="alert" className="type-body-sm text-text-secondary">{error}</p>}
    {stale && <button className="btn-secondary justify-self-start" type="button" onClick={onReload}>Reload latest review</button>}
    {visible.length ? <DataTable columns={columns} rows={visible} getRowKey={(row) => row.account_key} density="compact" minWidth={610} />
      : <p className="type-body-sm text-text-secondary">No accounts match this filter.</p>}
    <AdminPagination compact page={page} total={filtered.length} pageSize={pageSize} onPageChange={setPage}
      onPageSizeChange={(value) => { setPage(1); setPageSize(value); }} />
    {drawer === 'library' && <FinanceClassificationLibrary classifications={review.classifications} rows={review.rows} onClose={() => setDrawer(null)} />}
    {drawer === 'analysis' && <Drawer title="Analysis Details" onClose={() => setDrawer(null)} bodyClassName="space-y-4">
      <dl className="grid grid-cols-2 gap-3 type-body-sm">
        {[
          ['Accepted chart', timestamp(review.snapshotAt)], ['Classification scope', industries.find((option) => option.value === industry)?.label],
          ['Queued for AI', assist?.pending], ['AI reviewed', assist?.reviewed], ['Last run', assist?.lastRun?.state],
          ['Model', assist?.lastRun?.model], ['Completed', assist?.lastRun?.finishedAt && timestamp(assist.lastRun.finishedAt)],
          ['Input tokens', assist?.lastRun?.input], ['Output tokens', assist?.lastRun?.output], ['Provider cached input tokens', assist?.lastRun?.cached],
        ].map(([name, value]) => <div key={name}><dt className="text-text-secondary">{name}</dt><dd className="font-medium">{value ?? '—'}</dd></div>)}
      </dl>
      {assist?.lastRun?.error && <p className="type-body-sm text-text-secondary">Last run did not complete. Approved mappings and cached results remain available.</p>}
    </Drawer>}
    {confirming && <Modal title="Confirm account classifications" description="Save analytical classifications to this Account Book. Source accounting treatment and official statement amounts stay as supplied."
      size="md" onClose={() => { if (!saving) setConfirming(false); }}>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto type-body-sm" aria-label="Selected classifications">
        {entries.map((row) => <li key={row.account_key} className="grid gap-1 py-2 sm:grid-cols-2">
          <span><strong>{row.account_key}</strong> {row.description}</span>
          <span>{row.classification && `${label(row.classification)} → `}{label(staged.get(row.account_key))}</span>
        </li>)}
      </ul>
      {error && <p role="alert" className="my-2 type-body-sm">{error}</p>}
      <label className="mt-3 flex items-start gap-2 type-body-sm">
        <input type="checkbox" checked={remember} disabled={saving} onChange={(event) => setRemember(event.target.checked)} />
        Remember approved choices for exact source matches within this Legal Entity and provider
      </label>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button className="btn-secondary" type="button" disabled={saving} onClick={() => setConfirming(false)}>Back</button>
        <button className="btn-primary" type="button" disabled={saving} onClick={save}>{saving ? 'Confirming…' : `Confirm ${entries.length} ${entries.length === 1 ? 'classification' : 'classifications'}`}</button>
      </div>
    </Modal>}
  </div>;
}

export default function FinanceAccountMapping({ connectionId, revision, timestamp, onChange }) {
  const [refresh, setRefresh] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);
  const [result, setResult] = useState({ loading: true });
  const request = useRef(0);
  const reload = () => { setHasDraft(false); setResult({ loading: true }); setRefresh((value) => value + 1); };
  useEffect(() => {
    const onFocus = () => setRefresh((value) => value + 1);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  useEffect(() => {
    if (hasDraft) return undefined;
    const pending = ++request.current;
    Promise.resolve().then(() => readAccountMapping(connectionId)).then((review) => {
      if (request.current === pending) setResult({ review });
    }).catch(() => {
      if (request.current === pending) setResult((current) => current.review ? current : { error: 'The accepted chart of accounts could not be loaded.' });
    });
    return () => { request.current += 1; };
  }, [connectionId, revision, refresh, hasDraft]);
  return <AsyncDataSurface loading={result.loading} error={result.error} hasData={Boolean(result.review)}
    isEmpty={result.review === null} emptyTitle="No accepted chart of accounts" loadingRows={3} onRetry={reload}>
    {result.review && <MappingReviewTable review={result.review} timestamp={timestamp} onReload={reload} onDraftChange={setHasDraft}
      onSaved={(review) => { request.current += 1; setResult({ review }); onChange?.(connectionId, review.summary); }} />}
  </AsyncDataSurface>;
}
