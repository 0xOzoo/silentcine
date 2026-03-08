import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, Zap, Crown, Building2, Ticket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
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

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? ANON_KEY;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_KEY,
          'Authorization': `Bearer ${token}`,
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
    <div className="py-8 px-4">
      <div className="container max-w-6xl mx-auto">

        {/* Back */}
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-6"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>

        {/* Header — centered like the original */}
        <div className="text-center mb-8">
          <p className="text-[11px] font-semibold tracking-[0.25em] uppercase text-primary mb-3">Pricing</p>
          <h1 className="font-display text-3xl font-bold tracking-tight mb-2">Plans for every screening.</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            From small gatherings to large venues. Pick the plan that fits your silent cinema needs.
          </p>
          {currency.code !== 'EUR' && (
            <p className="text-xs text-muted-foreground mt-1">
              Shown in {currency.code} (approx). Charged in EUR at checkout.
            </p>
          )}

          {/* Billing toggle — centered */}
          <div className="flex items-center justify-center mt-5">
            <div className="flex items-center gap-1 border border-border/40 rounded-lg p-1">
              <button
                onClick={() => setBillingInterval('month')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  billingInterval === 'month'
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingInterval('year')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors inline-flex items-center gap-1.5 ${
                  billingInterval === 'year'
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Yearly
                <span className="text-[10px] font-semibold text-primary">−20%</span>
              </button>
            </div>
          </div>
        </div>

        {/* Plans grid — natural height, no stretching */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => {
            const isCurrent = plan.tier === currentTier;
            const isLoading = loadingTier === plan.ctaAction;

            const isYearly = billingInterval === 'year' && plan.isSubscription && !!plan.yearlyPriceEur;
            const priceEur = isYearly ? plan.yearlyPriceEur! : plan.monthlyPriceEur;
            const periodLabel = plan.isSubscription ? (isYearly ? '/yr' : '/mo') : plan.period;
            const displayPrice = formatPrice(priceEur, currency);

            // Strikethrough: monthly uses oldMonthlyPriceEur, yearly uses oldMonthlyPriceEur × 12
            const oldYearlyPriceEur = plan.oldMonthlyPriceEur ? plan.oldMonthlyPriceEur * 12 : null;
            const displayOldPrice = isYearly
              ? (oldYearlyPriceEur ? formatPrice(oldYearlyPriceEur, currency) : null)
              : (plan.oldMonthlyPriceEur ? formatPrice(plan.oldMonthlyPriceEur, currency) : null);
            const discountPct = isYearly && oldYearlyPriceEur && plan.yearlyPriceEur
              ? Math.round((1 - plan.yearlyPriceEur / oldYearlyPriceEur) * 100)
              : (!isYearly && plan.oldMonthlyPriceEur)
                ? Math.round((1 - plan.monthlyPriceEur / plan.oldMonthlyPriceEur) * 100)
                : null;

            const monthlyEquivalent = isYearly ? formatPrice(plan.yearlyPriceEur! / 12, currency) : null;

            // Per-plan accent colours
            const isPromo = !!plan.promoBadge && !plan.highlight;
            const accentLine  = plan.highlight ? 'bg-primary'          : isPromo ? 'bg-purple-500'      : '';
            const cardBorder  = plan.highlight ? 'border-primary/50 bg-primary/[0.03] shadow-lg shadow-primary/10'
                                               : isPromo ? 'border-purple-500/40 shadow-md shadow-purple-500/10'
                                               : 'border-border/40';
            const labelColor  = plan.highlight ? 'text-primary'        : isPromo ? 'text-purple-400'    : '';
            const discColor   = plan.highlight || !isPromo ? 'text-primary' : 'text-purple-400';

            return (
              <div
                key={plan.tier}
                className={`relative flex flex-col rounded-xl border p-4 overflow-hidden ${cardBorder}`}
              >
                {/* Top accent line */}
                {(plan.highlight || isPromo) && (
                  <div className={`absolute top-0 left-0 right-0 h-[2px] ${accentLine}`} />
                )}

                {/* Plan label + name */}
                <div className="mb-3">
                  {plan.highlight && (
                    <p className={`text-[10px] font-semibold tracking-[0.2em] uppercase mb-1 ${labelColor}`}>Most Popular</p>
                  )}
                  {plan.promoBadge && (
                    <p className={`text-[10px] font-semibold tracking-[0.2em] uppercase mb-1 ${labelColor}`}>Launch Sale</p>
                  )}
                  <h3 className="font-display font-bold text-base leading-tight">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{plan.description}</p>
                </div>

                {/* Price */}
                <div className="mb-4">
                  {displayOldPrice && (
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs text-muted-foreground line-through">
                        {displayOldPrice}{isYearly ? '/yr' : '/mo'}
                      </span>
                      {discountPct && (
                        <span className={`text-[10px] font-semibold ${discColor}`}>−{discountPct}%</span>
                      )}
                    </div>
                  )}
                  <div className="flex items-end gap-1">
                    <span className="text-2xl font-bold tracking-tight">{displayPrice}</span>
                    {priceEur !== 0 && (
                      <span className="text-xs text-muted-foreground mb-0.5">{periodLabel}</span>
                    )}
                  </div>
                  {monthlyEquivalent && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">{monthlyEquivalent}/mo equiv.</p>
                  )}
                </div>

                {/* Features */}
                <ul className="flex-1 space-y-1.5 mb-4">
                  {plan.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs">
                      <Check className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isPromo ? 'text-purple-400' : 'text-primary'}`} />
                      <span className="text-foreground/80 leading-snug">{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <button
                  disabled={isCurrent || !!isLoading}
                  onClick={() => handleCheckout(plan.ctaAction)}
                  className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60 ${
                    isCurrent
                      ? 'border border-border/40 text-muted-foreground cursor-default'
                      : plan.highlight
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]'
                        : isPromo
                          ? 'bg-purple-600 hover:bg-purple-700 text-white active:scale-[0.98]'
                          : 'border border-border/60 text-foreground hover:border-foreground/40 active:scale-[0.98]'
                  }`}
                >
                  {isLoading ? (
                    <div className="mx-auto animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                  ) : isCurrent ? (
                    'Current Plan'
                  ) : (
                    plan.ctaLabel
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-8 flex items-center justify-between text-xs text-muted-foreground">
          <p>All plans include audio sync, subtitle support, and QR code sharing.</p>
          <p className="shrink-0 ml-4">
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            {' · '}
            <Link to="/refund" className="hover:text-foreground transition-colors">Refund Policy</Link>
          </p>
        </div>

      </div>
    </div>
  );
};

export default Pricing;
