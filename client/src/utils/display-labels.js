// Display labels only: never replace codes in stored records, requests or CSS classes.
export const DISPLAY_LABELS = Object.freeze({
  bowel: { NORMAL:'Bình thường', CONSTIPATION:'Táo bón', DIARRHEA:'Tiêu chảy', OTHER:'Khác' },
  urine: { NORMAL:'Bình thường', SONDE:'Tiểu qua sonde', CATHETER:'Tiểu qua ống tiểu', DIAPER:'Tiểu qua tã', OTHER:'Khác', LOW:'Tiểu ít', NONE:'Không tiểu' },
  category: { HEALTH:'Sức khỏe', NUTRITION:'Dinh dưỡng / ăn uống', PSYCHOLOGY:'Tâm lý / hành vi', SKIN:'Ngoài da', INCIDENT:'Ngã / sự cố', OTHER:'Khác', ROUTINE:'Chăm sóc thường quy', OBSERVATION:'Theo dõi / quan sát', HYGIENE:'Vệ sinh', TOILETING:'Tiêu / tiểu' },
  event: { OBSERVATION:'Theo dõi / quan sát', FALL:'Ngã / trượt', PAIN:'Đau / khó chịu', MEAL:'Ăn uống', RESPIRATORY:'Hô hấp / đờm', SKIN:'Da / vết thương', BEHAVIOR:'Hành vi / tâm lý', HOSPITAL:'Đi viện', FAMILY:'Người nhà', OTHER:'Khác' },
  resident: { IN_FACILITY:'Tại cơ sở', HOME_LEAVE:'Về nhà', HOSPITAL:'Đi viện' },
  recording: { NO_RECORDED_CHANGE:'Chưa ghi nhận', RECORDED_CHANGE:'Đã ghi nhận', REQUIRES_HANDOVER:'Cần theo dõi ca sau' },
  shiftType: { MORNING:'Ca sáng', AFTERNOON:'Ca chiều', NIGHT:'Ca tối' },
  shiftStatus: { OPEN:'Đang mở', HANDOVER_CONFIRMED:'Đã ký bàn giao', RECEIVED:'Đã nhận bàn giao', CLOSED:'Đã đóng', SIGNED:'Đã ký bàn giao', PARTIALLY_SIGNED:'Đã ký bàn giao một phần', NOT_CREATED:'Chưa tạo' },
  alert: { NORMAL:'Xanh', RED:'Đỏ', YELLOW:'Vàng' },
  attention: { OPEN:'Chưa xử lý', RESOLVED:'Đã xử lý' },
  priority: { LOW:'Thấp (xanh)', MEDIUM:'Trung bình (vàng)', HIGH:'Cao (đỏ)' },
  role: { ADMIN:'Quản trị viên', BRANCH_DIRECTOR:'Giám đốc cơ sở', CARE_SHARED:'Tài khoản chăm sóc dùng chung', CSKH:'Chăm sóc khách hàng', STAFF:'Nhân viên' },
  assignment: { PLANNED:'Đã phân công', PRESENT:'Có mặt', ABSENT:'Vắng mặt', REPLACED:'Đã thay thế', CANCELLED:'Đã hủy' },
  task: { PENDING:'Chưa hoàn thành', DONE:'Đã hoàn thành', CANCELLED:'Đã hủy' },
  followup: { OPEN:'Chưa xử lý', IN_PROGRESS:'Đang xử lý', RESOLVED:'Đã xử lý, chờ xác minh', CLOSED:'Đã xác minh và đóng', CANCELLED:'Đã hủy' },
  channel: { PHONE:'Điện thoại', VISIT:'Gặp trực tiếp', MESSAGE:'Tin nhắn', OTHER:'Khác' },
  staffFunction: { LEAD:'Phụ trách', RECORDER:'Ghi chính', DUTY:'Trực', SUPPORT:'Hỗ trợ' },
  presenceSource: { MANUAL_CONFIRMATION:'Xác nhận thủ công', ASSIGNMENT:'Theo phân công' },
  timeBasis: { businessDate:'Ngày nghiệp vụ ca', occurredAt:'Thời điểm thực hiện', savedAt:'Thời điểm lưu' },
  groupBy: { zone:'khu', floor:'tầng', day:'ngày', staff:'nhân viên', resident:'NCT' },
  reportStatus: { PROVISIONAL:'Tạm tính', UNFINALIZED:'Chưa chốt' },
  auditAction: {
    SHIFT_CREATE:'Tạo ca', SHIFT_AUTO_CREATE:'Tự động tạo ca', SHIFT_CLOSE:'Đóng ca', SHIFT_DELETE:'Xóa ca', SHIFT_STAFF_UPDATE:'Sửa nhân sự ca', SHIFT_ROSTER_REFRESH:'Nạp lại danh sách NCT', SHIFT_REPAIR_UNCONFIRMED:'Khôi phục ca chưa có xác nhận bàn giao',
    CHANGE_CREATE:'Thêm ghi nhận', CHANGE_UPDATE:'Sửa ghi nhận', CHANGE_RESOLVE:'Xác nhận xử lý', CHANGE_RESOLUTION_UPDATE:'Sửa kết quả xử lý', CHANGE_RESTORE:'Khôi phục ghi nhận', CHANGE_SOFT_DELETE:'Xóa ghi nhận',
    TOILETING_CREATE:'Thêm ghi nhận tiêu / tiểu', TOILETING_UPDATE:'Sửa ghi nhận tiêu / tiểu', TOILETING_ADMIN_OVERRIDE_UPDATE:'Sửa tiêu / tiểu sau bàn giao', TOILETING_SOFT_DELETE:'Xóa ghi nhận tiêu / tiểu',
    HANDOVER_CONFIRM:'Ký bàn giao', HANDOVER_RECEIVE:'Xác nhận nhận bàn giao',
    STAFF_DIRECTORY_CREATE:'Thêm nhân viên', STAFF_DIRECTORY_UPDATE:'Sửa nhân viên', STAFF_DIRECTORY_DELETE:'Xóa nhân viên', STAFF_DIRECTORY_IMPORT:'Nhập danh sách nhân viên',
    USER_CREATE:'Tạo tài khoản', USER_UPDATE:'Sửa tài khoản', USER_ACTIVATE:'Mở khóa tài khoản', USER_DEACTIVATE:'Khóa tài khoản', USER_DELETE_PERMANENT:'Xóa vĩnh viễn tài khoản',
    GLUCOSE_SCHEDULE_UPDATE:'Sửa lịch theo dõi đường huyết', CARE_INSTRUCTION_CREATE:'Thêm hướng dẫn chăm sóc', CARE_INSTRUCTION_UPDATE:'Sửa hướng dẫn chăm sóc', CARE_INSTRUCTION_DELETE:'Xóa hướng dẫn chăm sóc', CARE_INSTRUCTION_ADMIN_OVERRIDE_UPDATE:'Sửa hướng dẫn chăm sóc sau bàn giao', CARE_INSTRUCTION_ADMIN_OVERRIDE_DELETE:'Xóa hướng dẫn chăm sóc sau bàn giao',
    MEDICATION_ORDER_CREATE:'Tạo y lệnh thuốc', MEDICATION_ORDER_STOP:'Ngừng y lệnh thuốc', MEDICATION_ADMINISTER:'Ghi nhận thực hiện thuốc', INSULIN_ADMINISTER:'Ghi nhận tiêm insulin', TELEGRAM_URGENT_SENT:'Gửi cảnh báo đỏ qua Telegram', TELEGRAM_URGENT_RESOLVED:'Gửi kết quả xử lý qua Telegram',
    AI_CHAT:'Hỏi trợ lý AI', AI_REPORT:'Tạo báo cáo AI', AI_TRANSCRIPT_CLEAN:'Chuẩn hóa bản chép lời', AI_AUDIO_TRANSCRIBE:'Chép lời ghi âm'
  },
  auditObject: { shift:'Ca chăm sóc', change_log:'Ghi nhận chăm sóc', toileting_log:'Ghi nhận tiêu / tiểu', handover:'Bàn giao ca', staff_member:'Nhân viên', user:'Tài khoản', resident:'Người cao tuổi', medication_order:'Y lệnh / hướng dẫn chăm sóc', medication_administration:'Lần thực hiện thuốc', ai_chat:'Hội thoại AI', ai_report:'Báo cáo AI', ai_transcript:'Bản chép lời AI' }
});
Object.values(DISPLAY_LABELS).forEach(Object.freeze);

export function displayLabel(domain, value, empty = 'Chưa ghi nhận') {
  const key = String(value ?? '').trim();
  if (!key) return empty;
  const labels = DISPLAY_LABELS[domain];
  if (!labels) return 'Chưa xác định';
  if (Object.hasOwn(labels, key)) return labels[key];
  const code = key.toUpperCase();
  return Object.hasOwn(labels, code) ? labels[code] : 'Chưa xác định';
}

// The edit prompt uses Vietnamese labels; old codes remain accepted for compatibility.
export function displayCode(domain, value) {
  const key = String(value ?? '').trim();
  const labels = DISPLAY_LABELS[domain] || {};
  const code = key.toUpperCase();
  if (Object.hasOwn(labels, code)) return code;
  return Object.keys(labels).find(k => labels[k].toLocaleLowerCase('vi') === key.toLocaleLowerCase('vi')) || '';
}
