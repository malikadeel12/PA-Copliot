// Minimal PayPal Orders v2 client. We avoid the @paypal/checkout-server-sdk
// because it pulls in a heavier http-client that we don't need; the REST
// endpoints here are documented at:
//   https://developer.paypal.com/docs/api/orders/v2/
//   https://developer.paypal.com/docs/api/reference/get-access-token/

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
const LIVE_BASE = "https://api-m.paypal.com";

function baseUrl() {
  return (process.env.PAYPAL_ENV || "sandbox").toLowerCase() === "live" ? LIVE_BASE : SANDBOX_BASE;
}

function clientId() {
  const v = process.env.PAYPAL_CLIENT_ID;
  if (!v) throw new Error("PAYPAL_CLIENT_ID is not configured");
  return v;
}

function clientSecret() {
  const v = process.env.PAYPAL_CLIENT_SECRET;
  if (!v) throw new Error("PAYPAL_CLIENT_SECRET is not configured");
  return v;
}

// Cache the OAuth access token until it expires (PayPal returns `expires_in`,
// typically ~9 hours). A single process can serve many requests with one token.
let _token = null;
let _tokenExp = 0;

async function accessToken() {
  const now = Date.now();
  if (_token && now < _tokenExp - 60_000) return _token;
  const auth = Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
  const resp = await fetch(`${baseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`PayPal auth failed: ${resp.status} ${body}`);
  }
  const json = await resp.json();
  _token = json.access_token;
  _tokenExp = now + (json.expires_in || 32400) * 1000;
  return _token;
}

async function paypalFetch(path, opts = {}) {
  const token = await accessToken();
  const resp = await fetch(`${baseUrl()}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
  const text = await resp.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = text; }
  }
  if (!resp.ok) {
    const err = new Error(`PayPal ${path} ${resp.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
    err.status = resp.status;
    err.body = body;
    throw err;
  }
  return body;
}

// Create an order on PayPal's side. Returns the order id; we'll persist the
// pack + user mapping in our own DB before redirecting the buyer.
async function createOrder({ packId, credits, amountUSD, userId }) {
  return paypalFetch("/v2/checkout/orders", {
    method: "POST",
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: `${packId}_${userId}_${Date.now()}`,
          description: `PA Copilot — ${credits} credits (${packId})`,
          custom_id: JSON.stringify({ packId, credits, userId }),
          amount: {
            currency_code: "USD",
            value: amountUSD.toFixed(2),
            breakdown: {
              item_total: { currency_code: "USD", value: amountUSD.toFixed(2) },
            },
          },
          items: [
            {
              name: `PA Copilot — ${packId} pack`,
              description: `${credits} PA Copilot analysis credits`,
              quantity: "1",
              unit_amount: { currency_code: "USD", value: amountUSD.toFixed(2) },
              category: "DIGITAL_GOODS",
            },
          ],
        },
      ],
      application_context: {
        brand_name: "PA Copilot",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    }),
  });
}

// Capture an approved order. Returns the full PayPal order with status.
// This is the source of truth for crediting the buyer's account.
async function captureOrder(orderId) {
  return paypalFetch(`/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

// Look up an order (used for diagnostics / orphaned-order checks).
async function getOrder(orderId) {
  return paypalFetch(`/v2/checkout/orders/${orderId}`, { method: "GET" });
}

module.exports = {
  baseUrl,
  accessToken,
  createOrder,
  captureOrder,
  getOrder,
};
