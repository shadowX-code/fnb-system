-- Qualify local values with an explicit PL/pgSQL block label, never a relation alias.
do $migration$
declare body text:=pg_get_functiondef('public.marketing_caption_save(uuid,uuid,uuid,integer,jsonb)'::regprocedure);
begin
 if position('kind=marketing_caption_save.kind' in body)=0 then raise exception 'Unexpected caption save baseline';end if;
 body:=replace(body,'declare org uuid;actor uuid;','<<caption_values>>'||chr(10)||'declare org uuid;actor uuid;');
 body:=replace(body,'marketing_caption_save.kind','caption_values.kind');
 body:=replace(body,'marketing_caption_save.name','caption_values.name');
 body:=replace(body,'marketing_caption_save.body','caption_values.body');
 body:=replace(body,'marketing_caption_save.active','caption_values.active');
 execute body;
end;$migration$;
