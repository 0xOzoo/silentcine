import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

/**
 * Password reset form. User arrives here from the reset email link.
 * Supabase embeds the recovery token in the URL hash, which the
 * client auto-parses to establish a recovery session.
 */
const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (password !== confirm) {
      toast.error('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password updated successfully');
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen py-10 px-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-sm">
        <Button variant="ghost" asChild className="mb-8">
          <a href="/login"><ArrowLeft className="w-4 h-4 mr-2" />Back to Sign In</a>
        </Button>

        <div className="cinema-card rounded-3xl p-8 border border-border">
          <div className="text-center mb-8">
            <KeyRound className="w-10 h-10 text-primary mx-auto mb-3" />
            <h1 className="font-display text-2xl font-bold">Set New Password</h1>
            <p className="text-muted-foreground text-sm mt-2">
              Choose a new password for your account
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 6 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                minLength={6}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input
                id="confirm"
                type="password"
                placeholder="Repeat your password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                minLength={6}
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground" />
              ) : (
                'Update Password'
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
