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
                <Button data-testid={`buy-pack-${p.id}`} onClick={() => buy(p.id)} disabled={busy === p.id}
                  className={`mt-6 h-11 font-semibold rounded-md border transition-colors ${p.highlight ? "bg-emerald-900 hover:bg-emerald-800 text-white border-emerald-950" : "bg-white hover:bg-stone-50 text-stone-900 border-stone-300"}`}>
                  {busy === p.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Zap className="w-4 h-4 mr-1.5" /> Get {p.credits} credits</>}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
