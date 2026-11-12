CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS purchase_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  task TEXT NOT NULL,
  product JSONB NOT NULL,
  guardrail_result JSONB NOT NULL,
  planner_result JSONB,
  auditor_result JSONB,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PLANNED', 'EVALUATED', 'PENDING_APPROVAL', 'APPROVED', 'BLOCKED', 'ORDER_CREATED', 'BUYER_APPROVED', 'CAPTURED', 'CANCELLED', 'FAILED')),
  paypal_order_id TEXT,
  paypal_transaction_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_evaluations_created_at ON purchase_evaluations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_evaluations_status ON purchase_evaluations (status);
CREATE INDEX IF NOT EXISTS idx_purchase_evaluations_user_id ON purchase_evaluations (user_id);
