-- Canonical Product Feedback form definitions. Campaigns keep their current
-- questions payload as a compatibility projection, while every response is
-- linked to the immutable definition that accepted it.
create table public.factory_product_feedback_form_versions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.factory_product_feedback_campaigns(id) on delete cascade,
  version integer not null check (version > 0),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (campaign_id, version)
);

create index factory_product_feedback_form_version_campaign_idx
  on public.factory_product_feedback_form_versions(campaign_id, version desc);

alter table public.factory_product_feedback_form_versions enable row level security;
revoke all on table public.factory_product_feedback_form_versions from public, anon, authenticated;

alter table public.factory_product_feedback_campaigns
  add column active_form_version_id uuid references public.factory_product_feedback_form_versions(id) on delete restrict;

alter table public.factory_product_feedback_responses
  add column form_version_id uuid references public.factory_product_feedback_form_versions(id) on delete restrict,
  add column answer_details jsonb not null default '{}'::jsonb check (jsonb_typeof(answer_details) = 'object');

-- Preserve every historical response definition. When an old version has no
-- response, seed it from the campaign's current compatibility projection.
insert into public.factory_product_feedback_form_versions (campaign_id, version, questions, created_by, created_at)
select distinct on (r.campaign_id, r.form_version)
  r.campaign_id, r.form_version, r.questions_snapshot, c.updated_by, coalesce(r.submitted_at, c.updated_at)
from public.factory_product_feedback_responses r
join public.factory_product_feedback_campaigns c on c.id = r.campaign_id
order by r.campaign_id, r.form_version, r.submitted_at;

insert into public.factory_product_feedback_form_versions (campaign_id, version, questions, created_by, created_at)
select c.id, c.form_version, c.questions, c.updated_by, c.updated_at
from public.factory_product_feedback_campaigns c
where not exists (
  select 1 from public.factory_product_feedback_form_versions f
  where f.campaign_id = c.id and f.version = c.form_version
);

update public.factory_product_feedback_campaigns c
set active_form_version_id = f.id
from public.factory_product_feedback_form_versions f
where f.campaign_id = c.id and f.version = c.form_version;

update public.factory_product_feedback_responses r
set form_version_id = f.id
from public.factory_product_feedback_form_versions f
where f.campaign_id = r.campaign_id and f.version = r.form_version;

alter table public.factory_product_feedback_campaigns
  alter column active_form_version_id set not null;
alter table public.factory_product_feedback_responses
  alter column form_version_id set not null;

create or replace function public.factory_product_feedback_question_semantics(p_question jsonb)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_set(
    jsonb_set(
      p_question - array['order', 'helper_en', 'helper_zh', 'helper_ms', 'label_zh', 'label_ms', 'rating_low_label_en', 'rating_low_label_zh', 'rating_low_label_ms', 'rating_high_label_en', 'rating_high_label_zh', 'rating_high_label_ms'],
      '{required}', to_jsonb(coalesce((p_question->>'required')::boolean, false)), true
    ),
    '{options}',
    coalesce((
      select jsonb_agg(option - array['label_zh', 'label_ms'] order by ordinal)
      from jsonb_array_elements(coalesce(p_question->'options', '[]'::jsonb)) with ordinality as items(option, ordinal)
    ), '[]'::jsonb),
    true
  );
$$;

create or replace function public.factory_product_feedback_questions_differ_only_by_presentation(
  p_existing jsonb,
  p_next jsonb
)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(p_existing) = 'array'
    and jsonb_typeof(p_next) = 'array'
    and jsonb_array_length(p_existing) = jsonb_array_length(p_next)
    and coalesce((
      select jsonb_agg(public.factory_product_feedback_question_semantics(question) order by ordinal)
      from jsonb_array_elements(p_existing) with ordinality as items(question, ordinal)
    ), '[]'::jsonb) = coalesce((
      select jsonb_agg(public.factory_product_feedback_question_semantics(question) order by ordinal)
      from jsonb_array_elements(p_next) with ordinality as items(question, ordinal)
    ), '[]'::jsonb);
$$;

create or replace function public.factory_product_feedback_save_campaign(p_campaign jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_product_feedback_actor();
  v_id uuid := nullif(p_campaign->>'id','')::uuid;
  v_existing public.factory_product_feedback_campaigns%rowtype;
  v_saved public.factory_product_feedback_campaigns%rowtype;
  v_active public.factory_product_feedback_form_versions%rowtype;
  v_new_form public.factory_product_feedback_form_versions%rowtype;
  v_questions jsonb := p_campaign->'questions';
  v_content jsonb := p_campaign->'content';
  v_branding jsonb := p_campaign->'branding';
  v_contact_collection jsonb := p_campaign->'contact_collection';
  v_has_responses boolean := false;
  v_semantic_change boolean := false;
  v_form_change text := coalesce(p_campaign->>'form_change', '');
begin
  if not (public.current_user_has_permission('factory_product_feedback.create') or public.current_user_has_permission('factory_product_feedback.edit') or public.current_user_has_permission('factory_product_feedback.manage')) then
    raise exception using errcode = '42501', message = 'Product Feedback management permission is required.';
  end if;
  if trim(coalesce(p_campaign->>'name','')) = '' then
    raise exception using errcode = '22023', message = 'Campaign name is required.';
  end if;

  if v_id is not null then
    select * into v_existing from public.factory_product_feedback_campaigns where id = v_id for update;
    if not found then raise exception using errcode = '22023', message = 'Campaign was not found.'; end if;
    select * into v_active from public.factory_product_feedback_form_versions where id = v_existing.active_form_version_id for update;
    v_questions := coalesce(v_questions, v_active.questions, '[]'::jsonb);
    v_content := coalesce(v_content, v_existing.content, '{}'::jsonb);
    v_branding := coalesce(v_branding, v_existing.branding, '{}'::jsonb);
    v_contact_collection := coalesce(v_contact_collection, v_existing.contact_collection, '{}'::jsonb);
  else
    v_questions := coalesce(v_questions, '[]'::jsonb);
    v_content := coalesce(v_content, '{}'::jsonb);
    v_branding := coalesce(v_branding, '{}'::jsonb);
    v_contact_collection := coalesce(v_contact_collection, '{}'::jsonb);
  end if;
  -- FormBuilder carries the confirmation intent inside its questions payload so
  -- existing campaign-save callers remain backward compatible.
  if jsonb_typeof(v_questions) = 'object' and v_questions ? 'items' then
    v_form_change := coalesce(v_questions->>'form_change', v_form_change);
    v_questions := v_questions->'items';
  end if;
  if jsonb_typeof(v_questions) <> 'array' then raise exception using errcode = '22023', message = 'Questions must be an ordered array.'; end if;
  if jsonb_typeof(v_content) <> 'object' or jsonb_typeof(v_branding) <> 'object' or jsonb_typeof(v_contact_collection) <> 'object' then
    raise exception using errcode = '22023', message = 'Campaign content, branding, and contact collection must be objects.';
  end if;

  if v_id is null then
    insert into public.factory_product_feedback_campaigns(
      name, finished_good_id, event_label, starts_on, ends_on, status, default_language,
      thank_you_en, thank_you_zh, questions, content, branding, contact_collection, created_by, updated_by
    ) values (
      trim(p_campaign->>'name'), nullif(p_campaign->>'finished_good_id','')::uuid,
      nullif(trim(p_campaign->>'event_label'),''), nullif(p_campaign->>'starts_on','')::date,
      nullif(p_campaign->>'ends_on','')::date, coalesce(nullif(p_campaign->>'status',''),'draft'),
      coalesce(nullif(p_campaign->>'default_language',''),'en'), nullif(p_campaign->>'thank_you_en',''),
      nullif(p_campaign->>'thank_you_zh',''), v_questions, v_content, v_branding, v_contact_collection, v_actor, v_actor
    ) returning * into v_saved;
    insert into public.factory_product_feedback_form_versions(campaign_id, version, questions, created_by)
    values(v_saved.id, 1, v_questions, v_actor) returning * into v_new_form;
    update public.factory_product_feedback_campaigns set active_form_version_id = v_new_form.id where id = v_saved.id returning * into v_saved;
    return to_jsonb(v_saved);
  end if;

  v_has_responses := exists(select 1 from public.factory_product_feedback_responses where campaign_id = v_id);
  v_semantic_change := v_questions is distinct from v_active.questions
    and not public.factory_product_feedback_questions_differ_only_by_presentation(v_active.questions, v_questions);
  if v_has_responses and v_semantic_change and v_form_change <> 'new_version' then
    raise exception using errcode = 'P0001', message = 'FORM_VERSION_REQUIRED', detail = 'Existing responses remain linked to the previous version. Save this structural change as a new form version.';
  end if;

  if v_semantic_change and v_has_responses then
    insert into public.factory_product_feedback_form_versions(campaign_id, version, questions, created_by)
    values(v_id, v_existing.form_version + 1, v_questions, v_actor) returning * into v_new_form;
  else
    update public.factory_product_feedback_form_versions set questions = v_questions where id = v_active.id returning * into v_new_form;
  end if;

  update public.factory_product_feedback_campaigns set
    name = trim(p_campaign->>'name'),
    finished_good_id = nullif(p_campaign->>'finished_good_id','')::uuid,
    event_label = nullif(trim(p_campaign->>'event_label'),''),
    starts_on = nullif(p_campaign->>'starts_on','')::date,
    ends_on = nullif(p_campaign->>'ends_on','')::date,
    status = coalesce(nullif(p_campaign->>'status',''), v_existing.status),
    default_language = coalesce(nullif(p_campaign->>'default_language',''), 'en'),
    thank_you_en = nullif(p_campaign->>'thank_you_en',''),
    thank_you_zh = nullif(p_campaign->>'thank_you_zh',''),
    questions = v_questions,
    active_form_version_id = v_new_form.id,
    form_version = v_new_form.version,
    content = v_content,
    branding = v_branding,
    contact_collection = v_contact_collection,
    updated_by = v_actor,
    updated_at = now()
  where id = v_id returning * into v_saved;
  return to_jsonb(v_saved);
end; $$;

create or replace function public.factory_product_feedback_public_entry(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.factory_product_feedback_campaigns%rowtype;
  v_variant public.factory_product_feedback_variants%rowtype;
  v_form public.factory_product_feedback_form_versions%rowtype;
  v_business_date date := timezone('Asia/Kuala_Lumpur', now())::date;
begin
  select c.* into v_campaign from public.factory_product_feedback_campaigns c where c.public_id = p_token or exists(select 1 from public.factory_product_feedback_variants v where v.campaign_id = c.id and v.public_token = p_token) limit 1;
  select * into v_variant from public.factory_product_feedback_variants where campaign_id = v_campaign.id and public_token = p_token;
  if v_campaign.id is null or v_campaign.status <> 'live' or (v_campaign.starts_on is not null and v_campaign.starts_on > v_business_date) or (v_campaign.ends_on is not null and v_campaign.ends_on < v_business_date) or (v_variant.id is not null and not v_variant.is_active) then
    return jsonb_build_object('available', false);
  end if;
  select * into v_form from public.factory_product_feedback_form_versions where id = v_campaign.active_form_version_id;
  return jsonb_build_object('available', true, 'campaign', jsonb_build_object(
    'name', v_campaign.name, 'event_label', v_campaign.event_label, 'default_language', v_campaign.default_language,
    'thank_you_en', v_campaign.thank_you_en, 'thank_you_zh', v_campaign.thank_you_zh,
    'form_version', v_form.version, 'questions', v_form.questions, 'content', v_campaign.content,
    'branding', v_campaign.branding, 'contact_collection', case when coalesce((v_campaign.contact_collection->>'enabled')::boolean, false) then jsonb_build_object('enabled', true, 'prompt', coalesce(v_campaign.contact_collection->'prompt', '{}'::jsonb)) else jsonb_build_object('enabled', false) end
  ), 'variant', case when v_variant.id is null then null else jsonb_build_object('name', v_variant.name) end);
end; $$;

drop function if exists public.factory_product_feedback_public_submit(text, jsonb, text, text, jsonb);
create function public.factory_product_feedback_public_submit(
  p_token text, p_answers jsonb, p_language text default 'en', p_session_token text default null,
  p_contact jsonb default '{}'::jsonb, p_answer_details jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.factory_product_feedback_campaigns%rowtype;
  v_variant public.factory_product_feedback_variants%rowtype;
  v_form public.factory_product_feedback_form_versions%rowtype;
  v_business_date date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_hash text := nullif(md5(coalesce(p_session_token, '')), md5(''));
  v_repeat integer; v_question jsonb; v_key text; v_saved public.factory_product_feedback_responses%rowtype;
  v_name text := nullif(btrim(coalesce(p_contact->>'name', '')), '');
  v_mobile_raw text := nullif(regexp_replace(btrim(coalesce(p_contact->>'mobile', '')), '[^0-9+]', '', 'g'), '');
  v_mobile text;
begin
  if jsonb_typeof(p_answers) <> 'object' or jsonb_typeof(p_contact) <> 'object' or jsonb_typeof(p_answer_details) <> 'object' then raise exception using errcode = '22023', message = 'Feedback submission is invalid.'; end if;
  select c.* into v_campaign from public.factory_product_feedback_campaigns c where c.public_id = p_token or exists(select 1 from public.factory_product_feedback_variants v where v.campaign_id = c.id and v.public_token = p_token) limit 1;
  select * into v_variant from public.factory_product_feedback_variants where campaign_id = v_campaign.id and public_token = p_token;
  if v_campaign.id is null or v_campaign.status <> 'live' or (v_campaign.starts_on is not null and v_campaign.starts_on > v_business_date) or (v_campaign.ends_on is not null and v_campaign.ends_on < v_business_date) or (v_variant.id is not null and not v_variant.is_active) then raise exception using errcode = '22023', message = 'This feedback link is unavailable.'; end if;
  select * into v_form from public.factory_product_feedback_form_versions where id = v_campaign.active_form_version_id;
  for v_question in select value from jsonb_array_elements(v_form.questions) loop
    v_key := v_question->>'key';
    if coalesce((v_question->>'required')::boolean, false) and not (p_answers ? v_key) then raise exception using errcode = '22023', message = 'Please answer all required questions.'; end if;
    if p_answer_details ? v_key and (
      jsonb_typeof(p_answer_details->v_key) <> 'object'
      or exists (
        select 1
        from jsonb_each_text(p_answer_details->v_key) as detail(option_value, detail_text)
        where length(detail.detail_text) > 500
          or not exists (
            select 1
            from jsonb_array_elements(coalesce(v_question->'options', '[]'::jsonb)) as option(value)
            where option.value->>'value' = detail.option_value
              and coalesce((option.value->>'allow_additional_text')::boolean, false)
              and (
                p_answers->>v_key = detail.option_value
                or (
                  jsonb_typeof(p_answers->v_key) = 'array'
                  and exists (select 1 from jsonb_array_elements_text(p_answers->v_key) as selected(value) where selected.value = detail.option_value)
                )
              )
          )
      )
    ) then raise exception using errcode = '22023', message = 'Additional answer details are invalid.'; end if;
  end loop;
  if (v_name is not null or v_mobile_raw is not null) and not coalesce((v_campaign.contact_collection->>'enabled')::boolean, false) then raise exception using errcode = '22023', message = 'Contact collection is not enabled for this campaign.'; end if;
  if v_mobile_raw is not null then
    if v_mobile_raw ~ '^0' then v_mobile := '+60' || substr(v_mobile_raw, 2); elsif v_mobile_raw ~ '^60' then v_mobile := '+' || v_mobile_raw; elsif v_mobile_raw ~ E'^\\+60' then v_mobile := v_mobile_raw; else raise exception using errcode = '22023', message = 'Enter a valid Malaysian mobile number.'; end if;
    if v_mobile !~ E'^\\+601[0-9]{7,9}$' then raise exception using errcode = '22023', message = 'Enter a valid Malaysian mobile number.'; end if;
  end if;
  select count(*) + 1 into v_repeat from public.factory_product_feedback_responses where campaign_id = v_campaign.id and variant_id is not distinct from v_variant.id and session_hash is not distinct from v_hash;
  insert into public.factory_product_feedback_responses(campaign_id, variant_id, form_version, form_version_id, questions_snapshot, answers, answer_details, language, session_hash, repeat_index)
  values(v_campaign.id, v_variant.id, v_form.version, v_form.id, v_form.questions, p_answers, p_answer_details, case when p_language in ('zh', 'ms') then p_language else 'en' end, v_hash, v_repeat) returning * into v_saved;
  if v_name is not null or v_mobile is not null then insert into public.factory_product_feedback_response_contacts(response_id, campaign_id, name, normalized_mobile) values(v_saved.id, v_campaign.id, v_name, v_mobile); end if;
  return jsonb_build_object('submitted', true, 'response', v_saved.public_response_id, 'repeat_index', v_saved.repeat_index);
end; $$;

revoke all on function public.factory_product_feedback_public_entry(text), public.factory_product_feedback_public_submit(text, jsonb, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.factory_product_feedback_public_entry(text), public.factory_product_feedback_public_submit(text, jsonb, text, text, jsonb, jsonb) to anon, authenticated;

-- Admin reads retain the immutable version and optional answer-detail evidence,
-- while campaign.questions remains the active compatibility projection for older clients.
create or replace function public.factory_product_feedback_admin_data(p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_campaign jsonb; v_responses jsonb; v_summary jsonb; v_kpis jsonb;
begin
  if not public.current_user_has_permission('factory_product_feedback.view') then
    raise exception using errcode = '42501', message = 'Product Feedback view permission is required.';
  end if;
  if p_campaign_id is null then
    return jsonb_build_object('campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'event_label', c.event_label, 'starts_on', c.starts_on, 'ends_on', c.ends_on, 'response_count', (select count(*) from public.factory_product_feedback_responses r where r.campaign_id = c.id), 'finished_good_id', c.finished_good_id) order by c.updated_at desc) from public.factory_product_feedback_campaigns c), '[]'::jsonb), 'finished_goods', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', coalesce(nullif(f.product_name_en,''), f.product_name), 'code', f.product_code) order by coalesce(nullif(f.product_name_en,''), f.product_name)) from public.factory_finished_goods f where lower(coalesce(f.status,'')) = 'active'), '[]'::jsonb));
  end if;
  select to_jsonb(c) || jsonb_build_object('response_count', (select count(*) from public.factory_product_feedback_responses r where r.campaign_id = c.id)) into v_campaign from public.factory_product_feedback_campaigns c where c.id = p_campaign_id;
  if v_campaign is null then raise exception using errcode = '22023', message = 'Campaign was not found.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'public_response_id', r.public_response_id, 'variant_id', r.variant_id, 'variant_name', v.name, 'answers', r.answers, 'answer_details', r.answer_details, 'questions_snapshot', r.questions_snapshot, 'form_version', r.form_version, 'form_version_id', r.form_version_id, 'language', r.language, 'repeat_index', r.repeat_index, 'submitted_at', r.submitted_at) order by r.submitted_at desc), '[]'::jsonb) into v_responses from public.factory_product_feedback_responses r left join public.factory_product_feedback_variants v on v.id = r.variant_id where r.campaign_id = p_campaign_id;
  select coalesce(jsonb_agg(kpi order by ordinal), '[]'::jsonb) into v_kpis from (
    select ordinal, jsonb_strip_nulls(jsonb_build_object(
      'role', question->>'analytics_role', 'question_key', question->>'key',
      'label', case question->>'analytics_role' when 'overall_rating' then 'Overall Rating' when 'purchase_intent' then 'Purchase Intent' when 'taste_spiciness' then 'Spiciness' when 'price_acceptance' then 'Average Accepted Price' else coalesce(question->>'label_en', 'Top Choice') end,
      'tone', case question->>'analytics_role' when 'overall_rating' then 'success' when 'purchase_intent' then 'success' when 'taste_spiciness' then 'info' when 'price_acceptance' then 'info' else 'neutral' end,
      'value', case question->>'analytics_role'
        when 'overall_rating' then coalesce((select round(avg(nullif(r.answers->>(question->>'key'),'')::numeric), 2)::text from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and (r.answers->>(question->>'key')) ~ '^[0-9]+(\.[0-9]+)?$' and public.factory_product_feedback_questions_differ_only_by_presentation(r.questions_snapshot, v_campaign->'questions')), '—')
        when 'purchase_intent' then coalesce((select round(100.0 * avg(case when lower(r.answers->>(question->>'key')) = lower(coalesce(question->>'analytics_target_value','yes')) then 1 else 0 end), 1)::text || '%' from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and r.answers ? (question->>'key') and public.factory_product_feedback_questions_differ_only_by_presentation(r.questions_snapshot, v_campaign->'questions')), '—')
        when 'taste_spiciness' then coalesce((select round(100.0 * avg(case when lower(r.answers->>(question->>'key')) = lower(coalesce(question->>'analytics_target_value','just right')) then 1 else 0 end), 1)::text || '%' from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and r.answers ? (question->>'key') and public.factory_product_feedback_questions_differ_only_by_presentation(r.questions_snapshot, v_campaign->'questions')), '—')
        when 'price_acceptance' then coalesce((select max(coalesce(o.value->>'currency','MYR')) || ' ' || round(avg((o.value->>'amount')::numeric), 2)::text from public.factory_product_feedback_responses r join lateral jsonb_array_elements(coalesce(question->'options','[]'::jsonb)) o(value) on o.value->>'value' = r.answers->>(question->>'key') where r.campaign_id = p_campaign_id and coalesce(o.value->>'amount','') ~ '^[0-9]+(\.[0-9]+)?$' and public.factory_product_feedback_questions_differ_only_by_presentation(r.questions_snapshot, v_campaign->'questions')), '—')
        else coalesce((select r.answers->>(question->>'key') from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and r.answers ? (question->>'key') and public.factory_product_feedback_questions_differ_only_by_presentation(r.questions_snapshot, v_campaign->'questions') group by r.answers->>(question->>'key') order by count(*) desc, r.answers->>(question->>'key') limit 1), '—')
      end
    )) as kpi
    from jsonb_array_elements(coalesce(v_campaign->'questions', '[]'::jsonb)) with ordinality as q(question, ordinal)
    where coalesce(question->>'analytics_role','') in ('overall_rating', 'purchase_intent', 'taste_spiciness', 'price_acceptance', 'generic_choice_distribution')
  ) analytics;
  select jsonb_build_object('responses', jsonb_array_length(v_responses), 'kpis', v_kpis) into v_summary;
  return jsonb_build_object('campaign', v_campaign, 'form_versions', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'version', f.version, 'created_at', f.created_at) order by f.version desc) from public.factory_product_feedback_form_versions f where f.campaign_id = p_campaign_id), '[]'::jsonb), 'variants', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from public.factory_product_feedback_variants v where v.campaign_id = p_campaign_id), '[]'::jsonb), 'responses', v_responses, 'summary', v_summary);
end; $$;
