import { Router } from 'express';
import { PolicySchema } from '../schemas/purchase.js';
let policy = PolicySchema.parse({ totalBudget: 250, perTransactionLimit: 75, approvalThreshold: 40 });
export const policyRouter = Router();
policyRouter.get('/', (_req, res) => res.json(policy));
policyRouter.post('/', (req, res) => {
  const parsed = PolicySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid policy.', details: parsed.error.flatten() });
  policy = parsed.data;
  return res.status(201).json(policy);
});
policyRouter.put('/', (req, res) => {
  const parsed = PolicySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid policy.', details: parsed.error.flatten() });
  policy = parsed.data;
  return res.json(policy);
});
