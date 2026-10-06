import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('active candidate aggregate leaves existing scope, permissions, filters and stage projection byte-identical',()=>{
 const before=fs.readFileSync('supabase/migrations/20261006140419_recruitment_operations_read_model.sql','utf8');
 const contract=before.slice(before.indexOf('create function public.recruitment_workspace'),before.indexOf('\n-- Existing protected evidence read'));
 const after=fs.readFileSync('supabase/migrations/20261006161038_recruitment_workspace_active_candidates.sql','utf8');
 const body=after.slice(after.indexOf('create or replace function')).replace('create or replace function','create function').replace("'active_candidates',(select count(*) from candidates where stage not in ('hired','rejected')),",'');
 assert.equal(body,contract); // This task authorizes an aggregate, not a lifecycle rewrite.
});
