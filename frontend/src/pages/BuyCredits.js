// --- Change Summary ---
// What: Pricing page — PayPal checkout only (no demo/mock credit purchase).
// Why: Real PayPal orders are the only credit path; demo credits removed.
// Related: PayPalButtons.js, REACT_APP_PAYPAL_CLIENT_ID, POST /billing/create-order

import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import AppShell from "@/components/AppShell";
import PayPalButtons from "@/components/PayPalButtons";
import { isPayPalConfigured } from "@/lib/paypal";
import { toast } from "sonner";
import { ArrowLeft, Check, AlertCircle } from "lucide-react";

const PACKS = [
  { id: "starter", name: "Starter", credits: 10, price: 39, per: "$3.90 / request", highlight: false },
  { id: "pro", name: "Practice", credits: 30, price: 99, per: "$3.30 / request", highlight: true },
  { id: "clinic", name: "Clinic", credits: 100, price: 279, per: "$2.79 / request", highlight: false },
];

export default function BuyCredits() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const paypalReady = isPayPalConfigured();

  const handlePaid = useCallback((updatedUser) => {
    setUser(updatedUser);
    toast.success("Payment received — credits added to your account.");
  }, [setUser]);

  return (
    <AppShell title="Billing & credits">
      <div className="max-w-5xl mx-auto animate-fade-in-up">
        <button data-testid="credits-back" onClick={() => navigate("/dashboard")} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="mt-4 text-center max-w-xl mx-auto">
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-stone-900">Buy credits</h1>
          <p className="mt-2 text-stone-500">
            You currently have <span className="font-mono font-semibold text-emerald-700">{user?.credits ?? 0}</span> credits.
            Each completed PA analysis uses 1 credit.
          </p>
          <p className="mt-2 text-xs text-stone-400 uppercase tracking-wider">
            {paypalReady ? "Secure checkout powered by PayPal" : "PayPal checkout unavailable"}
          </p>
        </div>

        {!paypalReady && (
          <div className="mt-6 max-w-xl mx-auto flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" data-testid="paypal-missing-banner">
            <AlertCircle className="w-5 h-5 shrink-0 text-amber-700" />
            <div>
              <p className="font-semibold">PayPal is not loaded in this browser session.</p>
              <p className="mt-1 text-amber-800/90">
                Restart the frontend app so it picks up the PayPal client ID, then refresh this page.
              </p>
            </div>
          </div>
        )}

        <div className="mt-10 grid sm:grid-cols-3 gap-5">
          {PACKS.map((p) => (
            <div key={p.id}
              className={`relative rounded-lg border bg-white flex flex-col overflow-hidden transition-colors ${p.highlight ? "border-emerald-900 ring-1 ring-emerald-900" : "border-stone-300 hover:border-stone-400"}`}>
              <div className={`px-6 py-3 border-b flex items-center justify-between ${p.highlight ? "border-emerald-800 bg-emerald-900 text-white" : "border-stone-200 bg-stone-50/70 text-stone-500"}`}>
                <span className="text-[11px] font-bold uppercase tracking-[0.15em]">{p.name}</span>
                {p.highlight && <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-800 border border-emerald-700 text-emerald-200">Popular</span>}
              </div>
              <div className="p-6 flex flex-col flex-1">
                <div className="flex items-baseline gap-1.5 border-b border-dashed border-stone-200 pb-4">
                  <span className="font-mono text-5xl font-semibold tracking-tighter text-stone-900 leading-none">${p.price}</span>
                </div>
                <div className="mt-3 text-sm text-stone-500"><span className="font-mono font-semibold text-stone-700">{p.credits}</span> credits · {p.per}</div>
                <ul className="mt-5 space-y-2.5 text-sm text-stone-600 flex-1">
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> {p.credits} full AI analyses</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> 4-panel package + export</li>
                  <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-700 shrink-0" /> Zero data retention</li>
                </ul>

                {paypalReady ? (
                  <PayPalButtons packId={p.id} onPaid={handlePaid} />
                ) : (
                  <p className="mt-6 text-center text-xs text-stone-400" data-testid={`buy-pack-${p.id}-disabled`}>
                    PayPal buttons unavailable
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
