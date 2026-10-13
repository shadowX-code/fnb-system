-- Optional names are absent identity data, never persisted display placeholders.
-- No existing customer or POS/consent records are rewritten.
alter table public.platform_customers alter column display_name drop not null;
alter table public.platform_customers drop constraint platform_customers_display_name_check;
alter table public.platform_customers add constraint platform_customers_display_name_check check(display_name is null or length(trim(display_name)) between 1 and 160);
do $migration$ declare definition text;begin
 definition:=pg_get_functiondef('marketing_private.customer_import_contact_row(uuid,uuid,jsonb)'::regprocedure);
 if position($old$if length(trim(coalesce(p_row->>'name',''))) not between 1 and 160 then raise exception 'Name must contain 1–160 characters.';end if;$old$ in definition)=0 then raise exception 'Expected contract missing: marketing_private.customer_import_contact_row(uuid,uuid,jsonb)';end if;
 execute replace(definition,$old$if length(trim(coalesce(p_row->>'name',''))) not between 1 and 160 then raise exception 'Name must contain 1–160 characters.';end if;$old$,$new$if length(trim(coalesce(p_row->>'name','')))>160 then raise exception 'Name must be at most 160 characters.';end if;$new$);
 definition:=pg_get_functiondef('marketing_private.customer_import_contact_row(uuid,uuid,jsonb)'::regprocedure);
 if position($old$v:=jsonb_build_object('name',trim(p_row->>'name'),'phone',phone);$old$ in definition)=0 then raise exception 'Expected contract missing: marketing_private.customer_import_contact_row(uuid,uuid,jsonb)';end if;
 execute replace(definition,$old$v:=jsonb_build_object('name',trim(p_row->>'name'),'phone',phone);$old$,$new$v:=jsonb_build_object('phone',phone);
 if nullif(trim(p_row->>'name'),'') is not null then v:=v||jsonb_build_object('name',trim(p_row->>'name'));end if;$new$);
 definition:=pg_get_functiondef('public.platform_customer_command(uuid,uuid,uuid,jsonb)'::regprocedure);
 if position($old$phone:=marketing_private.my_phone(p_payload->>'phone');$old$ in definition)=0 then raise exception 'Expected contract missing: public.platform_customer_command(uuid,uuid,uuid,jsonb)';end if;
 execute replace(definition,$old$phone:=marketing_private.my_phone(p_payload->>'phone');$old$,$new$phone:=marketing_private.my_phone(p_payload->>'phone');
 if length(trim(coalesce(p_payload->>'name','')))>160 then raise exception 'Name must be at most 160 characters.';end if;$new$);
 definition:=pg_get_functiondef('public.platform_customer_command(uuid,uuid,uuid,jsonb)'::regprocedure);
 if position($old$trim(p_payload->>'name')$old$ in definition)=0 then raise exception 'Expected contract missing: public.platform_customer_command(uuid,uuid,uuid,jsonb)';end if;
 execute replace(definition,$old$trim(p_payload->>'name')$old$,$new$nullif(trim(p_payload->>'name'),'')$new$);
 definition:=pg_get_functiondef('public.platform_customer_command(uuid,uuid,uuid,jsonb)'::regprocedure);
 if position($old$p_payload->>'gender' not in$old$ in definition)=0 then raise exception 'Expected contract missing: public.platform_customer_command(uuid,uuid,uuid,jsonb)';end if;
 execute replace(definition,$old$p_payload->>'gender' not in$old$,$new$nullif(p_payload->>'gender','') is not null and p_payload->>'gender' not in$new$);
 definition:=pg_get_functiondef('public.platform_customer_command(uuid,uuid,uuid,jsonb)'::regprocedure);
 if position($old$update public.platform_customers set email=coalesce(nullif(trim(p_payload->>'email'),''),email),
 gender=coalesce(nullif(p_payload->>'gender',''),gender),birthday=coalesce(marketing_private.customer_import_date(nullif(p_payload->>'birthday','')),birthday),revision=revision+1
 where id=cid and ((nullif(trim(p_payload->>'email'),'') is not null and email is distinct from trim(p_payload->>'email')) or
 (nullif(p_payload->>'gender','') is not null and gender is distinct from p_payload->>'gender') or
 (nullif(p_payload->>'birthday','') is not null and birthday is distinct from marketing_private.customer_import_date(p_payload->>'birthday')));$old$ in definition)=0 then raise exception 'Expected contract missing: public.platform_customer_command(uuid,uuid,uuid,jsonb)';end if;
 execute replace(definition,$old$update public.platform_customers set email=coalesce(nullif(trim(p_payload->>'email'),''),email),
 gender=coalesce(nullif(p_payload->>'gender',''),gender),birthday=coalesce(marketing_private.customer_import_date(nullif(p_payload->>'birthday','')),birthday),revision=revision+1
 where id=cid and ((nullif(trim(p_payload->>'email'),'') is not null and email is distinct from trim(p_payload->>'email')) or
 (nullif(p_payload->>'gender','') is not null and gender is distinct from p_payload->>'gender') or
 (nullif(p_payload->>'birthday','') is not null and birthday is distinct from marketing_private.customer_import_date(p_payload->>'birthday')));$old$,$new$update public.platform_customers set email=case when p_payload ? 'email' then nullif(trim(p_payload->>'email'),'') else email end,
 gender=case when p_payload ? 'gender' then nullif(p_payload->>'gender','') else gender end,
 birthday=case when p_payload ? 'birthday' then marketing_private.customer_import_date(nullif(p_payload->>'birthday','')) else birthday end,revision=revision+1
 where id=cid and ((p_payload ? 'email' and email is distinct from nullif(trim(p_payload->>'email'),'')) or
 (p_payload ? 'gender' and gender is distinct from nullif(p_payload->>'gender','')) or
 (p_payload ? 'birthday' and birthday is distinct from marketing_private.customer_import_date(nullif(p_payload->>'birthday',''))));$new$);
 definition:=pg_get_functiondef('public.platform_customer_import_job(uuid,uuid,text,uuid,jsonb)'::regprocedure);
 if position($old$if not(p_payload->'mapping' ?& array['name','phone']) or p_payload->'mapping'->>'name'='' or p_payload->'mapping'->>'phone'='' then raise exception 'Map Name and Phone.';end if;$old$ in definition)=0 then raise exception 'Expected contract missing: public.platform_customer_import_job(uuid,uuid,text,uuid,jsonb)';end if;
 execute replace(definition,$old$if not(p_payload->'mapping' ?& array['name','phone']) or p_payload->'mapping'->>'name'='' or p_payload->'mapping'->>'phone'='' then raise exception 'Map Name and Phone.';end if;$old$,$new$if nullif(p_payload->'mapping'->>'phone','') is null then raise exception 'Map Malaysian Phone.';end if;$new$);
 definition:=pg_get_functiondef('public.marketing_customers_read(uuid,uuid,jsonb,integer,integer)'::regprocedure);
 if position($old$marketing_private.customer_snapshot(p_brand,c.id) snapshot,$old$ in definition)=0 then raise exception 'Expected contract missing: public.marketing_customers_read(uuid,uuid,jsonb,integer,integer)';end if;
 execute replace(definition,$old$marketing_private.customer_snapshot(p_brand,c.id) snapshot,$old$,$new$(select marketing_private.customer_pos_current(p_brand,c.id,s.source) from marketing_private.customer_pos_snapshots s where s.brand_id=p_brand and s.customer_id=c.id order by s.snapshot_date desc,s.imported_at desc,s.id desc limit 1) pos_snapshot,
 marketing_private.customer_snapshot(p_brand,c.id) snapshot,$new$);
 definition:=pg_get_functiondef('public.marketing_outreach_command(uuid,uuid,uuid,text,uuid,jsonb)'::regprocedure);
 if position($old$replace(c.caption,'{name}',x.display_name)$old$ in definition)=0 then raise exception 'Expected contract missing: public.marketing_outreach_command(uuid,uuid,uuid,text,uuid,jsonb)';end if;
 execute replace(definition,$old$replace(c.caption,'{name}',x.display_name)$old$,$new$replace(c.caption,'{name}',coalesce(x.display_name,''))$new$);
end;$migration$;
