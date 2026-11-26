alter table finance_private.account_mapping_reviews add column memory_key text;

create table finance_private.mapping_ai_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references finance_private.source_connections(id),
  snapshot_id bigint not null references finance_private.source_snapshots(id),
  industry text not null,
  registry_version text not null,
  model text not null,
  targets jsonb not null,
  state text not null default 'running' check (state in ('running','completed','failed')),
  error_code text,
  input_tokens integer check (input_tokens>=0),
  output_tokens integer check (output_tokens>=0),
  cached_tokens integer check (cached_tokens>=0 and cached_tokens<=input_tokens),
  created_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
create index mapping_ai_runs_connection_created on finance_private.mapping_ai_runs(connection_id,created_at desc);

create table finance_private.mapping_ai_results (
  connection_id uuid not null references finance_private.source_connections(id),
  registry_version text not null,
  industry text not null,
  evidence_key text not null,
  run_id uuid not null references finance_private.mapping_ai_runs(id),
  classification_id text references finance_private.financial_classifications(id),
  basis text not null check (basis in ('source_support','keep_rule','ambiguous','tax_treatment','source_conflict','insufficient')),
  primary key (connection_id,registry_version,industry,evidence_key)
);
alter table finance_private.mapping_ai_runs enable row level security;
alter table finance_private.mapping_ai_results enable row level security;
revoke all on finance_private.mapping_ai_runs,finance_private.mapping_ai_results from public,anon,authenticated,service_role;

-- Exact contextual evidence shared only by explicitly opted-in reviews.
create function finance_private.mapping_memory_key(p_type text,p_label text,p_parent text,p_parent_label text,p_currency text)
returns text language sql immutable set search_path='' as $$
  select case when nullif(btrim(p_label),'') is not null then encode(extensions.digest(jsonb_build_array(
    p_type,lower(regexp_replace(btrim(p_label),'[[:space:]]+',' ','g')),p_parent,
    lower(regexp_replace(btrim(p_parent_label),'[[:space:]]+',' ','g')),p_currency
  )::text,'sha256'),'hex') end;
$$;

create function finance_private.mapping_assistance_version()
returns text language sql stable set search_path='' as $$
  select encode(extensions.digest('smart-mapping-policy-v1:' ||
    jsonb_agg(to_jsonb(c) order by c.id collate "C")::text,'sha256'),'hex')
  from finance_private.financial_classifications c;
$$;

-- The model can compare grounded candidates or abstain. Source type gates the
-- entire list. Sensitive/specific categories require corroborating source wording.
create function finance_private.mapping_ai_candidates(p_scope text,p_label text,p_rule text,p_industry text)
returns text[] language sql stable set search_path='' as $$
  select coalesce(array_agg(f.id order by f.sort_order),'{}') from finance_private.financial_classifications f
  where f.selectable and p_scope=any(f.source_scopes)
    and (f.industry is null or f.industry=p_industry)
    and lower(coalesce(p_label,'')) !~ '\m(temporary|suspense|clearing|rounding|contra)\M'
    and (f.id in (p_rule,finance_private.account_mapping_core_suggestion(p_rule))
      or (f.id='liabilities.current_borrowings' and p_scope='current_liability' and lower(p_label) ~ '^loan[[:space:]-]+')
      or (f.id='other_income.other_recoveries' and p_scope='other_income' and lower(p_label) ~ '\mused oil\M')
      or (f.id='opex.other_operating_expense' and p_scope='expense' and lower(p_label) ~ '\mdisposable (accessories|supplies)\M'));
$$;

create function finance_private.mapping_assistance_source(p_connection uuid)
returns table(snapshot_id bigint,baseline_id bigint,provider text,legal_entity_id uuid)
language sql stable set search_path='' as $$
  select selected.id,selected.baseline,c.provider,c.legal_entity_id
  from finance_private.source_connections c join public.legal_entities e on e.id=c.legal_entity_id
  left join finance_private.autocount_books b on b.id=c.autocount_book_id
  left join finance_private.autocount_devices d on d.id=b.device_id
  cross join lateral (
    select s.id,min(s.id) over () as baseline from finance_private.source_snapshots s
    join finance_private.source_receipts r on r.connection_id=s.connection_id and r.snapshot_id=s.id
    where s.connection_id=c.id and s.dataset='COA' order by r.received_at desc,s.id desc limit 1
  ) selected
  where c.id=p_connection and c.active and c.verified_at is not null and e.is_active and c.superseded_by_connection_id is null
    and (c.autocount_book_id is null or (b.ready and d.active));
$$;

create function finance_private.mapping_assistance_rows(p_connection uuid,p_industry text)
returns table(account_key text,description text,parent_description text,source_type text,source_scope text,
  rule_id text,evidence_key text,memory_id text,memory_conflict boolean,targeted boolean,
  candidate_ids text[],ai_checked boolean,ai_id text,basis text,posted boolean)
language sql stable set search_path='' as $$
  with source as materialized (select * from finance_private.mapping_assistance_source(p_connection)),
  accounts as materialized (
    select a.*, i->>'currency' as currency,finance_private.account_mapping_source_scope(s.provider,a.source_type) as scope
    from source s cross join lateral finance_private.account_mapping_rows(p_connection,s.snapshot_id,s.baseline_id,s.provider) a
    join finance_private.source_snapshots snap on snap.id=s.snapshot_id
    join lateral jsonb_array_elements(snap.rows) i on i->>'key'=a.account_key
    where a.role='posting' and a.classification is null
  ), review_sources as materialized (
    select c.id,live.* from source s
    join finance_private.source_connections c on c.legal_entity_id=s.legal_entity_id and c.provider=s.provider
    cross join lateral finance_private.mapping_assistance_source(c.id) live
    where exists (select 1 from finance_private.account_mapping_reviews m where m.connection_id=c.id and m.memory_key is not null)
  ), reviewed as materialized (
    select distinct on (r.connection_id,r.account_key) r.connection_id,r.account_key,r.memory_key,r.classification_id,r.source_fingerprint
    from review_sources s join finance_private.account_mapping_reviews r on r.connection_id=s.id
    order by r.connection_id,r.account_key,r.id desc
  ), remembered as (
    select m.memory_key,array_agg(distinct m.classification_id) as ids
    from review_sources s cross join lateral finance_private.account_mapping_rows(s.id,s.snapshot_id,s.baseline_id,s.provider) a
    join reviewed m on m.connection_id=s.id and m.account_key=a.account_key and m.source_fingerprint=a.fingerprint
    where a.status='confirmed' and m.memory_key is not null group by m.memory_key
  ), evaluated as (
    select a.*, m.ids,
      a.suggestion is null or a.suggestion in (
        'cogs','labour','opex','other_income','assets.current_other','assets.noncurrent_other',
        'liabilities.current_other','liabilities.noncurrent_other'
      ) as broad
    from accounts a left join remembered m on m.memory_key=finance_private.mapping_memory_key(a.source_type,a.description,a.parent_key,a.parent_description,a.currency)
  ), scored as (
    select a.*,
      (coalesce(cardinality(a.ids),0)>1 or (not a.broad and cardinality(a.ids)=1 and a.ids[1]<>a.suggestion)) as conflict,
      case when cardinality(a.ids)=1 and finance_private.account_mapping_allowed(a.ids[1],a.scope)
        and exists (select 1 from finance_private.financial_classifications f where f.id=a.ids[1] and (f.industry is null or f.industry=p_industry))
        then a.ids[1] end as memory
    from evaluated a
  )
  select a.account_key,a.description,a.parent_description,a.source_type,a.scope,a.suggestion,
    encode(extensions.digest(a.fingerprint || convert_to(jsonb_build_array(a.suggestion,coalesce(a.conflict,false))::text,'UTF8'),'sha256'),'hex'),
    case when not coalesce(a.conflict,false) then a.memory end,coalesce(a.conflict,false),
    a.scope is not null and (a.broad or coalesce(a.conflict,false)) and (a.memory is null or coalesce(a.conflict,false)),
    finance_private.mapping_ai_candidates(a.scope,a.description,a.suggestion,p_industry),
    r.run_id is not null,r.classification_id,r.basis,a.posted
  from scored a left join finance_private.mapping_ai_results r on r.connection_id=p_connection and r.industry=p_industry
    and r.registry_version=finance_private.mapping_assistance_version()
    and r.evidence_key=encode(extensions.digest(a.fingerprint || convert_to(jsonb_build_array(a.suggestion,coalesce(a.conflict,false))::text,'UTF8'),'sha256'),'hex');
$$;

create function public.finance_account_mapping_assistance(p_connection_id uuid,p_industry text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  source record;
begin
  if not finance_private.is_source_owner() then raise sqlstate 'PT403' using message='Owner access required'; end if;
  if p_industry is null or p_industry not in ('core','restaurant','manufacturing','retail') then
    raise sqlstate 'PT422' using message='Unknown industry filter'; end if;
  select * into source from finance_private.mapping_assistance_source(p_connection_id);
  if not found then raise sqlstate 'PT404' using message='Accepted chart unavailable'; end if;
  return (select jsonb_build_object(
    'snapshotId',source.snapshot_id::text,
    'pending',count(*) filter(where a.targeted and not a.ai_checked),
    'reviewed',count(*) filter(where a.targeted and a.ai_checked),
    'rows',coalesce(jsonb_object_agg(a.account_key,jsonb_build_object(
      'targeted',a.targeted,'memory',a.memory_id,'conflict',a.memory_conflict,'checked',a.ai_checked,
      'proposal',a.ai_id,'basis',a.basis
    )) filter(where a.targeted or a.memory_id is not null or a.memory_conflict),'{}'::jsonb),
    'lastRun',(select jsonb_build_object('model',m.model,'state',m.state,'error',m.error_code,
      'accounts',jsonb_array_length(m.targets),'input',m.input_tokens,'output',m.output_tokens,
      'cached',m.cached_tokens,'finishedAt',m.finished_at)
      from finance_private.mapping_ai_runs m
      where m.connection_id=p_connection_id and m.industry=p_industry
        and m.registry_version=finance_private.mapping_assistance_version()
      order by m.created_at desc limit 1)
  ) from finance_private.mapping_assistance_rows(p_connection_id,p_industry) a);
end;
$$;

create function public.finance_mapping_ai_prepare(p_connection uuid,p_snapshot bigint,p_industry text,p_model text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  source record;
  targets jsonb;
  categories jsonb;
  run_id uuid;
  version text:=finance_private.mapping_assistance_version();
begin
  if p_industry is null or p_industry not in ('core','restaurant','manufacturing','retail') or p_model is distinct from 'gpt-4.1-mini' then
    raise sqlstate 'PT422' using message='Invalid analysis settings'; end if;
  perform 1 from finance_private.source_connections where id=p_connection for update;
  select * into source from finance_private.mapping_assistance_source(p_connection);
  if not found or source.snapshot_id is distinct from p_snapshot then raise sqlstate 'PT409' using message='Accepted chart changed'; end if;
  if exists(select 1 from finance_private.mapping_ai_runs r where r.connection_id=p_connection and r.state='running'
    and r.created_at>clock_timestamp()-interval '90 seconds') then return '{"state":"running"}'::jsonb; end if;
  update finance_private.mapping_ai_runs set state='failed',error_code='analysis_interrupted',finished_at=clock_timestamp()
    where connection_id=p_connection and state='running';
  select jsonb_agg(to_jsonb(t) order by t.row_number) into targets from (
    select row_number() over (order by (a.rule_id is not null),a.posted desc,a.account_key collate "C") as row_number,
      a.account_key,a.evidence_key,left(a.description,160) as description,left(a.parent_description,120) as parent_description,
      a.source_type,a.source_scope,a.rule_id,a.candidate_ids,a.memory_conflict
    from finance_private.mapping_assistance_rows(p_connection,p_industry) a
    where a.targeted and not a.ai_checked
    order by (a.rule_id is not null),a.posted desc,a.account_key collate "C" limit 24
  ) t;
  if targets is null then return '{"state":"cached"}'::jsonb; end if;
  if (select count(*) from finance_private.mapping_ai_runs r where r.connection_id=p_connection
    and r.created_at>clock_timestamp()-interval '24 hours') >= 12 then return '{"state":"limited"}'::jsonb; end if;
  select coalesce(jsonb_object_agg(f.id,f.label),'{}') into categories from finance_private.financial_classifications f where f.id in (
    select c.id from jsonb_array_elements(targets) t cross join lateral jsonb_array_elements_text(t->'candidate_ids') c(id)
  );
  insert into finance_private.mapping_ai_runs(connection_id,snapshot_id,industry,registry_version,model,targets)
  values (p_connection,p_snapshot,p_industry,version,p_model,
    (select jsonb_agg(t-'description'-'parent_description' order by t->'row_number') from jsonb_array_elements(targets) t))
  returning id into run_id;
  return jsonb_build_object('state','ready','runId',run_id,'targets',targets,'categories',categories);
end;
$$;

create function public.finance_mapping_ai_finish(p_run uuid,p_results jsonb,p_error text,p_input integer,p_output integer,p_cached integer)
returns void language plpgsql security definer set search_path='' as $$
declare
  batch finance_private.mapping_ai_runs;
  source record;
begin
  select * into batch from finance_private.mapping_ai_runs where id=p_run;
  if not found then raise sqlstate 'PT404' using message='Analysis run unavailable'; end if;
  perform 1 from finance_private.source_connections where id=batch.connection_id for update;
  select * into batch from finance_private.mapping_ai_runs where id=p_run for update;
  if batch.state<>'running' then return; end if;
  select * into source from finance_private.mapping_assistance_source(batch.connection_id);
  if not found or source.snapshot_id is distinct from batch.snapshot_id
    or batch.registry_version is distinct from finance_private.mapping_assistance_version() then p_error:='chart_changed'; end if;
  if p_error is null and jsonb_typeof(p_results) is distinct from 'array' then p_error:='provider_invalid'; end if;
  if p_error is null and (
    jsonb_array_length(p_results) is distinct from jsonb_array_length(batch.targets)
    or exists(
      select 1 from jsonb_array_elements(batch.targets) t
      left join lateral (select count(*) as hits from jsonb_array_elements(p_results) x where x->'row' = t->'row_number') match on true
      where match.hits<>1
    )
  ) then p_error:='provider_invalid'; end if;
  if p_error is null then
    with checked as (
      select t->>'evidence_key' as key,x->>'classificationId' as candidate,x->>'basis' as basis,t->'candidate_ids' as candidates,
        t->>'source_scope' as scope,t->>'rule_id' as rule
      from jsonb_array_elements(batch.targets) t join jsonb_array_elements(p_results) x on x->'row'=t->'row_number'
    ), validated as (
      select *,coalesce(candidates ? candidate,false) and finance_private.account_mapping_allowed(candidate,scope)
        and (basis='source_support' or (basis='keep_rule' and candidate in (rule,finance_private.account_mapping_core_suggestion(rule)))) as allowed from checked
    )
    insert into finance_private.mapping_ai_results(connection_id,registry_version,industry,evidence_key,run_id,classification_id,basis)
    select batch.connection_id,batch.registry_version,batch.industry,key,batch.id,
      case when allowed then candidate end,
      case when allowed then basis when candidate is null and basis in ('ambiguous','tax_treatment','source_conflict','insufficient') then basis
        else 'insufficient' end
    from validated on conflict do nothing;
  end if;
  update finance_private.mapping_ai_runs set state=case when p_error is null then 'completed' else 'failed' end,
    error_code=p_error,input_tokens=p_input,output_tokens=p_output,cached_tokens=p_cached,finished_at=clock_timestamp()
  where id=batch.id;
end;
$$;

revoke all on function finance_private.mapping_memory_key(text,text,text,text,text),finance_private.mapping_assistance_version(),
  finance_private.mapping_ai_candidates(text,text,text,text),finance_private.mapping_assistance_source(uuid),
  finance_private.mapping_assistance_rows(uuid,text),public.finance_account_mapping_assistance(uuid,text),
  public.finance_mapping_ai_prepare(uuid,bigint,text,text),public.finance_mapping_ai_finish(uuid,jsonb,text,integer,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.finance_account_mapping_assistance(uuid,text) to authenticated;
grant execute on function public.finance_mapping_ai_prepare(uuid,bigint,text,text),public.finance_mapping_ai_finish(uuid,jsonb,text,integer,integer,integer) to service_role;

create or replace function public.finance_account_mapping_review(
  p_connection_id uuid,p_snapshot_id bigint default null,p_decisions jsonb default null,p_summary_only boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  source finance_private.source_connections;
  snapshot record;
  baseline_id bigint;
  rows jsonb;
  summary jsonb;
  invalid_count integer;
  incompatible_count integer;
  decision_count integer;
begin
  if not finance_private.is_source_owner() then raise sqlstate 'PT403' using message='Owner access required'; end if;
  -- Uploads and source lifecycle changes serialize on this connection row.
  if p_decisions is not null then
    perform 1 from finance_private.source_connections where id=p_connection_id for update;
  end if;
  select c.* into source from finance_private.source_connections c
  join public.legal_entities e on e.id=c.legal_entity_id
  left join finance_private.autocount_books b on b.id=c.autocount_book_id
  left join finance_private.autocount_devices d on d.id=b.device_id
  where c.id=p_connection_id and c.active and c.verified_at is not null and e.is_active
    and c.superseded_by_connection_id is null and (c.autocount_book_id is null or (b.ready and d.active));
  if not found then raise sqlstate 'PT404' using message='Current source unavailable'; end if;

  select s.id,s.accepted_at into snapshot
  from finance_private.source_snapshots s join finance_private.source_receipts r on r.connection_id=s.connection_id and r.snapshot_id=s.id
  where s.connection_id=source.id and s.dataset='COA' order by r.received_at desc,s.id desc limit 1;
  if snapshot.id is null then
    if p_decisions is not null then raise sqlstate 'PT409' using message='Accepted chart of accounts required'; end if;
    return null;
  end if;
  select min(s.id) into baseline_id
  from finance_private.source_snapshots s join finance_private.source_receipts r on r.connection_id=s.connection_id and r.snapshot_id=s.id
  where s.connection_id=source.id and s.dataset='COA';

  if p_decisions is not null then
    if snapshot.id is distinct from p_snapshot_id then raise sqlstate 'PT409' using message='Chart of accounts changed. Refresh the review.'; end if;
    if jsonb_typeof(p_decisions)<>'array' then raise sqlstate 'PT422' using message='Invalid mapping decisions'; end if;
    decision_count:=jsonb_array_length(p_decisions);
    if decision_count not between 1 and 500 then raise sqlstate 'PT422' using message='Select between 1 and 500 accounts'; end if;
    if exists (select 1 from jsonb_array_elements(p_decisions) item
      where jsonb_typeof(item)<>'object' or nullif(item->>'accountKey','') is null or nullif(item->>'classificationId','') is null
        or not (item ? 'expectedVersion') or (item ? 'remember' and jsonb_typeof(item->'remember')<>'boolean')) or
      (select count(distinct item->>'accountKey') from jsonb_array_elements(p_decisions) item)<>decision_count then
      raise sqlstate 'PT422' using message='Invalid or duplicate mapping decisions';
    end if;

    with selected as (
      select r.*,item->>'expectedVersion' as expected_version,item->>'classificationId' as target
      from jsonb_array_elements(p_decisions) item
      left join finance_private.account_mapping_rows(source.id,snapshot.id,baseline_id,source.provider) r on r.account_key=item->>'accountKey'
    )
    select
      count(*) filter (where account_key is null or role<>'posting' or
        (not (status='confirmed' and classification=target) and version is distinct from expected_version)),
      count(*) filter (where account_key is not null and role='posting'
        and not (status='confirmed' and classification is not distinct from target)
        and not finance_private.account_mapping_allowed(target,finance_private.account_mapping_source_scope(source.provider,source_type)))
    into invalid_count,incompatible_count from selected;
    if invalid_count>0 then raise sqlstate 'PT409' using message='Accounts or reviews changed. Refresh before confirming.'; end if;
    if incompatible_count>0 then raise sqlstate 'PT422' using message='Classification is incompatible with the accepted source type'; end if;

    insert into finance_private.account_mapping_reviews(connection_id,account_key,coa_snapshot_id,source_fingerprint,classification_id,decision,reviewed_by,memory_key)
    select source.id,r.account_key,snapshot.id,r.fingerprint,item->>'classificationId',
      case when item->>'classificationId' in (r.suggestion,finance_private.account_mapping_core_suggestion(r.suggestion))
        then 'suggestion' else 'manual' end,auth.uid(),
      case when item->>'remember'='true' then finance_private.mapping_memory_key(
        r.source_type,r.description,r.parent_key,r.parent_description,account.row_data->>'currency') end
    from jsonb_array_elements(p_decisions) item
    join finance_private.account_mapping_rows(source.id,snapshot.id,baseline_id,source.provider) r on r.account_key=item->>'accountKey'
    join finance_private.source_snapshots confirmed_chart on confirmed_chart.id=snapshot.id
    join lateral jsonb_array_elements(confirmed_chart.rows) account(row_data) on account.row_data->>'key'=r.account_key
    where r.status<>'confirmed' or r.classification<>item->>'classificationId';
  end if;

  with review as materialized (select * from finance_private.account_mapping_rows(source.id,snapshot.id,baseline_id,source.provider))
  select jsonb_build_object(
    'total',count(*),'posting',count(*) filter (where role='posting'),
    'groups',count(*) filter (where role='group'),'ambiguous',count(*) filter (where role='ambiguous'),
    'confirmed',count(*) filter (where status='confirmed'),'unresolved',count(*) filter (where role<>'group' and status<>'confirmed'),
    'suggested',count(*) filter (where suggestion is not null and status<>'confirmed'),
    'changed',count(*) filter (where status='changed'),'new',count(*) filter (where status='new'),
    'removed',(select count(distinct m.account_key) from finance_private.account_mapping_reviews m
      where m.connection_id=source.id and not exists (select 1 from review r where r.account_key=m.account_key)))
  ,case when not p_summary_only then coalesce(jsonb_agg((to_jsonb(review)-'fingerprint') || jsonb_build_object(
      'source_scope',finance_private.account_mapping_source_scope(source.provider,source_type),
      'core_suggestion',finance_private.account_mapping_core_suggestion(suggestion)
    ) order by account_key collate "C"),'[]'::jsonb) end
  into summary,rows from review;
  return jsonb_build_object('connectionId',source.id,'snapshotId',snapshot.id::text,'snapshotAt',snapshot.accepted_at,'summary',summary,
    'rows',rows,'classifications',case when not p_summary_only then
      (select jsonb_agg(to_jsonb(f) order by f.sort_order) from finance_private.financial_classifications f) end);
end;
$$;
