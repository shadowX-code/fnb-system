-- Re-completion retains verification provenance; current status owns the next action.
do $fix$
declare v_definition text:=pg_get_functiondef('feedx_integrations.mesti_rows(date,date)'::regprocedure);
begin
  if strpos(v_definition, $$when status='unsatisfactory' or verification_result='unsatisfactory' then 'evidence_issues'$$)=0 then
    raise exception 'Inspection cleaning classification changed; re-audit before applying.';
  end if;
  execute replace(v_definition,
    $$when status='unsatisfactory' or verification_result='unsatisfactory' then 'evidence_issues'$$,
    $$when status='unsatisfactory' then 'evidence_issues'$$);
end $fix$;
