# Triển khai DB gọn cho BCARE CARE middleware

## Không dùng bộ relational cũ
Bộ này thay cho thiết kế coi BCARE CARE như một BCARE mới. BCARE API vẫn là nguồn dữ liệu gốc.

## File cần chép
- `server/db/migrations/001_middleware_schema.sql`
- `server/scripts/db-migrate-middleware.js`
- `server/scripts/migrate-app-state-to-middleware.js`
- `server/scripts/import-json-to-middleware.js`
- `server/src/services/db.service.js`
- `server/src/services/store.service.js`
- `server/src/services/bcare-cache.service.js`
- `server/src/app.js`
- `server/package.json`
- `server/.env.example`

## Chạy
```bash
cd server
npm install
npm run db:migrate:middleware
npm run db:migrate:app-state
npm run dev
```

Nếu chưa từng có `app_state`, thay bước migrate app-state bằng:
```bash
npm run db:import:json
```

## Kiểm tra Neon
```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
ORDER BY table_name;
```

Kiểm tra nguồn BCARE cache và dữ liệu local:
```sql
SELECT COUNT(*) FROM bcare_residents_ref;
SELECT COUNT(*) FROM staff_members;
SELECT COUNT(*) FROM shifts;
SELECT COUNT(*) FROM shift_staff;
SELECT COUNT(*) FROM care_records;
SELECT COUNT(*) FROM toileting_logs;
SELECT COUNT(*) FROM handovers;
```

## Nguyên tắc
1. Không sửa hồ sơ NCT trong DB lớp đệm.
2. `bcare_resident_id` là khóa liên kết xuyên suốt.
3. Snapshot tên/khu/phòng/giường được lưu vào bản ghi ca/chăm sóc để báo cáo lịch sử không đổi khi BCARE chuyển phòng.
4. Ảnh thật để Object Storage; DB chỉ giữ `object_key`/metadata.
5. `store.service.js` là adapter tương thích tạm thời để các route hiện tại chưa phải viết lại ngay. Khi tải tăng, refactor dần sang repository theo module; schema không cần đổi.
