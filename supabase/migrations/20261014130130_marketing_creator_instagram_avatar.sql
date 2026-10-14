alter table public.marketing_creators add column primary_instagram_account_id uuid references public.marketing_creator_accounts(id) on delete set null;
do $avatar$
declare body text; needle text; replacement text;
begin
 body:=pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 needle:='result:=to_jsonb(c);entity:=''creator'';record_id:=c.id;rev:=c.revision;';
 replacement:='if p_action=''save_creator'' and p_payload?''primary_instagram_account_id'' then
 if nullif(p_payload->>''primary_instagram_account_id'','''') is not null and not exists(select 1 from public.marketing_creator_accounts ca where ca.id=(p_payload->>''primary_instagram_account_id'')::uuid and ca.creator_id=c.id and ca.organization_id=p_org and ca.platform=''instagram'' and not ca.archived) then raise exception ''Choose this Creator’s active Instagram profile.'';end if;
 update public.marketing_creators set primary_instagram_account_id=nullif(p_payload->>''primary_instagram_account_id'','''')::uuid where id=c.id returning * into c;end if;
 result:=to_jsonb(c);entity:=''creator'';record_id:=c.id;rev:=c.revision;';
 if position(needle in body)=0 then raise exception 'Creator command changed';end if;body:=replace(body,needle,replacement);
 needle:='''avatar_url'',p_payload->''public_observation''->''avatar_url'')';
 replacement:='''avatar_url'',p_payload->''public_observation''->''avatar_url'',''avatar_kind'',case when a.platform=''instagram'' and p_payload->''public_observation''->>''avatar_kind''=''profile_picture'' and p_payload->''public_observation''->>''profile_url''=a.profile_url then ''profile_picture'' end,''profile_url'',case when p_payload->''public_observation''->>''profile_url''=a.profile_url then a.profile_url end)';
 if position(needle in body)=0 then raise exception 'Profile observation changed';end if;body:=replace(body,needle,replacement);
 execute body;
end;$avatar$;
