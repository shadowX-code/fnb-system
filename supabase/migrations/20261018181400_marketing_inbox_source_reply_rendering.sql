-- Render identical cited answers once, retaining every supporting source key.
do $migration$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('marketing_private.inbox_auto_answer(public.marketing_inbox_ai_artifacts,jsonb,text)'::regprocedure);
 needle:='  parts:=array_append(parts,part);keys:=keys||jsonb_build_array(ref);';
 if position(needle in definition)=0 then raise exception 'Automatic source renderer baseline differs';end if;
 definition:=replace(definition,needle,'  if not(part=any(parts)) then parts:=array_append(parts,part);end if;keys:=keys||jsonb_build_array(ref);');
 -- Avoid escape-dependent separators in stored function bodies and menu-item lists.
 definition:=replace(definition,'E'''||chr(92)||'n''','chr(10)');
 definition:=replace(definition,'E'''||chr(92)||chr(92)||'n''','chr(10)');
 if position('part:=array_to_string(parts,chr(10));' in definition)=0 then raise exception 'Automatic separator baseline differs';end if;
 execute definition;
end;$migration$;
