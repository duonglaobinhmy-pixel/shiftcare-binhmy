# BCARE Chăm Sóc Thông Minh v10.4

Bản demo vận hành **Ca chăm sóc + Sổ giao ca + Nhật ký biến động NCT** dành cho Bình Mỹ Care.

## Điểm mới v10.4

- Kiểm tra ngay tại từng ô sinh hiệu, chặn giá trị ngoài miền kỹ thuật và kiểm tra huyết áp tâm thu phải lớn hơn tâm trương ở cả frontend lẫn backend.
- Tự phân tầng **Vàng / Đỏ** theo bộ ngưỡng vận hành mặc định. Cảnh báo Đỏ tự nâng mức ưu tiên và bắt buộc xác nhận đo lại, người đã báo, hành động đã làm trước khi cho lưu.
- Có bước **Kiểm tra trước khi lưu** cho cả biến động và tiêu/tiểu; dữ liệu chỉ được gửi khi người dùng bấm `Xác nhận lưu`.
- Nhập bằng giọng nói tiếng Việt theo hai lớp: Chrome nhận chữ tức thời khi trình duyệt hỗ trợ; đồng thời trình duyệt thu âm có khử vọng/lọc ồn và cứ khoảng 3 giây gửi phần âm thanh tích lũy để Gemini cập nhật cuốn chiếu ngay trong ô Nội dung. Khi bấm `Dừng & kiểm tra`, hệ thống chép lại toàn bộ lần cuối. Bản gốc và bản làm sạch đều phải được người dùng duyệt, không tự submit.
- Admin có nút `Xóa ca`; chỉ ca chưa có biến động, tiêu/tiểu hoặc bàn giao mới được xóa để tránh mất nhật ký nghiệp vụ.
- Kiểm soát y tế tối giản: chỉ hai trạng thái **Cần xử lý / Đã xử lý**; Đỏ và Vàng là mức cảnh báo, không tạo thêm quy trình. Cảnh báo chưa xử lý được giữ lại qua ngày và qua ca.
- Chuông cảnh báo toàn hệ thống tự cập nhật mỗi 20 giây. Biến động Đỏ hoặc té ngã được gửi nền tới nhóm Telegram; khi hoàn tất, nhóm nhận thông báo đóng cảnh báo.
- Dashboard quản trị ưu tiên Đỏ/Vàng chưa xử lý. Báo cáo tự tổng hợp cảnh báo tồn, tỷ lệ hoàn tất, chi tiết sinh hiệu, xử trí, tiêu/tiểu và xuất CSV đầy đủ.
- Tìm kiếm NCT chạy trên toàn bộ danh sách phía server thay vì chỉ lọc 20 NCT của trang đang xem.
- Hiển thị tiến độ NCT đã có ghi nhận trong ca; vẫn cho bổ sung nhiều lần đo cho cùng một NCT.
- Nhật ký lưu nhãn Vàng/Đỏ và dấu vết xử trí cảnh báo Đỏ.
- Mục Tiểu gồm: **BT, Tiểu qua sonde, Tiểu qua ống tiểu, Tiểu qua tã, Khác**; chọn Khác bắt buộc mô tả như tiểu ít/không tiểu.

### Ngưỡng cảnh báo mặc định

Đây là ngưỡng hỗ trợ vận hành, không thay thế đánh giá lâm sàng. Cơ sở cần cho bác sĩ/phụ trách chuyên môn phê duyệt trước khi dùng chính thức.

| Chỉ số | Vàng | Đỏ |
|---|---|---|
| Mạch | 41–50 hoặc 91–130 | ≤40 hoặc ≥131 lần/phút |
| Nhiệt độ | 35,1–36 hoặc 38,1–39,0 | ≤35 hoặc ≥39,1 °C |
| HA tâm thu | 91–110 | ≤90 hoặc ≥220 mmHg; HA >180/120 cũng báo Đỏ để đo lại/kiểm tra triệu chứng |
| SpO₂ | 92–95 | ≤91% |
| Nhịp thở | 9–11 hoặc 21–24 | ≤8 hoặc ≥25 lần/phút |

## Tính năng kế thừa

- Dùng logo Bình Mỹ thật ở đăng nhập, sidebar và PWA.
- Không còn lỗi phải tự tạo ca trước khi nhập nhanh: Admin/Chăm sóc viên bấm NCT sẽ **tự tìm hoặc tự mở ca hiện tại theo cơ sở + khu + khung giờ** rồi vào thẳng form ghi nhận.
- Nhập biến động 2 chế độ: **Nhập nhanh** và **Đầy đủ**.
- Một NCT có thể nhập **nhiều lần liên tiếp trong cùng ca** bằng nút `Lưu & nhập tiếp`; lịch sử của chính NCT hiển thị cạnh form.
- Form đầy đủ có: nhóm, loại sự kiện, mức ưu tiên, thời điểm, nội dung, xử lý đã làm, người/nhóm đã báo, sinh hiệu tùy chọn, cờ cần chú ý, chuyển ca sau.
- Dấu hiệu sinh tồn **hiện trực tiếp trong cả Nhập nhanh và Đầy đủ, không cần bấm hoặc tick mở**. Có ô nhập số riêng cho Mạch (lần/phút), Nhiệt độ (°C), Huyết áp tâm thu/tâm trương (mmHg), SpO₂ (%) và Nhịp thở (lần/phút). Không đo thì để trống; frontend và backend cùng kiểm tra khoảng giá trị.
- Tiêu/tiểu vẫn là luồng riêng nhưng mở ngay trong cùng modal NCT. Mục Tiểu gồm: BT, Tiểu qua sonde, Tiểu qua ống tiểu, Tiểu qua tã và Khác. Khi chọn Khác, bắt buộc mô tả rõ như tiểu ít, không tiểu hoặc tình trạng khác.
- Bàn giao ca có preview tự sinh, nhóm theo NCT, tiêu/tiểu cần lưu ý, **ký giao và ký nhận bằng mật khẩu tài khoản đang đăng nhập**.
- Dashboard theo ngày có **NCT cần chú ý**, biến động, ca, bàn giao, ca đã giao chưa nhận.
- Báo cáo ngày có tổng hợp + chi tiết nguồn, lọc ngày, in/PDF từ trình duyệt và xuất CSV.
- Giám đốc cơ sở vẫn **read-only** dữ liệu nghiệp vụ.
- Gemini `gemini-3.8-flash`, prompt/API key ở backend; AI chỉ đọc dữ liệu trong scope.
- PWA + offline outbox vẫn giữ nguyên.

## Luồng vận hành

`Tìm NCT -> bấm NCT -> tìm/tạo ca hiện tại -> nhập nhanh/đầy đủ -> lưu & nhập tiếp -> cảnh báo dashboard -> bàn giao -> ký giao -> ký nhận -> báo cáo ngày`

### Vì sao tự mở ca?

Bản trước yêu cầu NCT phải có sẵn trong roster của một ca OPEN. Với vận hành thực tế điều này tạo thêm thao tác và dẫn đến lỗi “chưa có ca OPEN”. v7 giữ logic dữ liệu theo ca nhưng tự tạo ca hiện tại khi Chăm sóc viên/Admin nhập lần đầu. Giám đốc không có quyền tạo hay sửa.

Khung demo hiện tại:
- 06:00–13:59: `MORNING`
- 14:00–21:59: `AFTERNOON`
- 22:00–05:59: `NIGHT`

Có thể đổi rule này trước khi production.

## Stack

- Frontend: React 18 + Vite + React Router
- Backend: Node.js + Express
- Demo storage: JSON file
- BCARE: FormData login -> JWT Bearer -> `/api/elderly/getpaging`
- AI: Gemini API + local fallback
- PWA: manifest + service worker + offline write outbox
- RBAC: Admin / Giám đốc cơ sở / Chăm sóc viên

## Chạy local trên Mac

```bash
cd ~/Downloads/BCARE-ChamSoc-ThongMinh-v10
npm install
npm run dev
```

Mở:
- Frontend: http://localhost:5173
- Backend: http://localhost:8788
- Health: http://localhost:8788/api/health

Không cần Docker/PostgreSQL cho bản demo.

## Tài khoản demo

| Vai trò | Username | Password |
|---|---|---|
| Admin | `admin` | `Admin@123` |
| Giám đốc Củ Chi | `giamdoc.cuchi` | `Demo@123` |
| Chăm sóc viên Củ Chi | `csv.cuchi` | `Demo@123` |

## Phân quyền

### ADMIN
- Toàn hệ thống.
- Tạo ca thủ công hoặc dùng auto-open khi nhập nhanh.
- CRUD biến động; xóa mềm có audit.
- Báo cáo, audit, user, diagnostics.

### BRANCH_DIRECTOR
- Chỉ cơ sở trong `branchId` được gán.
- Dashboard, NCT, ca, báo cáo, audit.
- **Không tạo/sửa/xóa biến động.**
- **Không ký thay người trực.**

### CAREGIVER
- Cơ sở/khu được phân công.
- Tìm NCT và nhập nhanh.
- Tạo nhiều ghi nhận trong ca.
- Sửa bản ghi của chính mình khi ca OPEN.
- Ghi tiêu/tiểu.
- Ký giao/nhận ca bằng mật khẩu tài khoản.

## Cảnh báo Dashboard

Một NCT được đưa vào khu “Cần chú ý” khi có ít nhất một record thỏa một trong các điều kiện vận hành:
- `priority = HIGH`, hoặc
- `eventType = FALL`, hoặc
- được đánh dấu `requiresHandover`, hoặc
- người ghi chủ động tick `vitals.concern`.

Đây là **cờ vận hành**, không phải chẩn đoán hay cảnh báo y khoa tự động.

## `.env`

Bản local có `server/.env`. Không push file này lên GitHub.

Các biến chính:

```env
PORT=8788
JWT_SECRET=...
BCARE_BASE_URL=https://bcare.duonglaobinhmy.com
BCARE_LOGIN_PATH=/api/authenticate/login
BCARE_ME_PATH=/api/user/me
BCARE_ELDERLY_PATH=/api/elderly/getpaging
BCARE_USERNAME=...
BCARE_PASSWORD=...
ALLOW_BCARE_MOCK=true
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.8-flash
TELEGRAM_ALERTS_ENABLED=true
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALERT_CHAT_ID=...
```

### Cảnh báo Telegram

1. Tạo bot bằng `@BotFather`, lấy bot token.
2. Thêm bot vào nhóm Telegram cảnh báo của cơ sở.
3. Gửi một tin nhắn trong nhóm và lấy `chat_id` của nhóm.
4. Điền `TELEGRAM_BOT_TOKEN` và `TELEGRAM_ALERT_CHAT_ID` vào `server/.env`, sau đó khởi động lại server.

Nếu bỏ trống hai biến này, hệ thống vẫn chạy đầy đủ; chỉ tắt gửi Telegram. Việc gửi Telegram chạy nền và không chặn thao tác lưu biến động.

## PWA

Dev:

```bash
npm run dev
```

Test PWA production:

```bash
npm run demo:pwa
```

Sau đó mở http://localhost:8788.

## Bàn giao & ký

Preview bàn giao được tự sinh từ:
- roster ca,
- biến động,
- mục `requiresHandover`,
- tiêu/tiểu cần lưu ý, kèm cách tiểu và mô tả chi tiết khi chọn Khác.

Khi ký giao/nhận, backend kiểm tra mật khẩu của tài khoản đang đăng nhập. Sau khi ký giao, ca chuyển `HANDOVER_CONFIRMED`; sau khi ký nhận chuyển `RECEIVED`.

## Báo cáo ngày

`/reports` hỗ trợ:
- chọn ngày,
- tổng ca/NCT/lượt biến động/NCT cần chú ý,
- nhóm biến động,
- thống kê theo khu,
- bảng trạng thái từng ca,
- chi tiết từng biến động,
- in/PDF bằng trình duyệt,
- CSV.

## Production sau pilot

Bản v9 vẫn là demo JSON. Trước production nên chuyển sang PostgreSQL và bổ sung password hashing, refresh token, HTTPS, rate limit, immutable audit, backup/DR, cấu hình ca theo từng cơ sở và chính sách chữ ký vận hành chính thức.
