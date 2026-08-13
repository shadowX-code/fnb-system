select jsonb_build_object(
  'migration', exists(select 1 from supabase_migrations.schema_migrations where version='20260813183402'),
  'bucket', (select jsonb_build_object('id',id,'public',public,'limit',file_size_limit,'mime',allowed_mime_types) from storage.buckets where id='crew-sop-media'),
  'table_rls', (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='crew_sop_media'),
  'functions', (select jsonb_agg(jsonb_build_object(
    'name',p.proname,'security_definer',p.prosecdef,'search_path',p.proconfig,
    'public',has_function_privilege('public',p.oid,'execute'),
    'anon',has_function_privilege('anon',p.oid,'execute'),
    'authenticated',has_function_privilege('authenticated',p.oid,'execute')
  ) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'crew_prepare_sop_media_upload','crew_finalize_sop_media_upload','crew_request_sop_media_delete',
      'crew_finalize_sop_media_delete','crew_sop_media_access','crew_attach_sop_media',
      'crew_prepare_sop_draft_media_cleanup','crew_validate_sop_section_media','crew_new_sop_version',
      'crew_publish_sop_version','crew_sop_version','crew_clone_selected_sops'
    )),
  'policies', (select jsonb_agg(jsonb_build_object('name',policyname,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by policyname)
    from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'crew sop%')
);
