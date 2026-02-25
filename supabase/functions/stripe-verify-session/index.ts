/**
 * stripe-verify-session — Verifies a Stripe Checkout Session after redirect.
 *
 * POST body: { sessionId: string }
 * Returns: { verified: true, status, type, tier } on success
 *
 * This prevents spoofing the success page by verifying the session_id
 * against Stripe's API. Only returns minimal info — no sensitive data.
 */

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

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const { sessionId } = await req.json();

    if (!sessionId || typeof sessionId !== "string") {
      return new Response(
        JSON.stringify({ error: "sessionId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Retrieve the session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (!session) {
      return new Response(
        JSON.stringify({ verified: false, error: "Session not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine type and tier from metadata
    const type = session.metadata?.type === "event_pass" ? "event_pass" : "subscription";
    const tier = session.metadata?.tier || (type === "event_pass" ? "event" : null);

    console.log(`[VerifySession] Session ${sessionId}: status=${session.payment_status}, type=${type}, tier=${tier}`);

    return new Response(
      JSON.stringify({
        verified: true,
        payment_status: session.payment_status, // "paid", "unpaid", "no_payment_required"
        status: session.status, // "complete", "expired", "open"
        type,
        tier,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[VerifySession] Error:", error);

    // If Stripe says the session doesn't exist, return 404
    if (error?.statusCode === 404 || error?.code === "resource_missing") {
      return new Response(
        JSON.stringify({ verified: false, error: "Invalid session" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
