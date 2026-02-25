import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen py-10 px-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-sm">
        <Button variant="ghost" asChild className="mb-8">
          <Link to="/login"><ArrowLeft className="w-4 h-4 mr-2" />Back to Sign In</Link>
        </Button>

        <div className="cinema-card rounded-3xl p-8 border border-border">
          {sent ? (
            <div className="text-center">
              <Mail className="w-12 h-12 text-primary mx-auto mb-4" />
              <h1 className="font-display text-2xl font-bold mb-2">Check Your Email</h1>
              <p className="text-muted-foreground text-sm">
                We sent a password reset link to <strong>{email}</strong>.
                Click the link in the email to set a new password.
              </p>
              <Button variant="ghost" asChild className="mt-6">
                <Link to="/login">Back to Sign In</Link>
              </Button>
            </div>
          ) : (
            <>
              <div className="text-center mb-8">
                <h1 className="font-display text-2xl font-bold">Reset Password</h1>
                <p className="text-muted-foreground text-sm mt-2">
                  Enter your email and we'll send you a reset link
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
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
                    autoFocus
                  />
                </div>

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" />
                  ) : (
                    'Send Reset Link'
                  )}
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
