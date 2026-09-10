-- Public clients receive only the campaign-level contact configuration. Contact values
-- remain private to the trusted submit path and authenticated admin response detail.
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
      'branding', v_campaign.branding,
      'contact_collection', case
        when coalesce((v_campaign.contact_collection->>'enabled')::boolean, false)
          then jsonb_build_object(
            'enabled', true,
            'prompt', coalesce(v_campaign.contact_collection->'prompt', '{}'::jsonb)
          )
        else jsonb_build_object('enabled', false)
      end
    ),
    'variant', case when v_variant.id is null then null else jsonb_build_object('name', v_variant.name) end
  );
end; $$;

revoke all on function public.factory_product_feedback_public_entry(text) from public, anon, authenticated;
grant execute on function public.factory_product_feedback_public_entry(text) to anon, authenticated;
