begin;
do $$declare owner_id uuid;response jsonb;identity uuid;latest uuid;days integer;expiry timestamptz;begin
 select e.auth_user_id into strict owner_id from public.employees e join public.roles r on r.id=e.role_id where lower(r.name)='owner' and e.auth_user_id is not null limit 1;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 response:=public.external_agents_register(gen_random_uuid(),'Policy rollback QA','QA','factory_mesti',array['nav_factory_mesti_cleaning_view'],90);identity:=(response->>'identity_id')::uuid;latest:=(response->>'credential_id')::uuid;
 foreach days in array array[30,90,180] loop
  response:=public.external_agents_rotate_credential(identity,latest,gen_random_uuid(),days);expiry:=(response->>'expires_at')::timestamptz;
  if abs(extract(epoch from (expiry-clock_timestamp()))-days*86400)>10 then raise exception 'Wrong duration';end if;
  latest:=(response->>'credential_id')::uuid;
 end loop;
 begin perform public.external_agents_rotate_credential(identity,latest,gen_random_uuid(),365);raise exception 'Invalid duration accepted';exception when invalid_parameter_value then null;end;
 execute 'set local role postgres';
 if (select count(*) from feedx_integrations.machine_credentials where identity_id=identity and revoked_at is null)<>1 then raise exception 'Rotation did not isolate active key';end if;
 insert into public.role_permissions(role_id,permission_id) select m.role_id,p.id from feedx_integrations.machine_identities m cross join public.permissions p where m.id=identity and p.code='factory_agent_mesti_review.view';
 if feedx_integrations.effective_access(identity)->>'summary' not like '%Compliance review records%' then raise exception 'Additional scope hidden';end if;
 execute 'set local role authenticated';
 perform public.external_agents_set_capability(identity,'factory_mesti_review_view',false,true);
 execute 'set local role postgres';
 if feedx_integrations.effective_access(identity)->>'summary' like '%Compliance review records%' then raise exception 'Additional scope not revoked';end if;
 if not exists(select 1 from public.audit_logs where action='external_agent_capability_revoked' and metadata->>'identity_id'=identity::text and trusted_external_agent) then raise exception 'Revocation audit missing';end if;
 update feedx_integrations.adapters set credential_days=array[30],credential_default_days=30 where key='factory_mesti';
 execute 'set local role authenticated';
 begin perform public.external_agents_rotate_credential(identity,latest,gen_random_uuid(),90);raise exception 'Policy restriction bypassed';exception when invalid_parameter_value then null;end;
 execute 'set local role postgres';
end $$;
rollback;
select 'PASS: 30/90/180 issuance, policy rejection, rotation, effective grant visibility, removal and audit' result;
