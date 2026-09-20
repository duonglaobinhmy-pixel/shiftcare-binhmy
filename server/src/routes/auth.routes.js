import { Router } from 'express';
import { getUsers } from '../services/store.service.js';
import { signUser, authenticate } from '../middleware/auth.js';
import { normalizePermissions } from '../config/permissions.js';

const router = Router();

function publicUser(user) {
  const { password, ...safe } = user;
  return { ...safe, permissions: normalizePermissions(user) };
}

router.post('/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const users = await getUsers();
  const user = users.find(u => u.active !== false && u.username === username && u.password === password);
  if (!user) return res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
  const token = signUser(user);
  res.json({ success: true, token, user: publicUser(user) });
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ success: true, user: req.user });
});

export default router;
