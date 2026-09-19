# BCARE — PostgreSQL quan hệ chuẩn để mở rộng

## 1. Mục tiêu
Bộ này thay mô hình `app_state JSONB` bằng các bảng quan hệ thật nhưng **giữ API hiện tại chạy được** thông qua `store.service.js` compatibility adapter.

Không xóa `app_state` ngay. Giữ nó 1–2 sprint làm rollback/đối soát, sau đó mới bỏ.

## 2. Quan hệ chính

### 1 → n
- `branches -> areas`
- `branches -> staff_members`
- `branches -> residents`
- `branches -> shifts`
- `areas -> rooms`
- `rooms -> beds`
- `shifts -> shift_staff` và `staff_members -> shift_staff` => n-n giữa ca và nhân viên
- `shifts -> shift_residents` và `residents -> shift_residents` => n-n giữa ca và NCT
- `residents -> care_records`
- `shifts -> care_records`
- `care_records -> care_record_images`
- `residents -> toileting_logs`
- `residents -> medication_orders`
- `medication_orders -> medication_administrations`
- `handovers -> handover_signatures`
- `users -> user_permissions`

### 1 → 1
- `shifts -> handovers` vì `handovers.shift_id UNIQUE`
- `care_records -> care_record_vitals` vì `care_record_vitals.care_record_id` vừa là PK vừa là FK
- `users -> staff_members` là 0..1 ↔ 0..1 qua `users.staff_member_id UNIQUE` khi tài khoản có map với nhân sự danh sách
- `residents -> beds` tại trạng thái hiện tại: partial unique index đảm bảo một giường active không bị hai NCT cùng chiếm

## 3. Vì sao không lưu 2–3 nhân viên trong một cột
Ca và nhân viên là quan hệ n-n. Bảng `shift_staff` cho phép:
- một ca có 2–3 người;
- một người trực nhiều ca;
- đánh dấu `is_primary_recorder`;
- truy trách nhiệm theo nhân viên;
- unique index bảo đảm mỗi ca tối đa một người ghi chính.

## 4. Cách triển khai trên Neon hiện tại
Bạn đã có `app_state` và đã migrate JSON lên Neon. Chạy trong `server`:

```bash
npm install
npm run db:migrate:relational
npm run db:migrate:data
npm run dev
```

`db:migrate:data` đọc `app_state.store` + `app_state.users` và tách vào bảng quan hệ.

## 5. Kiểm tra sau migration
Neon SQL Editor:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
ORDER BY table_name;
```

Kiểm tra số liệu:

```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM staff_members;
SELECT COUNT(*) FROM shifts;
SELECT COUNT(*) FROM shift_staff;
SELECT COUNT(*) FROM residents;
SELECT COUNT(*) FROM care_records;
SELECT COUNT(*) FROM toileting_logs;
SELECT COUNT(*) FROM medication_orders;
```

Kiểm tra một ca và nhân sự:

```sql
SELECT s.shift_date, s.shift_type, sm.employee_code, sm.full_name, ss.is_primary_recorder
FROM shifts s
JOIN shift_staff ss ON ss.shift_id=s.id
JOIN staff_members sm ON sm.id=ss.staff_id
ORDER BY s.shift_date DESC, sm.full_name;
```

Kiểm tra biến động NCT:

```sql
SELECT r.code, r.full_name, c.occurred_at, c.category, c.priority, c.content
FROM care_records c
JOIN residents r ON r.id=c.resident_id
WHERE c.deleted=FALSE
ORDER BY c.occurred_at DESC;
```

Kiểm tra 1→1 sinh hiệu:

```sql
SELECT c.id, r.full_name, v.pulse, v.temperature, v.bp_sys, v.bp_dia, v.spo2
FROM care_records c
JOIN residents r ON r.id=c.resident_id
LEFT JOIN care_record_vitals v ON v.care_record_id=c.id
ORDER BY c.occurred_at DESC;
```

## 6. Ảnh vết loét
Migration **không đưa base64 vào PostgreSQL**. Record ảnh được tạo trong `care_record_images`, nhưng ảnh base64 cũ đánh dấu `legacy_data_omitted=true`.

Đúng kiến trúc:
- file thật -> Neon Object Storage bucket private `bcare-uploads`;
- DB -> `object_key`, `mime_type`, `size_bytes`, `created_at`, `expires_at`;
- frontend không được nhận public URL vĩnh viễn.

## 7. Lưu ý compatibility adapter
`store.service.js` mới vẫn trả các array `shifts`, `changeLogs`, `toiletingLogs`... đúng shape cũ để frontend/routes hiện tại không phải sửa đồng loạt.

Khi `updateStore()` chạy, dữ liệu sẽ được ghi vào các bảng relational trong **một transaction**. Đây là bridge an toàn để chuyển dần.

Sau UAT, nên refactor route theo repository riêng (`shift.repository`, `care.repository`, ...) để mỗi request chỉ update đúng vài bảng thay vì materialize store. Schema SQL này không cần đổi khi làm bước đó.

## 8. Thứ tự go-live
1. Backup Neon branch hiện tại.
2. `npm run db:migrate:relational`.
3. `npm run db:migrate:data`.
4. Đối soát count và 10 mẫu record.
5. Chạy local app, tạo 1 ca test + 1 biến động.
6. Kiểm tra dữ liệu mới xuất hiện ở `shifts`, `shift_staff`, `care_records`.
7. Deploy staging Render.
8. Test iPad/Safari.
9. Chỉ sau UAT mới cho dữ liệu thật và tắt fallback JSON.

## 9. Không xóa app_state ngay
Giữ `app_state` để rollback. Khi đã chạy ổn và đối soát, có thể archive rồi xóa bằng migration riêng; không xóa thủ công trong ngày chuyển đổi.
