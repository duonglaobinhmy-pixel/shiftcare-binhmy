import { Router } from 'express';
import { getUsers } from '../services/store.service.js';
import { signUser, authenticate, safeIdentity } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const users = await getUsers();
  const user = users.find(u => u.active && u.username === username && u.password === password);
  if (!user) return res.status(401).json({ success: false, message: 'Sai tài khoản hoặc mật khẩu' });
  const token = signUser(user);
  res.json({ success: true, token, user: safeIdentity(user) });
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ success: true, user: req.user });
});

export default router;
