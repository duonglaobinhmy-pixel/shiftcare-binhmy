import { v4 as uuid } from 'uuid';
import { updateStore } from './store.service.js';

export async function audit(user, action, objectType, objectId, detail = {}) {
  return updateStore(store => {
    store.auditLogs.unshift({
      id: uuid(),
      actorId: user?.sub || null,
      actorName: user?.fullName || user?.username || 'SYSTEM',
      role: user?.role || 'SYSTEM',
      branchId: user?.branchId || null,
      action,
      objectType,
      objectId,
      detail,
      occurredAt: new Date().toISOString()
    });
  });
}
