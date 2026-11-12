import { Router } from 'express';
import { z } from 'zod';
import { currentUser, login, logout, register } from '../auth.js';

const credentials = z.object({ email: z.string().email().max(200), password: z.string().min(12).max(200) });
export const authRouter = Router();

authRouter.post('/register', (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Use a valid email and a password of at least 12 characters.' });
  try {
    const user = register(parsed.data.email, parsed.data.password);
    const result = login(user.email, parsed.data.password);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `agentwallet_session=${result.token}; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`);
    return res.status(201).json(result);
  } catch (error) { return res.status(409).json({ error: error instanceof Error ? error.message : 'Registration failed.' }); }
});

authRouter.post('/login', (req, res) => {
  const parsed = credentials.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid credentials.' });
  try {
    const result = login(parsed.data.email, parsed.data.password);
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `agentwallet_session=${result.token}; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`);
    return res.json({ user: result.user, token: result.token });
  } catch (error) { return res.status(401).json({ error: error instanceof Error ? error.message : 'Login failed.' }); }
});

authRouter.post('/logout', (req, res) => { logout(req); res.setHeader('Set-Cookie', 'agentwallet_session=; HttpOnly; SameSite=Lax; Max-Age=0'); res.status(204).end(); });
authRouter.get('/me', (req, res) => {
  const user = currentUser(req);
  return user ? res.json({ id: user.id, email: user.email }) : res.status(401).json({ error: 'Authentication required.' });
});
