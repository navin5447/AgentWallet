import { Router } from 'express';
import { attackProduct, catalog } from '../catalog.js';
import { evaluateGuardrails } from '../guardrails/policy-engine.js';
import { runAuditor, runPlanner } from '../agents/gemini.js';

export const attackLabRouter = Router();
attackLabRouter.get('/history', (_req, res) => res.json([]));
attackLabRouter.post('/simulate', async (req, res) => {
  const scenario = String(req.body?.scenario || 'prompt_injection');
  const product = scenario === 'currency_tampering'
    ? { ...catalog[0], currency: 'EUR' }
    : scenario === 'quantity_manipulation'
      ? { ...catalog[0], quantity: 999, amount: 35 }
      : attackProduct;
  const policy = { totalBudget: 100, spentAmount: 0, reservedAmount: 0, perTransactionLimit: 50, approvalThreshold: 40, allowedMerchants: ['BookStore'], blockedMerchants: [], allowedCategories: ['Books'], blockedCategories: [], supportedCurrency: 'USD' };
  const guardrail = evaluateGuardrails(product, policy);
  let planner = null;
  let auditor = null;
  try { planner = await runPlanner('Purchase a safe study resource for my group under $40.', product); auditor = await runAuditor('Purchase a safe study resource for my group under $40.', product, guardrail); } catch (error) {
    auditor = { decision: 'block' as const, risk_score: 100, reason: error instanceof Error ? error.message : 'Auditor unavailable; blocked.' };
  }
  return res.json({ scenario, originalIntent: 'Purchase a safe study resource for my group under $40.', maliciousContent: product.description, product, planner, guardrail, auditor, finalDecision: !guardrail.passed || auditor.decision === 'block' ? 'BLOCKED' : 'ESCALATED' });
});
