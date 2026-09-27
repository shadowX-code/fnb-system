-- Official supported cases only; do not use company accounting allocation
-- to resolve an unreconciled statutory edge. Historical snapshots stay intact.
do $migration$
declare v_definition text; v_before text;
begin
  v_before := pg_get_functiondef('public.payroll_statutory_project(uuid,uuid)'::regprocedure);
  if position('and v_issue<>''epf_remittance_rounding_allocation_unapproved''' in v_before)=0 then
    raise exception 'Unexpected statutory authority definition; review before applying.';
  end if;
  v_definition := replace(v_before,
    E'if v_issue not like ''pcb_%''\n      and v_issue<>''epf_remittance_rounding_allocation_unapproved'' then',
    'if v_issue not like ''pcb_%'' then');
  if v_definition=v_before then raise exception 'EPF gate replacement did not match.'; end if;
  v_definition := replace(v_definition,
    '''epf_remittance_rounding_policy'',''employer_funded_residual_v1''',
    '''epf_remittance_rounding_policy'',''official_reconciliation_required_v1''');
  execute v_definition;
end;
$migration$;
revoke all on function public.payroll_statutory_project(uuid,uuid) from public,anon,authenticated;
