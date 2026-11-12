import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { purchaseRouter } from './routes/purchase.js';
import { pool } from './db/pool.js';
import { catalog, attackProduct } from './catalog.js';
import { webhookRouter } from './routes/webhooks.js';
import { authRouter } from './routes/auth.js';
import { policyRouter } from './routes/policy.js';
import { rateLimit } from './rate-limit.js';
import { attackLabRouter } from './routes/attack-lab.js';

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '32kb' }));
app.use(rateLimit());
app.get('/', (_req, res) => {
  res.redirect(process.env.FRONTEND_ORIGIN || 'http://localhost:5173');
});
app.get('/health', async (_req, res) => {
  let database = 'not_configured';
  if (pool) {
    try { await pool.query('SELECT 1'); database = 'connected'; }
    catch { database = 'disconnected'; }
  }
  res.json({ status: 'ok', service: 'agentwallet-api', database });
});
app.get('/api/catalog', (_req, res) => res.json({ catalog, attackProduct }));
app.use('/api/auth', authRouter);
app.use('/api/policies', policyRouter);
app.use('/api/attack-lab', attackLabRouter);
app.get('/api/dashboard/summary', async (_req, res) => {
  const records = await import('./db/store.js').then(store => store.listLedger());
  const confirmed = records.filter(record => record.status === 'CAPTURED');
  const reserved = records.filter(record => ['ORDER_CREATED', 'BUYER_APPROVED'].includes(record.status));
  res.json({
    totalTransactions: records.length,
    blockedTransactions: records.filter(record => record.status === 'BLOCKED').length,
    pendingApprovals: records.filter(record => record.status === 'PENDING_APPROVAL').length,
    totalSpent: confirmed.reduce((sum, record) => sum + Number((record.product as { amount?: number })?.amount || 0), 0),
    reservedAmount: reserved.reduce((sum, record) => sum + Number((record.product as { amount?: number })?.amount || 0), 0),
    confirmedPayments: confirmed.length,
  });
});
app.get('/api/dashboard/activity', async (_req, res) => res.json(await import('./db/store.js').then(store => store.listLedger())));
app.get('/api/dashboard/analytics', async (_req, res) => {
  const records = await import('./db/store.js').then(store => store.listLedger());
  const categories = new Map<string, number>();
  for (const record of records.filter(item => item.status === 'CAPTURED')) {
    const category = String((record.product as { category?: string })?.category || 'Unknown');
    categories.set(category, (categories.get(category) || 0) + Number((record.product as { amount?: number })?.amount || 0));
  }
  res.json({ categories: Object.fromEntries(categories), daily: records.filter(item => item.status === 'CAPTURED').map(record => ({ date: record.createdAt.slice(0, 10), amount: Number((record.product as { amount?: number })?.amount || 0) })) });
});
app.get('/api/purchases', async (_req, res) => res.json(await import('./db/store.js').then(store => store.listLedger())));
app.use('/api/purchase', purchaseRouter);
app.use('/api/purchases', purchaseRouter);
app.use('/api/webhooks', webhookRouter);
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`AgentWallet API listening on http://localhost:${port}`));
