# BCARE CARE — ERD lớp đệm

## Ranh giới sở hữu dữ liệu

**BCARE API là nguồn sự thật:** NCT, cơ sở, khu/phòng/giường, hồ sơ nền.

**Lớp đệm sở hữu:** danh sách nhân sự chăm sóc, ca trực, người trực, người ghi chính, biến động, sinh hiệu mở rộng, tiêu/tiểu, y lệnh chăm sóc cục bộ, bàn giao, chữ ký, audit, báo cáo vận hành.

```text
BCARE API
   │
   ├── branch ───────► bcare_branches_ref (cache)
   └── elderly ──────► bcare_residents_ref (cache)
                              │
                              │ 1:N
                              ▼
                          care_records ───── 1:0..1 ─── care_record_vitals
                              │
                              └────────────── 1:N ───── care_record_images

bcare_branches_ref 1:N staff_members
bcare_branches_ref 1:N shifts

shifts N:N staff_members via shift_staff
shifts 1:N shift_residents ──► bcare_residents_ref
shifts 1:N care_records ─────► bcare_residents_ref
shifts 1:N toileting_logs ───► bcare_residents_ref
shifts 1:0..1 handovers 1:N handover_signatures ─► staff_members

bcare_residents_ref 1:N care_instructions
users 1:N user_permissions
users 1:N audit_logs
```

### 1:1 thật sự
- `care_records -> care_record_vitals`: `care_record_vitals.care_record_id` vừa PK vừa FK.
- `shifts -> handovers`: `handovers.shift_id UNIQUE`.

### 1:N
- branch -> staff
- branch -> shifts
- resident-ref -> care records
- resident-ref -> toileting logs
- resident-ref -> care instructions
- shift -> care records
- care record -> images
- handover -> signatures

### N:N
- shift <-> staff qua `shift_staff`.

Không tạo local master cho `areas`, `rooms`, `beds`, `residents`. Các giá trị đó chỉ cache/snapshot từ BCARE API để báo cáo lịch sử không bị đổi theo dữ liệu hiện tại.
