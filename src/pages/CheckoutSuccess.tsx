import { useEffect, useState, useRef } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const CheckoutSuccess = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, loading, refreshProfile } = useAuth();
  const [countdown, setCountdown] = useState(4);
  const profileRefreshed = useRef(false);

  const type = searchParams.get('type');
  const isEventPass = type === 'event_pass';

  // Refresh profile once auth is ready so tier badge updates immediately
  useEffect(() => {
    if (!loading && isAuthenticated && !profileRefreshed.current) {
      profileRefreshed.current = true;
      refreshProfile().catch(() => {});
    }
  }, [loading, isAuthenticated, refreshProfile]);

  // Start countdown only after auth is resolved
  useEffect(() => {
    if (loading) return; // wait for auth to resolve

    // If not authenticated, send to login with redirect back to dashboard
    if (!isAuthenticated) {
      navigate('/login?redirectTo=%2Fdashboard%3Ftab%3Dbilling', { replace: true });
      return;
    }

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          toast.success(
            isEventPass
              ? 'Event Pass purchased! Activate it from the Billing tab.'
              : 'Payment successful! Your account has been upgraded.'
          );
          navigate('/dashboard?tab=billing', { replace: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [navigate, isEventPass, loading, isAuthenticated]);

  // Show spinner while auth is loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen py-10 px-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-md">
        <Card className="border-border">
          <CardHeader className="text-center pb-4">
            <div className="mx-auto mb-4">
              <CheckCircle className="w-14 h-14 text-green-500" />
            </div>
            <CardTitle className="text-xl">
              {isEventPass ? 'Event Pass Purchased!' : 'Payment Successful!'}
            </CardTitle>
            <CardDescription>
              {isEventPass
                ? 'Your 48-hour Event Pass is ready. You can activate it anytime from your Dashboard.'
                : 'Your account has been upgraded. Enjoy your new features!'
              }
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {isEventPass && (
              <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">How the Event Pass works:</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>48-hour access from activation</li>
                  <li>Up to 50 simultaneous listeners</li>
                  <li>1080p audio/video quality</li>
                  <li>Must be activated within 30 days</li>
                </ul>
              </div>
            )}

            <p className="text-xs text-muted-foreground text-center">
              Redirecting to your Dashboard in {countdown}s...
            </p>

            <div className="flex flex-col gap-2">
              <Button asChild className="w-full">
                <Link to="/dashboard?tab=billing">Go to Dashboard Now</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default CheckoutSuccess;
