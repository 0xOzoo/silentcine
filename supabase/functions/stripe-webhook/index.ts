/**
 * stripe-webhook — Handles Stripe webhook events.
 *
 * Events handled:
 *   - checkout.session.completed → Upgrade tier (subscription) or create event pass (one-time)
 *   - customer.subscription.deleted → Downgrade tier with grace period
 *   - customer.subscription.updated → Handle plan changes
 *   - invoice.payment_failed → Log warning (Stripe retries automatically)
 *
 * Security: Verifies Stripe webhook signature via STRIPE_WEBHOOK_SECRET (using Web Crypto).
 * Idempotency: Deduplicates via stripe_webhook_events table.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Signature verification using Web Crypto (Deno-compatible) ────────

async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
  tolerance = 300 // 5 min
): Promise<boolean> {
  const pairs = sigHeader.split(",").reduce((acc, pair) => {
    const [k, v] = pair.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {} as Record<string, string>);

  const timestamp = pairs["t"];
  const sig = pairs["v1"];
  if (!timestamp || !sig) return false;

  // Check tolerance
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > tolerance) return false;

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return expected === sig;
}

// ── Main handler ─────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!stripeSecretKey || !webhookSecret) {
      console.error("[Webhook] STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not configured");
      return new Response("Stripe not configured", { status: 503 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Read raw body + verify signature
    const body = await req.text();
    const sig = req.headers.get("stripe-signature");

    if (!sig) {
      console.warn("[Webhook] Missing stripe-signature header");
      return new Response("Missing signature", { status: 400 });
    }

    const valid = await verifyStripeSignature(body, sig, webhookSecret);
    if (!valid) {
      console.error("[Webhook] Signature verification failed");
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(body);

    // Idempotency check
    const { data: existing } = await supabase
      .from("stripe_webhook_events")
      .select("event_id")
      .eq("event_id", event.id)
      .maybeSingle();

    if (existing) {
      console.log(`[Webhook] Skipping duplicate event: ${event.id} (${event.type})`);
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Record event
    await supabase.from("stripe_webhook_events").insert({
      event_id: event.id,
      event_type: event.type,
      payload: event,
    });

    console.log(`[Webhook] Processing event: ${event.id} (${event.type})`);

    // ── Handle event types ───────────────────────────────────────
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const profileId = session.metadata?.profile_id;

        if (!profileId) {
          console.warn("[Webhook] checkout.session.completed missing profile_id in metadata");
          break;
        }

        if (session.metadata?.type === "event_pass") {
          // ── One-time Event Pass payment ──
          console.log(`[Webhook] Event Pass purchased for profile ${profileId}`);

          const { error: passError } = await supabase.from("event_passes").insert({
            profile_id: profileId,
            stripe_payment_id: session.payment_intent,
            status: "pending",
          });

          if (passError) {
            console.error("[Webhook] Failed to create event pass:", passError.message);
          }
        } else {
          // ── Subscription checkout ──
          const tier = session.metadata?.tier || "pro";
          const subscriptionId = session.subscription;
          const customerId = session.customer;

          console.log(`[Webhook] Subscription checkout: profile=${profileId} tier=${tier} sub=${subscriptionId}`);

          const { error: upgradeError } = await supabase.rpc("upgrade_profile_tier", {
            p_profile_id: profileId,
            p_new_tier: tier,
            p_stripe_customer_id: customerId,
            p_stripe_subscription_id: subscriptionId,
          });

          if (upgradeError) {
            console.error("[Webhook] upgrade_profile_tier failed:", upgradeError.message);
          } else {
            console.log(`[Webhook] Profile ${profileId} upgraded to ${tier}`);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer;

        console.log(`[Webhook] Subscription deleted for customer ${customerId}`);

        const { data: profile } = await supabase
          .from("profiles")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .single();

        if (profile) {
          const { error: downgradeError } = await supabase.rpc("downgrade_profile_tier", {
            p_profile_id: profile.id,
            p_grace_days: 30,
          });

          if (downgradeError) {
            console.error("[Webhook] downgrade_profile_tier failed:", downgradeError.message);
          }
        } else {
          console.warn(`[Webhook] No profile found for customer ${customerId}`);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const newTier = subscription.metadata?.tier;

        if (newTier) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (profile) {
            console.log(`[Webhook] Subscription updated: profile=${profile.id} newTier=${newTier}`);

            const { error } = await supabase.rpc("upgrade_profile_tier", {
              p_profile_id: profile.id,
              p_new_tier: newTier,
              p_stripe_customer_id: customerId,
              p_stripe_subscription_id: subscription.id,
            });

            if (error) {
              console.error("[Webhook] upgrade on update failed:", error.message);
            }
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.warn(`[Webhook] Payment failed for customer ${invoice.customer} — Stripe will retry`);
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event type: ${event.type}`);
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Webhook] Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
