// Only text with a visible character is accepted; whitespace and invisible
// Unicode/control/combining characters cannot satisfy a required field.
const invisible=/[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;
const blank=/[\p{White_Space}\p{Cf}\p{Cc}\p{M}]/gu;
export function normalizeCareText(value){return typeof value==='string'?value.replace(invisible,'').replace(/\r\n?/g,'\n').trim():''}
export function validateCareText(input={}, {partial=false}={}){
 const data={...input},errors={};
 for(const [key,label] of [['content','01 · Ghi nhận'],['intervention','02 · Xử lý / hành động đã thực hiện']]){
  if(partial&&!Object.prototype.hasOwnProperty.call(input,key))continue;
  const raw=input[key],text=normalizeCareText(raw);
  if(typeof raw!=='string'||!text.replace(blank,''))errors[key]=`${label}: bắt buộc nhập nội dung, không được chỉ có dấu cách, xuống dòng hoặc ký tự trắng.`;
  else if(text.length>2000)errors[key]=`${label}: tối đa 2000 ký tự.`;
  data[key]=text;
 }
 return {data,errors,valid:!Object.keys(errors).length};
}
export function requireCareText(input,options){
 const result=validateCareText(input,options);
 if(!result.valid){const error=new Error(Object.values(result.errors).join(' '));error.status=422;error.fields=result.errors;throw error}
 return result.data;
}
