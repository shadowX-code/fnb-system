// Transport allowlist only. The database owns grants, scope, evidence and transitions.
export const factoryActions = Object.freeze([
  'job_order.create', 'job_order.update', 'job_order.submit', 'job_order.cancel',
  'production.update', 'production.complete', 'production.verify',
  'receiving.create', 'receiving.update', 'receiving.complete', 'receiving.verify', 'receiving.cancel',
  'product_stock_check.create', 'product_stock_check.update', 'product_stock_check.submit', 'product_stock_check.approve',
  'raw_stock_check.create', 'raw_stock_check.update', 'raw_stock_check.submit', 'raw_stock_check.approve',
  'area_cleaning.complete', 'area_cleaning.verify',
  'equipment_cleaning.complete', 'equipment_cleaning.verify',
  'calibration.create', 'calibration.verify',
]);

export const factoryActionTool = Object.freeze({
  name: 'execute_factory_action',
  description: 'Execute an explicitly granted Factory lifecycle action using canonical business authority. Obtain the current version from action context. Area/Equipment Cleaning Complete and Verify execute directly with their respective grants; the same actor may perform both, in that order. Genuine work/inspection evidence and all required record data must exist. Other actions retain their required human confirmation. Never infer physical work, measurements or approval. Reuse request_id for an identical retry.',
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    type: 'object', additionalProperties: false,
    required: ['request_id', 'action', 'expected_version', 'input'],
    properties: {
      request_id: { type: 'string', format: 'uuid' },
      action: { type: 'string', enum: factoryActions },
      target_id: { type: ['string', 'null'], format: 'uuid', description: 'Canonical UUID from scoped View: record_id for MeSTI occurrences, requirement_id for Calibration Create, id for ordinary Factory records. Do not use the opaque composite MeSTI id.' },
      expected_version: { type: ['string', 'null'], maxLength: 128 },
      input: { type: 'object' },
    },
  },
});

export const factoryActionContextTool = Object.freeze({
  name: 'factory_action_context',
  description: 'Read the current concurrency version and execution requirements for an explicitly granted Factory action. This does not approve or execute the action. Use query_factory_resources for authorized business evidence.',
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  inputSchema: { type: 'object', additionalProperties: false, required: ['action'], properties: {
    action: { type: 'string', enum: factoryActions }, target_id: { type: ['string', 'null'], format: 'uuid', description: 'Canonical scoped record UUID (MeSTI record_id, or requirement_id for Calibration Create). Required for existing targets.' },
  } },
});

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function actionContextArguments(args) {
  if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).some(k => !['action', 'target_id'].includes(k)) || !factoryActions.includes(args.action)) throw new Error('Supported Factory action required.');
  if (args.target_id != null && !uuid.test(args.target_id)) throw new Error('Invalid target_id.');
  if ((!args.action.endsWith('.create') || args.action === 'calibration.create') && !args.target_id) throw new Error('Existing canonical target UUID required. Use the scoped View record_id for MeSTI occurrences.');
  return { p_action: args.action, p_target_id: args.target_id ?? null };
}
export function actionArguments(args) {
  const keys = ['request_id', 'action', 'target_id', 'expected_version', 'input'];
  if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).some(k => !keys.includes(k))) throw new Error('Invalid Factory action fields.');
  if (!uuid.test(args.request_id || '') || !factoryActions.includes(args.action)) throw new Error('Supported action and UUID request_id required.');
  if (!Object.hasOwn(args, 'expected_version') || (args.expected_version !== null && (typeof args.expected_version !== 'string' || !args.expected_version.length || args.expected_version.length > 128))) throw new Error('Current expected_version required.');
  if (!args.input || Array.isArray(args.input) || typeof args.input !== 'object') throw new Error('Action input object required.');
  for (const key of ['target_id']) if (args[key] != null && !uuid.test(args[key])) throw new Error(`Invalid ${key}.`);
  if ((!args.action.endsWith('.create') || args.action === 'calibration.create') && (!args.target_id || args.expected_version === null)) throw new Error('Existing target and current expected_version required.');
  if (['actor_id', 'employee_id', 'auth_user_id', 'machine_identity_id', 'role_id', 'credential', 'token'].some(k => Object.hasOwn(args.input, k))) throw new Error('Actor identity is server-owned.');
  return { p_request_id: args.request_id, p_action: args.action, p_target_id: args.target_id ?? null, p_expected_version: args.expected_version, p_input: args.input };
}
