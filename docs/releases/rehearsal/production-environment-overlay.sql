-- Release-preparation candidate. NOT authorized for live Production application.
-- Run only after the 133 hashed migrations, explicit Production approval and target verification.
-- Rehearsal may set this transaction-local marker; it is not a provider execution authorization.
begin;
do $environment$
declare item record;body text;found_count integer:=0;
begin
 if current_setting('feedx.release_target',true) is distinct from 'oyfobxdoyfuzsodogpgs' then
  raise exception 'Verify the Production target and authorize this release before applying the overlay.';
 end if;
 for item in select p.oid,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and ((n.nspname='public' and p.proname in ('marketing_meta_begin','marketing_tick','marketing_privacy_journal_ack','marketing_privacy_prepare_release','marketing_privacy_replay','marketing_ads_begin')) or (n.nspname='marketing_private' and p.proname='privacy_intent')) loop
  body:=pg_get_functiondef(item.oid);
  if position('ujkzdaaadnvcfayuldmh' in body)>0 then
   execute replace(body,'ujkzdaaadnvcfayuldmh','oyfobxdoyfuzsodogpgs');
  elsif position('oyfobxdoyfuzsodogpgs' in body)=0 then
   raise exception 'Environment contract changed for %.%',item.nspname,item.proname;
  end if;
  found_count:=found_count+1;
 end loop;
 if found_count<>7 then raise exception 'Expected seven environment-bound Marketing functions, found %',found_count;end if;
 for item in select jobid from cron.job where jobname in ('feedx_marketing_meta_worker','feedx_marketing_meta_housekeeping','feedx_customer_import_worker') loop
  perform cron.alter_job(item.jobid,active:=false);
 end loop;
end;$environment$;
commit;
