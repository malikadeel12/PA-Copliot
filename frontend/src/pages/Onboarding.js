import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrustBadge } from "@/components/TrustBadge";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ArrowRight, Stethoscope } from "lucide-react";

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({
    name: user?.name || "",
    npi: user?.npi || "",
    specialty: user?.specialty || "",
    facility_name: user?.facility_name || "",
    facility_address: user?.facility_address || "",
  });
  const [busy, setBusy] = useState(false);

  const update = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    for (const [k, label] of [
      ["name", "Full name"],
      ["npi", "NPI"],
      ["specialty", "Specialty"],
      ["facility_name", "Facility name"],
      ["facility_address", "Facility address"],
    ]) {
      if (!(form[k] || "").trim()) {
        return toast.error(`${label} is required.`);
      }
    }
    if (!/^\d{10}$/.test(form.npi.trim())) {
      return toast.error("NPI must be exactly 10 digits.");
    }
    setBusy(true);
    try {
      const { data } = await api.put("/profile", form);
      setUser(data);
      toast.success("Profile saved — welcome to PA Copilot");
      navigate(data.role === "admin" ? "/admin" : "/dashboard", { replace: true });
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/pa-logo.png" alt="PA Copilot logo" className="w-8 h-8 object-contain" />
            <span className="font-heading font-bold text-stone-900">PA Copilot</span>
          </div>
          <span className="text-xs text-stone-500 hidden sm:inline">{user?.email}</span>
        </div>
      </header>

      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 pt-10 pb-16 animate-fade-in-up">
        <div className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-800">
          <Stethoscope className="w-3.5 h-3.5" /> Step 1 of 1 — prescriber onboarding
        </div>
        <h1 className="mt-3 font-heading text-3xl sm:text-4xl font-bold tracking-tight text-stone-900">
          Tell us about your practice
        </h1>
        <p className="mt-2 text-stone-500 text-sm max-w-xl leading-relaxed">
          We need a few prescriber details before unlocking the dashboard. They'll be reused on every prior-authorization request so you only fill them in once.
        </p>

        <form onSubmit={submit} className="mt-8 rounded-lg bg-white border border-stone-300 shadow-sm overflow-hidden">
          <div className="px-6 sm:px-8 py-3 border-b border-stone-200 bg-stone-50/70">
            <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-stone-500">Identity & facility</span>
          </div>
          <div className="p-6 sm:p-8 space-y-5">
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                Full name <span className="text-red-600">*</span>
              </Label>
              <Input data-testid="onboarding-name" required value={form.name}
                onChange={update("name")} placeholder="Dr. Jane Smith, MD" className="mt-1.5 h-11" />
            </div>
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                  NPI (10 digits) <span className="text-red-600">*</span>
                </Label>
                <Input data-testid="onboarding-npi" required value={form.npi}
                  onChange={update("npi")} placeholder="1234567890" inputMode="numeric"
                  maxLength={10} className="mt-1.5 h-11 font-mono" />
              </div>
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                  Specialty / taxonomy <span className="text-red-600">*</span>
                </Label>
                <Input data-testid="onboarding-specialty" required value={form.specialty}
                  onChange={update("specialty")} placeholder="Rheumatology" className="mt-1.5 h-11" />
              </div>
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                Facility name <span className="text-red-600">*</span>
              </Label>
              <Input data-testid="onboarding-facility" required value={form.facility_name}
                onChange={update("facility_name")} placeholder="Riverside Clinic" className="mt-1.5 h-11" />
            </div>
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
                Facility address <span className="text-red-600">*</span>
              </Label>
              <Input data-testid="onboarding-address" required value={form.facility_address}
                onChange={update("facility_address")} placeholder="123 Main St, Austin, TX 78701"
                className="mt-1.5 h-11" />
            </div>

            <Button data-testid="onboarding-submit" type="submit" disabled={busy}
              className="h-11 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                <>Unlock dashboard <ArrowRight className="w-4 h-4 ml-2" /></>
              )}
            </Button>
          </div>
        </form>

        <div className="mt-6 flex items-center gap-2 text-xs text-stone-500">
          <ShieldCheck className="w-4 h-4 text-emerald-700" />
          These fields are account metadata — never patient data. They appear only on your submitted packages.
        </div>
      </main>

      <footer className="border-t border-stone-200 bg-white py-4">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 flex items-center justify-center">
          <TrustBadge label="Account data only — patient PHI is never stored" />
        </div>
      </footer>
    </div>
  );
}
