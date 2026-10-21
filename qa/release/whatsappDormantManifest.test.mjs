import {test} from 'node:test';
import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';
const root=new URL('../../',import.meta.url),m=JSON.parse(fs.readFileSync(new URL('docs/releases/2026-10-22-whatsapp-dormant-production-manifest.json',root)));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const f of [...m.new_migrations,...m.historical_source_only,...m.preserved_production_files])test('exact release artifact '+f.path,()=>assert.equal(hash(fs.readFileSync(new URL(f.path,root))),f.sha256));
for(const b of m.edge_bundles)for(const [f,h] of Object.entries(b.candidate_files))test(b.slug+' dependency '+f,()=>assert.equal(hash(fs.readFileSync(new URL(f,root))),h));
test('Production guards, unchanged services and dependency lockfiles remain exact baseline bytes',()=>{
 for(const f of m.preserved_production_files)assert.equal(hash(execFileSync('git',['show',m.production_baseline.sha+':'+f.path],{cwd:root})),f.sha256);
});
test('explicit execution order has only five genuinely new migrations and no history replay',()=>{
 assert.equal(m.new_migrations.length,5);assert.match(m.new_migrations[0].path,/production_compatibility/);assert.equal(m.historical_source_only.length,4);
 assert.deepEqual(m.new_migrations.slice(1).map(x=>x.path.match(/(202610\d+)_/)[1]),['20261021140812','20261021150315','20261021150808','20261021163645']);
 assert.equal(m.expected_ledger_after_approved_release,m.production_baseline.ledger_count+5);
 assert.deepEqual(m.edge_bundles.map(x=>x.slug),['marketing-meta','marketing-inbox']);
});
