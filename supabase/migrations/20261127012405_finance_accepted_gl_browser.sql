-- Browse the latest receipt-backed observation per posting date. Paging pins
-- the receipt cutoff and the same-connection chart independently of sync.
create function public.finance_accounting_gl_records(
  p_connection_id uuid, p_from date default null, p_to date default null,
  p_as_of timestamptz default null, p_coa_snapshot_id bigint default null,
  p_account text default null, p_search text default '', p_offset integer default 0, p_limit integer default 20
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  chart jsonb;
  chart_id bigint;
  receipt_cutoff timestamptz:=coalesce(p_as_of,statement_timestamp());
  search_text text:=lower(btrim(coalesce(p_search,'')));
begin
  if not finance_private.is_source_owner() then raise sqlstate 'PT403' using message='Owner access required'; end if;
  if ((p_from is null)<>(p_to is null)) or p_from>p_to or not isfinite(p_from) or not isfinite(p_to)
    or not isfinite(receipt_cutoff) or receipt_cutoff>statement_timestamp()
    or length(search_text)>128 or length(p_account)>128 or p_coa_snapshot_id<1
    or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 100 then
    raise sqlstate 'PT422' using message='Invalid posting period, account or page';
  end if;

  -- Use the existing dataset owner's active book, entity and device checks.
  -- A GL book without a chart remains browseable with the original account codes.
  chart:=public.finance_accounting_dataset(p_connection_id,'COA',null,p_coa_snapshot_id,'',0,1);
  chart_id:=case when p_as_of is not null then p_coa_snapshot_id else (chart->>'snapshotId')::bigint end;

  return (with accepted_days as materialized (
    select distinct on (s.scope_date) s.scope_date,s.rows,r.received_at
    from finance_private.source_snapshots s join finance_private.source_receipts r on r.connection_id=s.connection_id and r.snapshot_id=s.id
    where s.connection_id=p_connection_id and s.dataset='GL' and s.scope_date is not null and r.received_at<=receipt_cutoff
      and (p_from is null or s.scope_date between p_from and p_to)
    order by s.scope_date,r.received_at desc,s.id desc
  ), chart_accounts as materialized (
    select item->>'key' as code,nullif(btrim(item->>'description'),'') as name
    from finance_private.source_snapshots s cross join lateral jsonb_array_elements(s.rows) item
    where s.id=chart_id and s.connection_id=p_connection_id and s.dataset='COA'
  ), accepted_rows as materialized (
    select a.scope_date as posting_date, item as row_data, item->>'key' as line_key,
      item->>'account' as account,c.name as account_name
    from accepted_days a cross join lateral jsonb_array_elements(a.rows) item
    left join chart_accounts c on c.code=item->>'account'
  ), matches as materialized (
    select * from accepted_rows r
    where (nullif(p_account,'') is null or r.account=p_account)
      and (search_text='' or strpos(lower(coalesce(r.account_name,'')),search_text)>0
        or exists (select 1 from jsonb_each_text(r.row_data) field where strpos(lower(field.value),search_text)>0))
  ), page as (
    select * from matches order by posting_date desc,line_key collate "C" offset p_offset limit p_limit
  )
  select jsonb_build_object(
    'asOf',receipt_cutoff,'coaSnapshotId',chart_id::text,
    'acceptedRows',(select count(*) from accepted_rows),'filteredRows',(select count(*) from matches),
    'coverage',(select jsonb_build_object(
      'firstDate',min(scope_date),'throughDate',max(scope_date),'latestReceipt',max(received_at),
      'acceptedDays',count(*),'emptyDays',count(*) filter (where jsonb_array_length(rows)=0),
      'missingDays',case when p_from is not null then p_to-p_from+1-count(*) else coalesce(max(scope_date)-min(scope_date)+1-count(*),0) end
    ) from accepted_days),
    'columns',(select jsonb_build_object('department',coalesce(bool_or(nullif(btrim(row_data->>'department'),'') is not null),false),
      'project',coalesce(bool_or(nullif(btrim(row_data->>'project'),'') is not null),false),
      'description',coalesce(bool_or(nullif(btrim(row_data->>'description'),'') is not null),false),
      'reference',coalesce(bool_or(nullif(btrim(row_data->>'reference'),'') is not null),false)) from matches),
    'accounts',(select coalesce(jsonb_agg(jsonb_build_object('code',a.account,'name',a.account_name)
      order by a.account collate "C"),'[]'::jsonb) from (select distinct account,account_name from accepted_rows where account is not null) a),
    'rows',(select coalesce(jsonb_agg(row_data||jsonb_build_object('postingDate',posting_date,'accountName',account_name)
      order by posting_date desc,line_key collate "C"),'[]'::jsonb) from page)
  ));
end;
$$;
revoke all on function public.finance_accounting_gl_records(uuid,date,date,timestamptz,bigint,text,text,integer,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.finance_accounting_gl_records(uuid,date,date,timestamptz,bigint,text,text,integer,integer) to authenticated;
