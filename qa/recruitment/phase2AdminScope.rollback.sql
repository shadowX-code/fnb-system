begin;
do $$
declare owner_auth uuid; manager_auth uuid; app uuid; outside uuid; denied boolean:=false;
begin
  select e.auth_user_id into owner_auth from employees e join roles r on r.id=e.role_id where r.name='owner' and e.enable_system_login and e.access_state='active' and e.is_active limit 1;
  select e.auth_user_id into manager_auth from employees e join roles r on r.id=e.role_id where r.name='manager' and e.enable_system_login and e.access_state='active' and e.is_active limit 1;
  select id into app from recruitment_applications limit 1;
  if owner_auth is null or manager_auth is null or app is null then raise exception 'Required existing QA authorities unavailable'; end if;
  perform set_config('request.jwt.claim.sub',owner_auth::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_auth,'role','authenticated')::text,true);
  perform recruitment_admin_evidence(app);
  perform set_config('request.jwt.claim.sub',manager_auth::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_auth,'role','authenticated')::text,true);
  if not current_user_has_permission('recruitment.view') then
    begin perform recruitment_admin_evidence(app); exception when insufficient_privilege then denied:=true; end;
    if not denied then raise exception 'Manager without Recruitment permission could read evidence'; end if;
  end if;
  select id into outside from outlets where not current_user_can_access_outlet(id) limit 1;
  if outside is not null and recruitment_opening_in_scope(outside) then raise exception 'Opening outlet scope escaped canonical authority'; end if;
  raise notice 'Existing owner evidence access, manager permission denial and canonical outlet scope checked';
end $$;
rollback;
