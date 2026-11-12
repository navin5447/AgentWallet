import { Router } from 'express';
import { findByPayPalOrder, updateLedger } from '../db/store.js';
import { verifyWebhook } from '../paypal.js';

export const webhookRouter = Router();
const processedEvents = new Set<string>();

webhookRouter.post('/paypal', async (req, res) => {
  const event = req.body as { event_type?: string; resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } } };
  const eventId = String((event as { id?: string }).id || '');
  if (eventId && processedEvents.has(eventId)) return res.status(200).json({ received: true, duplicate: true });
  const valid = await verifyWebhook({
    'paypal-auth-algo': req.header('paypal-auth-algo') || undefined,
    'paypal-cert-url': req.header('paypal-cert-url') || undefined,
    'paypal-transmission-id': req.header('paypal-transmission-id') || undefined,
    'paypal-transmission-sig': req.header('paypal-transmission-sig') || undefined,
    'paypal-transmission-time': req.header('paypal-transmission-time') || undefined,
  }, event);
  if (!valid) return res.status(400).json({ error: 'Invalid PayPal webhook signature.' });
  if (eventId) processedEvents.add(eventId);
  const orderId = event.resource?.supplementary_data?.related_ids?.order_id || event.resource?.id;
  if (orderId) {
    const record = await findByPayPalOrder(orderId);
    if (record) {
      const status = event.event_type === 'PAYMENT.CAPTURE.COMPLETED'
        ? 'CAPTURED'
        : event.event_type === 'PAYMENT.CAPTURE.DENIED' ? 'FAILED' : record.status;
      await updateLedger(record.id, { status, paypalTransactionId: event.resource?.id });
    }
  }
  res.status(200).json({ received: true });
});
