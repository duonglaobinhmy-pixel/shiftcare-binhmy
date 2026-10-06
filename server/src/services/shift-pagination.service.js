export function shiftPageOptions(query={}) {
  const page=query.page===undefined?1:Number(query.page),pageSize=query.pageSize===undefined?10:Number(query.pageSize);
  if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw Object.assign(new Error('Trang phải từ 1; số ca mỗi trang phải từ 1 đến 100.'),{status:400});
  return {page,pageSize};
}
export function shiftPageMeta(total,{page,pageSize}) {
  const totalPages=Math.max(1,Math.ceil(total/pageSize)),current=Math.min(page,totalPages);
  return {page:current,pageSize,total,totalPages,hasPrevious:current>1,hasNext:current<totalPages};
}
export function paginateShiftRows(rows,options) {
  const sorted=[...rows].sort((a,b)=>String(b.shiftDate||'').localeCompare(String(a.shiftDate||''))||String(b.createdAt||'').localeCompare(String(a.createdAt||''))||String(b.id).localeCompare(String(a.id)));
  const pagination=shiftPageMeta(sorted.length,options),offset=(pagination.page-1)*pagination.pageSize;
  return {data:sorted.slice(offset,offset+pagination.pageSize),pagination};
}
