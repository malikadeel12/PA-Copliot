import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import api from "@/lib/api";
import { supabase } from "@/lib/supabase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const profileRequest = useRef(null);

  const loadProfile = useCallback(async () => {
    // Sign-in and onAuthStateChange may ask for the profile at nearly the
    // same time. Share one request to avoid racing first-profile creation.
    if (profileRequest.current) return profileRequest.current;
    profileRequest.current = api.get("/auth/me")
      .then(({ data }) => {
        setUser(data);
        return data;
      })
      .catch(() => {
        setUser(null);
        return null;
      })
      .finally(() => {
        profileRequest.current = null;
      });
    return profileRequest.current;
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
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        setUser(null);
        setLoading(false);
        return;
      }

      // Supabase invokes this callback while completing the auth operation.
      // Awaiting a backend request here makes sign-in/sign-up wait for Render
      // (and can deadlock other Supabase calls). Schedule profile hydration
      // outside the auth callback instead.
      setTimeout(() => {
        if (!mounted) return;
        loadProfile().finally(() => {
          if (mounted) setLoading(false);
        });
      }, 0);
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
