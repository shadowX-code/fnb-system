do $$declare body text;begin
 body:=pg_get_functiondef('public.marketing_social_performance(uuid,uuid,date,date,text)'::regprocedure);
 if position('or p_grain not in' in body)=0 then raise exception 'Performance grain contract changed.';end if;
 body:=replace(body,'or p_grain not in','or p_grain is null or p_grain not in');
 execute body;
end;$$;
