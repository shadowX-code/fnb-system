-- Campaign contact collection is intentionally separate from anonymous feedback answers.
alter table public.factory_product_feedback_campaigns
  add column if not exists contact_collection jsonb not null default '{}'::jsonb
  check (jsonb_typeof(contact_collection) = 'object');

create table if not exists public.factory_product_feedback_response_contacts (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null unique references public.factory_product_feedback_responses(id) on delete cascade,
  campaign_id uuid not null references public.factory_product_feedback_campaigns(id) on delete restrict,
  name text,
  normalized_mobile text,
  consented_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  check (name is null or char_length(trim(name)) between 1 and 160),
  check (normalized_mobile is null or normalized_mobile ~ E'^\\+601[0-9]{7,9}$')
);

create index if not exists factory_product_feedback_contact_campaign_idx
  on public.factory_product_feedback_response_contacts(campaign_id, submitted_at desc);

alter table public.factory_product_feedback_response_contacts enable row level security;
revoke all on table public.factory_product_feedback_response_contacts from public, anon, authenticated;

create or replace function public.factory_product_feedback_save_campaign(p_campaign jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := public.factory_product_feedback_actor();
  v_id uuid := nullif(p_campaign->>'id','')::uuid;
  v_existing public.factory_product_feedback_campaigns%rowtype;
  v_saved public.factory_product_feedback_campaigns%rowtype;
  v_questions jsonb := p_campaign->'questions';
  v_content jsonb := p_campaign->'content';
  v_branding jsonb := p_campaign->'branding';
  v_contact_collection jsonb := p_campaign->'contact_collection';
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
    v_questions := coalesce(v_questions, v_existing.questions, '[]'::jsonb);
    v_content := coalesce(v_content, v_existing.content, '{}'::jsonb);
    v_branding := coalesce(v_branding, v_existing.branding, '{}'::jsonb);
    v_contact_collection := coalesce(v_contact_collection, v_existing.contact_collection, '{}'::jsonb);
  else
    v_questions := coalesce(v_questions, '[]'::jsonb);
    v_content := coalesce(v_content, '{}'::jsonb);
    v_branding := coalesce(v_branding, '{}'::jsonb);
    v_contact_collection := coalesce(v_contact_collection, '{}'::jsonb);
  end if;

  if jsonb_typeof(v_questions) <> 'array' then raise exception using errcode = '22023', message = 'Questions must be an ordered array.'; end if;
  if jsonb_typeof(v_content) <> 'object' or jsonb_typeof(v_branding) <> 'object' or jsonb_typeof(v_contact_collection) <> 'object' then
    raise exception using errcode = '22023', message = 'Campaign content, branding, and contact collection must be objects.';
  end if;
  if coalesce(v_contact_collection->>'enabled', 'false') not in ('true', 'false') then
    raise exception using errcode = '22023', message = 'Contact collection enabled must be true or false.';
  end if;
  if v_contact_collection ? 'prompt' and jsonb_typeof(v_contact_collection->'prompt') <> 'object' then
    raise exception using errcode = '22023', message = 'Contact collection prompt must be localized content.';
  end if;

  if v_id is not null then
    if v_existing.status <> 'draft' and exists(select 1 from public.factory_product_feedback_responses where campaign_id = v_id) and v_questions is distinct from v_existing.questions then
      raise exception using errcode = '22023', message = 'Form questions are immutable after responses have been submitted.';
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
      content = v_content,
      branding = v_branding,
      contact_collection = v_contact_collection,
      form_version = case when v_questions is distinct from v_existing.questions then v_existing.form_version + 1 else v_existing.form_version end,
      updated_by = v_actor,
      updated_at = now()
    where id = v_id returning * into v_saved;
  else
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
  end if;
  return to_jsonb(v_saved);
end; $$;

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
  select to_jsonb(c) into v_campaign from public.factory_product_feedback_campaigns c where c.id = p_campaign_id;
  if v_campaign is null then raise exception using errcode = '22023', message = 'Campaign was not found.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'public_response_id', r.public_response_id, 'variant_id', r.variant_id, 'variant_name', v.name, 'answers', r.answers, 'questions_snapshot', r.questions_snapshot, 'language', r.language, 'repeat_index', r.repeat_index, 'submitted_at', r.submitted_at, 'contact', case when contact.id is null then null else jsonb_build_object('name', contact.name, 'normalized_mobile', contact.normalized_mobile, 'consented_at', contact.consented_at, 'submitted_at', contact.submitted_at) end) order by r.submitted_at desc), '[]'::jsonb) into v_responses from public.factory_product_feedback_responses r left join public.factory_product_feedback_variants v on v.id = r.variant_id left join public.factory_product_feedback_response_contacts contact on contact.response_id = r.id where r.campaign_id = p_campaign_id;
  select coalesce(jsonb_agg(kpi order by ordinal), '[]'::jsonb) into v_kpis from (
    select ordinal, jsonb_strip_nulls(jsonb_build_object(
      'role', question->>'analytics_role', 'question_key', question->>'key',
      'label', case question->>'analytics_role' when 'overall_rating' then 'Overall Rating' when 'purchase_intent' then 'Purchase Intent' when 'taste_spiciness' then 'Spiciness' when 'price_acceptance' then 'Average Accepted Price' else coalesce(question->>'label_en', 'Top Choice') end,
      'tone', case question->>'analytics_role' when 'overall_rating' then 'success' when 'purchase_intent' then 'success' when 'taste_spiciness' then 'info' when 'price_acceptance' then 'info' else 'neutral' end,
      'value', case question->>'analytics_role'
        when 'overall_rating' then coalesce((select round(avg(nullif(r.answers->>(question->>'key'),'')::numeric), 2)::text from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and (r.answers->>(question->>'key')) ~ '^[0-9]+(\\.[0-9]+)?$'), '—')
        when 'purchase_intent' then coalesce((select round(100.0 * avg(case when lower(r.answers->>(question->>'key')) = lower(coalesce(question->>'analytics_target_value','yes')) then 1 else 0 end), 1)::text || '%' from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and r.answers ? (question->>'key')), '—')
        when 'taste_spiciness' then coalesce((select round(100.0 * avg(case when lower(r.answers->>(question->>'key')) = lower(coalesce(question->>'analytics_target_value','just right')) then 1 else 0 end), 1)::text || '%' from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and r.answers ? (question->>'key')), '—')
        when 'price_acceptance' then coalesce((select max(coalesce(o.value->>'currency','MYR')) || ' ' || round(avg((o.value->>'amount')::numeric), 2)::text from public.factory_product_feedback_responses r join lateral jsonb_array_elements(coalesce(question->'options','[]'::jsonb)) o(value) on o.value->>'value' = r.answers->>(question->>'key') where r.campaign_id = p_campaign_id and coalesce(o.value->>'amount','') ~ '^[0-9]+(\\.[0-9]+)?$'), '—')
        else coalesce((select r.answers->>(question->>'key') from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and r.answers ? (question->>'key') group by r.answers->>(question->>'key') order by count(*) desc, r.answers->>(question->>'key') limit 1), '—')
      end
    )) as kpi
    from jsonb_array_elements(coalesce(v_campaign->'questions', '[]'::jsonb)) with ordinality as q(question, ordinal)
    where coalesce(question->>'analytics_role','') in ('overall_rating', 'purchase_intent', 'taste_spiciness', 'price_acceptance', 'generic_choice_distribution')
  ) analytics;
  select jsonb_build_object('responses', jsonb_array_length(v_responses), 'contacts', (select count(*) from public.factory_product_feedback_response_contacts where campaign_id = p_campaign_id), 'kpis', v_kpis) into v_summary;
  return jsonb_build_object('campaign', v_campaign, 'variants', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from public.factory_product_feedback_variants v where v.campaign_id = p_campaign_id), '[]'::jsonb), 'responses', v_responses, 'summary', v_summary);
end; $$;

drop function if exists public.factory_product_feedback_public_submit(text, jsonb, text, text);
create function public.factory_product_feedback_public_submit(
  p_token text,
  p_answers jsonb,
  p_language text default 'en',
  p_session_token text default null,
  p_contact jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.factory_product_feedback_campaigns%rowtype;
  v_variant public.factory_product_feedback_variants%rowtype;
  v_business_date date := timezone('Asia/Kuala_Lumpur', now())::date;
  v_hash text := nullif(md5(coalesce(p_session_token, '')), md5(''));
  v_repeat integer;
  v_question jsonb;
  v_key text;
  v_saved public.factory_product_feedback_responses%rowtype;
  v_name text := nullif(btrim(coalesce(p_contact->>'name', '')), '');
  v_mobile_raw text := nullif(regexp_replace(btrim(coalesce(p_contact->>'mobile', '')), '[^0-9+]', '', 'g'), '');
  v_mobile text;
begin
  if jsonb_typeof(p_answers) <> 'object' then raise exception using errcode = '22023', message = 'Answers must be an object.'; end if;
  if jsonb_typeof(p_contact) <> 'object' then raise exception using errcode = '22023', message = 'Contact details must be an object.'; end if;

  select c.* into v_campaign from public.factory_product_feedback_campaigns c where c.public_id = p_token or exists (select 1 from public.factory_product_feedback_variants v where v.campaign_id = c.id and v.public_token = p_token) limit 1;
  select * into v_variant from public.factory_product_feedback_variants where campaign_id = v_campaign.id and public_token = p_token;
  if v_campaign.id is null or v_campaign.status <> 'live' or (v_campaign.starts_on is not null and v_campaign.starts_on > v_business_date) or (v_campaign.ends_on is not null and v_campaign.ends_on < v_business_date) or (v_variant.id is not null and not v_variant.is_active) then
    raise exception using errcode = '22023', message = 'This feedback link is unavailable.';
  end if;
  for v_question in select value from jsonb_array_elements(v_campaign.questions) loop
    v_key := v_question->>'key';
    if coalesce((v_question->>'required')::boolean, false) and not (p_answers ? v_key) then raise exception using errcode = '22023', message = 'Please answer all required questions.'; end if;
  end loop;
  if (v_name is not null or v_mobile_raw is not null) and not coalesce((v_campaign.contact_collection->>'enabled')::boolean, false) then
    raise exception using errcode = '22023', message = 'Contact collection is not enabled for this campaign.';
  end if;
  if v_name is not null and char_length(v_name) > 160 then raise exception using errcode = '22023', message = 'Name is too long.'; end if;
  if v_mobile_raw is not null then
    if v_mobile_raw ~ '^0' then v_mobile := '+60' || substr(v_mobile_raw, 2);
    elsif v_mobile_raw ~ '^60' then v_mobile := '+' || v_mobile_raw;
    elsif v_mobile_raw ~ E'^\\+60' then v_mobile := v_mobile_raw;
    else raise exception using errcode = '22023', message = 'Enter a valid Malaysian mobile number.';
    end if;
    if v_mobile !~ E'^\\+601[0-9]{7,9}$' then raise exception using errcode = '22023', message = 'Enter a valid Malaysian mobile number.'; end if;
  end if;
  select count(*) + 1 into v_repeat from public.factory_product_feedback_responses where campaign_id = v_campaign.id and variant_id is not distinct from v_variant.id and session_hash is not distinct from v_hash;
  insert into public.factory_product_feedback_responses(campaign_id, variant_id, form_version, questions_snapshot, answers, language, session_hash, repeat_index)
  values(v_campaign.id, v_variant.id, v_campaign.form_version, v_campaign.questions, p_answers, case when p_language in ('zh', 'ms') then p_language else 'en' end, v_hash, v_repeat) returning * into v_saved;
  if v_name is not null or v_mobile is not null then
    insert into public.factory_product_feedback_response_contacts(response_id, campaign_id, name, normalized_mobile)
    values(v_saved.id, v_campaign.id, v_name, v_mobile);
  end if;
  return jsonb_build_object('submitted', true, 'response', v_saved.public_response_id, 'repeat_index', v_saved.repeat_index);
end; $$;

revoke all on function public.factory_product_feedback_public_submit(text, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.factory_product_feedback_public_submit(text, jsonb, text, text, jsonb) to anon, authenticated;
