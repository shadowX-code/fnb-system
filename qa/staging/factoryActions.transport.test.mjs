import test from 'node:test';
import assert from 'node:assert/strict';
import { actionArguments, factoryActions, factoryActionTool } from '../../supabase/functions/factory-mesti-mcp/actions.js';

const request_id = '00000000-0000-4000-8000-000000000001';
const target_id = '00000000-0000-4000-8000-000000000002';
const command = { request_id, target_id, action: 'job_order.cancel', expected_version: 'version-1', input: {} };
test('mutations require a stable retry identity, existing target and expected version', () => {
  assert.deepEqual(actionArguments(command), { p_request_id: request_id, p_target_id: target_id, p_action: command.action, p_expected_version: 'version-1', p_input: {} });
  for (const changed of [{ request_id: '' }, { target_id: null }, { expected_version: null }, { input: [] }, { action: 'sql.execute' }, { rpc: 'unsafe' }]) assert.throws(() => actionArguments({ ...command, ...changed }));
  assert.throws(() => actionArguments({ ...command, input: { actor_id: target_id } }), /server-owned/);
});
test('create preserves explicit null version and server derives the actor', () => {
  const create = { request_id, action: 'job_order.create', expected_version: null, input: { planned_date: '2026-11-01' } };
  assert.equal(actionArguments(create).p_target_id, null);
  assert.throws(() => actionArguments({ ...create, expected_version: undefined }));
  assert.equal(factoryActionTool.annotations.readOnlyHint, false);
  assert.equal(new Set(factoryActions).size, factoryActions.length);
  assert.ok(factoryActions.every(x => !/delete|payroll|finance/.test(x)));
});
