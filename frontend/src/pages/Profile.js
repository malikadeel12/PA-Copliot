import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import api, { formatApiError } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Loader2, User2, Stethoscope, KeyRound, Mail, Trash2, Link2 } from "lucide-react";

export default function Profile() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const existingSig = user?.signature_data_url || "";
  const [form, setForm] = useState({
    name: user?.name || "", npi: user?.npi || "", specialty: user?.specialty || "",
    facility_name: user?.facility_name || "", facility_address: user?.facility_address || "",
    // Keep typed name and image stamp separate in the UI so one doesn't silently wipe the other.
    signature_typed: existingSig.startsWith("data:image") ? "" : existingSig,
    signature_image: existingSig.startsWith("data:image") ? existingSig : "",
  });
  const [busy, setBusy] = useState(false);
  // Linked sign-in identities (e.g. ["email", "google"]) — fetched from
  // Supabase so the user can see which providers can reach their account
  // and unlink the ones they don't want.
  const [identities, setIdentities] = useState([]);
  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.getUserIdentities();
        if (!active || error) return;
        setIdentities((data?.identities || []).map((i) => ({
          id: i.identity_id || i.id,
          provider: i.provider,
        })));
      } catch { /* unauthenticated — render nothing in this panel */ }
    })();
    return () => { active = false; };
  }, [user]);

  const save = async () => {
    setBusy(true);
    try {
      // Prefer image stamp when present; otherwise persist the typed signature name.
      const signature_data_url = form.signature_image || form.signature_typed || "";
      const { data } = await api.put("/profile", {
        name: form.name,
        npi: form.npi,
        specialty: form.specialty,
        facility_name: form.facility_name,
        facility_address: form.facility_address,
        signature_data_url,
      });
      setUser(data);
      toast.success("Profile saved");
    } catch (e) {
      toast.error(formatApiError(e.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const linkGoogle = async () => {
    setLinking(true);
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: "google",
        options: {
          redirectTo: window.location.origin + "/profile",
          queryParams: { prompt: "select_account consent", access_type: "offline" },
        },
      });
      if (error) throw error;
    } catch (e) {
      toast.error(formatApiError(e?.message) || "Couldn't link Google right now.");
      setLinking(false);
    }
  };

  const unlinkIdentity = async (identity) => {
    try {
      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) throw error;
      setIdentities((prev) => prev.filter((i) => i.id !== identity.id));
      toast.success(`${identity.provider === "google" ? "Google" : identity.provider} sign-in removed from this account.`);
    } catch (e) {
      toast.error(e?.message || "Couldn't remove that sign-in method.");
    }
  };

  const field = (key, label, placeholder, required = false) => (
    <div>
      <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">
        {label}{required && <span className="text-red-600"> *</span>}
      </Label>
      <Input data-testid={`profile-${key}`} value={form[key]} placeholder={placeholder}
        required={required}
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
          {field("name", "Full name", "Dr. Jane Smith, MD", true)}
          <div className="grid sm:grid-cols-2 gap-5">
            {field("npi", "NPI (10 digits)", "1234567890", true)}
            {field("specialty", "Specialty / taxonomy", "Rheumatology", true)}
          </div>
          {field("facility_name", "Facility name", "Riverside Clinic", true)}
          {field("facility_address", "Facility address", "123 Main St, Austin, TX 78701", true)}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wider text-stone-500">Typed e-signature name</Label>
            <Input data-testid="profile-signature" value={form.signature_typed}
              onChange={(e) => setForm({ ...form, signature_typed: e.target.value })}
              placeholder="e.g. Jane Smith, MD"
              className="mt-1.5 h-11 font-mono" />
            <Label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-stone-500">Signature / stamp image</Label>
            <div className="mt-1.5 flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2 px-3 h-10 rounded-md border border-stone-300 bg-white text-sm cursor-pointer hover:border-stone-400">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  data-testid="profile-signature-upload"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 800_000) {
                      toast.error("Signature image must be under 800 KB.");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => setForm((f) => ({ ...f, signature_image: String(reader.result || "") }));
                    reader.readAsDataURL(file);
                  }}
                />
                Upload signature image
              </label>
              {form.signature_image && (
                <>
                  <img src={form.signature_image} alt="Signature preview" className="h-12 object-contain border border-stone-200 rounded bg-white px-2" />
                  <button type="button" className="text-xs text-stone-500 underline" onClick={() => setForm({ ...form, signature_image: "" })}>
                    Clear image
                  </button>
                </>
              )}
            </div>
            <p className="mt-1.5 text-xs text-stone-400">Image stamps the PA form. Typed name (or your Full name) inserts into the cover letter.</p>
          </div>

          <Button data-testid="profile-save-btn" onClick={save} disabled={busy}
            className="h-11 px-6 bg-emerald-900 hover:bg-emerald-800 text-white font-semibold rounded-md border border-emerald-950 transition-colors">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Stethoscope className="w-4 h-4 mr-2" /> Save profile</>}
          </Button>
          </div>
        </div>

        {identities.length > 0 && (
          <div className="mt-6 rounded-lg bg-white border border-stone-300 shadow-sm overflow-hidden">
            <div className="px-6 sm:px-8 py-3 border-b border-stone-200 bg-stone-50/70">
              <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-stone-500">Sign-in methods</span>
            </div>
            <div className="p-6 sm:p-8 space-y-4">
              <p className="text-sm text-stone-600">
                These are the ways you can sign in to <span className="font-mono">{user?.email}</span>.
                Supabase automatically links new providers that use the same verified email —
                sign in with Google and your existing email + password account will be unified.
              </p>
              <ul className="space-y-2">
                {identities.map((id) => (
                  <li key={id.id} data-testid={`signin-method-${id.provider}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-stone-200 bg-stone-50 px-4 py-3">
                    <div className="flex items-center gap-3">
                      {id.provider === "email"
                        ? <Mail className="w-4 h-4 text-stone-600" />
                        : id.provider === "google"
                        ? <span className="w-4 h-4 inline-flex items-center justify-center font-bold text-xs text-stone-600">G</span>
                        : <KeyRound className="w-4 h-4 text-stone-600" />}
                      <div>
                        <div className="text-sm font-medium text-stone-900 capitalize">{id.provider === "email" ? "Email + password" : id.provider}</div>
                        <div className="text-xs text-stone-500">
                          {id.provider === "email" ? "Sign in with your email and password." : `Sign in with your ${id.provider} account.`}
                        </div>
                      </div>
                    </div>
                    {identities.length > 1 && (
                      <Button data-testid={`unlink-${id.provider}`} variant="ghost" size="sm"
                        onClick={() => unlinkIdentity(id)}
                        className="text-stone-500 hover:text-red-600">
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Remove
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              {!identities.some((i) => i.provider === "google") && (
                <Button data-testid="link-google-btn" variant="outline" onClick={linkGoogle} disabled={linking}
                  className="h-10 border-stone-300">
                  {linking ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Link2 className="w-4 h-4 mr-2" />}
                  Link Google account
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
