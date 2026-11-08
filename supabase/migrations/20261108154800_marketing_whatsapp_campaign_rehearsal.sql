-- Read the canonical campaign queue and consent at rehearsal time. No dispatch claim is created.
create function public.marketing_campaign_whatsapp_rehearsal(
 p_org uuid,p_brand uuid,p_campaign uuid,p_revision integer,p_scheduled_at timestamptz,p_batch_size integer
) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare c marketing_campaigns; queued integer; eligible integer; batch_count integer;
begin
 perform marketing_private.require_access(p_org,p_brand,'marketing_campaigns.execute');
 if p_scheduled_at is null or p_scheduled_at<=now() or p_scheduled_at>now()+interval '90 days'
  or p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'Choose a future time and a batch size of 1–100.';end if;
 select * into c from marketing_campaigns where id=p_campaign and organization_id=p_org and brand_id=p_brand;
 if c.id is null or c.status<>'ready' or c.revision is distinct from p_revision or c.approved_revision is distinct from c.revision
 then raise exception 'Queue the current approved campaign before rehearsing.';end if;
 select count(*),count(*) filter(where customer.active and customer.revision=r.customer_revision
  and customer.phone_e164=r.phone_e164 and marketing_private.whatsapp_consent(p_brand,customer.id)=r.consent_id)
 into queued,eligible
 from marketing_campaign_recipients r join platform_customers customer on customer.id=r.customer_id and customer.organization_id=p_org
 where r.campaign_id=c.id and r.campaign_revision=c.revision and r.state='pending';
 batch_count:=(eligible+p_batch_size-1)/p_batch_size;
 return jsonb_build_object('campaign_revision',c.revision,'scheduled_at',p_scheduled_at,'batch_size',p_batch_size,
  'queued',queued,'eligible',eligible,'excluded',queued-eligible,'batches',batch_count,'dispatch_enabled',false);
end;$$;
revoke all on function public.marketing_campaign_whatsapp_rehearsal(uuid,uuid,uuid,integer,timestamptz,integer) from public,anon,authenticated,service_role;
grant execute on function public.marketing_campaign_whatsapp_rehearsal(uuid,uuid,uuid,integer,timestamptz,integer) to authenticated;
