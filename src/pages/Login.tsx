import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import heroCinema from '@/assets/hero-cinema.jpg';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const redirectTo = searchParams.get('redirectTo') || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);

    if (error) {
      toast.error(error);
    } else {
      toast.success('Signed in successfully');
      navigate(decodeURIComponent(redirectTo));
    }
  };

  const handleGoogleSignIn = async () => {
    setOauthLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?redirectTo=${encodeURIComponent(redirectTo)}`,
      },
    });
    if (error) {
      toast.error(error.message);
      setOauthLoading(false);
    }
  };

  return (
    <div className="flex" style={{ height: 'calc(100vh - 3.5rem)' }}>

      {/* ── Left panel: cinema visual ── */}
      <div className="hidden lg:block relative flex-1 overflow-hidden">
        <img
          src={heroCinema}
          alt=""
          aria-hidden
          className="absolute inset-0 w-full h-full object-cover"
          style={{ animation: 'slowZoom 22s ease-in-out infinite alternate' }}
        />
        {/* dark vignette so text is legible */}
        <div className="absolute inset-0 bg-gradient-to-r from-background/20 via-background/40 to-background/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-background/30" />

        {/* Brand copy — vertically centered */}
        <div className="absolute inset-0 flex items-center">
          <div className="px-12">
            <p className="font-display text-7xl font-bold leading-[0.95] tracking-tight text-foreground whitespace-nowrap">
              Cinema outside.<br />
              <span className="text-foreground/40">Zero noise.</span>
            </p>
          </div>
        </div>

        <style>{`
          @keyframes slowZoom {
            from { transform: scale(1); }
            to   { transform: scale(1.09); }
          }
        `}</style>
      </div>

      {/* ── Right panel: form ── */}
      <div className="w-full lg:w-[420px] xl:w-[480px] shrink-0 flex flex-col justify-center px-10 xl:px-16 border-l border-border/20">

        {/* Back */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-12 self-start"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>

        {/* Header */}
        <div className="mb-10">
          <p className="text-[11px] font-semibold tracking-[0.25em] uppercase text-primary mb-2">Welcome back</p>
          <h1 className="font-display text-4xl font-bold tracking-tight">Sign in.</h1>
          <p className="text-sm text-muted-foreground mt-2">Manage your screenings and billing.</p>
        </div>

        {/* Google OAuth */}
        <button
          onClick={handleGoogleSignIn}
          disabled={oauthLoading}
          className="w-full flex items-center justify-center gap-3 border border-border/60 text-sm font-medium py-3 rounded-lg hover:border-border hover:bg-secondary/40 transition-all disabled:opacity-60 mb-6"
        >
          {oauthLoading ? (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
          ) : (
            <>
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </>
          )}
        </button>

        {/* Divider */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border/30" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-background px-3 text-xs text-muted-foreground">or</span>
          </div>
        </div>

        {/* Email / Password form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs uppercase tracking-wide text-muted-foreground">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="password" className="text-xs uppercase tracking-wide text-muted-foreground">Password</Label>
              <Link to="/forgot-password" className="text-xs text-primary hover:text-primary/80 transition-colors">
                Forgot?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              placeholder="Your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              minLength={6}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground py-3 rounded-lg text-sm font-semibold shadow-lg shadow-primary/30 hover:bg-primary/90 hover:shadow-xl hover:shadow-primary/40 transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {loading
              ? <div className="mx-auto animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" />
              : 'Sign In'
            }
          </button>
        </form>

        <p className="text-sm text-muted-foreground mt-8">
          No account?{' '}
          <Link to="/signup" className="text-primary underline underline-offset-4 hover:text-primary/80 transition-colors">
            Create one
          </Link>
        </p>

      </div>
    </div>
  );
};

export default Login;
