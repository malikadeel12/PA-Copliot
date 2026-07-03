import React from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Activity, CreditCard, User, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/dashboard" data-testid="header-logo" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 flex items-center justify-center shadow-sm shadow-emerald-600/30 group-hover:scale-105 transition-transform">
            <Activity className="w-5 h-5 text-white" strokeWidth={2.4} />
          </div>
          <div className="leading-none">
            <div className="font-heading font-bold text-stone-900 text-lg tracking-tight">PA Copilot</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-stone-400 font-semibold">Prior Auth · in minutes</div>
          </div>
        </Link>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            data-testid="header-credits"
            onClick={() => navigate("/buy-credits")}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-stone-100 hover:bg-stone-200 transition-colors text-sm"
          >
            <CreditCard className="w-4 h-4 text-emerald-600" />
            <span className="font-mono font-semibold text-stone-800">{user?.credits ?? 0}</span>
            <span className="text-stone-500 hidden sm:inline">credits</span>
          </button>

          <Button
            data-testid="header-profile-btn"
            variant="ghost" size="icon"
            className="rounded-full text-stone-600"
            onClick={() => navigate("/profile")}
          >
            <User className="w-5 h-5" />
          </Button>
          <Button
            data-testid="header-logout-btn"
            variant="ghost" size="icon"
            className="rounded-full text-stone-600"
            onClick={handleLogout}
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
