# ShiftCare — bản sửa gọn trên project gốc

Bản này lấy project anh vừa gửi làm nền. Giữ menu, lịch tháng, trang chi tiết ngày, thẻ NCT và form ghi nhận gốc. Không dùng lại màn hình Operations/OperationsReports tách riêng của bản trước. Gói file thay thế chứa **nội dung đầy đủ của từng file**, không phải đoạn patch.

## Cách áp dụng

1. Sao lưu project đang chạy, `server/.env`, `server/data` và DB PostgreSQL trước khi cập nhật.
2. Nếu dùng `shiftcare-full-files-changed.zip`: giải nén, chép **nội dung thư mục shiftcare-patch** vào thư mục gốc project, cho ghi đè đúng file. Không chép thư mục shiftcare-patch làm một thư mục con.
3. Chạy từ thư mục gốc project:

```bash
node scripts/cleanup-previous-patch.mjs
npm run install:all
node --test server/test/reports.test.js
npm run build
```

Lệnh cleanup chỉ dọn danh sách file dư đã xác định; sao lưu các file đó vào thư mục `backup-obsolete-*` trước khi xóa. Nếu vẫn còn import tới file cũ thì dừng để tránh làm hỏng project. Không đụng `server/.env`, `server/data` hay dữ liệu nghiệp vụ.

Nếu dùng `shiftcare-project-clean.zip`: đây là toàn bộ source sạch. Khi chuyển từ bản đang chạy, mang `server/.env` và dữ liệu của anh sang; không thay dữ liệu thực tế bằng dữ liệu demo trong zip. Sau đó cài dependencies và build như trên.

## PostgreSQL / lỗi thiếu DATABASE_URL

`DATABASE_URL` phải là chuỗi kết nối DB thật của anh. Không thể tạo đúng chuỗi này từ thông báo lỗi. Các script nay luôn đọc `server/.env` theo đường dẫn tuyệt đối, không phụ thuộc thư mục chạy; biến môi trường của hosting được ưu tiên.

Trong `server/.env`, cấu hình theo DB đang dùng, ví dụ DB local:

```dotenv
DATABASE_URL=postgresql://DB_USER:DB_PASSWORD@127.0.0.1:5432/DB_NAME
PG_SSL=false
```

Thay các giá trị mẫu bằng thông tin thật. DB cloud dùng SSL theo cấu hình nhà cung cấp. Không chép đè nguyên `.env.example` lên `.env` đang có.

Sau khi cấu hình DB:

```bash
npm --prefix server run db:migrate:middleware
npm start
```

Migration chạy theo thứ tự 001 → 002 → 003 → 004 → 006, có ghi version và transaction cho từng bản; chạy lại sẽ bỏ qua bản đã áp dụng. Số 005 thuộc phần Operations dư của bản trước nên được loại khỏi source. Bản 006 bổ sung index, chuẩn hóa trường cảnh báo dẫn xuất theo quy tắc hiện có và chuyển bảng `public.shiftcare_operations` cũ, nếu tồn tại, sang `shiftcare_archive.shiftcare_operations`. Không xóa các bản ghi trong bảng đó, không xóa lịch sử chăm sóc. Nếu archive đã tồn tại thì báo lỗi để kiểm tra, không tự ghi đè.

Nếu chưa dùng PostgreSQL: để `DATABASE_URL` trống và **không chạy migration/import DB**. Chạy `npm start` để dùng JSON demo. Lịch nhân viên và chi tiết ngày nay có nhánh JSON; health DB cũng trả đúng trạng thái JSON.

Nếu cần mang dữ liệu JSON sang một DB đã tạo schema:

```bash
npm --prefix server run db:import:json
```

Import nay gộp theo ID, giữ các ID đã có trong DB; không dùng dữ liệu JSON để xóa những dòng không có trong file. Không chạy import dữ liệu demo vào DB sản xuất. Script này không tự giải quyết trường hợp hai nguồn có cùng username/mã nhân viên nhưng ID khác.

## Các sửa thực tế

- Báo cáo lịch/tháng/ngày hoạt động trên cả JSON và PostgreSQL.
- Phát sinh sau 00:00 được tính theo ngày Việt Nam; ca nguồn hôm trước vẫn xuất hiện trong lịch và chi tiết ngày. Lọc một nhân viên chọn ca người đó tham gia, thẻ nhân sự của ca vẫn thể hiện đầy đủ người được phân công.
- Giữ báo cáo ca tham gia riêng với số hoạt động người thực hiện. Form cũ thêm một ô “Người thực hiện”; dữ liệu cũ chưa xác định người không tự gán cho toàn bộ nhân viên. Người nhập giữ theo tài khoản đăng nhập. Attribution lưu trong `legacy_extra` của bảng care_records hiện có, không tạo kho hoạt động song song.
- Sửa thời điểm mặc định của form: giờ Việt Nam thay vì lấy chuỗi UTC rồi diễn giải lại thành giờ local.
- Cảnh báo tồn hiện tại tính một cảnh báo ưu tiên/NCT/cơ sở; bỏ giới hạn 500 dòng làm sai tổng. Cảnh báo tồn có thể có từ trước khoảng báo cáo, được ghi rõ trên màn hình. Danh sách NCT biến động vẫn giữ định nghĩa người có hoạt động trong kỳ của giao diện gốc.
- Mẫu số xử lý bằng 0 hiển thị “—”, không mặc định 100%. ID NCT trong thẻ và URL được giữ nguyên.
- Kiểm tra ngày không hợp lệ và khoảng ngày đảo ngược; chặn lấy roster NCT khác cơ sở. Lỗi DB không bị biến thành chuyển sang JSON hay lỗi đăng nhập giả.
- Khi lưu PostgreSQL: đọc trong cùng transaction, tuần tự hóa các writer của ứng dụng và chỉ ghi dòng thay đổi. Không xóa toàn bộ shift_residents hoặc ghi lại toàn bộ care_records vì một audit mới. Đọc để ghi không ký lại URL của toàn bộ ảnh.
- Kiểm tra trạng thái khóa tại thời điểm commit; chống gửi lặp trong hàng đợi ghi; phát hiện ghi nhận đã bị sửa trước khi lưu đè. Hai cơ chế JSON/PG vẫn dùng đúng hạ tầng hiện có.
- Giữ ca có lịch sử chăm sóc/bàn giao: JSON và PG cùng chặn xóa vật lý ca đã có dữ liệu. Dọn code cũ không đồng nghĩa xóa dữ liệu người bệnh.
- Đổi version cache PWA để thiết bị tải lại giao diện được khôi phục.

## Phạm vi của bản sửa

Đây là bản ổn định luồng hiện có, không phải tuyên bố hoàn tất toàn bộ 31 UC V2. Scope bàn giao độc lập theo khu, lịch sử tầng/phân công, kế hoạch task, tương tác CSKH và chốt kỳ chưa được triển khai đầy đủ trong giao diện gốc. Không tự dựng danh mục khu/tầng hay quy tắc chuyên môn từ dữ liệu minh họa. Tài khoản CSKH từng tạo ở prototype được giữ trong DB để không mất tài khoản, nhưng bộ quyền/giao diện gốc không cấp quyền vận hành cho vai trò này.

## Kiểm tra đã thực hiện

- Build frontend thành công, không thêm thư viện runtime vào project.
- 9 test API chạy thành công với dữ liệu tạm riêng: JSON calendar/day, ca đêm, ID NCT, attribution, ngày sai, phạm vi cơ sở, N/A, retry, khóa ca và JSON hỏng.
- PostgreSQL nhúng (PGlite): chạy schema, đối chiếu báo cáo JSON/PG, lưu từng dòng, cache sau fast SQL, bảo vệ lịch sử và archive prototype.
- Kiểm tra script migration lần đầu/lần hai: đủ version, chạy lại không áp dụng lại.
- API boot production và các URL giao diện/health trả 200. Không kiểm thử thao tác trình duyệt vì runtime chưa có Chromium.
- Đối chiếu byte: `server/data/store.json` và `server/data/users.json` trong project sạch giữ nguyên file anh gửi. Chưa kết nối hay chạy migration lên DB thật của anh.

## Danh sách file

### File sửa so với project anh vừa gửi

- `client/public/sw.js`
- `client/src/pages/Reports.jsx`
- `client/src/pages/ShiftDetail.jsx`
- `server/.env.example`
- `server/db/migrations/002_align_shiftcare_20260920.sql`
- `server/scripts/db-migrate-middleware.js`
- `server/scripts/import-json-to-middleware.js`
- `server/scripts/migrate-app-state-to-middleware.js`
- `server/src/app.js`
- `server/src/middleware/auth.js`
- `server/src/routes/core.routes.js`
- `server/src/services/db.service.js`
- `server/src/services/fast-query.service.js`
- `server/src/services/store.service.js`
- `server/src/utils/files.js`

### File mới cần thiết

- `scripts/cleanup-previous-patch.mjs`
- `server/db/migrations/006_cleanup_previous_operations.sql`
- `server/src/config/env.js`
- `server/src/services/staff-report.service.js`
- `server/test/reports.test.js`

### File gốc khôi phục để gỡ bản sửa trước

Các file này không đổi so với project anh vừa gửi, nhưng có trong gói thay thế vì bản trước đã sửa chúng. Cần khôi phục để bỏ các import/màn hình/role của bản trước.

- `client/src/components/Layout.jsx`
- `client/src/context/AuthContext.jsx`
- `client/src/main.jsx`
- `client/src/pages/Users.jsx`
- `package.json`
- `server/package.json`
- `server/src/config/permissions.js`
- `server/src/routes/bcare.routes.js`
- `server/src/routes/users.routes.js`

### File dư đã loại khỏi project sạch

- `README 2.md`
- `server/src/routes/fast-query.service.js`
- `server/src/routes/store.service.js`

File Operations của bản trước được dọn bằng script cleanup; danh sách chính xác nằm trong script.
