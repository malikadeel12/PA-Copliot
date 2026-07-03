import React from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Activity, CreditCard, User, LogOut } from "lucide-react";

export default function AppHeader() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  return (
    <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-stone-200 saturate-150">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/dashboard" data-testid="header-logo" className="flex items-center gap-2.5 group">
          <div className="w-9 h-9 rounded-md bg-emerald-900 flex items-center justify-center border border-emerald-950 group-hover:bg-emerald-800 transition-colors">
            <Activity className="w-5 h-5 text-emerald-300" strokeWidth={2.4} />
          </div>
          <div className="leading-none">
            <div className="font-heading font-bold text-stone-900 text-[17px] tracking-tight">PA Copilot</div>
            <div className="text-[9px] uppercase tracking-[0.22em] text-stone-400 font-bold mt-0.5">Prior Authorization</div>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          <button
            data-testid="header-credits"
            onClick={() => navigate("/buy-credits")}
            className="flex items-center gap-2 px-3 h-9 rounded-md border border-stone-200 bg-white hover:border-stone-400 transition-colors text-sm"
          >
            <CreditCard className="w-4 h-4 text-emerald-800" />
            <span className="font-mono font-semibold text-stone-900">{user?.credits ?? 0}</span>
            <span className="text-stone-400 hidden sm:inline text-xs uppercase tracking-wider">credits</span>
          </button>

          <button data-testid="header-profile-btn" onClick={() => navigate("/profile")}
            className="w-9 h-9 rounded-md border border-stone-200 bg-white hover:border-stone-400 flex items-center justify-center text-stone-600 transition-colors">
            <User className="w-4.5 h-4.5 w-[18px] h-[18px]" />
          </button>
          <button data-testid="header-logout-btn" onClick={handleLogout}
            className="w-9 h-9 rounded-md border border-stone-200 bg-white hover:border-stone-400 flex items-center justify-center text-stone-600 transition-colors">
            <LogOut className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>
    </header>
  );
}
