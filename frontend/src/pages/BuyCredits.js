import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api, { formatApiError } from "@/lib/api";
import AppHeader from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, Zap } from "lucide-react";

const PACKS = [
  { id: "starter", name: "Starter", credits: 10, price: 39, per: "$3.90 / request", highlight: false },
  { id: "pro", name: "Practice", credits: 30, price: 99, per: "$3.30 / request", highlight: true },
  { id: "clinic", name: "Clinic", credits: 100, price: 279, per: "$2.79 / request", highlight: false },
];

export default function BuyCredits() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);

  const buy = async (pack) => {
    setBusy(pack);
    try {
      const { data } = await api.post("/billing/mock-purchase", { pack });
      setUser(data);
      toast.success(`Added ${PACKS.find((p) => p.id === pack).credits} credits`);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <AppHeader />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 animate-fade-in-up">
        <button data-testid="credits-back" onClick={() => navigate("/dashboard")} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="mt-4 text-center max-w-xl mx-auto">
          <h1 className="font-heading text-4xl font-semibold tracking-tight text-stone-900">Buy credits</h1>
          <p className="mt-2 text-stone-500">
            You currently have <span className="font-mono font-semibold text-emerald-700">{user?.credits ?? 0}</span> credits.
            Each completed PA analysis uses 1 credit.
          </p>
          <p className="mt-2 text-xs text-stone-400 uppercase tracking-wider">Demo checkout — no real payment processed yet</p>
        </div>

        <div className="mt-10 grid sm:grid-cols-3 gap-6">
          {PACKS.map((p) => (
            <div key={p.id}
              className={`relative rounded-2xl border p-6 flex flex-col ${p.highlight ? "border-emerald-500 bg-white shadow-lg shadow-emerald-600/10 ring-1 ring-emerald-500" : "border-stone-200 bg-white shadow-sm"}`}>
              {p.highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-emerald-600 text-white text-xs font-semibold rounded-full uppercase tracking-wider">Most popular</span>
              )}
              <h3 className="font-heading text-lg font-semibold text-stone-900">{p.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="font-mono text-4xl font-semibold text-stone-900">${p.price}</span>
              </div>
              <div className="mt-1 text-sm text-stone-500">{p.credits} credits · {p.per}</div>
              <ul className="mt-5 space-y-2 text-sm text-stone-600 flex-1">
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> {p.credits} full AI analyses</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> 4-panel package + export</li>
                <li className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-600" /> Zero data retention</li>
              </ul>
              <Button data-testid={`buy-pack-${p.id}`} onClick={() => buy(p.id)} disabled={busy === p.id}
                className={`mt-6 h-11 font-semibold rounded-md border transition-colors ${p.highlight ? "bg-emerald-900 hover:bg-emerald-800 text-white border-emerald-950" : "bg-white hover:bg-stone-50 text-stone-900 border-stone-300"}`}>
                {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Zap className="w-4 h-4 mr-1.5" /> Get {p.credits} credits</>}
              </Button>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
