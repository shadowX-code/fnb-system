import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql=readFileSync('supabase/migrations/20260927152000_restaurant_po_source_reservations_transactional.sql','utf8');
describe('private prospective PO source reservations',()=>{
 it('keeps the lock, historical capture, and trigger in one explicit transaction',()=>{
  expect(sql).toMatch(/^--[^]*?\nbegin;\n/);
  expect(sql.trimEnd()).toMatch(/commit;$/);
 });
 it('captures historical membership without rewriting business evidence',()=>{
  expect(sql).toContain('lock table public.inventory_purchase_orders in share row exclusive mode');
  expect(sql).toContain('array_agg(id order by id),array_agg(id order by id)');
  expect(sql).not.toMatch(/(?:update|delete from) public\.(?:inventory_purchase|inventory_movements|inventory_lifecycle)/i);
 });
 it('uses a unique database reservation and transactional row trigger, not timestamps',()=>{
  expect(sql).toContain('primary key (source_stock_check_id, supplier_id)');
  expect(sql).toContain('after insert or update or delete on public.inventory_purchase_orders');
  expect(sql).toContain('on conflict (source_stock_check_id,supplier_id) do update');
  expect(sql).toContain('where cardinality(reservation.active_po_ids)=0');
  expect(sql).toContain("errcode='23505'");
 });
 it('keeps completed/sibling claims and private client authority intact',()=>{
  expect(sql).toContain("old.status<>'cancelled'");
  expect(sql).toContain('array_remove(active_po_ids,old.id)');
  expect(sql).toContain('enable row level security');
  expect(sql).toContain('security definer set search_path =');
  expect(sql).toContain('from public, anon, authenticated, service_role');
  expect(sql).toContain('drop index if exists public.inventory_purchase_orders_active_source_supplier_unique');
 });
});
