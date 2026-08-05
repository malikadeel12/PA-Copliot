// --- Change Summary ---
// What: PayPal JS SDK loader + capture helper for credit checkout.
// Why: Browser only needs the public client id; capture goes through our API.
// Related: frontend/src/components/PayPalButtons.js, backend-node/src/paypal.js

import { toast } from "sonner";

const CLIENT_ID = process.env.REACT_APP_PAYPAL_CLIENT_ID || "";

let _loading = null;
let _sdk = null;

export function isPayPalConfigured() {
  return Boolean(CLIENT_ID);
}

// Load the PayPal JS SDK once and cache the promise so multiple PayPalButtons
// instances in the same view share one network round-trip. The SDK exposes
// `window.paypal` after load. Sandbox vs live is inferred from the client id.
export function loadPayPalSdk() {
  if (!CLIENT_ID) {
    return Promise.reject(new Error("REACT_APP_PAYPAL_CLIENT_ID is not set"));
  }
  if (_sdk) return Promise.resolve(_sdk);
  if (_loading) return _loading;

  _loading = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("PayPal SDK can only load in a browser"));
      return;
    }
    if (window.paypal && window.paypal.Buttons) {
      _sdk = window.paypal;
      resolve(_sdk);
      return;
    }
    const existing = document.getElementById("paypal-sdk");
    if (existing) {
      existing.addEventListener("load", () => {
        _sdk = window.paypal;
        if (_sdk) resolve(_sdk);
        else reject(new Error("PayPal SDK loaded but window.paypal is missing"));
      });
      existing.addEventListener("error", () => reject(new Error("PayPal SDK failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.id = "paypal-sdk";
    // commit=true matches user_action: PAY_NOW on the server order.
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      CLIENT_ID
    )}&components=buttons&intent=capture&currency=USD&commit=true`;
    script.async = true;
    script.onload = () => {
      _sdk = window.paypal;
      if (_sdk) resolve(_sdk);
      else reject(new Error("PayPal SDK loaded but window.paypal is missing"));
    };
    script.onerror = () => reject(new Error("PayPal SDK failed to load"));
    document.body.appendChild(script);
  }).catch((err) => {
    _loading = null;
    throw err;
  });
  return _loading;
}

// Convenience: call this when an order is captured. Surfaces a toast and
// resolves with the user payload returned by /billing/capture-order/:id so
// callers can refresh their own auth state from it.
export async function captureOrder(api, orderId) {
  const { data } = await api.post(`/billing/capture-order/${orderId}`);
  return data;
}

// PayPal Buttons reject their promise when the buyer cancels; we don't want
// to render that as a scary red error toast. The page surfaces a softer
// "cancelled" message instead.
export function isBuyerCancelled(err) {
  if (!err) return false;
  const code = err?.details?.[0]?.issue || err?.code;
  return (
    code === "CHECKOUT_SESSION_CANCELLED" ||
    code === "INSTRUMENT_DECLINED" ||
    code === "PAYER_ACTION_REQUIRED"
  );
}

// Suppress the toast for benign errors; rethrow for real ones so the
// PayPal Button's onError can still log them.
export function reportPayPalError(err, { onCancel } = {}) {
  if (isBuyerCancelled(err)) {
    if (onCancel) onCancel(err);
    else toast.message("Checkout cancelled — no charges were made.");
    return;
  }
  console.error("PayPal error:", err);
  toast.error(
    err?.details?.[0]?.description ||
      err?.message ||
      "PayPal could not complete the payment. Please try again."
  );
}
