import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

type User = { id: string; email: string; passwordHash: string; salt: string };
const users = new Map<string, User>();
const sessions = new Map<string, string>();

export function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  return { salt, passwordHash: scryptSync(password, salt, 64).toString('hex') };
}

export function register(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  if (users.has(normalized)) throw new Error('An account with this email already exists.');
  const credentials = hashPassword(password);
  const user = { id: randomUUID(), email: normalized, ...credentials };
  users.set(normalized, user);
  return user;
}

export function login(email: string, password: string) {
  const user = users.get(email.trim().toLowerCase());
  if (!user) throw new Error('Invalid email or password.');
  const candidate = Buffer.from(hashPassword(password, user.salt).passwordHash, 'hex');
  if (!timingSafeEqual(candidate, Buffer.from(user.passwordHash, 'hex'))) throw new Error('Invalid email or password.');
  const token = randomBytes(32).toString('hex');
  sessions.set(token, user.id);
  return { token, user: { id: user.id, email: user.email } };
}

export function currentUser(req: Request) {
  const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('agentwallet_session='));
  const token = cookie?.split('=')[1] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const userId = token ? sessions.get(token) : undefined;
  return [...users.values()].find(user => user.id === userId);
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!currentUser(req)) return res.status(401).json({ error: 'Authentication required.' });
  next();
}

export function logout(req: Request) {
  const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('agentwallet_session='));
  const token = cookie?.split('=')[1] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (token) sessions.delete(token);
}
