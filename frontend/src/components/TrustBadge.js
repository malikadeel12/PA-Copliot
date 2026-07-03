import React from "react";
import { ShieldCheck } from "lucide-react";

export const TrustBadge = ({ label = "Zero data retention · No PHI stored", className = "" }) => (
  <span
    data-testid="trust-badge"
    className={`inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 text-[11px] font-semibold uppercase tracking-widest rounded-full border border-emerald-100 ${className}`}
  >
    <ShieldCheck className="w-3.5 h-3.5" />
    {label}
  </span>
);

export default TrustBadge;
