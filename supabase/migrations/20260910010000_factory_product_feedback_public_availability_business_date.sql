-- Public campaign availability follows the Factory Malaysia business date rather than the
-- database server's UTC date. Entry and submission must enforce the same availability rule.
create or replace function public.factory_product_feedback_public_entry(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_campaign public.factory_product_feedback_campaigns%rowtype;
  v_variant public.factory_product_feedback_variants%rowtype;
  v_business_date date := timezone('Asia/Kuala_Lumpur', now())::date;
begin
  select c.* into v_campaign
  from public.factory_product_feedback_campaigns c
  where c.public_id = p_token
     or exists (
       select 1 from public.factory_product_feedback_variants v
       where v.campaign_id = c.id and v.public_token = p_token
     )
  limit 1;

  select * into v_variant
  from public.factory_product_feedback_variants
  where campaign_id = v_campaign.id and public_token = p_token;

  if v_campaign.id is null
    or v_campaign.status <> 'live'
    or (v_campaign.starts_on is not null and v_campaign.starts_on > v_business_date)
    or (v_campaign.ends_on is not null and v_campaign.ends_on < v_business_date)
    or (v_variant.id is not null and not v_variant.is_active)
  then
    return jsonb_build_object('available', false);
  end if;

  return jsonb_build_object(
    'available', true,
    'campaign', jsonb_build_object(
      'name', v_campaign.name,
      'event_label', v_campaign.event_label,
      'default_language', v_campaign.default_language,
      'thank_you_en', v_campaign.thank_you_en,
      'thank_you_zh', v_campaign.thank_you_zh,
      'questions', v_campaign.questions,
      'content', v_campaign.content,
      'branding', v_campaign.branding
    ),
    'variant', case when v_variant.id is null then null else jsonb_build_object('name', v_variant.name) end
  );
end; $$;

create or replace function public.factory_product_feedback_public_submit(
  p_token text,
  p_answers jsonb,
  p_language text default 'en',
  p_session_token text default null
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
begin
  if jsonb_typeof(p_answers) <> 'object' then
    raise exception using errcode = '22023', message = 'Answers must be an object.';
  end if;

  select c.* into v_campaign
  from public.factory_product_feedback_campaigns c
  where c.public_id = p_token
     or exists (
       select 1 from public.factory_product_feedback_variants v
       where v.campaign_id = c.id and v.public_token = p_token
     )
  limit 1;

  select * into v_variant
  from public.factory_product_feedback_variants
  where campaign_id = v_campaign.id and public_token = p_token;

  if v_campaign.id is null
    or v_campaign.status <> 'live'
    or (v_campaign.starts_on is not null and v_campaign.starts_on > v_business_date)
    or (v_campaign.ends_on is not null and v_campaign.ends_on < v_business_date)
    or (v_variant.id is not null and not v_variant.is_active)
  then
    raise exception using errcode = '22023', message = 'This feedback link is unavailable.';
  end if;

  for v_question in select value from jsonb_array_elements(v_campaign.questions)
  loop
    v_key := v_question->>'key';
    if coalesce((v_question->>'required')::boolean, false) and not (p_answers ? v_key) then
      raise exception using errcode = '22023', message = 'Please answer all required questions.';
    end if;
  end loop;

  select count(*) + 1 into v_repeat
  from public.factory_product_feedback_responses
  where campaign_id = v_campaign.id
    and variant_id is not distinct from v_variant.id
    and session_hash is not distinct from v_hash;

  insert into public.factory_product_feedback_responses(
    campaign_id, variant_id, form_version, questions_snapshot, answers, language, session_hash, repeat_index
  )
  values(
    v_campaign.id,
    v_variant.id,
    v_campaign.form_version,
    v_campaign.questions,
    p_answers,
    case when p_language in ('zh', 'ms') then p_language else 'en' end,
    v_hash,
    v_repeat
  )
  returning * into v_saved;

  return jsonb_build_object('submitted', true, 'response', v_saved.public_response_id, 'repeat_index', v_saved.repeat_index);
end; $$;

revoke all on function public.factory_product_feedback_public_entry(text), public.factory_product_feedback_public_submit(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.factory_product_feedback_public_entry(text), public.factory_product_feedback_public_submit(text, jsonb, text, text) to anon, authenticated;
