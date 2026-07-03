import { defineCapability } from '@/packages/shared/lib/capability';

export const capability = defineCapability({
  name: 'bookings.cancelBooking',
  useCase: 'makeCancelBookingUseCase',
  preconditions: ['bookings.booking.exists', 'bookings.booking.isNonTerminal'],
  effects: ['bookings.booking.cancelled'],
});
