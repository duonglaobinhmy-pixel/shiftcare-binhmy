# ERD BCARE chăm sóc

```text
branches
  1 ───< areas 1 ───< rooms 1 ───< beds
  │         │
  │         └────< shifts
  ├────< staff_members >──── users (optional 1:1 mapping)
  ├────< residents
  └────< shifts
           ├────< shift_staff >──── staff_members
           ├────< shift_residents >─ residents
           ├────< care_records >──── residents
           │          ├── 1:1 care_record_vitals
           │          └── 1:n care_record_images
           ├────< toileting_logs >── residents
           └── 1:1 handovers
                    └────< handover_signatures >── staff_members

residents 1 ───< medication_orders 1 ───< medication_administrations
users     1 ───< user_permissions
users     1 ───< audit_logs (actor)
```
