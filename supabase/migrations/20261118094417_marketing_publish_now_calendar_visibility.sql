-- Calendar placement only: never derive an authorized schedule from retry due_at.
do $migration$
declare body text;
begin
 body:=pg_get_functiondef('marketing_private.content_rows(uuid,uuid,boolean)'::regprocedure);
 if md5(body)<>'b7088596844ff80e62fe0edfaca3b941' then raise exception 'Unexpected content rows baseline';end if;
 body:=replace(body,
  'coalesce(evidence.actual_at,evidence.receipt_confirmed_at,evidence.scheduled_at,(r.payload->>''planned_at'')::timestamptz) as display_at',
  'coalesce(evidence.actual_at,evidence.receipt_confirmed_at,evidence.scheduled_at,(r.payload->>''planned_at'')::timestamptz,evidence.publish_now_confirmed_at) as display_at');
 body:=replace(body,
  'select max(s.published_at) as actual_at,',
  'select min(j.external_authorized_at) filter (where timeline.evidence->>''publishing_intention''=''now'') as publish_now_confirmed_at,max(s.published_at) as actual_at,');
 execute body;
end;$migration$;
