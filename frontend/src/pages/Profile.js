import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api, { formatApiError } from "@/lib/api";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Loader2, User2, Stethoscope } from "lucide-react";

export default function Profile() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: user?.name || "", npi: user?.npi || "", specialty: user?.specialty || "",
    facility_name: user?.facility_name || "", facility_address: user?.facility_address || "",
    signature_data_url: user?.signature_data_url || "",
  });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const { data } = await api.put("/profile", form);
      setUser(data);
      toast.success("Profile saved");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const field = (key, label, placeholder) => (
    <div>
      <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">{label}</Label>
      <Input data-testid={`profile-${key}`} value={form[key]} placeholder={placeholder}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })} className="mt-1.5 h-11" />
    </div>
  );

  return (
    <AppShell title="Prescriber profile">
      <div className="max-w-3xl mx-auto animate-fade-in-up">
        <button data-testid="profile-back" onClick={() => navigate("/dashboard")} className="flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-800 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="mt-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-lg border border-stone-200 bg-stone-50 flex items-center justify-center">
            <User2 className="w-7 h-7 text-emerald-800" />
          </div>
          <div>
            <h1 className="font-heading text-3xl font-semibold tracking-tight text-stone-900">Prescriber profile</h1>
            <p className="text-stone-500 text-sm">{user?.email} · reused on every request (account data, not PHI).</p>
          </div>
        </div>

        <div className="mt-8 rounded-lg bg-white border border-stone-300 shadow-sm overflow-hidden">
          <div className="px-6 sm:px-8 py-3 border-b border-stone-200 bg-stone-50/70">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-stone-500">Identity & facility</span>
          </div>
          <div className="p-6 sm:p-8 space-y-5">
          {field("name", "Full name", "Dr. Jane Smith, MD")}
          <div className="grid sm:grid-cols-2 gap-5">
            {field("npi", "NPI (10 digits)", "1234567890")}
            {field("specialty", "Specialty / taxonomy", "Rheumatology")}
          </div>
          {field("facility_name", "Facility name", "Riverside Clinic")}
          {field("facility_address", "Facility address", "123 Main St, Austin, TX 78701")}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">E-signature name</Label>
            <Input data-testid="profile-signature" value={form.signature_data_url}
              onChange={(e) => setForm({ ...form, signature_data_url: e.target.value })}
              placeholder="Typed signature (e.g. Jane Smith, MD)" className="mt-1.5 h-11 font-mono" />
            <p className="mt-1.5 text-xs text-stone-400">Applied with a date stamp when you approve a package.</p>
          </div>

          <Button data-testid="profile-save-btn" onClick={save} disabled={busy}
            className="h-11 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Stethoscope className="w-4 h-4 mr-2" /> Save profile</>}
          </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
