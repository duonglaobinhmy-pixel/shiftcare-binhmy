import {hasPermission} from '../config/permissions.js';
export function shiftHandover(store,shift){if(!shift)return null;return (store.handovers||[]).filter(h=>String(h.shiftId)===String(shift.id)).sort((a,b)=>(Date.parse(b.confirmedAt||b.receivedAt)||0)-(Date.parse(a.confirmedAt||a.receivedAt)||0))[0]||null}
export function careUnlocked(store,shift){const h=shiftHandover(store,shift);return !!shift&&shift.status==='OPEN'&&!h?.confirmedAt&&!h?.receivedAt}
export function shiftWorkAccess(user,store,shift){
 const h=shiftHandover(store,shift),signed=!!(h?.confirmedAt||h?.receivedAt);
 const inScope=user?.role==='ADMIN'||!!user?.branchId&&String(user.branchId)===String(shift.branchId);
 const writable=careUnlocked(store,shift),create=inScope&&writable&&hasPermission(user,'CARE.CREATE'),update=inScope&&writable&&hasPermission(user,'CARE.UPDATE');
 const unsignedLocked=!signed&&['HANDOVER_CONFIRMED','RECEIVED'].includes(shift.status);
 const reason=signed?'Ca đã có xác nhận ký bàn giao/nhận ca nên không được nhập hoặc sửa.':unsignedLocked?'Trạng thái ca đang khóa nhưng chưa có dấu vết ký/nhận bàn giao; Admin cần kiểm tra và khôi phục.':shift.status!=='OPEN'?`Ca có trạng thái ${shift.status}; chưa ở trạng thái mở để ghi nhận.`:!create?'Tài khoản hiện chưa có quyền Thêm ghi nhận chăm sóc (CARE.CREATE).':'Ca chưa ký bàn giao: có thể tiếp tục ghi nhận.';
 return {status:shift.status,writable,canCreate:create,canUpdate:update,hasSignature:signed,confirmedAt:h?.confirmedAt||null,confirmedByName:h?.confirmedByName||null,receivedAt:h?.receivedAt||null,canRepair:user?.role==='ADMIN'&&unsignedLocked,message:reason};
}
