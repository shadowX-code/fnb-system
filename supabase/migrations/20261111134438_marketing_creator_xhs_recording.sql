-- Preserve navigation parameters while using the stable XHS profile ID for uniqueness.
do $patch$
declare body text; needle text;
begin
 body:=pg_get_functiondef('marketing_private.creator_profile(jsonb)'::regprocedure);
 needle:=$old$;eid:=lower(m[1]);u:='https://www.xiaohongshu.com/user/profile/'||eid;$old$;
 if position(needle in body)=0 then raise exception 'XHS profile parser changed';end if;
 execute replace(body,needle,';eid:=lower(m[1]);');

 body:=pg_get_functiondef('marketing_private.creator_url(text)'::regprocedure);
 needle:='length(u)>1500';
 if position(needle in body)=0 then raise exception 'Creator URL length guard changed';end if;
 body:=replace(body,needle,$new$(length(u)>1500 and (length(u)>2000 or u !~ '^https://(?:www[.])?(?:xiaohongshu[.]com|xhslink[.]com)/'))$new$);
 needle:=$old$^/(?:explore|discovery/item)/([A-Fa-f0-9]+)/?(?:\?.*)?$old$;
 if position(needle in body)=0 then raise exception 'XHS note parser changed';end if;
 body:=replace(body,needle,$new$^/(?:explore|discovery/item|user/profile/[A-Fa-f0-9]{24})/([A-Fa-f0-9]+)/?(?:\?.*)?$new$);
 needle:=$old$^/(?:[ao]/)?([A-Za-z0-9]+)/?(?:\?.*)?$old$;
 if position(needle in body)=0 then raise exception 'XHS short parser changed';end if;
 execute replace(body,needle,$new$^/(?:[A-Za-z]/)?([A-Za-z0-9_-]+)/?(?:\?.*)?$new$);

 body:=pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 needle:=$old$(profile->>'platform',profile->>'handle',profile->>'external_id',profile->>'profile_url');$old$;
 if position(needle in body)=0 then raise exception 'Creator profile identity comparison changed';end if;
 body:=replace(body,needle,$new$(profile->>'platform',profile->>'handle',profile->>'external_id',profile->>'profile_url');
 if a.platform='xhs' and profile->>'platform'='xhs' and a.external_id<>'' and a.external_id=profile->>'external_id' and a.handle=profile->>'handle' then identity_changed:=false;end if;$new$);
 needle:=$old$d:=null;if nullif(p_payload->>'deliverable_id','') is not null then$old$;
 if position(needle in body)=0 then raise exception 'Creator Post binding changed';end if;
 execute replace(body,needle,$new$if p.id is null and v.id is not null and parsed->>'platform'='xhs' and (v.creator_id is null or a.id is null or v.status='cancelled') then
 raise exception 'Choose an active Collaboration and its Creator’s Xiaohongshu Social Profile.';
 end if;
 d:=null;if nullif(p_payload->>'deliverable_id','') is not null then$new$);
end;
$patch$;
