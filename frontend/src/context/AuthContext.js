import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "@/lib/api";
import { supabase } from "@/lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      return data;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        setSession(data.session);
        if (data.session) await loadProfile();
      } catch {
        /* ignore */
      } finally {
        if (mounted) setLoading(false);
      }
    };
    init();
    // Failsafe: never trap the user on an infinite spinner if the backend is slow/unreachable.
    const failsafe = setTimeout(() => { if (mounted) setLoading(false); }, 30000);
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s);
      try {
        if (s) await loadProfile();
        else setUser(null);
      } finally {
        setLoading(false);
      }
    });
    return () => { mounted = false; clearTimeout(failsafe); sub.subscription.unsubscribe(); };
  }, [loadProfile]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, session, loading, refreshUser: loadProfile, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
