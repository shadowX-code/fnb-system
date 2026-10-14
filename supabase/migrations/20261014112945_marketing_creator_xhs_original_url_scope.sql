-- Keep this share-URL repair scoped to XHS; other adapters retain their existing persistence contracts.
do $$declare body text;needle text:='if p_payload?''original_url'' then update public.marketing_creator_posts';begin
 select pg_get_functiondef('marketing_private.creator_post_details(uuid,uuid,uuid,jsonb)'::regprocedure) into body;
 if position(needle in body)=0 then raise exception 'Missing original URL update anchor';end if;
 execute replace(body,needle,'if p.platform=''xhs'' and p_payload?''original_url'' then update public.marketing_creator_posts');
end;$$;
