-- Campaign question roles, not question wording, own KPI selection. Historical response
-- snapshots remain authoritative for submitted answers.
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
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'public_response_id', r.public_response_id, 'variant_id', r.variant_id, 'variant_name', v.name, 'answers', r.answers, 'questions_snapshot', r.questions_snapshot, 'language', r.language, 'repeat_index', r.repeat_index, 'submitted_at', r.submitted_at) order by r.submitted_at desc), '[]'::jsonb) into v_responses from public.factory_product_feedback_responses r left join public.factory_product_feedback_variants v on v.id = r.variant_id where r.campaign_id = p_campaign_id;
  select coalesce(jsonb_agg(kpi order by ordinal), '[]'::jsonb) into v_kpis from (
    select ordinal, jsonb_strip_nulls(jsonb_build_object(
      'role', question->>'analytics_role', 'question_key', question->>'key',
      'label', case question->>'analytics_role' when 'overall_rating' then 'Overall Rating' when 'purchase_intent' then 'Purchase Intent' when 'taste_spiciness' then 'Spiciness' when 'price_acceptance' then 'Average Accepted Price' else coalesce(question->>'label_en', 'Top Choice') end,
      'tone', case question->>'analytics_role' when 'overall_rating' then 'success' when 'purchase_intent' then 'success' when 'taste_spiciness' then 'info' when 'price_acceptance' then 'info' else 'neutral' end,
      'value', case question->>'analytics_role'
        when 'overall_rating' then coalesce((select round(avg(nullif(r.answers->>(question->>'key'),'')::numeric), 2)::text from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and (r.answers->>(question->>'key')) ~ '^[0-9]+(\\.[0-9]+)?$'), '—')
        when 'purchase_intent' then coalesce((select round(100.0 * avg(case when lower(r.answers->>(question->>'key')) = lower(coalesce(question->>'analytics_target_value','yes')) then 1 else 0 end), 1)::text || '%' from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and r.answers ? (question->>'key')), '—')
        when 'taste_spiciness' then coalesce((select round(100.0 * avg(case when lower(r.answers->>(question->>'key')) = lower(coalesce(question->>'analytics_target_value','just right')) then 1 else 0 end), 1)::text || '%' from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and r.answers ? (question->>'key')), '—')
        when 'price_acceptance' then coalesce((select coalesce(o.value->>'currency','MYR') || ' ' || round(avg((o.value->>'amount')::numeric), 2)::text from public.factory_product_feedback_responses r join lateral jsonb_array_elements(coalesce(question->'options','[]'::jsonb)) o(value) on o.value->>'value' = r.answers->>(question->>'key') where r.campaign_id = p_campaign_id and coalesce(o.value->>'amount','') ~ '^[0-9]+(\\.[0-9]+)?$'), '—')
        else coalesce((select r.answers->>(question->>'key') from public.factory_product_feedback_responses r where r.campaign_id = p_campaign_id and r.answers ? (question->>'key') group by r.answers->>(question->>'key') order by count(*) desc, r.answers->>(question->>'key') limit 1), '—')
      end
    )) as kpi
    from jsonb_array_elements(coalesce(v_campaign->'questions', '[]'::jsonb)) with ordinality as q(question, ordinal)
    where coalesce(question->>'analytics_role','') in ('overall_rating', 'purchase_intent', 'taste_spiciness', 'price_acceptance', 'generic_choice_distribution')
  ) analytics;
  select jsonb_build_object('responses', jsonb_array_length(v_responses), 'kpis', v_kpis) into v_summary;
  return jsonb_build_object('campaign', v_campaign, 'variants', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at) from public.factory_product_feedback_variants v where v.campaign_id = p_campaign_id), '[]'::jsonb), 'responses', v_responses, 'summary', v_summary);
end; $$;
