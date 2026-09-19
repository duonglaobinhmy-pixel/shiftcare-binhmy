import { cacheBcareResidents, logBcareSync } from './bcare-cache.service.js';
import { branchInfo } from '../config/branches.js';
let tokenCache = { token: null, expiresAt: 0, loginPreview: null };

const cfg = () => ({
  base: process.env.BCARE_BASE_URL || 'https://bcare.duonglaobinhmy.com',
  login: process.env.BCARE_LOGIN_PATH || '/api/authenticate/login',
  me: process.env.BCARE_ME_PATH || '/api/user/me',
  elderly: process.env.BCARE_ELDERLY_PATH || '/api/elderly/getpaging',
  username: process.env.BCARE_USERNAME || '',
  password: process.env.BCARE_PASSWORD || '',
  allowMock: String(process.env.ALLOW_BCARE_MOCK || 'true').toLowerCase() === 'true'
});

function findToken(data) {
  return data?.accessToken || data?.access_token || data?.token || data?.jwt || data?.jwtToken ||
    data?.data?.accessToken || data?.data?.access_token || data?.data?.token ||
    data?.result?.accessToken || data?.result?.token || null;
}

async function parseResponse(res) {
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { data, text };
}

export async function loginBcare(force = false) {
  if (!force && tokenCache.token && Date.now() < tokenCache.expiresAt) return tokenCache.token;
  const c = cfg();
  if (!c.username || !c.password) throw new Error('Chưa cấu hình BCARE_USERNAME/BCARE_PASSWORD');

  const form = new FormData();
  form.append('username', c.username);
  form.append('password', c.password);

  const res = await fetch(`${c.base}${c.login}`, { method: 'POST', body: form });
  const { data, text } = await parseResponse(res);
  tokenCache.loginPreview = typeof data === 'object' ? Object.keys(data || {}) : String(text).slice(0, 120);
  if (!res.ok) throw new Error(`BCARE login HTTP ${res.status}: ${String(text).slice(0, 300)}`);
  const token = findToken(data);
  if (!token) throw new Error(`BCARE login thành công nhưng chưa tìm thấy token. Keys=${JSON.stringify(tokenCache.loginPreview)}`);
  tokenCache = { token, expiresAt: Date.now() + 10 * 60 * 1000, loginPreview: tokenCache.loginPreview };
  return token;
}

export async function bcareMe() {
  const c = cfg();
  const token = await loginBcare();
  const res = await fetch(`${c.base}${c.me}`, { headers: { Authorization: `Bearer ${token}` } });
  const { data, text } = await parseResponse(res);
  if (!res.ok) throw new Error(`BCARE /user/me HTTP ${res.status}: ${String(text).slice(0, 300)}`);
  return data;
}

export async function getResidents(payload = {}) {
  const c = cfg();
  const body = {
    pageIndex: Number(payload.pageIndex || 1),
    pageSize: Math.min(Number(payload.pageSize || 10), 100),
    religionId: payload.religionId || '',
    roomId: payload.roomId || '',
    branchId: payload.branchId || '',
    status: payload.status ?? 1
  };

  const call = async token => {
    const res = await fetch(`${c.base}${c.elderly}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const parsed = await parseResponse(res);
    return { res, ...parsed };
  };

  const startedAt = Date.now();
  try {
    let token = await loginBcare();
    let out = await call(token);
    if (out.res.status === 401 || out.res.status === 403) {
      token = await loginBcare(true);
      out = await call(token);
    }
    if (!out.res.ok) throw new Error(`BCARE elderly/getpaging HTTP ${out.res.status}: ${String(out.text).slice(0, 400)}`);
    const data = out.data?.data || out.data;
    if (!data || !Array.isArray(data.items)) throw new Error('BCARE response không có items[]');
    data.items = (data.items || []).map(x => { const b = branchInfo(x.branchId); return b ? { ...x, branchName: b.name, branchCode: b.code } : x; });
    await cacheBcareResidents(data.items).catch(err => console.warn('[BCARE CACHE]', err.message));
    await logBcareSync({operation:'ELDERLY_GETPAGING',endpoint:c.elderly,branchId:body.branchId||null,success:true,itemCount:data.items.length,durationMs:Date.now()-startedAt,meta:{pageIndex:body.pageIndex,pageSize:body.pageSize}}).catch(()=>{});
    return data;
  } catch (e) {
    await logBcareSync({operation:'ELDERLY_GETPAGING',endpoint:c.elderly,branchId:body.branchId||null,success:false,durationMs:Date.now()-startedAt,error:e.message,meta:{pageIndex:body.pageIndex,pageSize:body.pageSize}}).catch(()=>{});
    if (!c.allowMock) throw e;
    return mockResidents(body, e.message);
  }
}

function mockResidents(body, reason) {
  const all = Array.from({ length: 36 }, (_, i) => ({
    id: `MOCK-${i + 1}`,
    code: `DEMO${String(i + 1).padStart(4, '0')}`,
    fullName: `NCT Demo ${i + 1}`,
    branchId: body.branchId || 'DEMO-BRANCH',
    branchName: branchInfo(body.branchId)?.name || (body.branchId ? 'Cơ sở theo bộ lọc' : 'Cơ sở Demo'),
    areaId: i % 2 ? 'AREA-A' : 'AREA-B',
    areaName: i % 2 ? 'Khu A' : 'Khu B',
    roomId: `ROOM-${Math.ceil((i + 1) / 3)}`,
    roomName: `Phòng ${Math.ceil((i + 1) / 3)}`,
    bedName: `Giường ${(i % 3) + 1}`,
    yearofBirth: 1940 + (i % 30),
    gender: i % 2 ? 2 : 1,
    image: '',
    status: 1,
    _mock: true
  }));
  const start = (body.pageIndex - 1) * body.pageSize;
  return {
    pageIndex: body.pageIndex,
    pageSize: body.pageSize,
    totalItem: all.length,
    totalPage: Math.ceil(all.length / body.pageSize),
    items: all.slice(start, start + body.pageSize),
    mock: true,
    mockReason: reason
  };
}

export async function diagnostics() {
  const c = cfg();
  const result = { ok: false, baseUrl: c.base, loginPath: c.login, mePath: c.me, elderlyPath: c.elderly, steps: [] };
  try {
    const token = await loginBcare(true);
    result.steps.push({ step: 'login', ok: true, tokenDetected: !!token });
    const me = await bcareMe();
    result.steps.push({ step: 'user/me', ok: true, username: me?.username || me?.userName || me?.data?.username || null });
    const residents = await getResidents({ pageIndex: 1, pageSize: 1, status: 1 });
    result.steps.push({ step: 'elderly/getpaging', ok: true, totalItem: residents.totalItem, totalPage: residents.totalPage, mock: !!residents.mock });
    result.ok = true;
  } catch (e) {
    result.error = e.message;
    result.steps.push({ step: 'failed', ok: false, message: e.message });
  }
  return result;
}
