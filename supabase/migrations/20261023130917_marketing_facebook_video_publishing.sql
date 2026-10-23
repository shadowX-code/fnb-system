-- Add an adapter format without changing revisions, grants, execution policies or saved data.
do $migration$
declare body text:=pg_get_functiondef('marketing_private.validate_content(uuid,uuid,jsonb,boolean)'::regprocedure);
begin
 if position($old$not in ('text','image','carousel','reel')$old$ in body)=0 or position($old$variant->>'format'='reel' and$old$ in body)=0 then raise exception 'Unexpected content validator; reconcile before applying';end if;
 body:=replace(body,$old$not in ('text','image','carousel','reel')$old$,$new$not in ('text','image','carousel','reel','video')$new$);
 body:=replace(body,$old$variant->>'channel'='instagram' and variant->>'format'='text'$old$,$new$variant->>'channel'='instagram' and variant->>'format' in ('text','video')$new$);
 body:=replace(body,$old$variant->>'format'='reel' and$old$,$new$variant->>'format' in ('reel','video') and$new$);
 body:=replace(body,$old$variant->>'format' in ('image','reel')$old$,$new$variant->>'format' in ('image','reel','video')$new$);
 execute body;
end;$migration$;
-- Only fresh, current-generation eligibility may expand the format projection.
-- No existing connection or credential is updated by this migration.
do $migration$
declare body text:=pg_get_functiondef('public.marketing_meta_record_eligibility(uuid,uuid,integer,jsonb,boolean)'::regprocedure);
 old_fields text:=$old$'publishing',coalesce(p_verified,false),'execution_enabled',false$old$;
 new_fields text:=$new$'publishing',coalesce(p_verified,false),'execution_enabled',false,'formats',case when p_verified and c.channel='facebook' then '["text","image","carousel","video","reel"]'::jsonb else coalesce(c.capabilities->'formats','[]'::jsonb) end$new$;
begin
 if position(old_fields in body)=0 then raise exception 'Unexpected eligibility authority; reconcile before applying';end if;
 execute replace(body,old_fields,new_fields);
end;$migration$;
