import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate, allowPermission } from '../middleware/auth.js';
import { getStore, updateStore, getUsers } from '../services/store.service.js';
import { audit } from '../services/audit.service.js';

const router = Router();
router.use(authenticate);

function visible(user, row) {
  if (user.role === 'ADMIN') return true;
  if (row.branchId && row.branchId !== user.branchId) return false;
  return true;
}

function requiredText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} là bắt buộc.`);
  return text;
}

function validDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw new Error(`${label} không hợp lệ.`);
  return date.toISOString();
}

async function verifyPassword(userId, password) {
  const users = await getUsers();
  return users.some(x => x.id === userId && x.active && x.password === password);
}

router.get('/orders', allowPermission('MEDICAL.VIEW'), async (req, res) => {
  const store = await getStore();
  const orders = (store.medicationOrders || [])
    .filter(x => !x.deleted && visible(req.user, x))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const administrations = (store.medicationAdministrations || [])
    .filter(x => visible(req.user, x))
    .sort((a, b) => String(b.administeredAt).localeCompare(String(a.administeredAt)));
  res.json({ success: true, data: { orders, administrations } });
});

router.get('/report', allowPermission('REPORT.VIEW'), async (req, res) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : from;
  if (to < from) return res.status(400).json({ success: false, message: 'Khoảng ngày không hợp lệ.' });
  const store = await getStore();
  const localDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value));
  const rows = (store.medicationAdministrations || [])
    .filter(x => visible(req.user, x))
    .filter(x => { const d = localDate(x.administeredAt); return d >= from && d <= to; })
    .sort((a, b) => String(b.administeredAt).localeCompare(String(a.administeredAt)));
  res.json({ success: true, data: { from, to, total: rows.length, insulin: rows.filter(x => x.type === 'INSULIN').length, residents: new Set(rows.map(x => x.residentId)).size, rows } });
});

router.post('/orders', allowPermission('MEDICAL.CREATE'), async (req, res) => {
  try {
    const b = req.body || {};
    const type = b.type === 'CARE_INSTRUCTION' ? 'CARE_INSTRUCTION' : 'MEDICATION';
    if (type === 'CARE_INSTRUCTION') {
      const morning = String(b.morning || '').trim();
      const noon = String(b.noon || '').trim();
      const evening = String(b.evening || '').trim();
      if (!morning && !noon && !evening) throw new Error('Cần nhập ít nhất một nội dung cho Sáng, Trưa hoặc Chiều.');
      const order = {
        id: uuid(), type,
        shiftId: String(b.shiftId || '').trim() || null,
        residentId: requiredText(b.residentId, 'Người cao tuổi'),
        residentName: requiredText(b.residentName, 'Tên người cao tuổi'),
        residentCode: String(b.residentCode || '').trim(),
        branchId: requiredText(b.branchId, 'Cơ sở'), branchName: String(b.branchName || '').trim(),
        areaId: String(b.areaId || '').trim() || null, areaName: String(b.areaName || '').trim(),
        roomName: String(b.roomName || '').trim(), bedName: String(b.bedName || '').trim(),
        morning, noon, evening,
        status: 'ACTIVE', source: 'CARE_INSTRUCTION',
        createdBy: req.user.sub, createdByName: req.user.fullName, createdAt: new Date().toISOString(), deleted: false
      };
      await updateStore(store => { store.medicationOrders ||= []; store.medicationOrders.unshift(order); });
      await audit(req.user, 'CARE_INSTRUCTION_CREATE', 'medication_order', order.id, { residentId: order.residentId });
      return res.status(201).json({ success: true, data: order });
    }
    const dose = Number(b.dose);
    if (!Number.isFinite(dose) || dose <= 0 || dose > 10000) throw new Error('Liều dùng phải là số dương hợp lệ.');
    const validFrom = validDate(b.validFrom, 'Ngày bắt đầu');
    const validTo = b.validTo ? validDate(b.validTo, 'Ngày kết thúc') : null;
    if (validTo && new Date(validTo) < new Date(validFrom)) throw new Error('Ngày kết thúc phải sau ngày bắt đầu.');
    const order = {
      id: uuid(), type,
      residentId: requiredText(b.residentId, 'Người cao tuổi'), residentName: requiredText(b.residentName, 'Tên người cao tuổi'),
      residentCode: String(b.residentCode || '').trim(), branchId: requiredText(b.branchId, 'Cơ sở'), branchName: String(b.branchName || '').trim(),
      areaId: String(b.areaId || '').trim() || null, areaName: String(b.areaName || '').trim(), roomName: String(b.roomName || '').trim(), bedName: String(b.bedName || '').trim(),
      prescriptionRef: requiredText(b.prescriptionRef, 'Mã/số toa'), doctorName: requiredText(b.doctorName, 'Bác sĩ ra y lệnh'),
      orderedAt: validDate(b.orderedAt, 'Thời điểm bác sĩ ra y lệnh'), medicationName: requiredText(b.medicationName, 'Tên thuốc'), dose,
      doseUnit: requiredText(b.doseUnit, 'Đơn vị liều'), route: requiredText(b.route, 'Đường dùng'), schedule: requiredText(b.schedule, 'Giờ/tần suất thực hiện'),
      validFrom, validTo, instructions: String(b.instructions || '').trim(), status: 'ACTIVE', source: 'EXTERNAL_PRESCRIPTION',
      createdBy: req.user.sub, createdByName: req.user.fullName, createdAt: new Date().toISOString(), deleted: false
    };
    await updateStore(store => { store.medicationOrders ||= []; store.medicationOrders.unshift(order); });
    await audit(req.user, 'MEDICATION_ORDER_CREATE', 'medication_order', order.id, { residentId: order.residentId, prescriptionRef: order.prescriptionRef, type: order.type });
    res.status(201).json({ success: true, data: order });
  } catch (e) { res.status(422).json({ success: false, message: e.message }); }
});

router.post('/orders/:id/stop', allowPermission('MEDICAL.STOP'), async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(422).json({ success: false, message: 'Bắt buộc nhập lý do ngừng y lệnh.' });
  let order = null;
  await updateStore(store => {
    order = (store.medicationOrders || []).find(x => x.id === req.params.id && !x.deleted);
    if (order && visible(req.user, order)) {
      order.status = 'STOPPED';
      order.stoppedReason = reason;
      order.stoppedAt = new Date().toISOString();
      order.stoppedBy = req.user.sub;
      order.stoppedByName = req.user.fullName;
    }
  });
  if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy y lệnh.' });
  await audit(req.user, 'MEDICATION_ORDER_STOP', 'medication_order', order.id, { reason });
  res.json({ success: true, data: order });
});

router.patch('/orders/:id', allowPermission('MEDICAL.UPDATE'), async (req, res) => {
  const b = req.body || {};
  const store = await getStore();
  const order = (store.medicationOrders || []).find(x => x.id === req.params.id && !x.deleted);
  if (!order || !visible(req.user, order)) return res.status(404).json({ success: false, message: 'Không tìm thấy y lệnh.' });
  if (order.type !== 'CARE_INSTRUCTION') return res.status(422).json({ success: false, message: 'Y lệnh thuốc không sửa đè; phải ngừng y lệnh cũ và tạo y lệnh mới.' });
  const linkedShift = order.shiftId ? (store.shifts || []).find(x => x.id === order.shiftId) : null;
  const locked = linkedShift && linkedShift.status !== 'OPEN';
  const overrideReason = String(b.overrideReason || '').trim();
  if (locked && req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Ca đã ký bàn giao; chỉ Admin được sửa y lệnh.' });
  if (locked && !overrideReason) return res.status(422).json({ success: false, message: 'Admin phải nhập lý do sửa y lệnh sau bàn giao.' });
  const morning = String(b.morning || '').trim();
  const noon = String(b.noon || '').trim();
  const evening = String(b.evening || '').trim();
  if (!morning && !noon && !evening) return res.status(422).json({ success: false, message: 'Cần nhập ít nhất một nội dung cho Sáng, Trưa hoặc Chiều.' });
  let updated;
  await updateStore(next => {
    updated = (next.medicationOrders || []).find(x => x.id === order.id && !x.deleted);
    updated.morning = morning;
    updated.noon = noon;
    updated.evening = evening;
    updated.updatedBy = req.user.sub;
    updated.updatedByName = req.user.fullName;
    updated.updatedAt = new Date().toISOString();
    if (locked) {
      updated.adminOverrideReason = overrideReason;
      updated.adminOverriddenBy = req.user.sub;
      updated.adminOverriddenAt = updated.updatedAt;
    }
  });
  await audit(req.user, locked ? 'CARE_INSTRUCTION_ADMIN_OVERRIDE_UPDATE' : 'CARE_INSTRUCTION_UPDATE', 'medication_order', order.id, { residentId: order.residentId, overrideReason: locked ? overrideReason : undefined });
  res.json({ success: true, data: updated });
});

router.delete('/orders/:id', allowPermission('MEDICAL.DELETE'), async (req, res) => {
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(422).json({ success: false, message: 'Bắt buộc nhập lý do xóa y lệnh.' });
  const store = await getStore();
  const order = (store.medicationOrders || []).find(x => x.id === req.params.id && !x.deleted);
  if (!order || !visible(req.user, order)) return res.status(404).json({ success: false, message: 'Không tìm thấy y lệnh.' });
  const linkedShift = order.shiftId ? (store.shifts || []).find(x => x.id === order.shiftId) : null;
  const locked = linkedShift && linkedShift.status !== 'OPEN';
  if (locked && req.user.role !== 'ADMIN') return res.status(403).json({ success: false, message: 'Ca đã ký bàn giao; chỉ Admin được xóa y lệnh.' });
  let deleted;
  await updateStore(next => {
    deleted = (next.medicationOrders || []).find(x => x.id === order.id && !x.deleted);
    deleted.deleted = true;
    deleted.deletedBy = req.user.sub;
    deleted.deletedByName = req.user.fullName;
    deleted.deletedAt = new Date().toISOString();
    deleted.deleteReason = reason;
  });
  await audit(req.user, locked ? 'CARE_INSTRUCTION_ADMIN_OVERRIDE_DELETE' : 'CARE_INSTRUCTION_DELETE', 'medication_order', order.id, { residentId: order.residentId, reason });
  res.json({ success: true });
});

router.post('/orders/:id/administer', allowPermission('MEDICAL.ADMINISTER'), async (req, res) => {
  const b = req.body || {};
  const store = await getStore();
  const order = (store.medicationOrders || []).find(x => x.id === req.params.id && !x.deleted);
  if (!order || !visible(req.user, order)) return res.status(404).json({ success: false, message: 'Không tìm thấy y lệnh trong phạm vi được giao.' });
  if (order.type === 'CARE_INSTRUCTION') return res.status(422).json({ success: false, message: 'Y lệnh chăm sóc chỉ dùng để xem/kiểm tra, không ghi thực hiện tại đây.' });
  if (order.status !== 'ACTIVE') return res.status(422).json({ success: false, message: 'Y lệnh đã ngừng, không được tiếp tục thực hiện.' });
  const now = new Date();
  if (now < new Date(order.validFrom) || (order.validTo && now > new Date(order.validTo))) return res.status(422).json({ success: false, message: 'Y lệnh chưa có hiệu lực hoặc đã hết hiệu lực.' });
  const administeredAt = new Date(b.administeredAt || '');
  if (Number.isNaN(administeredAt.getTime()) || administeredAt.getTime() > Date.now() + 5 * 60 * 1000) return res.status(422).json({ success: false, message: 'Thời điểm thực hiện không hợp lệ hoặc ở tương lai.' });
  const doseGiven = Number(b.doseGiven);
  if (!Number.isFinite(doseGiven) || doseGiven !== Number(order.dose)) return res.status(422).json({ success: false, message: 'Liều thực hiện phải đúng bằng liều trên y lệnh. Nếu bác sĩ đổi liều, hãy ngừng y lệnh cũ và nhập y lệnh mới.' });
  const checks = b.checks || {};
  if (!checks.resident || !checks.medication || !checks.dose || !checks.time || !checks.route) return res.status(422).json({ success: false, message: 'Phải hoàn tất đối chiếu đúng NCT, thuốc, liều, giờ và đường dùng.' });
  if (!b.confirm) return res.status(422).json({ success: false, message: 'Chưa xác nhận đã trực tiếp thực hiện và theo dõi.' });
  if (!await verifyPassword(req.user.sub, String(b.password || ''))) return res.status(401).json({ success: false, message: 'Mật khẩu ký xác nhận không đúng.' });

  let bloodGlucose = null;
  if (order.type === 'INSULIN') {
    bloodGlucose = Number(b.bloodGlucose);
    if (!Number.isFinite(bloodGlucose) || bloodGlucose < 20 || bloodGlucose > 600) return res.status(422).json({ success: false, message: 'Đường huyết trước tiêm phải từ 20 đến 600 mg/dL.' });
  }
  const duplicate = (store.medicationAdministrations || []).find(x => x.clientRequestId && x.clientRequestId === b.clientRequestId && x.administeredBy === req.user.sub);
  if (duplicate) return res.json({ success: true, data: duplicate, duplicate: true });
  const administration = {
    id: uuid(), clientRequestId: String(b.clientRequestId || ''), orderId: order.id,
    residentId: order.residentId, residentName: order.residentName,
    branchId: order.branchId, branchName: order.branchName, areaId: order.areaId, areaName: order.areaName,
    medicationName: order.medicationName, type: order.type, prescriptionRef: order.prescriptionRef,
    doseGiven, doseUnit: order.doseUnit, route: order.route, administeredAt: administeredAt.toISOString(),
    bloodGlucose, response: String(b.response || '').trim(), note: String(b.note || '').trim(),
    checks: { resident: true, medication: true, dose: true, time: true, route: true },
    administeredBy: req.user.sub, administeredByName: req.user.fullName, signedAt: new Date().toISOString()
  };
  await updateStore(next => {
    next.medicationAdministrations ||= [];
    next.medicationAdministrations.unshift(administration);
  });
  await audit(req.user, order.type === 'INSULIN' ? 'INSULIN_ADMINISTER' : 'MEDICATION_ADMINISTER', 'medication_administration', administration.id, {
    orderId: order.id, residentId: order.residentId, dose: doseGiven, unit: order.doseUnit
  });
  res.status(201).json({ success: true, data: administration });
});

export default router;
