import React, { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import api from "@/lib/api";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Profile from "@/pages/Profile";
import BuyCredits from "@/pages/BuyCredits";
import Wizard from "@/pages/Wizard";
import AdminDashboard from "@/pages/AdminDashboard";

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="w-10 h-10 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="w-10 h-10 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
function AuthCallback() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const processed = useRef(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;
    const hash = window.location.hash;
    const sessionId = new URLSearchParams(hash.replace("#", "")).get("session_id");
    if (!sessionId) {
      navigate("/login", { replace: true });
      return;
    }
    (async () => {
      try {
        const { data } = await api.post("/auth/session", {}, { headers: { "X-Session-ID": sessionId } });
        setUser(data.user);
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/dashboard", { replace: true });
      } catch (e) {
        setError("Sign-in failed. Please try again.");
        setTimeout(() => navigate("/login", { replace: true }), 1500);
      }
    })();
  }, [navigate, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="text-center">
        <div className="w-10 h-10 mx-auto rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
        <p className="mt-4 text-stone-500 text-sm">{error || "Signing you in securely…"}</p>
      </div>
    </div>
  );
}

function AppRouter() {
  const location = useLocation();
  if (location.hash?.includes("session_id=")) {
    return <AuthCallback />;
  }
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/buy-credits" element={<ProtectedRoute><BuyCredits /></ProtectedRoute>} />
      <Route path="/new-request" element={<ProtectedRoute><Wizard /></ProtectedRoute>} />
      <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

export default function App() {
  useEffect(() => {
    document.title = "PA Copilot — Prior Authorization";
  }, []);
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
          <Toaster position="top-center" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}
