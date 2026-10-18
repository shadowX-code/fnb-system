-- Preserve unique identities and return only authorized shared-directory conflict targets.
-- Replacing the handler retains the installed command, including concurrent forward fixes.
do $migration$
declare definition text;old_handler text:=$old$exception when unique_violation then raise exception using errcode='23505',message='This account or post identity already exists. Reload and open the existing record.';$old$;
new_handler text:=$new$exception when unique_violation then
 get stacked diagnostics fp=PG_EXCEPTION_DETAIL,entity=CONSTRAINT_NAME;
 -- Preserve a child account conflict when saving profiles inside a Creator transaction.
 if fp like '%"kind": "creator_account_conflict"%' then raise;end if;
 if p_action='save_account' and entity in ('marketing_creator_account_external','marketing_creator_account_handle','marketing_creator_account_profile')
 and marketing_private.creator_editable(p_org,linked_creator) then
 select jsonb_build_object('kind','creator_account_conflict','account_id',ca.id,'creator_id',cc.id,
 'creator_name',cc.name,'same_creator',cc.id=linked_creator,'archived',ca.archived)
 into result from public.marketing_creator_accounts ca join public.marketing_creators cc on cc.id=ca.creator_id
 where ca.organization_id=p_org and ca.platform=profile->>'platform' and ca.id is distinct from p_id
 and marketing_private.creator_visible(p_org,cc.id) and (
 (entity='marketing_creator_account_external' and ca.external_id=profile->>'external_id' and ca.external_id<>'') or
 (entity='marketing_creator_account_handle' and lower(ca.handle)=lower(profile->>'handle') and ca.handle<>'') or
 (entity='marketing_creator_account_profile' and lower(ca.profile_url)=lower(profile->>'profile_url') and ca.profile_url<>''))
 order by ca.id limit 1;
 if result is not null then raise exception using errcode='23505',
 message=case when (result->>'same_creator')::boolean then 'Already Linked' else 'This social profile is linked to '||(result->>'creator_name')||'.' end,
 detail=result::text;end if;
 end if;
 raise exception using errcode='23505',message='This account or post identity already exists. Open its existing record.';
$new$;
begin
 definition:=pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 if position(old_handler in definition)=0 then raise exception 'Creator command handler changed; review before applying.';end if;
 execute replace(definition,old_handler,new_handler);
end;$migration$;
