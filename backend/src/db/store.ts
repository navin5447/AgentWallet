import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import type { PurchaseStatus } from '../schemas/purchase.js';
import { pool } from './pool.js';

export type LedgerRecord = {
  id: string;
  task: string;
  product: Record<string, unknown>;
  guardrail: Record<string, unknown>;
  planner: Record<string, unknown> | null;
  auditor: Record<string, unknown> | null;
  status: PurchaseStatus;
  paypalOrderId?: string;
  paypalTransactionId?: string;
  createdAt: string;
  updatedAt: string;
};

const memory: LedgerRecord[] = [];
let client: MongoClient | undefined;

async function getCollection() {
  if (!process.env.MONGODB_URI) return null;
  client ??= new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  return client.db(process.env.MONGODB_DB || 'agentwallet').collection<LedgerRecord>('audit_log');
}

export async function saveLedger(input: Omit<LedgerRecord, 'id' | 'createdAt' | 'updatedAt'>) {
  const now = new Date().toISOString();
  const record: LedgerRecord = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
  if (pool) {
    await pool.query(
      `INSERT INTO purchase_evaluations
       (id, task, product, guardrail_result, planner_result, auditor_result, status, paypal_order_id, paypal_transaction_id, created_at, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $10)`,
      [record.id, record.task, JSON.stringify(record.product), JSON.stringify(record.guardrail), record.planner ? JSON.stringify(record.planner) : null, record.auditor ? JSON.stringify(record.auditor) : null, record.status, record.paypalOrderId || null, record.paypalTransactionId || null, now],
    );
    return record;
  }
  const collection = await getCollection();
  if (collection) await collection.insertOne(record);
  memory.unshift(record);
  return record;
}

export async function getLedger(id: string) {
  if (pool) {
    const result = await pool.query('SELECT * FROM purchase_evaluations WHERE id = $1', [id]);
    return result.rows[0] ? fromPostgresRow(result.rows[0]) : undefined;
  }
  const collection = await getCollection();
  if (collection) return collection.findOne({ id });
  return memory.find(record => record.id === id);
}

export async function updateLedger(id: string, changes: Partial<LedgerRecord>) {
  const updatedAt = new Date().toISOString();
  if (pool) {
    const fields: Record<string, unknown> = {
      status: changes.status,
      paypal_order_id: changes.paypalOrderId,
      paypal_transaction_id: changes.paypalTransactionId,
    };
    const updates = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (updates.length) {
      const set = updates.map(([field], index) => `${field} = $${index + 2}`).join(', ');
      await pool.query(`UPDATE purchase_evaluations SET ${set}, updated_at = $1 WHERE id = $${updates.length + 2}`, [updatedAt, ...updates.map(([, value]) => value), id]);
    }
    return getLedger(id);
  }
  const collection = await getCollection();
  if (collection) await collection.updateOne({ id }, { $set: { ...changes, updatedAt } });
  const record = memory.find(item => item.id === id);
  if (record) Object.assign(record, changes, { updatedAt });
  return record ?? await getLedger(id);
}

export async function listLedger() {
  if (pool) {
    const result = await pool.query('SELECT * FROM purchase_evaluations ORDER BY created_at DESC LIMIT 100');
    return result.rows.map(fromPostgresRow);
  }
  const collection = await getCollection();
  if (collection) return collection.find({}).sort({ createdAt: -1 }).limit(100).toArray();
  return memory;
}

export async function findByPayPalOrder(orderId: string) {
  if (pool) {
    const result = await pool.query('SELECT * FROM purchase_evaluations WHERE paypal_order_id = $1 LIMIT 1', [orderId]);
    return result.rows[0] ? fromPostgresRow(result.rows[0]) : undefined;
  }
  const collection = await getCollection();
  if (collection) return collection.findOne({ paypalOrderId: orderId });
  return memory.find(record => record.paypalOrderId === orderId);
}

export const CONFIRMED_PAYMENT_STATUSES: PurchaseStatus[] = ['CAPTURED'];

function fromPostgresRow(row: Record<string, unknown>): LedgerRecord {
  return {
    id: String(row.id),
    task: String(row.task),
    product: row.product as Record<string, unknown>,
    guardrail: row.guardrail_result as Record<string, unknown>,
    planner: row.planner_result as Record<string, unknown> | null,
    auditor: row.auditor_result as Record<string, unknown> | null,
    status: row.status as PurchaseStatus,
    paypalOrderId: row.paypal_order_id ? String(row.paypal_order_id) : undefined,
    paypalTransactionId: row.paypal_transaction_id ? String(row.paypal_transaction_id) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at || row.created_at)).toISOString(),
  };
}
