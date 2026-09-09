-- Factory Product Feedback: campaign-owned tasting/R&D forms with anonymous token entry.
create table if not exists public.factory_product_feedback_campaigns (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default replace(gen_random_uuid()::text, '-', ''),
  name text not null check (char_length(trim(name)) between 1 and 160),
  finished_good_id uuid references public.factory_finished_goods(id) on delete set null,
  event_label text,
  starts_on date,
  ends_on date,
  status text not null default 'draft' check (status in ('draft', 'live', 'closed')),
  default_language text not null default 'en' check (default_language in ('en', 'zh')),
  thank_you_en text,
  thank_you_zh text,
  form_version integer not null default 1 check (form_version > 0),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array'),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table if not exists public.factory_product_feedback_variants (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.factory_product_feedback_campaigns(id) on delete cascade,
  public_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  name text not null check (char_length(trim(name)) between 1 and 100),
  finished_good_id uuid references public.factory_finished_goods(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, name)
);

create table if not exists public.factory_product_feedback_responses (
  id uuid primary key default gen_random_uuid(),
  public_response_id text not null unique default replace(gen_random_uuid()::text, '-', ''),
  campaign_id uuid not null references public.factory_product_feedback_campaigns(id) on delete restrict,
  variant_id uuid references public.factory_product_feedback_variants(id) on delete set null,
  form_version integer not null,
  questions_snapshot jsonb not null check (jsonb_typeof(questions_snapshot) = 'array'),
  answers jsonb not null check (jsonb_typeof(answers) = 'object'),
  language text not null default 'en' check (language in ('en', 'zh')),
  session_hash text,
  repeat_index integer not null default 1 check (repeat_index > 0),
  submitted_at timestamptz not null default now()
);

create index if not exists factory_product_feedback_campaign_status_idx on public.factory_product_feedback_campaigns(status, starts_on, ends_on);
create index if not exists factory_product_feedback_response_campaign_idx on public.factory_product_feedback_responses(campaign_id, variant_id, submitted_at desc);
create index if not exists factory_product_feedback_response_session_idx on public.factory_product_feedback_responses(campaign_id, variant_id, session_hash, submitted_at desc);

alter table public.factory_product_feedback_campaigns enable row level security;
alter table public.factory_product_feedback_variants enable row level security;
alter table public.factory_product_feedback_responses enable row level security;
revoke all on table public.factory_product_feedback_campaigns, public.factory_product_feedback_variants, public.factory_product_feedback_responses from anon, authenticated;

create or replace function public.factory_product_feedback_actor()
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_employee_id uuid;
begin
  if auth.uid() is null then raise exception using errcode = '42501', message = 'Authentication is required.'; end if;
  select id into v_employee_id from public.employees where auth_user_id = auth.uid() and lower(coalesce(employment_status, '')) = 'active' order by id limit 1;
  if v_employee_id is null then raise exception using errcode = '42501', message = 'An active employee profile is required.'; end if;
  return v_employee_id;
end; $$;

create or replace function public.factory_product_feedback_admin_data(p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign jsonb; v_responses jsonb; v_summary jsonb;
begin
  if not public.current_user_has_permission('factory_product_feedback.view') then raise exception using errcode = '42501', message = 'Product Feedback view permission is required.'; end if;
  if p_campaign_id is null then
    return jsonb_build_object('campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'event_label', c.event_label, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'response_count', (select count(*) from public.factory_product_feedback_responses r where r.campaign_id = c.id), 'finished_good_id', c.finished_good_id) order by c.updated_at desc) from public.factory_product_feedback_campaigns c), '[]'::jsonb), 'finished_goods', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', coalesce(nullif(f.product_name_en,''), f.product_name), 'code', f.product_code) order by coalesce(nullif(f.product_name_en,''), f.product_name)) from public.factory_finished_goods f where lower(coalesce(f.status,'')) = 'active'), '[]'::jsonb));
  end if;
  select to_jsonb(c) into v_campaign from public.factory_product_feedback_campaigns c where c.id = p_campaign_id;
  if v_campaign is null then raise exception using errcode = '22023', message = 'Campaign was not found.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'public_response_id', r.public_response_id, 'variant_id', r.variant_id, 'variant_name', v.name, 'answers', r.answers, 'questions_snapshot', r.questions_snapshot, 'language', r.language, 'repeat_index', r.repeat_index, 'submitted_at', r.submitted_at) order by r.submitted_at desc), '[]'::jsonb) into v_responses from public.factory_product_feedback_responses r left join public.factory_product_feedback_variants v on v.id = r.variant_id where r.campaign_id = p_campaign_id;
  select jsonb_build_object('responses', jsonb_array_length(v_responses), 'overall_rating', coalesce((select round(avg(nullif(r.answers->>'overall_rating','')::numeric), 2) from public.factory_product_feedback_responses r where r.campaign_id=p_campaign_id and (r.answers->>'overall_rating') ~ '^[0-9]+(\\.[0-9]+)?$'), 0), 'would_buy_percent', coalesce((select round(100.0 * avg(case when lower(r.answers->>'purchase_intent') = 'yes' then 1 else 0 end), 1) from public.factory_product_feedback_responses r where r.campaign_id=p_campaign_id and r.answers ? 'purchase_intent'), 0), 'just_right_spiciness_percent', coalesce((select round(100.0 * avg(case when lower(r.answers->>'sambal_spiciness') = 'just right' then 1 else 0 end), 1) from public.factory_product_feedback_responses r where r.campaign_id=p_campaign_id and r.answers ? 'sambal_spiciness'), 0)) into v_summary;
  return jsonb_build_object('campaign', v_campaign, 'variants', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from public.factory_product_feedback_variants v where v.campaign_id=p_campaign_id), '[]'::jsonb), 'responses', v_responses, 'summary', v_summary);
end; $$;

create or replace function public.factory_product_feedback_save_campaign(p_campaign jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor uuid := public.factory_product_feedback_actor(); v_id uuid := nullif(p_campaign->>'id','')::uuid; v_existing public.factory_product_feedback_campaigns%rowtype; v_saved public.factory_product_feedback_campaigns%rowtype; v_questions jsonb := coalesce(p_campaign->'questions','[]'::jsonb);
begin
  if not (public.current_user_has_permission('factory_product_feedback.create') or public.current_user_has_permission('factory_product_feedback.edit') or public.current_user_has_permission('factory_product_feedback.manage')) then raise exception using errcode = '42501', message = 'Product Feedback management permission is required.'; end if;
  if trim(coalesce(p_campaign->>'name','')) = '' then raise exception using errcode = '22023', message = 'Campaign name is required.'; end if;
  if jsonb_typeof(v_questions) <> 'array' then raise exception using errcode='22023', message='Questions must be an ordered array.'; end if;
  if v_id is not null then
    select * into v_existing from public.factory_product_feedback_campaigns where id=v_id for update;
    if not found then raise exception using errcode='22023', message='Campaign was not found.'; end if;
    if v_existing.status <> 'draft' and exists(select 1 from public.factory_product_feedback_responses where campaign_id=v_id) and v_questions is distinct from v_existing.questions then raise exception using errcode='22023', message='Form questions are immutable after responses have been submitted.'; end if;
    update public.factory_product_feedback_campaigns set name=trim(p_campaign->>'name'), finished_good_id=nullif(p_campaign->>'finished_good_id','')::uuid, event_label=nullif(trim(p_campaign->>'event_label'),''), starts_on=nullif(p_campaign->>'starts_on','')::date, ends_on=nullif(p_campaign->>'ends_on','')::date, status=coalesce(nullif(p_campaign->>'status',''), v_existing.status), default_language=coalesce(nullif(p_campaign->>'default_language',''), 'en'), thank_you_en=nullif(p_campaign->>'thank_you_en',''), thank_you_zh=nullif(p_campaign->>'thank_you_zh',''), questions=v_questions, form_version=case when v_questions is distinct from v_existing.questions then v_existing.form_version+1 else v_existing.form_version end, updated_by=v_actor, updated_at=now() where id=v_id returning * into v_saved;
  else
    insert into public.factory_product_feedback_campaigns(name,finished_good_id,event_label,starts_on,ends_on,status,default_language,thank_you_en,thank_you_zh,questions,created_by,updated_by) values(trim(p_campaign->>'name'),nullif(p_campaign->>'finished_good_id','')::uuid,nullif(trim(p_campaign->>'event_label'),''),nullif(p_campaign->>'starts_on','')::date,nullif(p_campaign->>'ends_on','')::date,coalesce(nullif(p_campaign->>'status',''),'draft'),coalesce(nullif(p_campaign->>'default_language',''),'en'),nullif(p_campaign->>'thank_you_en',''),nullif(p_campaign->>'thank_you_zh',''),v_questions,v_actor,v_actor) returning * into v_saved;
  end if;
  return to_jsonb(v_saved);
end; $$;

create or replace function public.factory_product_feedback_save_variant(p_variant jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p_variant->>'id','')::uuid; v_campaign uuid := nullif(p_variant->>'campaign_id','')::uuid; v_saved public.factory_product_feedback_variants%rowtype;
begin
  perform public.factory_product_feedback_actor();
  if not (public.current_user_has_permission('factory_product_feedback.edit') or public.current_user_has_permission('factory_product_feedback.manage')) then raise exception using errcode='42501',message='Product Feedback edit permission is required.'; end if;
  if v_campaign is null or trim(coalesce(p_variant->>'name',''))='' then raise exception using errcode='22023',message='Variant name and campaign are required.'; end if;
  if v_id is null then insert into public.factory_product_feedback_variants(campaign_id,name,finished_good_id,is_active) values(v_campaign,trim(p_variant->>'name'),nullif(p_variant->>'finished_good_id','')::uuid,coalesce((p_variant->>'is_active')::boolean,true)) returning * into v_saved;
  else update public.factory_product_feedback_variants set name=trim(p_variant->>'name'),finished_good_id=nullif(p_variant->>'finished_good_id','')::uuid,is_active=coalesce((p_variant->>'is_active')::boolean,true),updated_at=now() where id=v_id and campaign_id=v_campaign returning * into v_saved; end if;
  if v_saved.id is null then raise exception using errcode='22023',message='Variant was not found.'; end if;
  return to_jsonb(v_saved);
end; $$;

create or replace function public.factory_product_feedback_public_entry(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign public.factory_product_feedback_campaigns%rowtype; v_variant public.factory_product_feedback_variants%rowtype;
begin
  select c.* into v_campaign from public.factory_product_feedback_campaigns c where c.public_id=p_token or exists (select 1 from public.factory_product_feedback_variants v where v.campaign_id=c.id and v.public_token=p_token) limit 1;
  select * into v_variant from public.factory_product_feedback_variants where campaign_id=v_campaign.id and public_token=p_token;
  if v_campaign.id is null or v_campaign.status <> 'live' or (v_campaign.starts_on is not null and v_campaign.starts_on > current_date) or (v_campaign.ends_on is not null and v_campaign.ends_on < current_date) or (v_variant.id is not null and not v_variant.is_active) then return jsonb_build_object('available', false); end if;
  return jsonb_build_object('available',true,'campaign',jsonb_build_object('name',v_campaign.name,'event_label',v_campaign.event_label,'default_language',v_campaign.default_language,'thank_you_en',v_campaign.thank_you_en,'thank_you_zh',v_campaign.thank_you_zh,'questions',v_campaign.questions),'variant',case when v_variant.id is null then null else jsonb_build_object('name',v_variant.name) end);
end; $$;

create or replace function public.factory_product_feedback_public_submit(p_token text, p_answers jsonb, p_language text default 'en', p_session_token text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign public.factory_product_feedback_campaigns%rowtype; v_variant public.factory_product_feedback_variants%rowtype; v_hash text := nullif(md5(coalesce(p_session_token,'')), md5('')); v_repeat integer; v_question jsonb; v_key text; v_saved public.factory_product_feedback_responses%rowtype;
begin
  if jsonb_typeof(p_answers) <> 'object' then raise exception using errcode='22023',message='Answers must be an object.'; end if;
  select c.* into v_campaign from public.factory_product_feedback_campaigns c where c.public_id=p_token or exists (select 1 from public.factory_product_feedback_variants v where v.campaign_id=c.id and v.public_token=p_token) limit 1;
  select * into v_variant from public.factory_product_feedback_variants where campaign_id=v_campaign.id and public_token=p_token;
  if v_campaign.id is null or v_campaign.status <> 'live' or (v_campaign.starts_on is not null and v_campaign.starts_on > current_date) or (v_campaign.ends_on is not null and v_campaign.ends_on < current_date) or (v_variant.id is not null and not v_variant.is_active) then raise exception using errcode='22023',message='This feedback link is unavailable.'; end if;
  for v_question in select value from jsonb_array_elements(v_campaign.questions) loop v_key := v_question->>'key'; if coalesce((v_question->>'required')::boolean, false) and not (p_answers ? v_key) then raise exception using errcode='22023',message='Please answer all required questions.'; end if; end loop;
  select count(*) + 1 into v_repeat from public.factory_product_feedback_responses where campaign_id=v_campaign.id and variant_id is not distinct from v_variant.id and session_hash is not distinct from v_hash;
  insert into public.factory_product_feedback_responses(campaign_id,variant_id,form_version,questions_snapshot,answers,language,session_hash,repeat_index) values(v_campaign.id,v_variant.id,v_campaign.form_version,v_campaign.questions,p_answers,case when p_language='zh' then 'zh' else 'en' end,v_hash,v_repeat) returning * into v_saved;
  return jsonb_build_object('submitted',true,'response',v_saved.public_response_id,'repeat_index',v_saved.repeat_index);
end; $$;

revoke all on function public.factory_product_feedback_actor(), public.factory_product_feedback_admin_data(uuid), public.factory_product_feedback_save_campaign(jsonb), public.factory_product_feedback_save_variant(jsonb), public.factory_product_feedback_public_entry(text), public.factory_product_feedback_public_submit(text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.factory_product_feedback_admin_data(uuid), public.factory_product_feedback_save_campaign(jsonb), public.factory_product_feedback_save_variant(jsonb) to authenticated;
grant execute on function public.factory_product_feedback_public_entry(text), public.factory_product_feedback_public_submit(text,jsonb,text,text) to anon, authenticated;
