export const CARE_BRANCHES = [
  { id:'426c773d-44da-4455-ea30-08dd70451305', code:'CS_BMG', name:'BÌNH MỸ GOLD (Dương Quảng Hàm)' },
  { id:'48c235b3-c26a-484d-ea2f-08dd70451305', code:'CS_BMC', name:'BÌNH MỸ CARE (An Hội)' },
  { id:'6eb4adfd-05f4-43fc-ce79-08da760073f1', code:'CS_BM', name:'Bình Mỹ - Củ Chi' },
  { id:'fa49647c-101c-4f1f-e6cb-08de62d5e7fe', code:'HHG', name:'Ngôi Nhà Tình Thân - Hà Huy Giáp' },
  { id:'3cd882d6-3c35-48dc-2c02-08dd58575585', code:'TXT', name:'Trung Xuân Thu - Nguyễn Tuân' }
];
export const CARE_BRANCH_MAP = Object.fromEntries(CARE_BRANCHES.map(x=>[x.id,x]));
export function branchInfo(id){ return CARE_BRANCH_MAP[id] || null; }
