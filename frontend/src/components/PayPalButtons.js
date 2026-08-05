// --- Change Summary ---
// What: PayPal Smart Buttons wrapper for credit-pack checkout.
// Why: BuyCredits must create/capture Orders v2 via our backend (secret stays server-side).
// Related: frontend/src/lib/paypal.js, POST /billing/create-order, POST /billing/capture-order/:id
// NOTE: Follows PayPal JS SDK Buttons pattern (createOrder / onApprove / onError).

import React, { useEffect, useRef, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import {
  loadPayPalSdk,
  captureOrder,
  reportPayPalError,
  isPayPalConfigured,
} from "@/lib/paypal";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Renders PayPal Smart Buttons for one credit pack.
 * Business rule: amount/credits are decided server-side from `packId` —
 * the browser never chooses the price.
 */
export default function PayPalButtons({ packId, onPaid, disabled = false }) {
  const hostRef = useRef(null);
  const buttonsRef = useRef(null);
  // Keep latest onPaid without re-mounting Smart Buttons on every parent render.
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState(null);

  useEffect(() => {
    if (!isPayPalConfigured() || disabled) return undefined;
    let cancelled = false;
    setReady(false);
    setBootError(null);

    (async () => {
      try {
        const paypal = await loadPayPalSdk();
        if (cancelled || !hostRef.current) return;

        // Tear down any previous Buttons instance before re-rendering
        // (React Strict Mode / pack switch would otherwise stack iframes).
        if (buttonsRef.current?.close) {
          try { buttonsRef.current.close(); } catch { /* ignore */ }
          buttonsRef.current = null;
        }
        hostRef.current.innerHTML = "";

        const buttons = paypal.Buttons({
          style: {
            layout: "vertical",
            color: "gold",
            shape: "rect",
            label: "pay",
            height: 44,
          },
          // --- Create order on our server (source of truth for price) ---
          createOrder: async () => {
            const { data } = await api.post("/billing/create-order", { pack: packId });
            if (!data?.orderId) throw new Error("No order id returned from server");
            return data.orderId;
          },
          // --- Buyer approved — capture + credit their account ---
          onApprove: async (data) => {
            try {
              const result = await captureOrder(api, data.orderID);
              if (result?.user && onPaidRef.current) {
                onPaidRef.current(result.user, result);
              } else if (result?.ok === false) {
                // PayPal returned PENDING / non-COMPLETED — money may settle later.
                toast.message(
                  result.detail ||
                    `Payment status: ${result.status || "pending"}. Credits will appear once PayPal confirms.`
                );
              }
              return result;
            } catch (err) {
              reportPayPalError(err);
              throw err;
            }
          },
          onCancel: () => {
            reportPayPalError({ code: "CHECKOUT_SESSION_CANCELLED" });
          },
          onError: (err) => {
            reportPayPalError(err);
          },
        });

        if (!buttons.isEligible()) {
          setBootError("PayPal checkout isn’t available in this browser. Try Chrome or Safari.");
          return;
        }
        await buttons.render(hostRef.current);
        buttonsRef.current = buttons;
        if (!cancelled) setReady(true);
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setBootError(
            formatApiError(e?.response?.data?.detail) ||
              "Could not load PayPal checkout. Please refresh and try again."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (buttonsRef.current?.close) {
        try { buttonsRef.current.close(); } catch { /* ignore */ }
        buttonsRef.current = null;
      }
    };
  }, [packId, disabled]);

  if (!isPayPalConfigured()) {
    return (
      <p className="text-xs text-stone-500 text-center">
        PayPal is not configured for this environment.
      </p>
    );
  }

  return (
    <div className="mt-6 min-h-[48px]" data-testid={`paypal-buttons-${packId}`}>
      {!ready && !bootError && (
        <div className="flex items-center justify-center h-11 text-stone-400">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}
      {bootError && (
        <p className="text-xs text-red-600 text-center">{bootError}</p>
      )}
      <div ref={hostRef} className={ready ? "" : "sr-only"} />
    </div>
  );
}
