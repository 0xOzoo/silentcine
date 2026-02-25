import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import type { Profile } from '@/types/profile';

const ANON_ID_KEY = 'silentcine_anonymous_id';

interface AuthState {
  /** Supabase Auth user (null if anonymous) */
  user: User | null;
  /** Supabase session (null if anonymous) */
  session: Session | null;
  /** Profile from profiles table (always exists: anonymous or authenticated) */
  profile: Profile | null;
  /** True while loading initial auth state */
  loading: boolean;
  /** True if user has a real account (not anonymous) */
  isAuthenticated: boolean;
  /** The anonymous UUID (always available, even after login for bridging) */
  anonymousId: string;
}

interface AuthActions {
  signUp: (email: string, password: string, displayName?: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  /** Link current anonymous profile to the newly created auth account */
  bridgeAnonymousProfile: () => Promise<void>;
  /** Re-fetch profile from DB (call after payment/tier change to update UI) */
  refreshProfile: () => Promise<void>;
}

type AuthContextValue = AuthState & AuthActions;

const AuthContext = createContext<AuthContextValue | null>(null);

/** Get or create a persistent anonymous UUID */
function getAnonymousId(): string {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [anonymousId] = useState(getAnonymousId);

  // Mutex to prevent concurrent ensureAnonymousProfile calls (race condition)
  const ensureProfileInflight = useRef<Promise<Profile | null> | null>(null);
  // Flag to prevent onAuthStateChange from re-running anonymous profile setup during signOut
  const isSigningOut = useRef(false);

  /** Fetch profile by auth_user_id or anonymous_id */
  const fetchProfile = useCallback(async (authUserId?: string): Promise<Profile | null> => {
    try {
      if (authUserId) {
        // Authenticated user: find by auth_user_id
        const { data, error } = await (supabase as any)
          .from('profiles')
          .select('*')
          .eq('auth_user_id', authUserId)
          .maybeSingle();
        if (error) console.error('[Auth] Profile fetch error:', error);
        return data as Profile | null;
      }

      // Anonymous: find by anonymous_id — only match truly anonymous profiles.
      // After bridging, the authenticated profile keeps the same anonymous_id
      // but has anonymous=false. Without this filter, sign-out + refresh would
      // find the bridged profile and display stale user data.
      const { data, error } = await (supabase as any)
        .from('profiles')
        .select('*')
        .eq('anonymous_id', anonymousId)
        .eq('anonymous', true)
        .maybeSingle();
      if (error) console.error('[Auth] Anon profile fetch error:', error);
      return data as Profile | null;
    } catch (err) {
      console.error('[Auth] Profile fetch exception:', err);
      return null;
    }
  }, [anonymousId]);

  /** Ensure an anonymous profile exists (deduplicated — only one inflight request at a time) */
  const ensureAnonymousProfile = useCallback(async (): Promise<Profile | null> => {
    // If there's already an inflight request, reuse it to prevent race conditions
    if (ensureProfileInflight.current) {
      return ensureProfileInflight.current;
    }

    const doEnsure = async (): Promise<Profile | null> => {
      // Check if one already exists
      const prof = await fetchProfile();
      if (prof) return prof;

      // Create shadow profile via edge function (service_role bypasses RLS)
      try {
        const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-manager?action=create-profile`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': ANON_KEY,
              'Authorization': `Bearer ${ANON_KEY}`,
            },
            body: JSON.stringify({ anonymousId }),
          },
        );

        if (res.ok) {
          const { profile: p } = await res.json();
          return p as Profile;
        }

        // Edge function returned an error — log it but don't crash
        const errText = await res.text().catch(() => '');
        console.warn('[Auth] Edge function create-profile failed:', res.status, errText);
        return null;
      } catch (err) {
        console.warn('[Auth] Edge function unreachable for profile creation:', err);
        return null;
      }
    };

    ensureProfileInflight.current = doEnsure();
    try {
      return await ensureProfileInflight.current;
    } finally {
      ensureProfileInflight.current = null;
    }
  }, [anonymousId, fetchProfile]);

  /** Bridge anonymous profile to authenticated account.
   *  Also migrates movies and sessions owned by the anonymous profile. */
  const bridgeAnonymousProfile = useCallback(async () => {
    if (!user) return;

    // Find existing anonymous profile
    const anonProfile = await fetchProfile();
    if (anonProfile && anonProfile.anonymous && !anonProfile.auth_user_id) {
      // Link anonymous profile to auth user
      await (supabase as any)
        .from('profiles')
        .update({
          auth_user_id: user.id,
          email: user.email,
          anonymous: false,
          display_name: user.user_metadata?.display_name || user.email?.split('@')[0],
        })
        .eq('id', anonProfile.id);

      // Migrate movies owned by anonymous profile to the now-authenticated profile.
      // The profile ID stays the same (we update the profile in-place), so
      // movies.profile_id already points to the correct row. But movies that
      // were created with user_id = anonymousId need to be re-linked.
      await (supabase as any)
        .from('movies')
        .update({ profile_id: anonProfile.id })
        .eq('user_id', anonymousId)
        .is('profile_id', null);

      // Migrate sessions: link any sessions missing a profile_id
      await (supabase as any)
        .from('sessions')
        .update({ profile_id: anonProfile.id })
        .is('profile_id', null);

      console.log('[Auth] Anonymous profile bridged + data migrated for', user.email);

      // Refresh profile
      const updated = await fetchProfile(user.id);
      if (updated) setProfile(updated);
    }
  }, [user, anonymousId, fetchProfile]);

  // Initialize auth state
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      // Get existing session
      const { data: { session: existingSession } } = await supabase.auth.getSession();

      if (!mounted) return;

      if (existingSession?.user) {
        // Fetch profile BEFORE setting user/session so there's no intermediate
        // render where isAuthenticated=true but profile is still null (shows "Free").
        const prof = await fetchProfile(existingSession.user.id);
        if (!mounted) return;
        setSession(existingSession);
        setUser(existingSession.user);
        setProfile(prof);
        setLoading(false);
      } else {
        // No session — user is anonymous. Set loading=false immediately so the
        // Header shows "Sign In" / "Sign Up" without waiting for the anonymous
        // profile edge function call.
        setLoading(false);

        // Ensure shadow profile in the background (non-blocking)
        const prof = await ensureAnonymousProfile();
        if (mounted) setProfile(prof);
      }
    };

    init();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return;

      // If signOut() is handling the transition, skip to avoid duplicate work
      if (isSigningOut.current) return;

      if (newSession?.user) {
        // Fetch profile BEFORE setting user so there's no flash of "Free" badge
        const prof = await fetchProfile(newSession.user.id);
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession.user);
        setProfile(prof);
      } else {
        setSession(null);
        setUser(null);
        const prof = await ensureAnonymousProfile();
        if (mounted) setProfile(prof);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile, ensureAnonymousProfile]);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email.split('@')[0] },
      },
    });
    if (error) return { error: error.message };

    // The handle_new_user trigger creates the profile automatically.
    // Bridge anonymous data after signup confirmation.
    return { error: null };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };

    // After sign-in, try to bridge anonymous profile
    await bridgeAnonymousProfile();
    return { error: null };
  }, [bridgeAnonymousProfile]);

  const refreshProfile = useCallback(async () => {
    if (user) {
      const prof = await fetchProfile(user.id);
      if (prof) setProfile(prof);
    } else {
      const prof = await fetchProfile();
      if (prof) setProfile(prof);
    }
  }, [user, fetchProfile]);

  const signOut = useCallback(async () => {
    // Prevent onAuthStateChange from duplicating the anonymous profile work
    isSigningOut.current = true;

    // Clear auth state immediately so UI updates without waiting for onAuthStateChange
    setUser(null);
    setSession(null);
    setProfile(null);

    // Use scope: 'local' to guarantee localStorage is cleared even if the
    // server-side token revocation fails (network error, etc.)
    await supabase.auth.signOut({ scope: 'local' });

    // Belt-and-suspenders: nuke ALL Supabase auth keys from localStorage
    // to prevent any "ghost session" showing up after page refresh.
    // Supabase may store under different key variants.
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.startsWith('supabase'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));

    // After sign-out, user becomes anonymous again
    const prof = await ensureAnonymousProfile();
    setProfile(prof);

    isSigningOut.current = false;
  }, [ensureAnonymousProfile]);

  const value: AuthContextValue = {
    user,
    session,
    profile,
    loading,
    isAuthenticated: !!user,
    anonymousId,
    signUp,
    signIn,
    signOut,
    bridgeAnonymousProfile,
    refreshProfile,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
