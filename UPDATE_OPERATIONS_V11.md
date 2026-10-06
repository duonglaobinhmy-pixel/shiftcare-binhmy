# ShiftCare V11 — hướng dẫn cập nhật project sổ bàn giao ca

Ngày: 06/10/2026. Nguồn đặc tả: ShiftCare-mo-phong-bao-cao (1).html, phiên bản 2.

## 1. Bộ file

- `shiftcare-binhmy-main.zip`: project đã cập nhật, giữ toàn bộ dữ liệu và các file gốc không thay đổi. Không kèm node_modules, dist hoặc dữ liệu kiểm thử.
- `ShiftCare-full-files-thay-doi.zip`: chỉ các file sửa và file mới, giữ đúng đường dẫn từ thư mục gốc project. Mỗi file là nội dung hoàn chỉnh, không phải diff hoặc đoạn mã để chèn.
- Thay **toàn bộ** file cùng đường dẫn; bổ sung file mới. Đọc các bước cấu hình bên dưới trước khi dùng.

## 2. Những phần đã triển khai

1. Luồng `/shifts/current` và `/shifts`: một ca cơ sở theo branchId + businessDate + shiftType; các khu có scope riêng. Tạo/vào lại không reset nhân sự. Cơ sở không chia khu cấu hình một khu mặc định Toàn cơ sở.
2. Danh mục khu, tầng, phòng bằng ID; không hardcode số khu/tầng. Tầng và phòng có tuyến cha được kiểm tra, không suy tầng từ số phòng. Giường hiện lưu snapshot mã/tên trong vị trí, chưa có danh mục giường riêng.
3. Lịch ca lặp hằng ngày theo khu, giờ đầu/cuối và số nhân sự tối thiểu cấu hình được. Ca qua 00:00 thuộc ngày bắt đầu.
4. Phân công nhân sự theo khu/tầng/NCT, chức năng và khoảng hiệu lực; hỗ trợ nhiều tầng; xác nhận hiện diện thủ công; kết thúc phân công để thay người. Mã/tên nhân sự đến từ danh mục hiện có.
5. Ghi nhận chăm sóc chung: người làm chính, người phối hợp qua API, tài khoản nhập, thời điểm thực hiện/lưu và snapshot vị trí tách riêng. Giao diện có người làm chính; đồng thực hiện hiện dùng API.
6. Ghi từng hoạt động với clientRequestId; gửi lại không nhân đôi. Cùng mã nhưng đổi nội dung bị chặn để người dùng đối chiếu. Sửa bằng expectedVersion và giữ lịch sử nội dung. Mất mạng/lỗi không giả báo đã lưu.
7. Chuyển khu/tầng/phòng giữ lịch sử vị trí; ghi cũ giữ snapshot. Việc chưa hoàn thành giữ taskId, đổi trách nhiệm. Tạm giới hạn chuyển không hồi tố qua ghi nhận đã có.
8. Kế hoạch theo taskId và hạn việc. Ghi chú đột xuất không tự hoàn thành kế hoạch; chỉ ghi liên kết một task hợp lệ mới hoàn thành task. Báo cáo không có kế hoạch trả tỷ lệ N/A.
9. Rà soát, ký khóa từng khu có dataVersion kiểm tra cả dữ liệu con. Snapshot lưu danh sách tham gia, hoạt động, roster và việc tồn. Danh sách tham gia không giả chữ ký từng người. Tài khoản dùng chung chọn nhân sự đại diện. Khu khác tiếp tục mở.
10. Nhận bàn giao vào scope ca tiếp theo cùng khu. Việc chưa xong chuyển tiếp giữ taskId và ngày nghĩa vụ gốc, xuất hiện trong danh sách làm việc mới và phần tồn kỳ trước.
11. Báo cáo ngày/tuần/tháng/custom, cơ sở/khu/tầng/ca/nhân viên, businessDate/occurredAt/savedAt, nhóm khu/tầng/ngày/nhân viên/NCT. Có phân trang; tuần thứ Hai–Chủ nhật, qua năm vẫn đủ tuần; tháng nhuận tính đúng; custom gồm cả hai đầu.
12. Tổng người và tỷ lệ được tính lại DISTINCT/tử số–mẫu số. Không cộng số người từng tầng thành tổng, không lấy trung bình tỷ lệ khu. Nhân viên lọc hoạt động theo người làm/người phối hợp/người nhập; không suy tỷ lệ cá nhân từ số lượt nhập.
13. Đọc dữ liệu cũ vào báo cáo qua adapter; dữ liệu thiếu floorId/người làm giữ nhóm Chưa xác định. Sửa lỗi API báo cáo nhân viên cũ cộng hoạt động cả ca cho mọi người; giữ unattributedChanges để đối chiếu.
14. Vai trò CSKH với trần quyền riêng, UserScope nhiều cơ sở/khu/tầng/NCT và thời hạn; API đọc lại quyền hiện hành. CSKH chỉ nhận dữ liệu chăm sóc chung; không trả ảnh/y lệnh/sinh hiệu chi tiết. Chặn các API cũ chỉ lọc cơ sở khi tài khoản có phạm vi hẹp, để tránh vượt quyền bằng URL.
15. CSKH xem cả NCT chưa có hoạt động trong roster có lịch sử vị trí được biết, timeline chăm sóc, tương tác gia đình và tác vụ. Việc được giao có owner/hạn/version/lịch sử; chăm sóc viên được cấp FOLLOWUP chỉ tiếp nhận/đánh dấu đã xử lý việc của mình, CSKH xác minh đóng/mở lại.
16. Xuất CSV nhóm theo đúng bộ lọc, có tổng DISTINCT, metadata và chống công thức Excel. Export dùng cutoff và kiểm tra fingerprint; dữ liệu nguồn đổi thì yêu cầu tải lại. Lưu được snapshot báo cáo PROVISIONAL.
17. Cập nhật định kỳ bằng polling: ca 10 giây, báo cáo ngày hiện tại 15 giây. Không dùng hoặc yêu cầu Kafka. Form ghi không reset khi polling.
18. Backend JSON demo dùng file riêng theo cơ sở và hàng đợi ghi nguyên tử; PostgreSQL dùng bảng records V2, upsert chỉ đối tượng đổi và advisory transaction lock theo cơ sở. Lỗi PG không fallback âm thầm sang JSON.

## 3. Cách chạy

Từ thư mục gốc project:

```bash
npm install
npm test
npm run dev
```

Nếu đã cài các dependency hiện có, không cần thêm dependency cho phần V2.

Nếu dùng PostgreSQL, chạy migration bằng tài khoản DB có quyền tạo bảng/chỉ mục trước khi gọi luồng mới:

```bash
cd server
npm run db:migrate:middleware
```

File migration mới là `server/db/migrations/005_shiftcare_operations.sql`. Script migration đã được cập nhật để chạy file này. Các bảng và ca cũ không bị chuyển đổi hoặc xóa. Khi chưa có DATABASE_URL, V2 chạy JSON; khi có DATABASE_URL mà thiếu bảng mới, API báo 503 yêu cầu migration.

Build production:

```bash
npm run build
npm start
```

Nếu phục vụ frontend bằng API Express, dùng `NODE_ENV=production` theo cơ chế hiện có hoặc `npm run demo:pwa`. Không tải dist cũ; service worker đã tăng phiên bản cache.

## 4. Trình tự cấu hình và dùng lần đầu

1. Đăng nhập Admin. Mở Ca chăm sóc, chọn cơ sở → Danh mục/lịch ca.
2. Tạo khu đúng thực tế; cơ sở đơn giản tạo Toàn cơ sở và tick scope mặc định. Chưa tự nhập bảy khu Bình Mỹ vì cần mã/cấu trúc thật.
3. Tạo tầng/phòng nếu cơ sở có quản lý. Tạo lịch ca cho từng khu hoạt động (Sáng/Chiều/Đêm theo thực tế), số tối thiểu theo quy định đã duyệt.
4. Đồng bộ NCT từ BCARE. Nếu BCARE đang trả mock, nút đồng bộ thường sẽ chặn; chỉ chọn đồng bộ chạy thử khi muốn dùng dữ liệu demo.
5. Hồ sơ mới bắt đầu có lịch sử vị trí tại thời điểm đồng bộ. Không tự dựng quá khứ chưa biết. Đồng bộ sau đó cập nhật tên/mã; việc đổi vị trí phải dùng Chuyển NCT để không ghi đè lịch sử.
6. Tạo/vào ca cơ sở → chọn khu → phân công nhân sự. Danh mục nhân sự có sẵn trong Tài khoản & nhân sự; không coi iPad là nhân viên. Nhân viên hỗ trợ có thể được thêm phân công riêng với khoảng giờ.
7. Cần tầng chính xác: mở Chuyển NCT, gắn tuyến khu/tầng/phòng được xác nhận với thời điểm hiệu lực trước ghi nhận mới.
8. Ghi nhận: chọn NCT/người làm/thời điểm/loại/nội dung; chọn task nếu thực sự làm nhiệm vụ đó. Thời điểm phải nằm trong ca và không ở tương lai. Chăm sóc viên chỉ ghi trong ca đang hiện hành; quản lý được cấp quyền xử lý ca mở lịch sử.
9. Rà soát khu → chọn nhân sự đại diện nếu tài khoản CSV → ghi việc tồn → ký. Có dữ liệu mới sau preview phải tải lại preview. Ký chỉ khóa khu này.
10. Tạo ca tiếp nhận trước. Đọc scopeId hiển thị ở tab Bàn giao của khu ca mới, nhập vào xác nhận nhận ở bản bàn giao nguồn. Việc tồn chuyển sang scope mới. Đây là giao diện nhận bằng ID, chưa có bộ chọn ca nhận thân thiện.
11. Admin cấp role CSKH và quyền tương ứng. Có thể dùng một cơ sở chính hoặc JSON phạm vi nâng cao trên màn hình tài khoản. `[]` dùng cơ sở chính; danh sách có giá trị dùng phạm vi và thời hạn từng dòng. Nhập ID từ danh mục thực tế; ID không khớp không mở dữ liệu.
12. Tài khoản cũ có danh sách quyền đã lưu: quyền mới không tự thêm. Admin sửa/reset quyền cho Director nếu cần SYSTEM.UPDATE/REPORT.FINALIZE/CSKH; CARE_SHARED nếu cần FOLLOWUP.VIEW/UPDATE.
13. CSKH vào Theo dõi & CSKH, chọn kỳ/phạm vi; dùng Timeline/CSKH ở từng NCT. Muốn tạo tương tác/tác vụ cho NCT chỉ có trong dữ liệu cũ, phải đồng bộ danh mục V2 trước.
14. Báo cáo mới là trang tổng quan mặc định cho tài khoản có REPORT.VIEW. Dữ liệu lâm sàng/các màn cũ vẫn đọc tại `/reports/legacy`, `/dashboard/legacy` và URL chi tiết ca cũ theo quyền. Dữ liệu V2 được đọc ở báo cáo V2, không ghi sao chép ngược vào bảng ca cũ.

## 5. API chính

Mọi API dưới đây cần Bearer token hiện hành; ghi phải truyền branchId. GET nhận branchId trên query. Actor nhập và thời điểm lưu lấy trên server.

| API | Mục đích |
|---|---|
| GET /api/operations/bootstrap | Danh mục theo quyền, roster, nhân sự, ca |
| POST /api/operations/org/{zones,floors,rooms,schedules} | Thêm/cập nhật danh mục/lịch; có id thì cập nhật |
| POST /api/operations/residents/sync | Đồng bộ NCT BCARE; allowDemo:true cho thử nghiệm |
| POST /api/operations/shifts | Tạo/vào ca chung bằng businessDate, shiftType |
| GET /api/operations/shifts/:id | Scope, assignment, roster, task, hoạt động theo quyền |
| POST/PATCH /api/operations/assignments[/:id] | Tạo/điều chỉnh phân công và hiện diện |
| POST /api/operations/residents/:id/transfers | Chuyển vị trí có effectiveAt và reason |
| POST /api/operations/tasks | Tạo nghĩa vụ kế hoạch |
| POST/PATCH /api/operations/activities[/:id] | Ghi/sửa chăm sóc, requestId/expectedVersion |
| GET /api/operations/scopes/:id/handover-preview | Snapshot rà soát có dataVersion |
| POST /api/operations/scopes/:id/sign | Ký riêng khu; confirm,dataVersion,note,representativeStaffId |
| POST /api/operations/scopes/:id/receive | Nhận; confirm,receivingScopeId,note |
| GET /api/reporting/overview | Báo cáo V2 và nguồn ca cũ |
| GET /api/reporting/export | CSV; cutoff,expectedFingerprint để đối chiếu bản đã xem |
| POST /api/reporting/snapshots | Lưu bản báo cáo tạm PROVISIONAL |
| GET /api/cskh/daily | Báo cáo/roster chăm sóc chung cho CSKH |
| GET /api/cskh/residents/:id/timeline | Timeline chăm sóc/tương tác/tác vụ |
| POST /api/cskh/interactions | Tương tác gia đình |
| GET/POST/PATCH /api/follow-ups[/:id] | Việc theo dõi qua ngày, quyền owner/CSKH |
| GET /api/operations/audit | Audit V2, phân quyền theo scope |

## 6. Phạm vi đã kiểm tra

- 39 kiểm thử tự động đã PASS: 37 nghiệp vụ + 2 tích hợp HTTP thật với Express/JSON.
- Có kiểm tra tạo ca đồng thời tám yêu cầu, ghi trùng, stale version, khóa khu, ca đêm, tuần giao năm, nhuận, DISTINCT, tỷ lệ có trọng số, nhập hộ, thiếu mapping, phạm vi/thời hạn, chuyển NCT, chuyển task sang ca tiếp theo, việc tồn kỳ trước, xử lý followup và CSV.
- Frontend `npm run build` PASS. API khởi động và import toàn bộ module thành công ở JSON mode.
- Không chạy UAT người dùng trên iPad. Thử kiểm tra trình duyệt tự động không chạy được vì runtime thiếu Chromium; không tuyên bố đã kiểm thử UI end-to-end.
- Chưa chạy migration và bộ tích hợp trên PostgreSQL thật; đường PG đã được viết nhưng phải nghiệm thu với DB triển khai. Chưa gọi BCARE thật hoặc kiểm thử tải nhiều cơ sở.

## 7. Phần nâng cao còn thiếu so với toàn bộ 31 UC của tài liệu

Đây là bản triển khai các luồng vận hành chính, không phải lời xác nhận đã hoàn tất toàn bộ đặc tả V2.

- Chốt FINAL, quy trình đề nghị/duyệt amendment sau khóa, xuất PDF/XLSX và xuất nền chưa triển khai. API chặn FINAL thay vì gắn nhãn chốt giả. Không sửa trực tiếp hoạt động V2 đã khóa, kể cả Admin.
- Lịch ca hiện là lịch lặp ngày hiện hành; chưa có hiệu lực lịch theo thời gian, ngoại lệ ngày nghỉ hoặc lịch sử biên chế chính của nhân sự. Completeness lịch sử dùng lịch hiện tại và ghi sourceBasis rõ; không đủ cơ sở để chốt báo cáo quá khứ.
- Chưa có lịch sử issue đầy đủ để báo cáo tồn đầu + phát sinh + mở lại − giải quyết − hủy. Followup có lịch sử trạng thái, nhưng chỉ tiêu issue toàn hệ thống chưa dựng.
- Báo cáo statusBasis là CURRENT, không dựng trạng thái từng đối tượng tại cuối kỳ. Lần xuất theo cutoff khóa phần nguồn hiện có bằng fingerprint, không phải cơ chế time travel tất cả phiên bản.
- Hồ sơ/roster cũ chỉ biết người xuất hiện trong các ca đã lưu; không thể suy NCT chưa từng có trong nguồn. Roster mới đầy đủ hơn sau đồng bộ BCARE.
- Hỗ trợ/đổi người dùng nhiều assignment có hiệu lực; chưa tự phát hiện chồng trách nhiệm và điều động nhiều cơ sở. Hiện chỉ nhận staff thuộc cùng cơ sở. Xác nhận hiện diện là thủ công, chưa kết nối máy chấm công.
- Y lệnh/sinh hiệu/ảnh chuyên môn và các form lâm sàng cũ chưa được hợp nhất vào CareActivity V2. Luồng mới là ghi chăm sóc chung và task, không thay phác đồ chuyên môn hoặc tự đặt threshold. Muốn dùng nghiệp vụ chuyên môn cho ca mới cần bước hợp nhất tiếp theo.
- Chưa có lịch sử HomeAssignment của nhân viên hoặc danh mục giường độc lập. Truy vấn API danh mục nâng cao/nhận ca hiện còn dùng ID tại một số chỗ.
- Polling hiện thay cho realtime SSE/WebSocket theo scope. Chưa có projection, outbox nền, Kafka, DLQ hoặc xuất dữ liệu lớn. JSON dành cho demo một process; PG khóa/upsert từng row nhưng phần đọc còn tải state theo cơ sở, chưa đủ để cam kết dữ liệu lớn. Báo cáo tương tác tối đa 366 ngày; CSV tối đa 200 nhóm, không cắt âm thầm.
- Audit V2 lưu riêng trong collections/tables V2 và xem qua /operations/audit; màn audit cũ không tự trộn audit mới.

## 8. Danh sách file thay đổi — đều là FULL FILE

### File hiện có được thay nguyên file (15)

- `client/public/sw.js`
- `client/src/components/Layout.jsx`
- `client/src/context/AuthContext.jsx`
- `client/src/main.jsx`
- `client/src/pages/Users.jsx`
- `package.json`
- `server/package.json`
- `server/scripts/db-migrate-middleware.js`
- `server/src/app.js`
- `server/src/config/permissions.js`
- `server/src/middleware/auth.js`
- `server/src/routes/bcare.routes.js`
- `server/src/routes/core.routes.js`
- `server/src/routes/users.routes.js`
- `server/src/services/fast-query.service.js`

### File mới (12)

- `client/src/components/CustomerPanel.jsx`
- `client/src/pages/Operations.jsx`
- `client/src/pages/OperationsReports.jsx`
- `client/src/services/operations.js`
- `client/src/styles/operations.css`
- `server/db/migrations/005_shiftcare_operations.sql`
- `server/src/routes/operations.routes.js`
- `server/src/services/operations-domain.service.js`
- `server/src/services/operations-report.service.js`
- `server/src/services/operations-store.service.js`
- `server/test/operations-http.test.js`
- `server/test/operations.test.js`

Thêm `UPDATE_OPERATIONS_V11.md` là hướng dẫn này. Không đổi nội dung `server/data/users.json`, `server/data/store.json`, hay tài liệu HTML đầu vào.
