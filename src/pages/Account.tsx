import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard, LogOut, Shield, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { TIER_LIMITS } from '@/types/profile';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const Account = () => {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [portalLoading, setPortalLoading] = useState(false);

  const currentTier = profile?.subscription_tier ?? 'free';
  const tierConfig = TIER_LIMITS[currentTier];

  const handleManageBilling = async () => {
    if (!profile?.id || !profile.stripe_customer_id) {
      toast.error('No billing information found. Subscribe to a plan first.');
      return;
    }

    setPortalLoading(true);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/customer-portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ profileId: profile.id }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to open billing portal');
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to open billing portal';
      toast.error(msg);
    } finally {
      setPortalLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
    toast.success('Signed out');
  };

  // ProtectedRoute handles the auth redirect, so this page
  // always renders for authenticated users.

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="container max-w-2xl mx-auto">
        <Button variant="ghost" asChild className="mb-8">
          <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
        </Button>

        <h1 className="font-display text-3xl font-bold mb-8">Account</h1>

        {/* Profile Card */}
        <Card className="mb-6 border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm">{user?.email ?? 'N/A'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Display Name</span>
              <span className="text-sm">{profile?.display_name ?? 'N/A'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Member Since</span>
              <span className="text-sm">
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString()
                  : 'N/A'
                }
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Subscription Card */}
        <Card className="mb-6 border-border">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Star className="w-5 h-5" />
              Subscription
            </CardTitle>
            <CardDescription>Your current plan and limits</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge variant={currentTier === 'free' ? 'secondary' : 'default'} className="text-sm">
                {tierConfig.label}
              </Badge>
              {profile?.tier_expires_at && (
                <span className="text-xs text-muted-foreground">
                  Grace period until {new Date(profile.tier_expires_at).toLocaleDateString()}
                </span>
              )}
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Max Listeners</p>
                <p className="font-medium">
                  {tierConfig.maxListeners === -1 ? 'Unlimited' : tierConfig.maxListeners}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Concurrent Movies</p>
                <p className="font-medium">
                  {tierConfig.concurrentMovies === -1 ? 'Unlimited' : tierConfig.concurrentMovies}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Max Quality</p>
                <p className="font-medium">{tierConfig.maxQuality}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Storage</p>
                <p className="font-medium">{tierConfig.storageGb >= 1000 ? `${tierConfig.storageGb / 1000} TB` : `${tierConfig.storageGb} GB`}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Retention</p>
                <p className="font-medium">{tierConfig.retention.replace('_', ' ')}</p>
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              {currentTier === 'free' ? (
                <Button asChild>
                  <Link to="/pricing">Upgrade Plan</Link>
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={handleManageBilling}
                    disabled={portalLoading || !profile?.stripe_customer_id}
                  >
                    {portalLoading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : (
                      <>
                        <CreditCard className="w-4 h-4 mr-2" />
                        Manage Billing
                      </>
                    )}
                  </Button>
                  <Button variant="ghost" asChild>
                    <Link to="/pricing">Change Plan</Link>
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Sign Out */}
        <Card className="border-border">
          <CardContent className="pt-6">
            <Button variant="destructive" onClick={handleSignOut} className="w-full">
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Account;
