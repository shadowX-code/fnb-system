-- Enrich the authenticated Product Feedback read model with the metadata the
-- Form Builder needs to explain immutable form versions. This is read-only:
-- campaigns, active versions, and response snapshots remain unchanged.
create or replace function public.factory_product_feedback_admin_data(p_campaign_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_data jsonb;
  v_responses jsonb;
  v_versions jsonb;
begin
  v_data := public.factory_product_feedback_admin_data_base(p_campaign_id);
  if p_campaign_id is null then return v_data; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id,
    'version', f.version,
    'active', f.id = c.active_form_version_id,
    'question_count', jsonb_array_length(f.questions),
    'response_count', (select count(*) from public.factory_product_feedback_responses r where r.form_version_id = f.id),
    'created_at', f.created_at
  ) order by f.version desc), '[]'::jsonb)
  into v_versions
  from public.factory_product_feedback_form_versions f
  join public.factory_product_feedback_campaigns c on c.id = f.campaign_id
  where f.campaign_id = p_campaign_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'public_response_id', r.public_response_id,
    'variant_id', r.variant_id,
    'variant_name', v.name,
    'answers', r.answers,
    'answer_details', r.answer_details,
    'questions_snapshot', r.questions_snapshot,
    'form_version', r.form_version,
    'form_version_id', r.form_version_id,
    'language', r.language,
    'repeat_index', r.repeat_index,
    'submitted_at', r.submitted_at,
    'contact', case when contact.id is null then null else jsonb_build_object(
      'name', contact.name,
      'normalized_mobile', contact.normalized_mobile,
      'consented_at', contact.consented_at,
      'submitted_at', contact.submitted_at
    ) end
  ) order by r.submitted_at desc), '[]'::jsonb)
  into v_responses
  from public.factory_product_feedback_responses r
  left join public.factory_product_feedback_variants v on v.id = r.variant_id
  left join public.factory_product_feedback_response_contacts contact on contact.response_id = r.id
  where r.campaign_id = p_campaign_id;

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_data, '{responses}', v_responses, true),
      '{form_versions}', v_versions, true
    ),
    '{summary,contacts}',
    to_jsonb((select count(*) from public.factory_product_feedback_response_contacts where campaign_id = p_campaign_id)),
    true
  );
end; $$;

revoke all on function public.factory_product_feedback_admin_data(uuid) from public, anon;
grant execute on function public.factory_product_feedback_admin_data(uuid) to authenticated;
