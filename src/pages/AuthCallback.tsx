import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

/**
 * Handles OAuth redirects and email confirmation links from Supabase.
 * Supabase redirects here with hash fragments containing the session.
 * Once the session is established, redirects to the intended destination.
 */
const AuthCallback = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Supabase auth will automatically parse the URL hash/query params
        // and establish the session. We just need to verify it worked.
        const { data, error: authError } = await supabase.auth.getSession();

        if (authError) {
          console.error('[AuthCallback] Error:', authError.message);
          setError(authError.message);
          return;
        }

        if (data.session) {
          // Session established. Redirect to the intended page or home.
          const params = new URLSearchParams(window.location.search);
          const redirectTo = params.get('redirectTo') || '/';
          navigate(decodeURIComponent(redirectTo), { replace: true });
        } else {
          // No session yet — might be processing. Wait a moment.
          // The onAuthStateChange listener in AuthContext will pick it up.
          setTimeout(() => {
            navigate('/', { replace: true });
          }, 2000);
        }
      } catch (err) {
        console.error('[AuthCallback] Exception:', err);
        setError('Authentication failed. Please try again.');
      }
    };

    handleCallback();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-xl font-bold mb-2 text-destructive">Authentication Error</h1>
          <p className="text-muted-foreground text-sm mb-4">{error}</p>
          <a href="/login" className="text-primary hover:underline text-sm">Back to Sign In</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
        <p className="text-muted-foreground text-sm">Completing sign in...</p>
      </div>
    </div>
  );
};

export default AuthCallback;
