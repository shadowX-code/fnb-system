-- Keep stable identity separate from the validated navigable share URL. Do not reconstruct legacy links.
alter table public.marketing_creator_posts add column original_url text check(original_url is null or length(original_url)<=2000);

do $patch$
declare body text;needle text;
begin
 select pg_get_functiondef('marketing_private.creator_url(text)'::regprocedure) into body;
 needle:='^/(?:a/)?([A-Za-z0-9]+)/?(?:\?.*)?$';
 if position(needle in body)=0 then raise exception 'Missing XHS short-link parser anchor';end if;
 body:=replace(body,needle,'^/(?:[ao]/)?([A-Za-z0-9]+)/?(?:\?.*)?$');
 execute body;
 select pg_get_functiondef('public.marketing_creator_command(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure) into body;
 needle:='parsed:=marketing_private.creator_url(p_payload->>''url'');';
 if position(needle in body)=0 then raise exception 'Missing Post identity parser anchor';end if;
 body:=replace(body,needle,needle||' if parsed->>''platform''=''xhs'' and (parsed->>''short_link'')::boolean and p.id is null then raise exception ''Resolve the Xiaohongshu short link or paste its complete share URL before saving.'';end if;');
 execute body;
end;$patch$;

create function marketing_private.creator_original_url(p public.marketing_creator_posts,u text) returns text
language plpgsql immutable set search_path=public as $$
declare parsed jsonb;
begin
 if u is null or trim(u)='' then return null;end if;
 u:=trim(u);
 if length(u)>2000 or u !~ '^https://' or u ~ '[[:space:]\\]' then raise exception 'Use a valid HTTPS original Post URL.';end if;
 parsed:=marketing_private.creator_url(u);
 if parsed->>'platform'<>p.platform then raise exception 'Original URL belongs to another platform.';end if;
 if parsed->>'post_key'<>p.post_key and not (p.platform='xhs' and (parsed->>'short_link')::boolean and p.post_key ~ '^[a-f0-9]{24}$') then raise exception 'Original URL belongs to another Post.';end if;
 return u;
end;$$;
revoke all on function marketing_private.creator_original_url(public.marketing_creator_posts,text) from public,anon,authenticated;

do $patch$
declare body text;needle text;
begin
 select pg_get_functiondef('marketing_private.creator_post_details(uuid,uuid,uuid,jsonb)'::regprocedure) into body;
 needle:='return p;';
 if position(needle in body)=0 then raise exception 'Missing Post details result anchor';end if;
 body:=replace(body,needle,'if p_payload?''original_url'' then update public.marketing_creator_posts set original_url=marketing_private.creator_original_url(p,p_payload->>''original_url'') where id=p.id returning * into p;end if; '||needle);
 execute body;
end;$patch$;

