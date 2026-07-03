import { defineCapability } from '@/packages/shared/lib/capability';

export const capability = defineCapability({
  name: 'bookings.computeAvailability',
  useCase: 'makeComputeAvailabilityUseCase',
  preconditions: [],
  effects: [],
  query: true,
});
