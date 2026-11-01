import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FactoryCleaningTaskActions from '../FactoryCleaningTaskActions.jsx';
import { factoryService } from '../../../../services/factoryService.js';
vi.mock('../../../../services/factoryService.js', () => ({ factoryService: { mestiCleaningTaskAction: vi.fn() } }));
afterEach(cleanup);
it('uses canonical eligibility for own completed records without an independent-verifier warning', async () => {
 factoryService.mestiCleaningTaskAction.mockResolvedValue({ total_count: 1, complete_count: 0, verify_count: 1,
  records: [{ id: 'own', status: 'completed', self_completed: true, can_verify: true, token: 'source', location_name: 'Kitchen' }] });
 const request = vi.fn();
 render(<FactoryCleaningTaskActions row={{ requirement_id: 'req', task_name: 'Floor' }} cell={{ due_date: '2026-11-01' }} canVerify onRequest={request} />);
 const verify = await screen.findByRole('button', { name: 'Verify eligible (1)' });
 expect(verify.disabled).toBe(false);
 expect(screen.queryByText(/Another verifier required/)).toBeNull();
 fireEvent.click(verify);
 expect(request).toHaveBeenCalledWith(expect.objectContaining({ action: 'verify', expected: { own: 'source' } }));
});
