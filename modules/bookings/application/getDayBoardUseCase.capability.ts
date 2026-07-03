import { defineCapability } from '@/packages/shared/lib/capability';

export const capability = defineCapability({
  name: 'bookings.getDayBoard',
  useCase: 'makeGetDayBoardUseCase',
  preconditions: [],
  effects: [],
  query: true,
});
