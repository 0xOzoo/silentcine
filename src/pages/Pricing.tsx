import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Zap, Crown, Building2, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { TIER_LIMITS, type SubscriptionTier } from '@/types/profile';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── Currency conversion ──────────────────────────────────────────────

interface CurrencyInfo {
  code: string;
  symbol: string;
  rate: number; // multiplier from EUR
}

const CURRENCIES: Record<string, CurrencyInfo> = {
  EUR: { code: 'EUR', symbol: '\u20ac', rate: 1 },
  USD: { code: 'USD', symbol: '$', rate: 1.10 },
  GBP: { code: 'GBP', symbol: '\u00a3', rate: 0.86 },
};

/** Detect visitor currency from locale/timezone */
function detectCurrency(): CurrencyInfo {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const locale = navigator.language || '';

    // US timezones or en-US locale
    if (tz.startsWith('America/') || locale.startsWith('en-US')) {
      return CURRENCIES.USD;
    }
    // UK timezones or en-GB locale
    if (tz === 'Europe/London' || locale.startsWith('en-GB')) {
      return CURRENCIES.GBP;
    }
  } catch {
    // fallback
  }
  return CURRENCIES.EUR;
}

function formatPrice(eurAmount: number, currency: CurrencyInfo): string {
  const converted = eurAmount * currency.rate;
  // Round to nearest .99 for clean display
  const rounded = Math.floor(converted) + 0.99;
  // For small amounts (< 1), just show converted
  if (eurAmount === 0) return 'Free';
  return `${currency.symbol}${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2)}`;
}

// ── Plan config ──────────────────────────────────────────────────────

type BillingInterval = 'month' | 'year';

interface PlanConfig {
  tier: SubscriptionTier;
  name: string;
  monthlyPriceEur: number;    // monthly price in EUR
  yearlyPriceEur?: number;    // yearly price in EUR (only for subscription plans)
  oldMonthlyPriceEur?: number; // original monthly price (for strikethrough promo)
  period: string;              // label for non-subscription plans (e.g. "48 hours", "forever")
  isSubscription: boolean;     // true for plans that support monthly/yearly toggle
  description: string;
  icon: React.ReactNode;
  features: string[];
  highlight?: boolean;
  promoBadge?: string;
  ctaLabel: string;
  ctaAction: 'free' | 'event_pass' | 'checkout_pro' | 'checkout_enterprise' | 'contact';
}

const plans: PlanConfig[] = [
  {
    tier: 'free',
    name: 'Free',
    monthlyPriceEur: 0,
    period: 'forever',
    isSubscription: false,
    description: 'Try SilentCine with small audiences',
    icon: <Zap className="w-5 h-5" />,
    features: [
      'Up to 5 listeners',
      '1 concurrent movie',
      '720p quality',
      '2.5 GB storage',
      '7-day retention',
      'SilentCine branding',
    ],
    ctaLabel: 'Current Plan',
    ctaAction: 'free',
  },
  {
    tier: 'event',
    name: 'Event Pass',
    monthlyPriceEur: 29,
    period: '48 hours',
    isSubscription: false,
    description: 'Perfect for one-time outdoor screenings',
    icon: <Ticket className="w-5 h-5" />,
    features: [
      'Up to 50 listeners',
      '3 concurrent movies',
      '1080p quality',
      '50 GB storage',
      '30-day retention',
      'SilentCine branding',
      '48-hour access window',
    ],
    ctaLabel: 'Buy Event Pass',
    ctaAction: 'event_pass',
  },
  {
    tier: 'pro',
    name: 'Pro',
    monthlyPriceEur: 19,
    yearlyPriceEur: 179.99,        // ~15/mo, saves ~20%
    period: '/month',
    isSubscription: true,
    description: 'For regular screening organizers',
    icon: <Crown className="w-5 h-5" />,
    features: [
      'Up to 100 listeners',
      '5 concurrent movies',
      '1080p quality',
      '100 GB storage',
      'Permanent retention',
      'Custom branding',
      'Priority support',
    ],
    highlight: true,
    ctaLabel: 'Subscribe to Pro',
    ctaAction: 'checkout_pro',
  },
  {
    tier: 'enterprise',
    name: 'Enterprise',
    monthlyPriceEur: 69.99,
    yearlyPriceEur: 669.99,        // ~55.83/mo, saves ~20%
    oldMonthlyPriceEur: 99,
    period: '/month',
    isSubscription: true,
    description: 'For venues and organizations',
    icon: <Building2 className="w-5 h-5" />,
    features: [
      'Unlimited listeners',
      'Unlimited concurrent movies',
      '4K quality',
      '1 TB storage',
      'Permanent retention',
      'White-label branding',
      'Dedicated support',
      'Custom integrations',
    ],
    promoBadge: 'Launch Sale',
    ctaLabel: 'Subscribe to Enterprise',
    ctaAction: 'checkout_enterprise',
  },
];

const Pricing = () => {
  const { profile, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [loadingTier, setLoadingTier] = useState<string | null>(null);
  const [currency, setCurrency] = useState<CurrencyInfo>(CURRENCIES.EUR);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('month');

  const currentTier = profile?.subscription_tier ?? 'free';

  // Detect visitor currency on mount
  useEffect(() => {
    setCurrency(detectCurrency());
  }, []);

  const handleCheckout = async (action: PlanConfig['ctaAction']) => {
    if (action === 'free') return;

    if (!isAuthenticated) {
      toast.error('Please sign in first to subscribe');
      navigate('/login');
      return;
    }

    if (!profile?.id) {
      toast.error('Profile not loaded yet. Please try again.');
      return;
    }

    setLoadingTier(action);

    try {
      let endpoint: string;
      let body: Record<string, string>;

      if (action === 'event_pass') {
        endpoint = `${SUPABASE_URL}/functions/v1/create-event-pass`;
        body = { profileId: profile.id };
      } else if (action === 'checkout_pro') {
        endpoint = `${SUPABASE_URL}/functions/v1/create-checkout-session`;
        body = { profileId: profile.id, tier: 'pro', interval: billingInterval };
      } else if (action === 'checkout_enterprise') {
        endpoint = `${SUPABASE_URL}/functions/v1/create-checkout-session`;
        body = { profileId: profile.id, tier: 'enterprise', interval: billingInterval };
      } else {
        toast.info('Please contact us at hello@silentcine.com');
        setLoadingTier(null);
        return;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Checkout failed';
      toast.error(msg);
    } finally {
      setLoadingTier(null);
    }
  };

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="container max-w-6xl mx-auto">
        <Button variant="ghost" asChild className="mb-8">
          <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Back</Link>
        </Button>

        <div className="text-center mb-12">
          <h1 className="font-display text-3xl font-bold mb-3">Choose Your Plan</h1>
          <p className="text-muted-foreground max-w-md mx-auto">
            From small gatherings to large venues. Pick the plan that fits your silent cinema needs.
          </p>
          {currency.code !== 'EUR' && (
            <p className="text-xs text-muted-foreground mt-2">
              Prices shown in {currency.code} (approximate). You will be charged in EUR at checkout.
            </p>
          )}

          {/* Billing interval toggle */}
          <div className="flex items-center justify-center mt-6">
            {/* Invisible counterweight to keep toggle centered */}
            <Badge variant="default" className="text-xs mr-1 opacity-0 pointer-events-none">Save 20%</Badge>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium transition-colors ${billingInterval === 'month' ? 'text-foreground' : 'text-muted-foreground'}`}>
                Monthly
              </span>
              <button
                onClick={() => setBillingInterval(prev => prev === 'month' ? 'year' : 'month')}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  billingInterval === 'year' ? 'bg-primary' : 'bg-muted'
                }`}
                aria-label="Toggle billing interval"
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                    billingInterval === 'year' ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
              <span className={`text-sm font-medium transition-colors ${billingInterval === 'year' ? 'text-foreground' : 'text-muted-foreground'}`}>
                Yearly
              </span>
            </div>
            <Badge variant="default" className={`text-xs ml-1 transition-opacity ${billingInterval === 'year' ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>Save 20%</Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => {
            const isCurrent = plan.tier === currentTier;
            const isLoading = loadingTier === plan.ctaAction;

            // Determine displayed price based on billing interval
            const isYearly = billingInterval === 'year' && plan.isSubscription && plan.yearlyPriceEur;
            const priceEur = isYearly ? plan.yearlyPriceEur! : plan.monthlyPriceEur;
            const periodLabel = plan.isSubscription
              ? (isYearly ? '/year' : '/month')
              : plan.period;
            const displayPrice = formatPrice(priceEur, currency);

            // Old/strikethrough price (launch promo): only for monthly
            const displayOldPrice = (!isYearly && plan.oldMonthlyPriceEur)
              ? formatPrice(plan.oldMonthlyPriceEur, currency)
              : null;

            // For yearly subscription plans, show the monthly equivalent
            const monthlyEquivalent = isYearly
              ? formatPrice(plan.yearlyPriceEur! / 12, currency)
              : null;

            return (
              <Card
                key={plan.tier}
                className={`relative flex flex-col ${
                  plan.highlight
                    ? 'border-primary shadow-lg shadow-primary/10'
                    : plan.promoBadge
                      ? 'border-purple-500/50 shadow-md shadow-purple-500/10'
                      : 'border-border'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge variant="default" className="text-xs">Most Popular</Badge>
                  </div>
                )}
                {plan.promoBadge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="text-xs bg-purple-600 hover:bg-purple-700 text-white">{plan.promoBadge}</Badge>
                  </div>
                )}

                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2 mb-2">
                    {plan.icon}
                    <CardTitle className="text-lg">{plan.name}</CardTitle>
                  </div>
                  <CardDescription>{plan.description}</CardDescription>
                </CardHeader>

                <CardContent className="flex-1">
                  <div className="mb-6">
                    {displayOldPrice && (
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg text-muted-foreground line-through">{displayOldPrice}</span>
                        <Badge variant="outline" className="text-xs text-purple-400 border-purple-400/30">-30%</Badge>
                      </div>
                    )}
                    <span className="text-3xl font-bold">{displayPrice}</span>
                    {priceEur !== 0 && (
                      <span className="text-muted-foreground text-sm ml-1">{periodLabel}</span>
                    )}
                    {monthlyEquivalent && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {monthlyEquivalent}/mo equivalent
                      </p>
                    )}
                  </div>

                  <ul className="space-y-2.5">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter className="pt-4">
                  <Button
                    className={`w-full ${plan.promoBadge ? 'bg-purple-600 hover:bg-purple-700 text-white' : ''}`}
                    variant={plan.highlight ? 'default' : plan.promoBadge ? 'default' : 'outline'}
                    disabled={isCurrent || isLoading}
                    onClick={() => handleCheckout(plan.ctaAction)}
                  >
                    {isLoading ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                    ) : isCurrent ? (
                      'Current Plan'
                    ) : (
                      plan.ctaLabel
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        <div className="text-center mt-12 text-sm text-muted-foreground">
          <p>All plans include audio sync, subtitle support, and QR code session sharing.</p>
          <p className="mt-1">
            Questions? Check our{' '}
            <Link to="/terms" className="text-primary hover:underline">Terms</Link>{' '}
            and{' '}
            <Link to="/refund" className="text-primary hover:underline">Refund Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Pricing;
