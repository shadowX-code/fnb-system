import { countedRows, date, invalidArgument, page, readContract } from '../assistant/readContract.js';
import { packagingTypeLabel } from './packagingUnit.js';
import { exactName } from '../assistant/entityResolution.js';

const optionalText = { type: 'string', maxLength: 120, nullable: true };
const ledgerFields = ['id', 'movement_date', 'created_at', 'movement_type', 'reference_no',
  'reference_type', 'reference_id', 'batch_no', 'quantity', 'uom', 'balance_after'];

function movementRead({ raw, id, module_id, label, rpc }) {
  const item = raw ? 'raw_material' : 'finished_good';
  const skuField = item + '->>' + (raw ? 'material_code' : 'product_code');
  const nameField = raw ? 'raw_material->>name' : 'product_name';
  const displayNameField = raw ? 'raw_material->>name_en' : 'finished_good_name';
  const fields = [...ledgerFields, raw ? 'raw_material_id' : 'finished_good_id', 'item_code', 'item_name'];
  const queryFields = [...fields.slice(0,-2), 'item_code:' + skuField, 'item_name:' + nameField];
  if (!raw) {
    fields.push('product_name','packaging_type','product_family_name');
    queryFields.push('product_name','packaging_type:finished_good->>packaging_type','product_family_name:' + displayNameField);
  }
  if (raw) {
    fields.push('item_name_en','material_uom');
    queryFields.push('item_name_en:' + displayNameField,'material_uom:raw_material->>uom');
  }
  const argumentDates = raw ? { ...date, nullable: true } : date;
  return readContract({
    id, module_id, label, version: 2, permission: module_id + '.view', source: raw ? '/factory/raw-materials/movements' : '/factory/warehouse/product-movements',
    scope: 'Factory shared warehouse. Posted movements under the current human account.',
    discoveryPhrases: raw
      ? ['raw material history', 'raw ingredient movements', '原料出入库', 'pergerakan bahan mentah']
      : ['finished goods history', 'finished product movements', '成品出入库', 'pergerakan produk siap'],
    description: 'Read dated ' + label + ' in Factory. Count matching ledger events or list them with signed quantities, recorded units and historical balance after posting. ' +
      'Use exact product/material code, displayed item name, batch number, business reference or movement type when supplied. ' +
      (raw ? 'Dates are optional and must be supplied together.' : 'Supply both dates for a period of up to 31 days between endpoints.') +
      ' Use quantity_unit for quantity and historical balance: Finished Goods counts packages and raw materials retain their recorded UOM. No outlet filter. Page totals count events; never sum unlike units or infer a current stock balance from a past movement.',
    properties: { page, mode: { type: 'string', enum: ['list', 'summary'] }, from: argumentDates, to: argumentDates,
      sku: optionalText, item_name: optionalText, batch: optionalText, reference: optionalText, movement_type: optionalText },
    normalizeArguments(args) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) return args;
      return { page: 1, mode: 'list', ...(raw ? { from: null, to: null } : {}),
        sku: null, item_name: null, batch: null, reference: null, movement_type: null, ...args };
    },
    check(args) {
      if (args.mode === 'summary' && args.page !== 1) invalidArgument('unsupported_value', 'page');
      if (Boolean(args.from) !== Boolean(args.to)) invalidArgument('paired_dates_required', args.from ? 'to' : 'from');
      if (args.from && (args.from > args.to || !raw && Date.parse(args.to)-Date.parse(args.from) > 31 * 86400000))
        invalidArgument('invalid_date_range', 'to');
      for (const field of ['sku', 'item_name', 'batch', 'reference', 'movement_type'])
        if (args[field] !== null && !args[field].trim()) invalidArgument('unsupported_value', field);
    },
    pageableModes: ['list'], rpc,
    async load(caller, args, signal) {
      const params = { p_date_from: args.from, p_date_to: args.to, p_movement_type: args.movement_type?.trim() || null,
        ...(raw ? { p_batch_id: null, p_raw_material_id: null, p_storage_location: null, p_search: null }
          : { p_product_search: null, p_category_id: null, p_batch_source_search: null }) };
      const summary = args.mode === 'summary';
      let query = caller.rpc(rpc, params, { count: 'exact' }).select(summary ? 'id' : queryFields.join(','));
      for (const [field, value] of [[skuField, args.sku], ['batch_no', args.batch], ['reference_no', args.reference]])
        if (value) query = exactName(query, field, value.trim());
      if (args.item_name) {
        // Match only the two exposed name fields. Quote PostgREST grammar and LIKE metacharacters.
        const name = args.item_name.trim();
        const operator = name.includes('*') ? 'eq' : 'ilike';
        const pattern = operator === 'eq' ? name : name.replace(/[\\%_]/g, '\\$&');
        const literal = '"' + pattern.replace(/["\\]/g, '\\$&') + '"';
        query = query.or([nameField, displayNameField].map(field => field + '.' + operator + '.' + literal).join(','));
      }
      if (summary) query = query.limit(1);
      else query = query.order('movement_date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false });
      return countedRows(query, args, fields, signal);
    },
    project: data => ({...data, rows: data.rows.map(row=>({
      ...row,item_name: (raw ? row.item_name_en : row.product_family_name) || row.item_name || null,
      quantity_unit: raw ? row.uom || row.material_uom || null : packagingTypeLabel(row),
    }))}),
    interface: {
      authority: rpc, fields: [...fields,'quantity_unit'], queryKinds: ['count', 'list', 'filter', 'movement_history'],
      aggregates: 'complete_filtered_scope', pagination: 'Exact filtered movement count; stable pages of 20 by movement date, posted time and identity.',
      semantics: { entities: [label, 'batch', 'business reference'], time: 'Recorded movement date, inclusive; latest movement first.',
        relationships: ['Each movement belongs to one stock item. Reference and batch fields identify the recorded source.'],
        metrics: {
          movement_count: { field: 'total_matching', unit: 'records', definition: 'Count of posted records matching all selected ledger filters.' },
          posted_quantity: { field: 'rows[].quantity', unit_field: 'rows[].quantity_unit', definition: 'Signed quantity for the event, in packaging units for finished goods and the recorded material unit for raw materials.' },
          balance_after: { field: 'rows[].balance_after', unit_field: 'rows[].quantity_unit', definition: 'Historical item balance after that ledger entry, when recorded.' },
        } },
      unsupported: ['Current balance, root cause, financial valuation and cross-unit totals are outside this ledger.'],
    },
  });
}

export const factoryRawMovementRead = movementRead({ raw: true, id: 'read_factory_raw_movements',
  module_id: 'factory_raw_movements', label: 'Factory raw material movements', rpc: 'factory_list_raw_material_movements' });
export const factoryProductMovementRead = movementRead({ raw: false, id: 'read_factory_product_movements',
  module_id: 'factory_product_movements', label: 'Factory finished product movements', rpc: 'factory_list_product_movements' });
