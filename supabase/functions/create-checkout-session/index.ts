/**
 * create-checkout-session — Creates a Stripe Checkout Session for Pro/Enterprise subscriptions.
 *
 * POST body: { tier: "pro" | "enterprise", profileId: string, interval?: "month" | "year" }
 * Returns: { url: string } — the Stripe Checkout URL to redirect to
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe is not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // ── Authenticate the user via JWT ──────────────────────────
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { auth: { persistSession: false }, global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Get profile from request body
    const { tier, profileId, interval } = await req.json();

    if (!tier || !profileId) {
      return new Response(
        JSON.stringify({ error: "tier and profileId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["pro", "enterprise"].includes(tier)) {
      return new Response(
        JSON.stringify({ error: "tier must be 'pro' or 'enterprise'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const billingInterval = interval === "year" ? "year" : "month";

    // Fetch the profile — MUST belong to the authenticated user
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, email, stripe_customer_id")
      .eq("id", profileId)
      .eq("auth_user_id", user.id)
      .single();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found or access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get or create Stripe customer
    let customerId = profile.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email || undefined,
        metadata: {
          profile_id: profileId,
          silentcine_tier: tier,
        },
      });
      customerId = customer.id;

      // Store the customer ID
      await supabaseAdmin
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", profileId);
    }

    // Map tier + interval to Stripe Price ID
    let priceId: string | undefined;
    if (tier === "pro") {
      priceId = billingInterval === "year"
        ? Deno.env.get("STRIPE_PRICE_PRO_YEARLY")
        : Deno.env.get("STRIPE_PRICE_PRO");
    } else {
      priceId = billingInterval === "year"
        ? Deno.env.get("STRIPE_PRICE_ENTERPRISE_YEARLY")
        : Deno.env.get("STRIPE_PRICE_ENTERPRISE");
    }

    if (!priceId) {
      return new Response(
        JSON.stringify({ error: "Pricing not configured for this tier" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine success/cancel URLs
    const origin = req.headers.get("origin") || "http://localhost:8080";

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout/cancel`,
      subscription_data: {
        metadata: {
          profile_id: profileId,
          tier: tier,
          interval: billingInterval,
        },
      },
      metadata: {
        profile_id: profileId,
        tier: tier,
        interval: billingInterval,
      },
    });

    console.log(`[Checkout] Created session ${session.id} for profile ${profileId} (${tier}/${billingInterval})`);

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Checkout] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
