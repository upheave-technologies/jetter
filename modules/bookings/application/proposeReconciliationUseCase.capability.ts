import { defineCapability } from '@/packages/shared/lib/capability';

export const capability = defineCapability({
  name: 'bookings.proposeReconciliation',
  useCase: 'makeProposeReconciliationUseCase',
  preconditions: [],
  effects: [],
  query: true,
});
