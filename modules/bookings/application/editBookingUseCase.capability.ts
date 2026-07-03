import { defineCapability } from '@/packages/shared/lib/capability';

export const capability = defineCapability({
  name: 'bookings.editBooking',
  useCase: 'makeEditBookingUseCase',
  preconditions: ['bookings.booking.exists', 'bookings.booking.isNonTerminal'],
  effects: ['bookings.booking.edited'],
});
