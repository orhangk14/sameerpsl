import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

const clearStaleSession = () => {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith('sb-'));
    keys.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    console.warn('Failed to clear stale session data', e);
  }
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const ensureProfile = async (userId: string, email: string | undefined) => {
      try {
        const { data } = await supabase.from('profiles').select('id').eq('user_id', userId).maybeSingle();
        if (!data) {
          const username = email ? email.split('@')[0] : `user_${userId.slice(0, 6)}`;
          await supabase.from('profiles').insert({ user_id: userId, username });
        }
      } catch (e) {
        console.error('Error ensuring profile:', e);
      }
    };

    const authTimeout = setTimeout(() => {
      if (isMounted && loading) {
        console.warn('Auth session retrieval timed out, clearing stale data');
        clearStaleSession();
        setSession(null);
        setLoading(false);
      }
    }, 5000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;
      setSession(session);
      setLoading(false);
      clearTimeout(authTimeout);
      if (session?.user) {
        setTimeout(() => ensureProfile(session.user.id, session.user.email), 0);
      }
    });

    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!isMounted) return;
      if (error) {
        console.error('Error getting session:', error.message);
        clearStaleSession();
        setSession(null);
      } else {
        setSession(session);
        if (session?.user) {
          setTimeout(() => ensureProfile(session.user.id, session.user.email), 0);
        }
      }
      setLoading(false);
      clearTimeout(authTimeout);
    }).catch(() => {
      if (!isMounted) return;
      console.error('getSession crashed, clearing stale data');
      clearStaleSession();
      setSession(null);
      setLoading(false);
      clearTimeout(authTimeout);
    });

    return () => {
      isMounted = false;
      clearTimeout(authTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
