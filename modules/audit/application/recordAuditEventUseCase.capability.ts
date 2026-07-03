import { defineCapability } from '@/packages/shared/lib/capability';

export const capability = defineCapability({
  name: 'audit.recordAuditEvent',
  useCase: 'makeRecordAuditEventUseCase',
  preconditions: [],
  effects: ['audit.event.appended'],
});
