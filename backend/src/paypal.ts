const apiBase = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('PayPal Sandbox credentials are missing. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
  }
  const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch(`${apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw new Error(`PayPal authentication failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return (await response.json() as { access_token: string }).access_token;
}

export async function createOrder(amount: number, currency: string, description: string) {
  const token = await getAccessToken();
  const origin = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  const response = await fetch(`${apiBase}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ description, amount: { currency_code: currency, value: amount.toFixed(2) } }],
      application_context: { user_action: 'PAY_NOW', return_url: `${origin}/?paypal=success`, cancel_url: `${origin}/?paypal=cancelled` },
    }),
  });
  if (!response.ok) throw new Error(`PayPal order creation failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return await response.json() as { id: string; links?: { rel: string; href: string }[] };
}

export async function captureOrder(orderId: string) {
  const token = await getAccessToken();
  const response = await fetch(`${apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`PayPal capture failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
  return await response.json() as { id: string; status: string; purchase_units?: { payments?: { captures?: { id: string }[] } }[] };
}

export async function verifyWebhook(headers: Record<string, string | undefined>, event: unknown) {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return process.env.NODE_ENV !== 'production';
  const token = await getAccessToken();
  const response = await fetch(`${apiBase}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: event,
    }),
  });
  if (!response.ok) return false;
  return (await response.json() as { verification_status?: string }).verification_status === 'SUCCESS';
}
