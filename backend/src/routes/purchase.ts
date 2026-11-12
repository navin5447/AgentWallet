import { Router } from 'express';
import { EvaluatePurchaseSchema, type ProductInput, type PurchaseStatus } from '../schemas/purchase.js';
import { evaluateGuardrails, hasPromptInjection, productMatchesTask } from '../guardrails/policy-engine.js';
import { runAuditor, runPlanner } from '../agents/gemini.js';
import { catalog } from '../catalog.js';
import { captureOrder, createOrder } from '../paypal.js';
import { getLedger, listLedger, saveLedger, updateLedger } from '../db/store.js';

export const purchaseRouter = Router();
const pipeline = (
  status: PurchaseStatus,
  auditor: Record<string, unknown> | null = null,
  planner: Record<string, unknown> | null = null,
) => ({
  planner: planner || ['PLANNED', 'EVALUATED', 'PENDING_APPROVAL', 'APPROVED', 'ORDER_CREATED', 'BUYER_APPROVED', 'CAPTURED'].includes(status)
    ? 'COMPLETED'
    : status === 'DRAFT' ? 'WAITING' : 'FAILED',
  guardrails: ['EVALUATED', 'PENDING_APPROVAL', 'APPROVED', 'ORDER_CREATED', 'BUYER_APPROVED', 'CAPTURED'].includes(status) ? 'COMPLETED' : status === 'BLOCKED' ? 'BLOCKED' : 'WAITING',
  auditor: ['PENDING_APPROVAL', 'APPROVED', 'ORDER_CREATED', 'BUYER_APPROVED', 'CAPTURED'].includes(status) ? 'COMPLETED' : status === 'BLOCKED' ? (auditor ? 'BLOCKED' : 'SKIPPED') : 'WAITING',
  payment: status === 'CAPTURED' ? 'CAPTURED' : status === 'ORDER_CREATED' ? 'ORDER_CREATED' : status === 'BUYER_APPROVED' ? 'BUYER_APPROVED' : 'WAITING',
});

export function canCreatePayPalOrder(record: { status: PurchaseStatus; guardrail: Record<string, unknown>; auditor: Record<string, unknown> | null }) {
  return record.status === 'APPROVED'
    && record.guardrail.passed === true
    && (record.auditor?.decision === 'approve');
}

purchaseRouter.get('/audit-log', async (_req, res) => res.json(await listLedger()));

purchaseRouter.post('/evaluate', async (req, res) => {
  const parsed = EvaluatePurchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
  const { task, policy } = parsed.data;
  let product = parsed.data.product ?? catalog[0];
  let planner: Awaited<ReturnType<typeof runPlanner>> | null = null;
  let auditor: Awaited<ReturnType<typeof runAuditor>> | null = null;
  let status: PurchaseStatus = 'DRAFT';
  const previousProducts = (await listLedger())
    .filter(record => record.status === 'CAPTURED')
    .map(record => record.product as ProductInput);
  let guardrail = evaluateGuardrails(product, policy, previousProducts);
  let explanation = '';

  try {
    planner = await runPlanner(task, product);
    status = 'PLANNED';
    const semanticMatch = productMatchesTask(task, product);
    if (!semanticMatch) {
      planner = { ...planner, taskMatch: false, rationale: 'The product does not semantically match the requested task; a service or unrelated item cannot substitute for the requested product.' };
    }
    if (!parsed.data.product) {
      const candidates = await Promise.all(catalog.map(async candidate => ({ candidate, plan: await runPlanner(task, candidate) })));
      const match = candidates.find(item => item.plan.taskMatch && productMatchesTask(task, item.candidate));
      if (match) {
        product = match.candidate;
        planner = match.plan;
        guardrail = evaluateGuardrails(product, policy, previousProducts);
      }
    }
    status = 'EVALUATED';
    if (hasPromptInjection(product) || !planner.taskMatch) {
      status = 'BLOCKED';
      explanation = hasPromptInjection(product)
        ? 'Blocked because untrusted merchant/product data contains prompt-injection instructions.'
        : planner.rationale;
    } else if (!guardrail.passed) {
      status = 'BLOCKED';
      explanation = guardrail.reasons.join(' ');
    } else {
      auditor = await runAuditor(task, product, guardrail);
      if (auditor.prompt_injection_detected || auditor.decision === 'block') {
        status = 'BLOCKED';
        explanation = auditor.reason;
      } else if (auditor.decision === 'escalate' || guardrail.requiresHumanApproval) {
        status = 'PENDING_APPROVAL';
        explanation = auditor.reason;
      } else {
        status = 'APPROVED';
        explanation = auditor.reason;
      }
    }
  } catch (error) {
    status = 'FAILED';
    explanation = error instanceof Error ? error.message : 'Evaluation failed.';
  }

  const record = await saveLedger({ task, product, guardrail, planner, auditor, status });
  return res.json({
    evaluationId: record.id, status, product, guardrail, planner, auditor, pipeline: pipeline(status, auditor, planner),
    explanation, paymentCreated: false,
    message: status === 'APPROVED' || status === 'PENDING_APPROVAL' ? 'Checks completed. Payment has not been created.' : 'No payment was created.',
  });
});

async function createForEvaluation(evaluationId: string) {
  const record = await getLedger(evaluationId);
  if (!record) throw new Error('Evaluation not found.');
  if (!canCreatePayPalOrder({ status: record.status, guardrail: record.guardrail, auditor: record.auditor })) {
    throw new Error(`PayPal order blocked because the evaluation is not approved (current status: ${record.status}).`);
  }
  const product = record.product as { amount: number; currency: string; name: string };
  const order = await createOrder(product.amount, product.currency, product.name);
  await updateLedger(evaluationId, { paypalOrderId: order.id, status: 'ORDER_CREATED' });
  return order;
}

purchaseRouter.post('/:evaluationId/approve', async (req, res) => {
  const record = await getLedger(req.params.evaluationId);
  if (!record) return res.status(404).json({ error: 'Evaluation not found.' });
  if (req.body.approved !== true) {
    await updateLedger(record.id, { status: 'CANCELLED' });
    return res.json({ status: 'CANCELLED', pipeline: pipeline('CANCELLED'), explanation: 'Human approval was rejected.' });
  }
  if (!['PENDING_APPROVAL', 'APPROVED'].includes(record.status)) return res.status(409).json({ error: `Cannot approve a ${record.status} purchase.` });
  await updateLedger(record.id, { status: 'APPROVED' });
  try {
    const order = await createForEvaluation(record.id);
    return res.json({ status: 'ORDER_CREATED', pipeline: pipeline('ORDER_CREATED'), orderId: order.id, approvalUrl: order.links?.find(link => link.rel === 'approve')?.href });
  } catch (error) {
    await updateLedger(record.id, { status: 'FAILED' });
    return res.status(502).json({ error: error instanceof Error ? error.message : 'PayPal unavailable.' });
  }
});

purchaseRouter.post('/:evaluationId/order', async (req, res) => {
  try {
    const order = await createForEvaluation(req.params.evaluationId);
    return res.json({ status: 'ORDER_CREATED', pipeline: pipeline('ORDER_CREATED'), orderId: order.id, approvalUrl: order.links?.find(link => link.rel === 'approve')?.href });
  } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : 'PayPal unavailable.' });
  }
});

purchaseRouter.post('/:evaluationId/capture', async (req, res) => {
  const record = await getLedger(req.params.evaluationId);
  if (!record?.paypalOrderId) return res.status(400).json({ error: 'No PayPal order exists for this evaluation.' });
  await updateLedger(record.id, { status: 'BUYER_APPROVED' });
  try {
    const payment = await captureOrder(record.paypalOrderId);
    const transactionId = payment.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    const captured = payment.status === 'COMPLETED' && Boolean(transactionId);
    await updateLedger(record.id, { status: captured ? 'CAPTURED' : 'FAILED', paypalTransactionId: transactionId });
    return res.json({ status: captured ? 'CAPTURED' : 'FAILED', transactionId, verified: captured, pipeline: pipeline(captured ? 'CAPTURED' : 'FAILED') });
  } catch (error) {
    await updateLedger(record.id, { status: 'FAILED' });
    return res.status(502).json({ error: error instanceof Error ? error.message : 'PayPal unavailable.' });
  }
});
