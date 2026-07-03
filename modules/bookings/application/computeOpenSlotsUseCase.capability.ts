import { defineCapability } from '@/packages/shared/lib/capability';

export const capability = defineCapability({
  name: 'bookings.computeOpenSlots',
  useCase: 'makeComputeOpenSlotsUseCase',
  preconditions: [],
  effects: [],
  query: true,
});
