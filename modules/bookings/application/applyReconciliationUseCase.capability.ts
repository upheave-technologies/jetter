import { defineCapability } from '@/packages/shared/lib/capability';

// NOTE: ideal effect token would be 'bookings.reconciliation.applied';
// reusing 'bookings.booking.edited' as the closest existing token
// (applies edits to booking start/end times).
export const capability = defineCapability({
  name: 'bookings.applyReconciliation',
  useCase: 'makeApplyReconciliationUseCase',
  preconditions: [],
  effects: ['bookings.booking.edited'],
});
