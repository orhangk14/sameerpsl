import { createContext, useContext, useEffect, useState, useRef, ReactNode } from 'react';
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

const AUTH_TIMEOUT_MS = 5000;

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const initialized = useRef(false);

  useEffect(() => {
    const finishInit = (s: Session | null) => {
      if (initialized.current) return;
      initialized.current = true;
      setSession(s);
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!initialized.current) {
          finishInit(session);
        } else {
          setSession(session);
        }
      }
    );

    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Auth session recovery timed out')), AUTH_TIMEOUT_MS)
    );

    Promise.race([sessionPromise, timeoutPromise])
      .then(({ data: { session } }) => {
        finishInit(session);
      })
      .catch((error) => {
        console.error('Auth initialization error:', error);
        finishInit(null);
        // Best-effort cleanup — fire and forget
        supabase.auth.signOut({ scope: 'local' }).catch((err) => {
          console.error('Local session cleanup failed:', err);
        });
        console.warn('Cleared stale local auth session');
      });

    return () => {
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
