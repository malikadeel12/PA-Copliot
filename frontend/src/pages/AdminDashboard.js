import React, { useEffect, useState } from "react";
import api, { formatApiError } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Users, Stethoscope, ShieldAlert, Activity, ShoppingBag, Wallet,
  Chrome, Plus, Loader2, ShieldCheck,
} from "lucide-react";

const OVERVIEW_CELLS = [
  { key: "total_users", label: "Total users", icon: Users },
  { key: "total_physicians", label: "Physicians", icon: Stethoscope },
  { key: "total_admins", label: "Admins", icon: ShieldAlert },
  { key: "google_users", label: "Google sign-ins", icon: Chrome },
  { key: "total_analyses", label: "Analyses run", icon: Activity },
  { key: "total_credits_purchased", label: "Credits purchased", icon: ShoppingBag },
  { key: "total_credits_outstanding", label: "Credits outstanding", icon: Wallet },
];

function fmtDate(iso) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return "—"; }
}

export default function AdminDashboard() {
  const [overview, setOverview] = useState(null);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [grantUser, setGrantUser] = useState(null);
  const [amount, setAmount] = useState("10");
  const [granting, setGranting] = useState(false);

  const load = async () => {
    try {
      const [ov, us] = await Promise.all([api.get("/admin/overview"), api.get("/admin/users")]);
      setOverview(ov.data);
      setUsers(us.data.users);
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const grant = async () => {
    const amt = parseInt(amount, 10);
    if (!amt) { toast.error("Enter a credit amount"); return; }
    setGranting(true);
    try {
      await api.post(`/admin/users/${grantUser.user_id}/grant-credits`, { amount: amt });
      toast.success(`Granted ${amt} credits to ${grantUser.email}`);
      setGrantUser(null);
      setAmount("10");
      load();
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setGranting(false);
    }
  };

  return (
    <AppShell title="Admin console">
      <div className="max-w-6xl mx-auto animate-fade-in-up">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800">
          <ShieldAlert className="w-3.5 h-3.5" /> Restricted · Admin only
        </div>
        <h1 className="mt-2 font-heading text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">Platform overview</h1>
        <p className="mt-2 text-stone-500 text-sm max-w-xl">
          Aggregate metrics and account management. All figures are anonymous counts — no patient data is ever stored or shown.
        </p>

        {/* Overview grid */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {OVERVIEW_CELLS.map((c) => (
            <div key={c.key} data-testid={`admin-stat-${c.key}`} className="rounded-lg border border-stone-300 bg-white p-5">
              <div className="flex items-center gap-2 text-stone-400">
                <c.icon className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-widest">{c.label}</span>
              </div>
              <div className="mt-2 font-mono text-3xl font-semibold tracking-tight text-stone-900 leading-none">
                {loading ? "—" : (overview?.[c.key] ?? 0)}
              </div>
            </div>
          ))}
        </div>

        {/* Users table */}
        <div className="mt-6 rounded-lg border border-stone-300 bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-stone-200 bg-stone-50/70 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-stone-500">Accounts</span>
            <span className="font-mono text-[11px] text-stone-400">{users.length} total</span>
          </div>
          <div className="overflow-x-auto pa-scroll">
            <table className="w-full text-sm border-collapse min-w-[720px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-stone-500 bg-stone-50/60">
                  <th className="px-5 py-2.5 font-semibold">User</th>
                  <th className="px-5 py-2.5 font-semibold">Role</th>
                  <th className="px-5 py-2.5 font-semibold">Auth</th>
                  <th className="px-5 py-2.5 font-semibold text-right">Analyses</th>
                  <th className="px-5 py-2.5 font-semibold text-right">Credits</th>
                  <th className="px-5 py-2.5 font-semibold">Joined</th>
                  <th className="px-5 py-2.5 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={7} className="px-5 py-10 text-center text-stone-400"><Loader2 className="w-5 h-5 animate-spin inline" /></td></tr>
                )}
                {!loading && users.map((u) => (
                  <tr key={u.user_id} data-testid={`admin-user-row-${u.user_id}`} className="border-t border-stone-200 hover:bg-stone-50/60">
                    <td className="px-5 py-3">
                      <div className="font-medium text-stone-900">{u.name || "—"}</div>
                      <div className="font-mono text-xs text-stone-400">{u.email}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${u.role === "admin" ? "text-emerald-800 bg-emerald-50 border-emerald-200" : "text-stone-500 bg-stone-50 border-stone-200"}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-stone-500 text-xs uppercase tracking-wider">{u.auth_provider}</td>
                    <td className="px-5 py-3 text-right font-mono text-stone-700">{u.analyses}</td>
                    <td className="px-5 py-3 text-right font-mono font-semibold text-stone-900">{u.credits}</td>
                    <td className="px-5 py-3 text-stone-500 text-xs">{fmtDate(u.created_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        data-testid={`admin-grant-btn-${u.user_id}`}
                        onClick={() => { setGrantUser(u); setAmount("10"); }}
                        className="inline-flex items-center gap-1 h-8 px-3 rounded-md border border-stone-300 bg-white hover:border-emerald-700 hover:text-emerald-800 text-xs font-semibold transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Credits
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-stone-400">
          <ShieldCheck className="w-3.5 h-3.5" /> No clinical data (PHI) is ever persisted — only account, credit and anonymous usage counters.
        </div>
      </div>

      {/* Grant credits dialog */}
      <Dialog open={!!grantUser} onOpenChange={(o) => !o && setGrantUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-heading">Grant credits</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-stone-500">
            Add credits to <span className="font-medium text-stone-800">{grantUser?.email}</span> (current balance:{" "}
            <span className="font-mono font-semibold">{grantUser?.credits}</span>).
          </p>
          <div className="mt-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">Amount</Label>
            <Input data-testid="admin-grant-amount" type="number" value={amount}
              onChange={(e) => setAmount(e.target.value)} className="mt-1.5 h-11 font-mono" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantUser(null)} className="rounded-md border-stone-300">Cancel</Button>
            <Button data-testid="admin-grant-confirm" onClick={grant} disabled={granting}
              className="rounded-md bg-emerald-900 hover:bg-emerald-800 text-white border border-emerald-950">
              {granting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Grant credits"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
