import { defineCapability } from '@/packages/shared/lib/capability';

export const capability = defineCapability({
  name: 'bookings.editMaintenance',
  useCase: 'makeEditMaintenanceUseCase',
  preconditions: ['bookings.booking.exists', 'bookings.booking.isNonTerminal'],
  effects: ['bookings.maintenance.edited'],
});
