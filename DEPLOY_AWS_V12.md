# ShifTCARE V12 – triển khai AWS Lightsail Ubuntu

Bản nâng cấp từ ZIP (7), giữ schema cũ. Đây là bản ứng viên staging, chưa kiểm thử end-to-end. Chọn Singapore, Ubuntu 24.04, General Purpose 4 GB RAM, IPv4; 80/443 public, SSH hạn chế IP quản trị, không mở 5432/8788. Gắn static IP và DNS A. 

## Chuẩn bị
- Cài Node.js 22 LTS từ nguồn tin cậy, Nginx, PostgreSQL, git, certbot và python3-certbot-nginx. Dùng tài khoản ubuntu, source ở /opt/shiftcare. `sudo apt install nginx postgresql git certbot python3-certbot-nginx`.
- DB local: `sudo -u postgres psql` rồi `CREATE ROLE shiftcare LOGIN;` và `\password shiftcare` để nhập mật khẩu, `CREATE DATABASE shiftcare OWNER shiftcare;`, `\q`. Không mở PostgreSQL ra Internet. DB riêng: dùng TLS xác thực chứng chỉ (rà soát cấu hình PG_SSL trước khi sử dụng).
- `cp deploy/production.env.example server/.env; chmod 600 server/.env`. Điền DB URL (URL encode mật khẩu), BCARE, secret từ `openssl rand -hex 32`, domain thật. Không bật mock hoặc AI với dữ liệu thật nếu chưa phê duyệt. Không commit .env.
- `bash deploy/build.sh` (chạy migration 001–007). Với DB cũ sao lưu trước. Không import JSON demo.
- Bắt buộc chuyển mật khẩu cũ sang scrypt: `node server/scripts/secure-accounts.js`. Nếu DB trống, chạy `read -rs INITIAL_ADMIN_PASSWORD; export INITIAL_ADMIN_PASSWORD; node server/scripts/secure-accounts.js; unset INITIAL_ADMIN_PASSWORD` và nhập mật khẩu mới tối thiểu 16 ký tự. Đổi mọi mật khẩu demo cũ; hash không khắc phục mật khẩu yếu/đã lộ.
- `sudo cp deploy/shiftcare.service /etc/systemd/system/; sudo systemctl daemon-reload; sudo systemctl enable --now shiftcare`. Dùng systemd, không chạy PM2 đồng thời. `sudo journalctl -u shiftcare -n 80`.
- `curl -f http://127.0.0.1:8788/api/health/database` và kiểm tra trạng thái schema; health cơ bản không chứng minh mọi module hoạt động.
- `sudo cp deploy/nginx-rate.conf /etc/nginx/conf.d/shiftcare-rate.conf; sudo cp deploy/nginx.conf /etc/nginx/sites-available/shiftcare; sudo ln -s /etc/nginx/sites-available/shiftcare /etc/nginx/sites-enabled/shiftcare; sudo nginx -t; sudo systemctl reload nginx`. Sửa domain nếu khác. Sau khi DNS đúng: `sudo certbot --nginx -d shiftcare.duonglaobinhmy.com`.

## Cập nhật
Backup DB và object storage, lưu commit đang chạy. Kiểm thử bản mới ở staging. Trong maintenance window: git pull --ff-only, bash deploy/build.sh, sudo systemctl restart shiftcare. Kiểm tra đăng nhập, phân quyền, ca và bàn giao. Rollback code về commit trước và build lại; không tự rollback schema hoặc khôi phục backup đè dữ liệu mới.

## Backup
Dùng deploy/backup.sh với PGHOST/PGUSER/PGDATABASE và .pgpass quyền 600. Thiết lập lịch qua cron/systemd timer sau khi test, sao chép backup sang kho mã hóa khác máy, kiểm tra restore vào DB riêng. Script không tự cấu hình lịch hay backup ảnh. Snapshot không thay thế pg_dump.

## Thay đổi và giới hạn
- NCT toàn cơ sở, tìm kiếm debounce + phân trang; ca mới toàn cơ sở, ca cũ giữ phạm vi và lịch sử. Nếu nhiều ca trùng, phải vào ca cụ thể; cần đóng ca khu cũ theo quy trình trước khi chuyển. Không tự tạo hoặc thêm NCT từ trình duyệt.
- Popup sinh hiệu 7/15/30 ngày, nhật ký gần nhất; query giới hạn 500 bản ghi. Tiền sử/chế độ ăn chưa có mapping BCARE xác nhận, không tự điền. 
- Bữa ăn ghi vào care_records dạng nhật ký NUTRITION/MEAL, không phải bảng suất ăn riêng. Không tự xác nhận đổi món hoặc hành động thực tế. Có ghi chú, xử lý, bàn giao, ID chống retry trùng. Chưa có bảng trạng thái bữa ăn duy nhất/ngày, thống kê riêng hoặc đồng bộ bếp.
- API thuốc tắt mặc định, giữ source/schema cũ. Không phát triển thêm.
- Route hồ sơ truy vấn SQL theo NCT/cơ sở; ghi chăm sóc vẫn dùng store transaction hiện có (chưa refactor toàn bộ). Tìm kiếm BCARE vẫn gọi theo trang, chưa có đồng bộ danh mục định kỳ. 
- Production yêu cầu DB, JWT secret, tắt mock; CORS giới hạn, mật khẩu scrypt, rate limit nginx. Cần rà soát quyền, dữ liệu demo và API key đã từng commit, PWA/outbox chứa dữ liệu chăm sóc, TLS, backup và log trước khi dùng dữ liệu thật.
- Kiểm thử bắt buộc: 2 cơ sở, quyền CARE_SHARED/CSKH/Admin, ca sáng/đêm qua nửa đêm, khóa ca, retry, đổi cơ sở, hồ sơ không có sinh hiệu, lỗi BCARE, mobile, backup/restore và tải đồng thời. Không có kết quả benchmark hoặc kết nối BCARE/AWS thực trong bản này.
