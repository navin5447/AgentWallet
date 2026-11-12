# AgentWallet backend — Phase 1

This starter implements the first purchase-evaluation pipeline:

1. Validate a task, supplied product and spending policy.
2. Run deterministic guardrails (budget, transaction cap, merchant/category allowlists).
3. Ask Gemini Planner whether the supplied product matches the task.
4. Ask a separate Gemini Auditor to approve, escalate or block.
5. Fail closed if Gemini errors or returns invalid output.
6. Persist the evaluation in PostgreSQL when `DATABASE_URL` is configured.

**No PayPal order or payment is created in Phase 1.** The API explicitly returns `paymentCreated: false`.

## Requirements

- Node.js 20+ recommended (Node 22 is a good choice for current Google SDK compatibility)
- PostgreSQL 14+
- Gemini API key from Google AI Studio

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set `GEMINI_API_KEY` and `DATABASE_URL`.

Create a PostgreSQL database named `agentwallet`, then apply the schema:

```bash
createdb agentwallet
psql "$DATABASE_URL" -f db-schema.sql
```

On Windows PowerShell, if `createdb` is not on PATH, create the database using pgAdmin, then run:

```powershell
psql $env:DATABASE_URL -f .\db-schema.sql
```

Run tests and start the API:

```bash
npm test
npm run dev
```

API: `http://localhost:4000`

## Health check

```bash
curl http://localhost:4000/health
```

## Evaluate a purchase

```bash
curl -X POST http://localhost:4000/api/purchase/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Buy a data structures book for my study group",
    "product": {
      "name": "Data Structures in C++",
      "merchant": "BookStore",
      "category": "Books",
      "amount": 35,
      "currency": "USD",
      "description": "A textbook covering arrays, trees and graphs."
    },
    "policy": {
      "totalBudget": 100,
      "spentAmount": 0,
      "reservedAmount": 0,
      "perTransactionLimit": 50,
      "approvalThreshold": 40,
      "allowedMerchants": ["BookStore"],
      "allowedCategories": ["Books"]
    }
  }'
```

Expected response status is one of:

- `blocked`
- `auditor_blocked`
- `needs_human_approval`
- `approved_for_checkout`

An `approved_for_checkout` result is **not** payment authorization. The PayPal checkout and buyer approval flow will be implemented in a later phase.

## Security notes

- Keep `GEMINI_API_KEY`, database credentials and future PayPal secrets on the backend only.
- This phase has no user authentication. Do not expose the API publicly.
- The policy is supplied by the caller in this development phase. Before production, load it from an authenticated user's persisted policy, never trust client-supplied policy values.
- Budget reservation, duplicate protection, signed webhooks and payment idempotency are required before enabling payment capture.
