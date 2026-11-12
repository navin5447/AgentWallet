import { z } from 'zod';

export const ProductInputSchema = z.object({
  name: z.string().min(1).max(160),
  merchant: z.string().min(1).max(120),
  category: z.string().min(1).max(80),
  amount: z.number().positive().finite(),
  quantity: z.number().int().positive().max(100).default(1),
  unitPrice: z.number().positive().finite().optional(),
  currency: z.string().length(3).transform(value => value.toUpperCase()).default('USD'),
  description: z.string().max(2000).optional().default(''),
});

export const PolicySchema = z.object({
  totalBudget: z.number().nonnegative().finite(),
  spentAmount: z.number().nonnegative().finite().default(0),
  reservedAmount: z.number().nonnegative().finite().default(0),
  perTransactionLimit: z.number().positive().finite(),
  approvalThreshold: z.number().nonnegative().finite(),
  allowedMerchants: z.array(z.string()).default([]),
  blockedMerchants: z.array(z.string()).default([]),
  allowedCategories: z.array(z.string()).default([]),
  blockedCategories: z.array(z.string()).default([]),
  perItemLimit: z.number().positive().finite().optional(),
  supportedCurrency: z.string().length(3).transform(value => value.toUpperCase()).default('USD'),
}).superRefine((p, ctx) => {
  if (p.spentAmount + p.reservedAmount > p.totalBudget) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Spent plus reserved funds cannot exceed the total budget.' });
  }
  if (p.perItemLimit !== undefined && p.perItemLimit > p.perTransactionLimit) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Per-item limit cannot exceed the transaction limit.' });
  }
});

export const EvaluatePurchaseSchema = z.object({
  task: z.string().min(5).max(1000),
  product: ProductInputSchema.optional(),
  policy: PolicySchema,
});

export const PlannerResultSchema = z.object({
  taskMatch: z.boolean(),
  rationale: z.string().min(1).max(500),
  proposal: z.object({
    merchant: z.string().min(1),
    item: z.string().min(1),
    amount: z.number().nonnegative(),
    reason: z.string().min(1),
  }).optional(),
});

export const AuditorResultSchema = z.object({
  decision: z.enum(['approve', 'escalate', 'block']),
  reason: z.string().min(1).max(500),
  risk_score: z.number().int().min(0).max(100).default(50),
  intent_match: z.boolean().default(false),
  product_category: z.string().min(1).max(80).optional(),
  merchant: z.string().min(1).max(120).optional(),
  verified_amount: z.number().nonnegative().finite().optional(),
  prompt_injection_detected: z.boolean().default(false),
  guardrail_passed: z.boolean().default(false),
});

export type ProductInput = z.infer<typeof ProductInputSchema>;
export type SpendingPolicy = z.infer<typeof PolicySchema>;
export const PurchaseStatusSchema = z.enum([
  'DRAFT', 'PLANNED', 'EVALUATED', 'PENDING_APPROVAL', 'APPROVED',
  'BLOCKED', 'ORDER_CREATED', 'BUYER_APPROVED', 'CAPTURED', 'CANCELLED', 'FAILED',
]);
export type PurchaseStatus = z.infer<typeof PurchaseStatusSchema>;
