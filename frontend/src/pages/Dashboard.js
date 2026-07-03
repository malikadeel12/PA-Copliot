import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api from "@/lib/api";
import AppShell from "@/components/AppShell";
import {
  Camera, Mic, LayoutGrid, FileText, ArrowRight,
  Plus, Clock, Activity, Lock, Zap, BarChart3, TrendingUp, ShoppingBag, CalendarDays,
} from "lucide-react";

const STEPS = [
  { icon: Camera, title: "Capture", desc: "Snap ID, insurance card & clinical order. Vision AI reads the fields." },
  { icon: Mic, title: "Dictate", desc: "Speak the clinical narrative into a slot-filling script." },
  { icon: LayoutGrid, title: "Validate", desc: "Confirm payer portal, code cross-walk, modifiers & quantity." },
  { icon: FileText, title: "Package", desc: "Get 4 panels + a submission-ready cover letter to export." },
];

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" }); }
  catch { return "—"; }
}
function fmtRelative(iso) {
  if (!iso) return "No activity yet";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return "—"; }
}

function StatsStrip() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.get("/stats").then(({ data }) => setStats(data)).catch(() => {});
  }, []);

  const cells = [
    { label: "Analyses run", value: stats?.total_analyses ?? "—", icon: TrendingUp },
    { label: "Credits used", value: stats?.credits_used ?? "—", icon: BarChart3 },
    { label: "Credits purchased", value: stats?.credits_purchased ?? "—", icon: ShoppingBag },
    { label: "Member since", value: fmtDate(stats?.member_since), icon: CalendarDays, mono: false },
  ];

  return (
    <div className="rounded-lg border border-stone-300 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-stone-200 bg-stone-50/70 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-stone-500">Activity</span>
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400">
          <Lock className="w-3 h-3" /> Anonymous · No PHI
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4">
        {cells.map((c, i) => (
          <div key={c.label} data-testid={`stat-${c.label.toLowerCase().replace(/ /g, "-")}`}
            className={`p-5 border-stone-200 ${i < cells.length - 1 ? "border-r" : ""} ${i < 2 ? "border-b md:border-b-0" : ""}`}>
            <div className="flex items-center gap-2 text-stone-400">
              <c.icon className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">{c.label}</span>
            </div>
            <div className={`mt-2 text-stone-900 leading-none ${c.mono === false ? "font-heading text-xl font-semibold" : "font-mono text-3xl font-semibold tracking-tight"}`}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 py-2.5 border-t border-stone-200 bg-stone-50/40 text-[11px] text-stone-400 font-mono flex items-center gap-1.5">
        <Clock className="w-3 h-3" /> Last activity: {fmtRelative(stats?.last_activity)}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const noCredits = (user?.credits ?? 0) < 1;
  const firstName = user?.name ? user.name.split(" ")[0] : "there";

  return (
    <AppShell title="Dashboard">
      {/* Greeting */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse-ring" /> Workspace · Live
          </div>
          <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">
            Good to see you, {firstName}.
          </h1>
          <p className="mt-2 text-stone-500 text-sm max-w-xl leading-relaxed">
            Turn a prior-authorization into a submission-ready package — filled form, approval-likelihood analysis, ranked fixes, and cover letter — in under five minutes.
          </p>
        </div>
      </div>

      {/* Stats strip */}
      <div className="mt-6">
        <StatsStrip />
      </div>

      {/* Control-room bento grid */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* Primary CTA */}
        <div className="md:col-span-7 relative overflow-hidden rounded-lg border border-stone-300 bg-white pa-noise">
          <div className="absolute inset-0 pa-grid-bg opacity-40" />
          <div className="relative p-8">
            <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-stone-400">
              <Zap className="w-3.5 h-3.5 text-emerald-700" /> New request
            </div>
            <h2 className="mt-4 font-heading text-2xl sm:text-3xl font-bold tracking-tight text-stone-900 max-w-sm leading-[1.1]">
              Start a new prior authorization
            </h2>
            <p className="mt-3 text-sm text-stone-500 max-w-md">
              Each completed analysis uses <span className="font-mono font-semibold text-stone-700">1 credit</span>. Nothing is stored — the session purges on export.
            </p>
            <button
              data-testid="start-request-btn"
              onClick={() => (noCredits ? navigate("/buy-credits") : navigate("/new-request"))}
              className="mt-7 inline-flex items-center gap-2 h-12 px-6 bg-emerald-900 hover:bg-emerald-800 text-white text-sm font-semibold rounded-md border border-emerald-950 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-900 focus:ring-offset-2"
            >
              {noCredits ? "Buy credits to start" : "Begin capture"}
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Credit balance */}
        <div className="md:col-span-5 rounded-lg border border-stone-300 bg-white p-6 flex flex-col">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-stone-500">Credit balance</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${noCredits ? "text-red-700 bg-red-50 border-red-200" : "text-emerald-700 bg-emerald-50 border-emerald-200"}`}>
              {noCredits ? "Empty" : "Active"}
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-2 border-b border-dashed border-stone-200 pb-4">
            <span data-testid="dashboard-credit-count" className="font-mono text-6xl font-semibold tracking-tighter text-stone-900 leading-none">{user?.credits ?? 0}</span>
            <span className="text-stone-400 text-xs uppercase tracking-wider">credits</span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-stone-500">
            <div className="w-6 h-6 rounded bg-stone-100 flex items-center justify-center"><Activity className="w-3.5 h-3.5 text-emerald-700" /></div>
            1 credit = 1 full AI analysis + package
          </div>
          <button
            data-testid="buy-credits-btn"
            onClick={() => navigate("/buy-credits")}
            className="mt-auto h-11 inline-flex items-center justify-center gap-1.5 border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 text-sm font-semibold rounded-md transition-colors"
          >
            <Plus className="w-4 h-4" /> Buy more credits
          </button>
        </div>

        {/* How it works */}
        <div className="md:col-span-8 rounded-lg border border-stone-300 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50/70 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-stone-500">How it works</span>
            <span className="font-mono text-[11px] text-stone-400">4 steps · &lt; 5 min</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            {STEPS.map((s, i) => (
              <div key={s.title} className={`p-5 flex gap-4 border-stone-200 ${i % 2 === 0 ? "sm:border-r" : ""} ${i < 2 ? "border-b" : ""}`}>
                <div className="w-10 h-10 shrink-0 rounded-md border border-stone-200 bg-stone-50 flex items-center justify-center">
                  <s.icon className="w-5 h-5 text-emerald-800" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-semibold text-stone-300">0{i + 1}</span>
                    <h4 className="font-heading font-semibold text-stone-900 text-sm">{s.title}</h4>
                  </div>
                  <p className="mt-1 text-xs text-stone-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Privacy / trust */}
        <div className="md:col-span-4 rounded-lg border border-emerald-800 bg-emerald-900 text-white p-6 flex flex-col relative overflow-hidden pa-noise">
          <div className="absolute inset-0 pa-grid-bg opacity-[0.07]" />
          <div className="relative">
            <div className="w-10 h-10 rounded-md bg-emerald-800 border border-emerald-700 flex items-center justify-center">
              <Lock className="w-5 h-5 text-emerald-300" />
            </div>
            <h4 className="mt-4 font-heading font-bold text-lg tracking-tight">Privacy by design</h4>
            <p className="mt-2 text-sm text-emerald-100/80 leading-relaxed">
              We never store your patient's data. Documents, transcripts & AI output live only in memory for your active session and are wiped on export.
            </p>
            <div className="mt-4 pt-4 border-t border-emerald-800 flex items-center gap-2 text-emerald-200 text-xs font-mono">
              <Clock className="w-3.5 h-3.5" /> 30-minute in-memory TTL
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
