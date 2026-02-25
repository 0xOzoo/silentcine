import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, UserPlus, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

const Signup = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const passwordRules = useMemo(() => [
    { label: '8 characters minimum', test: (p: string) => p.length >= 8 },
    { label: 'Lowercase letter (a-z)', test: (p: string) => /[a-z]/.test(p) },
    { label: 'Uppercase letter (A-Z)', test: (p: string) => /[A-Z]/.test(p) },
    { label: 'Digit (0-9)', test: (p: string) => /[0-9]/.test(p) },
    { label: 'Symbol (!@#$...)', test: (p: string) => /[^a-zA-Z0-9]/.test(p) },
  ], []);

  const allRulesPassed = password.length > 0 && passwordRules.every(r => r.test(password));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    if (!allRulesPassed) {
      toast.error('Password does not meet all requirements');
      return;
    }

    setLoading(true);
    const { error } = await signUp(email, password, displayName || undefined);
    setLoading(false);

    if (error) {
      toast.error(error);
    } else {
      toast.success('Account created! Check your email to verify.');
      navigate('/');
    }
  };

  const handleGoogleSignUp = async () => {
    setOauthLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      toast.error(error.message);
      setOauthLoading(false);
    }
  };

  return (
    <div className="min-h-screen py-10 px-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-sm">
        <Button variant="ghost" asChild className="mb-8">
          <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
        </Button>

        <div className="cinema-card rounded-3xl p-8 border border-border">
          <div className="text-center mb-8">
            <h1 className="font-display text-2xl font-bold">Create Account</h1>
            <p className="text-muted-foreground text-sm mt-2">
              Save your sessions and unlock premium features
            </p>
          </div>

          {/* OAuth */}
          <Button
            variant="outline"
            className="w-full mb-4"
            onClick={handleGoogleSignUp}
            disabled={oauthLoading}
          >
            {oauthLoading ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </>
            )}
          </Button>

          <div className="relative my-6">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
              or
            </span>
          </div>

          {/* Email/Password */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name (optional)</Label>
              <Input
                id="displayName"
                type="text"
                placeholder="Your name"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                autoComplete="name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
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

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Strong password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={8}
              />
              {password.length > 0 && (
                <ul className="space-y-1 mt-2">
                  {passwordRules.map(rule => {
                    const passed = rule.test(password);
                    return (
                      <li key={rule.label} className={`flex items-center gap-1.5 text-xs ${passed ? 'text-green-400' : 'text-muted-foreground'}`}>
                        {passed ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {rule.label}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" />
              ) : (
                <>
                  <UserPlus className="w-4 h-4 mr-2" />
                  Create Account
                </>
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-primary hover:underline">Sign in</Link>
          </p>

          <p className="text-center text-xs text-muted-foreground mt-4">
            By creating an account, you agree to our{' '}
            <Link to="/terms" className="text-primary hover:underline">Terms</Link>{' '}
            and{' '}
            <Link to="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Signup;
