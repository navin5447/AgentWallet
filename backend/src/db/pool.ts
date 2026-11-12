import pg from 'pg';
const { Pool } = pg;

export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 })
  : null;

export async function saveEvaluation(input: {
  task: string; product: object; guardrail: object; planner: object | null; auditor: object | null; status: string;
}) {
  if (!pool) return null; // Allows policy unit tests and local API exploration without PostgreSQL.
  const result = await pool.query(
    `INSERT INTO purchase_evaluations (task, product, guardrail_result, planner_result, auditor_result, status)
     VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6) RETURNING id, created_at`,
    [input.task, JSON.stringify(input.product), JSON.stringify(input.guardrail), input.planner ? JSON.stringify(input.planner) : null, input.auditor ? JSON.stringify(input.auditor) : null, input.status],
  );
  return result.rows[0] as { id: string; created_at: Date };
}
