import test from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_LABELS, displayLabel, displayCode } from '../../client/src/utils/display-labels.js';
import { detailCsvRows } from '../../client/src/utils/report-export.js';
import { csvReport } from '../src/services/operations-report.service.js';

test('Toileting labels distinguish every supported code; NORMAL is written in full', () => {
  assert.equal(displayLabel('bowel','NORMAL'),'Bình thường');
  assert.equal(displayLabel('urine','Normal'),'Bình thường');
  assert.equal(displayLabel('urine',' normal '),'Bình thường');
  assert.equal(displayLabel('urine','NONE'),'Không tiểu');
  assert.equal(displayLabel('urine','LOW'),'Tiểu ít');
  assert.equal(displayLabel('bowel','CONSTIPATION'),'Táo bón');
  assert.equal(displayLabel('bowel','DIARRHEA'),'Tiêu chảy');
  assert.equal(displayLabel('bowel',null),'Chưa ghi nhận');
  for(const value of ['NEW_STATUS','toString','constructor','__proto__'])assert.equal(displayLabel('urine',value),'Chưa xác định');
  assert.notEqual(displayLabel('urine',null),'Bình thường');
});

test('The same code is translated according to its domain, without changing workflow semantics', () => {
  assert.equal(displayLabel('shiftStatus','OPEN'),'Đang mở');
  assert.equal(displayLabel('attention','OPEN'),'Chưa xử lý');
  assert.equal(displayLabel('followup','RESOLVED'),'Đã xử lý, chờ xác minh');
  assert.equal(displayLabel('attention','RESOLVED'),'Đã xử lý');
  assert.equal(displayLabel('shiftStatus','CLOSED'),'Đã đóng');
  assert.equal(displayLabel('assignment','CANCELLED'),'Đã hủy');
  assert.equal(displayLabel('resident','IN_FACILITY'),'Tại cơ sở');
  assert.equal(displayLabel('category','HEALTH'),'Sức khỏe');
});

test('Vietnamese edit inputs round-trip to the original enum codes, including OTHER and cancellation', () => {
  for(const domain of ['bowel','urine'])for(const [code,label]of Object.entries(DISPLAY_LABELS[domain])){
    assert.equal(displayCode(domain,label),code);
    assert.equal(displayCode(domain,code),code);
    assert.equal(displayCode(domain,` ${label.toLocaleUpperCase('vi')} `),code);
  }
  assert.equal(displayCode('urine','Khác'),'OTHER');
  assert.equal(displayCode('urine',null),'');
  assert.equal(displayCode('urine','không rõ mã'),'');
});

test('Detailed CSV translates codes while preserving every record, numeric value, column and input object', () => {
  const changes=[{id:'c1',shiftId:'s1',residentId:'r1',content:'Ghi nhận NORMAL do người dùng nhập',category:'HEALTH',attentionLevel:'RED',attentionStatus:'OPEN',occurredAt:'2026-10-16T02:00:00Z',vitals:{pulse:0,temperature:37}}];
  const toilets=Object.keys(DISPLAY_LABELS.urine).map((urineStatus,i)=>({id:`t${i}`,shiftId:'s1',residentId:'r1',bowelStatus:'NORMAL',urineStatus,createdAt:`2026-10-16T01:0${i}:00Z`}));
  const shifts=[{id:'s1',shiftDate:'2026-10-16',shiftType:'MORNING'}];
  const before=JSON.stringify({changes,toilets,shifts});
  const rows=detailCsvRows(changes,toilets,shifts);
  assert.equal(rows.length,1+changes.length+toilets.length);
  assert.ok(rows.every(r=>r.length===rows[0].length));
  const column=name=>rows[0].indexOf(name),c=rows.find(r=>r[0]==='c1');
  assert.equal(c[column('Loại ca')],'Ca sáng');
  assert.equal(c[column('Mức cảnh báo')],'Đỏ');
  assert.equal(c[column('Trạng thái cảnh báo')],'Chưa xử lý');
  assert.equal(c[column('Mạch')],0);
  assert.equal(c[column('Nội dung')],changes[0].content);
  for(const row of rows.slice(2))assert.equal(row[column('Tiêu')],'Bình thường');
  assert.equal(JSON.stringify({changes,toilets,shifts}),before);
});

test('Operations CSV localizes filter metadata, retains zero/null and formula-injection protection', () => {
  const report={resolvedFilter:{from:'2026-10-16',to:'2026-10-16',branchId:'b1',shiftType:'NIGHT',period:'day'},sourceBasis:{timeBasis:'businessDate',attribution:'performer'},status:'PROVISIONAL',asOf:'2026-10-16T08:00:00Z',rows:[{name:'=HYPERLINK("bad")',activityCount:0}],totals:{residentsWithActivity:0,activityCount:0,completionPercent:null}};
  const before=JSON.stringify(report),csv=csvReport(report);
  for(const text of ['Ca tối','Ngày nghiệp vụ ca','Người thực hiện chính','Tạm tính','Không áp dụng',"'=HYPERLINK"] )assert.ok(csv.includes(text),text);
  assert.ok(!/PROVISIONAL|businessDate|performer|N\/A/.test(csv));
  assert.equal(JSON.stringify(report),before);
});
