-- Preserve legacy Production ordering without enabling the excluded reminder workflow.
do $legacy_order$
declare f text; needle text:='coalesce((select remind_at<=now() from marketing_inbox_reads where conversation_id=c.id and employee_id=actor),false) desc,';
begin
 f:=pg_get_functiondef('public.marketing_inbox_read(uuid,uuid,text,text,text,integer,integer,text,boolean,text)'::regprocedure);
 if md5(f)<>'c9dee80a7f8b81f03f9e3610fc112ef6' then raise exception 'Inbox read correction baseline differs';end if;
 if length(f)-length(replace(f,needle,''))<>length(needle) then raise exception 'Expected single legacy ordering dependency unavailable';end if;
 execute replace(f,needle,'');
end;$legacy_order$;
notify pgrst,'reload schema';
