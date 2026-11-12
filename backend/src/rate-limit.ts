import type { Request, Response, NextFunction } from 'express';
const hits = new Map<string, { count: number; reset: number }>();
export function rateLimit(limit = 60, windowMs = 60000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    const hit = hits.get(key);
    if (!hit || hit.reset <= now) hits.set(key, { count: 1, reset: now + windowMs });
    else if (++hit.count > limit) return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    res.setHeader('X-RateLimit-Limit', limit);
    next();
  };
}
