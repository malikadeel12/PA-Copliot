import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import AppHeader from "@/components/AppHeader";
import { TrustBadge } from "@/components/TrustBadge";
import { Button } from "@/components/ui/button";
import {
  Camera, Mic, LayoutGrid, FileText, ArrowRight, Sparkles,
  ShieldCheck, Zap, CreditCard, Plus, Clock,
} from "lucide-react";

const STEPS = [
  { icon: Camera, title: "Capture", desc: "Snap the ID, insurance card & clinical order. AI reads them." },
  { icon: Mic, title: "Dictate", desc: "Speak the clinical narrative into a smart, slot-filling script." },
  { icon: LayoutGrid, title: "Validate", desc: "Confirm payer portal, code cross-walk, modifiers & quantity." },
  { icon: FileText, title: "Package", desc: "Get 4 panels + a submission-ready cover letter to export." },
];

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const noCredits = (user?.credits ?? 0) < 1;

  return (
    <div className="min-h-screen bg-stone-50">
      <AppHeader />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="animate-fade-in-up">
          <TrustBadge />
          <h1 className="mt-4 font-heading text-4xl sm:text-5xl font-semibold tracking-tight text-stone-900">
            Hello{user?.name ? `, ${user.name.split(" ")[0]}` : ""}.
          </h1>
          <p className="mt-3 text-stone-500 text-base max-w-2xl">
            Turn a prior-authorization request into a submission-ready package — a filled form, an approval-likelihood analysis, ranked suggestions, and a cover letter — in under five minutes.
          </p>
        </div>

        {/* Primary CTA */}
        <div className="mt-8 grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-8 text-white shadow-lg shadow-emerald-600/20">
            <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-white/10" />
            <div className="absolute -right-12 top-16 w-56 h-56 rounded-full bg-white/5" />
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-semibold uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5" /> New PA request
              </div>
              <h2 className="mt-4 font-heading text-2xl sm:text-3xl font-semibold tracking-tight">Start a new prior authorization</h2>
              <p className="mt-2 text-emerald-50/90 text-sm max-w-md">
                Each completed analysis uses 1 credit. Nothing is stored — the session purges on export.
              </p>
              <Button
                data-testid="start-request-btn"
                onClick={() => (noCredits ? navigate("/buy-credits") : navigate("/new-request"))}
                className="mt-6 h-12 px-6 bg-white text-emerald-700 hover:bg-emerald-50 font-semibold rounded-xl active:scale-[0.98] transition-all"
              >
                {noCredits ? "Buy credits to start" : "Start request"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>

          {/* Credit card */}
          <div className="rounded-2xl bg-white border border-stone-200 p-6 flex flex-col shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-stone-500">Credit balance</span>
              <CreditCard className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span data-testid="dashboard-credit-count" className="font-mono text-5xl font-semibold tracking-tight text-stone-900">{user?.credits ?? 0}</span>
              <span className="text-stone-400 text-sm">credits</span>
            </div>
            <p className="mt-2 text-sm text-stone-500">1 credit = 1 full AI analysis + package.</p>
            <Button
              data-testid="buy-credits-btn"
              variant="outline" onClick={() => navigate("/buy-credits")}
              className="mt-auto h-11 border-stone-300 font-semibold rounded-xl hover:bg-stone-50"
            >
              <Plus className="w-4 h-4 mr-1" /> Buy more credits
            </Button>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-10">
          <h3 className="font-heading text-xl font-medium text-stone-800">How it works</h3>
          <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="rounded-2xl bg-white border border-stone-200 p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <s.icon className="w-5 h-5 text-emerald-600" />
                  </div>
                  <span className="font-mono text-xs text-stone-300 font-semibold">0{i + 1}</span>
                </div>
                <h4 className="mt-4 font-heading font-semibold text-stone-900">{s.title}</h4>
                <p className="mt-1 text-sm text-stone-500 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Privacy strip */}
        <div className="mt-10 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-emerald-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h4 className="font-heading font-semibold text-stone-900">Privacy by design</h4>
            <p className="text-sm text-stone-600 mt-0.5">
              We never store your patient's data. Documents, transcripts and AI results live only in memory for your active session (30-min max) and are wiped on export.
            </p>
          </div>
          <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium">
            <Clock className="w-4 h-4" /> 30-min TTL
          </div>
        </div>
      </main>
    </div>
  );
}
