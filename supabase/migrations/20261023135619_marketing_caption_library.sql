create table marketing_private.caption_snippets(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations(id),brand_id uuid not null references public.brands(id),
 kind text not null check(kind in ('caption','hashtags')),name text not null check(length(name) between 1 and 100),body text not null check(length(body) between 1 and 2200),
 active boolean not null default true,revision integer not null default 1,created_by uuid not null references public.employees(id),updated_at timestamptz not null default now()
);
create index caption_snippets_brand on marketing_private.caption_snippets(brand_id,kind,updated_at desc,id);
create table marketing_private.caption_snippet_revisions(
 snippet_id uuid not null references marketing_private.caption_snippets(id),revision integer not null,snapshot jsonb not null,actor_employee_id uuid not null references public.employees(id),created_at timestamptz not null default now(),primary key(snippet_id,revision)
);
alter table marketing_private.caption_snippets enable row level security;
alter table marketing_private.caption_snippet_revisions enable row level security;
revoke all on marketing_private.caption_snippets,marketing_private.caption_snippet_revisions from public,anon,authenticated;

create function public.marketing_caption_library(p_brand uuid,p_kind text,p_search text default '',p_page integer default 1,p_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare org uuid;result jsonb;
begin
 select organization_id into org from public.brands where id=p_brand;
 perform marketing_private.require_access(org,p_brand,case when public.current_user_has_permission('marketing_content.view') then 'marketing_content.view' else 'marketing_calendar.view' end);
 if p_kind not in ('caption','hashtags') or p_kind is null or p_search is null or length(p_search)>200 or p_page is null or p_page not between 1 and 100000 or p_size is null or p_size not in (20,50,100) then raise exception 'Invalid caption library filters.';end if;
 with filtered as materialized(select * from marketing_private.caption_snippets where brand_id=p_brand and organization_id=org and kind=p_kind and (p_search='' or position(lower(p_search) in lower(name||' '||body))>0)),paged as(select * from filtered order by active desc,updated_at desc,id limit p_size offset (p_page-1)*p_size)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p) order by active desc,updated_at desc,id) from paged p),'[]'::jsonb),'total_count',(select count(*) from filtered)) into result;
 return result;
end;$$;
revoke all on function public.marketing_caption_library(uuid,text,text,integer,integer) from public,anon;
grant execute on function public.marketing_caption_library(uuid,text,text,integer,integer) to authenticated;

create function public.marketing_caption_save(p_request uuid,p_brand uuid,p_id uuid,p_revision integer,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare org uuid;actor uuid;item marketing_private.caption_snippets;prior public.marketing_requests;fp text;result jsonb;name text;body text;kind text;active boolean;tags text[];
begin
 select organization_id into org from public.brands where id=p_brand;
 actor:=marketing_private.require_access(org,p_brand,case when p_id is null then 'marketing_content.create' else 'marketing_content.edit' end);
 if p_request is null or p_revision is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then raise exception 'Caption details and a request identity are required.';end if;
 fp:=md5(jsonb_build_array('caption_library',p_brand,p_id,p_revision,p_data)::text);
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into prior from public.marketing_requests where request_id=p_request;
 if found then if prior.actor_employee_id<>actor or prior.fingerprint<>fp then raise exception 'Retry payload changed. Use a new request.';end if;return prior.result;end if;
 name:=trim(p_data->>'name');body:=trim(p_data->>'body');kind:=p_data->>'kind';active:=(p_data->>'active')::boolean;
 if coalesce(length(name),0) not between 1 and 100 or coalesce(length(body),0) not between 1 and 2200 or kind is null or kind not in ('caption','hashtags') or active is null then raise exception 'Enter a name and up to 2,200 characters of caption text or hashtags.';end if;
 if kind='hashtags' then
  tags:=regexp_split_to_array(body,'[[:space:]]+');
  if cardinality(tags)>30 or exists(select 1 from unnest(tags) t where t!~'^#[[:alnum:]_]{1,80}$') then raise exception 'Use up to 30 hashtags containing letters, numbers or underscores, separated by spaces.';end if;
  select string_agg(tag,' ' order by first_index) into body from(select min(ord) as first_index,(array_agg(tag order by ord))[1] as tag from unnest(tags) with ordinality t(tag,ord) group by lower(tag)) unique_tags;
 end if;
 if p_id is null then
  if p_revision<>0 then raise exception 'New templates start without a revision.';end if;
  insert into marketing_private.caption_snippets(organization_id,brand_id,kind,name,body,active,created_by) values(org,p_brand,kind,name,body,active,actor) returning * into item;
 else
  select * into item from marketing_private.caption_snippets where id=p_id and brand_id=p_brand and organization_id=org for update;
  if not found then raise exception using errcode='42501',message='Template is unavailable in this Brand.';end if;
  if item.revision<>p_revision then raise exception using errcode='40001',message='Template changed. Reload before saving.';end if;
  update marketing_private.caption_snippets set kind=marketing_caption_save.kind,name=marketing_caption_save.name,body=marketing_caption_save.body,active=marketing_caption_save.active,revision=revision+1,updated_at=clock_timestamp() where id=item.id returning * into item;
 end if;
 result:=to_jsonb(item);
 insert into marketing_private.caption_snippet_revisions values(item.id,item.revision,result,actor,now());
 insert into public.marketing_requests values(p_request,actor,fp,result);
 insert into public.marketing_events(organization_id,brand_id,action,actor_employee_id,details) values(org,p_brand,'caption_library_saved',actor,jsonb_build_object('snippet_id',item.id,'revision',item.revision,'kind',item.kind,'active',item.active));
 return result;
end;$$;
revoke all on function public.marketing_caption_save(uuid,uuid,uuid,integer,jsonb) from public,anon;
grant execute on function public.marketing_caption_save(uuid,uuid,uuid,integer,jsonb) to authenticated;
