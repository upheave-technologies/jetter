import { defineCapability } from '@/packages/shared/lib/capability';

// NOTE: ideal effect token would be 'bookings.maintenance.created';
// reusing 'bookings.booking.created' as the closest existing token
// (both create a new row on the bookings timeline).
export const capability = defineCapability({
  name: 'bookings.blockScooter',
  useCase: 'makeBlockScooterUseCase',
  preconditions: [],
  effects: ['bookings.booking.created'],
});
