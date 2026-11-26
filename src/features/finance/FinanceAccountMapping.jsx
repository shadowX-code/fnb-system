import { useEffect, useState } from 'react';
import AsyncDataSurface from '../../components/feedback/AsyncDataSurface.jsx';
import Modal from '../../components/feedback/Modal.jsx';
import AdminSearchField from '../../components/forms/AdminSearchField.jsx';
import SelectField from '../../components/forms/SelectField.jsx';
import AdminPagination from '../../components/tables/AdminPagination.jsx';
import DataTable from '../../components/tables/DataTable.jsx';
import StatusBadge from '../../components/ui/StatusBadge.jsx';
import { readAccountMapping, confirmAccountMapping } from './dataSources.js';

const statuses = {
  suggested: 'Suggested', manual_review: 'Needs classification', new: 'New account', changed: 'Source changed',
  confirmed: 'Confirmed', group: 'Group only', ambiguous: 'Hierarchy review',
};
const filters = [
  ['all', 'All accounts'], ['unresolved', 'Needs review'], ['suggested', 'With suggestions'],
  ['confirmed', 'Confirmed'], ['changed', 'Changed or new'], ['group', 'Group accounts'], ['posted', 'Used in accepted GL'],
];
const issues = {
  hierarchy: 'Parent chain is missing, circular or too deep.',
  group_postings: 'This group also has direct GL postings. Review it in the source.',
};
const maxSelected = 500;
const industries = [
  { value: 'core', label: 'Core only' }, { value: 'restaurant', label: 'Restaurant' },
  { value: 'manufacturing', label: 'Manufacturing' }, { value: 'retail', label: 'Retail' },
];

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
    case 'suggested': return row.suggestion && row.status !== 'confirmed';
    case 'changed': return ['changed', 'new'].includes(row.status);
    case 'group': return row.role === 'group';
    case 'posted': return row.posted;
    default: return row.status === status;
  }
}

function MappingReviewTable({ review, timestamp, onSaved, onReload }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [industry, setIndustry] = useState('core');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [staged, setStaged] = useState(() => new Map());
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [stale, setStale] = useState(false);

  const classes = new Map(review.classifications.map((entry) => [entry.id, entry]));
  const label = (id) => classes.has(id) ? classes.get(id).label : '—';
  const suggestionFor = (row) => {
    const candidate = classes.get(row.suggestion);
    return candidate?.industry && candidate.industry !== industry ? row.core_suggestion : row.suggestion;
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
  const needle = search.trim().toLowerCase();
  const filtered = review.rows.filter((row) => matches(row, filter) &&
    [row.account_key, row.description, row.parent_key, row.parent_description, row.source_type, label(suggestionFor(row)), label(row.classification)]
      .some((value) => value?.toLowerCase().includes(needle)));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const suggestions = visible.filter((row) => row.status !== 'confirmed' && suggestionFor(row) && !staged.has(row.account_key));
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
  function selectVisible() {
    setStaged((prev) => {
      const next = new Map(prev);
      for (const row of suggestions.slice(0, maxSelected - next.size)) next.set(row.account_key, suggestionFor(row));
      return next;
    });
    setNotice('');
  }
  async function save() {
    setSaving(true);
    setError('');
    try {
      const next = await confirmAccountMapping(review.connectionId, review.snapshotId, entries.map((row) => ({
        accountKey: row.account_key, classificationId: staged.get(row.account_key), expectedVersion: row.version,
      })));
      setStaged(new Map());
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
    { key: 'suggestion', header: 'Suggested', width: 145, render: (row) => label(suggestionFor(row)) },
    { key: 'classification', header: 'Analytical classification', width: 240, render: (row) => {
      const selected = staged.get(row.account_key) ?? (row.status === 'confirmed' ? row.classification : '');
      return <div>
        {row.role === 'posting' && row.source_scope && <SelectField
          ariaLabel={`Classification for ${row.account_key}`} searchable placeholder="Choose classification"
          value={selected} options={choices(row, selected)}
          disabled={blocked || (staged.size >= maxSelected && !staged.has(row.account_key))}
          onChange={(value) => stage(row, value)} />}
        {row.role === 'posting' && !row.source_scope && <span className="type-caption text-text-secondary">
          {selected ? `${label(selected)} · ` : ''}Source type needs verification
        </span>}
        {row.status === 'changed' && <p className="type-caption text-text-secondary">Previous confirmation · {label(row.classification)}</p>}
        {row.role !== 'posting' && row.status !== 'changed' && <span className="type-caption text-text-secondary">Excluded from confirmation</span>}
      </div>;
    }},
  ];

  const { total, confirmed, unresolved, groups, ambiguous, changed, removed } = review.summary;
  return <div className="grid min-w-0 gap-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h3 className="type-section-title font-semibold">Smart Mapping</h3>
        <p className="type-body-sm text-text-secondary">Accepted chart · {timestamp(review.snapshotAt)}</p>
      </div>
      <button className="btn-secondary" type="button" disabled={saving || (staged.size > 0 && !stale)} onClick={onReload}>Reload latest review</button>
    </div>
    <p className="type-body-sm" aria-live="polite">{total} source accounts · {confirmed} confirmed · {unresolved} need review · {groups} group accounts
      {ambiguous ? ` · ${ambiguous} hierarchy issues` : ''}{changed ? ` · ${changed} changed` : ''}{removed ? ` · ${removed} previously reviewed accounts absent` : ''}</p>
    <div className="flex flex-wrap items-end gap-2">
      <AdminSearchField label="Find accounts" value={search} maxLength={128} onChange={(value) => { setSearch(value); setPage(1); }} />
      <label className="grid gap-1 type-caption">Filter accounts
        <select className="control" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
          {filters.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      <SelectField label="Industry categories" value={industry} options={industries} onChange={setIndustry} />
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-secondary" type="button" disabled={blocked || !suggestions.length || staged.size >= maxSelected} onClick={selectVisible}>Select suggestions on this page</button>
      {staged.size > 0 && <button className="btn-secondary" type="button" disabled={saving} onClick={() => setStaged(new Map())}>Clear selection</button>}
      <button className="btn-primary" type="button" disabled={blocked || !entries.length} onClick={() => { setError(''); setConfirming(true); }}>Review selected ({entries.length})</button>
    </div>
    {notice && <p role="status" className="type-body-sm">{notice}</p>}
    {error && !confirming && <p role="alert" className="type-body-sm text-text-secondary">{error}</p>}
    {visible.length ? <DataTable columns={columns} rows={visible} getRowKey={(row) => row.account_key} density="compact" minWidth={720} />
      : <p className="type-body-sm text-text-secondary">No accounts match this filter.</p>}
    <AdminPagination compact page={page} total={filtered.length} pageSize={pageSize} onPageChange={setPage}
      onPageSizeChange={(value) => { setPage(1); setPageSize(value); }} />
    {confirming && <Modal title="Confirm account classifications" description="Save analytical classifications to this Account Book. Source accounting treatment and official statement amounts stay as supplied."
      size="md" onClose={() => { if (!saving) setConfirming(false); }}>
      <ul className="max-h-64 divide-y divide-border overflow-y-auto type-body-sm" aria-label="Selected classifications">
        {entries.map((row) => <li key={row.account_key} className="grid gap-1 py-2 sm:grid-cols-2">
          <span><strong>{row.account_key}</strong> {row.description}</span>
          <span>{row.classification && `${label(row.classification)} → `}{label(staged.get(row.account_key))}</span>
        </li>)}
      </ul>
      {error && <p role="alert" className="my-2 type-body-sm">{error}</p>}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button className="btn-secondary" type="button" disabled={saving} onClick={() => setConfirming(false)}>Back</button>
        <button className="btn-primary" type="button" disabled={saving} onClick={save}>{saving ? 'Confirming…' : `Confirm ${entries.length} ${entries.length === 1 ? 'classification' : 'classifications'}`}</button>
      </div>
    </Modal>}
  </div>;
}

export default function FinanceAccountMapping({ connectionId, timestamp, onChange }) {
  const [loadId, setLoadId] = useState(0);
  const [result, setResult] = useState({ loading: true });
  const reload = () => { setResult({ loading: true }); setLoadId((value) => value + 1); };
  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => readAccountMapping(connectionId)).then((review) => {
      if (active) setResult({ review });
    }).catch(() => {
      if (active) setResult({ error: 'The accepted chart of accounts could not be loaded.' });
    });
    return () => { active = false; };
  }, [connectionId, loadId]);
  return <AsyncDataSurface loading={result.loading} error={result.error} hasData={Boolean(result.review)}
    isEmpty={result.review === null} emptyTitle="No accepted chart of accounts" loadingRows={3} onRetry={reload}>
    {result.review && <MappingReviewTable review={result.review} timestamp={timestamp} onReload={reload}
      onSaved={(review) => { setResult({ review }); onChange?.(connectionId, review.summary); }} />}
  </AsyncDataSurface>;
}
