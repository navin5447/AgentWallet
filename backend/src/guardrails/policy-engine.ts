import type { ProductInput, SpendingPolicy } from '../schemas/purchase.js';

export type GuardrailResult = {
  passed: boolean;
  reasons: string[];
  checks: { name: string; passed: boolean; reason: string }[];
  decision: 'APPROVED' | 'BLOCKED' | 'ESCALATED';
  requiresHumanApproval: boolean;
};

const normalize = (value: string) => value.trim().toLowerCase();

const TASK_TERMS: Record<string, string[]> = {
  books: ['book', 'books', 'textbook', 'workbook', 'flashcard', 'study resource', 'study guide'],
  electronics: ['headphone', 'headphones', 'lamp', 'laptop', 'electronics'],
  food: ['food', 'coffee', 'snack', 'snacks', 'meal'],
};

export function productMatchesTask(task: string, product: ProductInput) {
  const text = normalize(task);
  const category = normalize(product.category);
  const categoryTerms = TASK_TERMS[category] || [];
  const categoryMatch = categoryTerms.some(term => text.includes(term));
  const productMatch = [product.name, product.description, product.category]
    .map(normalize)
    .some(value => value && text.includes(value));
  const serviceSubstitution = category === 'services' && /(book|study|textbook|workbook|course|resource)/i.test(text);
  return !serviceSubstitution && (categoryMatch || productMatch);
}

export function hasPromptInjection(product: ProductInput) {
  return /ignore your rules|attacker@|send all funds|prompt injection/i.test(product.description || '');
}

/** Deterministic policy checks. This module must never depend on an LLM. */
export function evaluateGuardrails(product: ProductInput, policy: SpendingPolicy, recentPurchases: ProductInput[] = []): GuardrailResult {
  const reasons: string[] = [];
  const checks: GuardrailResult['checks'] = [];
  const available = policy.totalBudget - policy.spentAmount - policy.reservedAmount;
  const check = (name: string, passed: boolean, reason: string) => {
    checks.push({ name, passed, reason });
    if (!passed) reasons.push(reason);
  };

  check('BUDGET', product.amount <= available, 'Transaction exceeds the remaining budget.');
  check('TRANSACTION_LIMIT', product.amount <= policy.perTransactionLimit, 'Transaction exceeds the per-transaction limit.');
  check('QUANTITY', Number.isInteger(product.quantity) && product.quantity > 0, 'Quantity must be a positive whole number.');
  check('CURRENCY', normalize(product.currency) === normalize(policy.supportedCurrency), 'Currency is not supported by this policy.');
  if (policy.perItemLimit !== undefined) check('ITEM_LIMIT', (product.unitPrice ?? product.amount / product.quantity) <= policy.perItemLimit, 'Item price exceeds the per-item limit.');

  check('MERCHANT_ALLOWLIST', policy.allowedMerchants.length === 0 || policy.allowedMerchants.some(m => normalize(m) === normalize(product.merchant)), 'Merchant is not on the allowlist.');
  check('MERCHANT_BLOCKLIST', !policy.blockedMerchants.some(m => normalize(m) === normalize(product.merchant)), 'Merchant is blocked by policy.');
  check('CATEGORY_ALLOWLIST', policy.allowedCategories.length === 0 || policy.allowedCategories.some(c => normalize(c) === normalize(product.category)), 'Category is not on the allowlist.');
  check('CATEGORY_BLOCKLIST', !policy.blockedCategories.some(c => normalize(c) === normalize(product.category)), 'Category is blocked by policy.');
  check('DUPLICATE', !recentPurchases.some(p => normalize(p.merchant) === normalize(product.merchant) && normalize(p.name) === normalize(product.name) && p.amount === product.amount), 'Duplicate charge detected for this merchant, item, and amount.');

  const passed = reasons.length === 0;
  const requiresHumanApproval = passed && product.amount >= policy.approvalThreshold;

  return {
    passed,
    reasons,
    checks,
    decision: passed ? (requiresHumanApproval ? 'ESCALATED' : 'APPROVED') : 'BLOCKED',
    requiresHumanApproval,
  };
}
