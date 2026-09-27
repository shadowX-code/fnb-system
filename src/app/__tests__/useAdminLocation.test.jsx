// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import useAdminLocation from '../useAdminLocation.js';
import { navigateAdminRoute } from '../routeOwnership.js';

it('tracks nested result identities and close navigation within the same Admin module', () => {
  window.history.replaceState(null, '', '/restaurant/inventory/stock-check');
  const { result, unmount } = renderHook(useAdminLocation);
  act(() => navigateAdminRoute('inventory-stock-check-result', { checkId: 'A' }));
  expect(result.current.params.checkId).toBe('A');
  act(() => navigateAdminRoute('inventory-stock-check-result', { checkId: 'B' }));
  expect(result.current.params.checkId).toBe('B');
  act(() => navigateAdminRoute('inventory_stock_check'));
  expect(result.current.definitionId).not.toBe('inventory-stock-check-result');
  unmount();
});
