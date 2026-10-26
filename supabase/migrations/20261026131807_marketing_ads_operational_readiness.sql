-- Preserve the reviewed OAuth, grant-continuity and paused-create authorities.
do $$begin
 if md5(pg_get_functiondef('public.marketing_ads_pending(uuid,uuid)'::regprocedure)) <> 'e38f55b857cc2e2121b2bd119d37b2f0'
 or md5(pg_get_functiondef('public.marketing_ads_bind(uuid,uuid,text,uuid,jsonb,timestamptz,jsonb,integer)'::regprocedure)) <> '85ba4833ef33d7b4602bf1f38b53728a'
 or md5(pg_get_functiondef('public.marketing_ads_execution_preflight(uuid,uuid,text)'::regprocedure)) <> '37aa95d871c5853e2efd74df0e8ff406'
 then raise exception 'Ads authorization authority changed; reconcile before applying.';end if;
end;$$;

create or replace function public.marketing_ads_pending(p_org uuid,p_brand uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=marketing_private.require_access(p_org,null,'marketing_ads.connect');result jsonb;
begin
 if not marketing_private.ads_org_allowed(actor,p_org,'marketing_ads.connect') then return '[]';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'expires_at',s.expires_at,
  'authorization_purpose',case when s.ads_management_config_id is null then 'reporting' else 'management' end,
  'accounts',(
   select coalesce(jsonb_agg(item.account||jsonb_build_object(
    'available',not exists(select 1 from marketing_connections elsewhere where elsewhere.channel='ad_account'
     and (elsewhere.provider_account_id=item.account->>'id' or elsewhere.account_slot=item.account->>'id') and elsewhere.organization_id<>p_org),
    'connected_generation',connected.credential_generation,
    'authorization_blocker',case
     when s.ads_management_config_id is not null and item.account->>'manage_verified' is distinct from 'true' then 'ads_management_required'
     when s.ads_management_config_id is not null and connected.status in ('test_authorized','production_authorized')
      and credential.meta_user_id is distinct from s.meta_user_id then 'ads_management_authorizer_changed'
     else null end)),'[]')
   from jsonb_array_elements(s.accounts) item(account)
   left join marketing_connections connected on connected.channel='ad_account' and connected.organization_id=p_org
    and (connected.provider_account_id=item.account->>'id' or connected.account_slot=item.account->>'id')
   left join marketing_private.credentials credential on credential.connection_id=connected.id
  ))),'[]') into result
 from marketing_private.oauth_sessions s where s.purpose='ads' and s.organization_id=p_org and s.actor_employee_id=actor
  and s.expires_at>now() and s.sealed_discovery is not null and s.selected_at is null;
 return result;
end;$$;
revoke all on function public.marketing_ads_pending(uuid,uuid) from public,anon;
grant execute on function public.marketing_ads_pending(uuid,uuid) to authenticated;

do $migration$
declare f text;old text;
begin
 select pg_get_functiondef('public.marketing_ads_bind(uuid,uuid,text,uuid,jsonb,timestamptz,jsonb,integer)'::regprocedure) into f;
 old:='if s.ads_management_config_id is not null and not (coalesce(p_account_evidence->''granted_scopes'',''[]''::jsonb) ? ''ads_management'') then raise exception ''Meta did not grant ads_management.'';end if;';
 if position(old in f)=0 then raise exception 'Management grant guard changed';end if;
 f:=replace(f,old,$new$
 if s.ads_management_config_id is not null then
  if not (coalesce(p_account_evidence->'granted_scopes','[]'::jsonb) ? 'ads_management')
   or p_account_evidence->>'manage_verified' is distinct from 'true' then raise exception 'ads_management_required';end if;
  if c.id is not null and c.status in ('test_authorized','production_authorized') and not exists(
   select 1 from marketing_private.credentials k where k.connection_id=c.id and k.meta_user_id=s.meta_user_id
  ) then raise exception 'ads_management_authorizer_changed';end if;
 end if;
$new$);
 execute f;
 select pg_get_functiondef('public.marketing_ads_execution_preflight(uuid,uuid,text)'::regprocedure) into f;
 old:='jsonb_build_object(''fingerprint'',r.fingerprint';
 if position(old in f)=0 then raise exception 'Execution preflight projection changed';end if;
 f:=replace(f,old,'jsonb_build_object(''id'',r.id,''state'',r.state,''approval_expires_at'',r.approval_expires_at,''approval_current'',coalesce(r.state=''approved'' and r.approval_expires_at>now() and marketing_private.actor_allowed(r.approved_by,r.organization_id,r.brand_id,''marketing_ads.approve'') and marketing_private.actor_allowed(r.reviewed_by,r.organization_id,r.brand_id,''marketing_ads.review''),false),''fingerprint'',r.fingerprint');
 execute f;
end;$migration$;
