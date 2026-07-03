import { defineCapability } from '@/packages/shared/lib/capability';

export const capability = defineCapability({
  name: 'bookings.createBooking',
  useCase: 'makeCreateBookingUseCase',
  preconditions: [],
  effects: ['bookings.booking.created'],
});
