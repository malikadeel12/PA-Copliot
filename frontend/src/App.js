import React, { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import Login from "@/pages/Login";
import AuthCallback from "@/pages/AuthCallback";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "@/pages/Dashboard";
import Profile from "@/pages/Profile";
import BuyCredits from "@/pages/BuyCredits";
// TEMPORARILY DISABLED FOR THE CLIENT DEMO:
// import Wizard from "@/pages/Wizard";
import DemoWizard from "@/pages/DemoWizard";
import AdminDashboard from "@/pages/AdminDashboard";

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-50">
      <div className="w-10 h-10 rounded-full border-2 border-emerald-600 border-t-transparent animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
      <Route path="/buy-credits" element={<ProtectedRoute><BuyCredits /></ProtectedRoute>} />
      {/* Production request logic is preserved in pages/Wizard.js and components/wizard/*. */}
      {/* <Route path="/new-request" element={<ProtectedRoute><Wizard /></ProtectedRoute>} /> */}
      <Route path="/new-request" element={<ProtectedRoute><DemoWizard /></ProtectedRoute>} />
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
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <AppRouter />
            <Toaster position="top-center" richColors />
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </div>
  );
}
