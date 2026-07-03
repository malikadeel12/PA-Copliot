import React, { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  Activity, LayoutDashboard, FilePlus2, CreditCard, User, LogOut,
  Menu, ShieldCheck,
} from "lucide-react";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/new-request", label: "New request", icon: FilePlus2 },
  { to: "/buy-credits", label: "Billing", icon: CreditCard },
  { to: "/profile", label: "Profile", icon: User },
];

function NavItems({ onNavigate }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          data-testid={`nav-${item.label.toLowerCase().replace(" ", "-")}`}
          className={({ isActive }) =>
            `group flex items-center gap-3 px-3 h-10 rounded-md text-sm font-medium transition-colors border ${
              isActive
                ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                : "text-stone-600 border-transparent hover:bg-stone-100 hover:text-stone-900"
            }`
          }
        >
          {({ isActive }) => (
            <>
              <item.icon className={`w-[18px] h-[18px] ${isActive ? "text-emerald-800" : "text-stone-400 group-hover:text-stone-600"}`} />
              {item.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-md bg-emerald-900 flex items-center justify-center border border-emerald-950">
        <Activity className="w-5 h-5 text-emerald-300" strokeWidth={2.4} />
      </div>
      <div className="leading-none">
        <div className="font-heading font-bold text-stone-900 text-[17px] tracking-tight">PA Copilot</div>
        <div className="text-[9px] uppercase tracking-[0.22em] text-stone-400 font-bold mt-0.5">Prior Authorization</div>
      </div>
    </div>
  );
}

export default function AppShell({ title, children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const SidebarBody = (
    <div className="flex flex-col h-full">
      <div className="px-5 h-16 flex items-center border-b border-stone-200">
        <Brand />
      </div>
      <div className="p-3 flex-1">
        <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-stone-400">Navigate</div>
        <NavItems onNavigate={() => setOpen(false)} />
      </div>
      <div className="p-3 border-t border-stone-200 space-y-2">
        <button
          data-testid="sidebar-credits"
          onClick={() => { setOpen(false); navigate("/buy-credits"); }}
          className="w-full flex items-center justify-between px-3 h-14 rounded-md border border-stone-200 bg-stone-50 hover:border-stone-300 transition-colors"
        >
          <div className="text-left">
            <div className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Credits</div>
            <div className="font-mono text-xl font-semibold text-stone-900 leading-none mt-0.5">{user?.credits ?? 0}</div>
          </div>
          <CreditCard className="w-4 h-4 text-emerald-800" />
        </button>
        <button
          data-testid="sidebar-logout"
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 h-10 rounded-md text-sm font-medium text-stone-600 hover:bg-stone-100 transition-colors"
        >
          <LogOut className="w-[18px] h-[18px] text-stone-400" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-64 flex-col bg-white border-r border-stone-200 z-40">
        {SidebarBody}
      </aside>

      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/80 backdrop-blur-xl border-b border-stone-200 saturate-150 flex items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            {/* Mobile menu */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button data-testid="mobile-menu-btn" className="lg:hidden w-9 h-9 rounded-md border border-stone-200 flex items-center justify-center text-stone-600">
                  <Menu className="w-5 h-5" />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                {SidebarBody}
              </SheetContent>
            </Sheet>
            <div className="lg:hidden"><Brand /></div>
            <h1 className="hidden lg:block font-heading text-lg font-semibold tracking-tight text-stone-900">{title}</h1>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 h-8 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-bold uppercase tracking-widest">
              <ShieldCheck className="w-3.5 h-3.5" /> Zero retention
            </span>
            <button
              data-testid="topbar-credits"
              onClick={() => navigate("/buy-credits")}
              className="flex items-center gap-2 px-3 h-9 rounded-md border border-stone-200 bg-white hover:border-stone-400 transition-colors text-sm"
            >
              <CreditCard className="w-4 h-4 text-emerald-800" />
              <span className="font-mono font-semibold text-stone-900">{user?.credits ?? 0}</span>
            </button>
          </div>
        </header>

        <main className="px-4 sm:px-6 lg:px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
