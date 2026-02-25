/**
 * account-manager — Profile updates and account deletion.
 *
 * Actions (via ?action= query param):
 *   PUT  ?action=update-profile — Update display_name, custom_branding_url, watermark_text, watermark_image_url
 *   GET  ?action=subscription-info — Fetch Stripe subscription details (next payment date, interval, status)
 *   POST ?action=list-passes    — List user's event passes
 *   DELETE ?action=delete-account — GDPR: delete all user data + auth account
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    // Authenticate user via JWT
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: authHeader } },
      }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Find user profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("auth_user_id", user.id)
      .single();

    if (!profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // ── UPDATE PROFILE ──────────────────────────────────────────
    if (action === "update-profile" && req.method === "PUT") {
      const body = await req.json();
      const allowedFields = ["display_name", "custom_branding_url", "watermark_text", "watermark_image_url", "watermark_position", "watermark_opacity", "watermark_size"];

      const updates: Record<string, unknown> = {};
      for (const key of Object.keys(body)) {
        if (allowedFields.includes(key)) {
          updates[key] = body[key];
        }
      }

      // Enterprise-only: custom_branding_url, watermark_image_url
      if (updates.custom_branding_url !== undefined && profile.subscription_tier !== "enterprise") {
        return new Response(
          JSON.stringify({ error: "Custom branding is an Enterprise feature" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (updates.watermark_image_url !== undefined && profile.subscription_tier !== "enterprise") {
        return new Response(
          JSON.stringify({ error: "Logo watermark is an Enterprise feature" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Pro or above: watermark_text, watermark_position, watermark_opacity
      if (updates.watermark_text !== undefined && !["pro", "enterprise"].includes(profile.subscription_tier)) {
        return new Response(
          JSON.stringify({ error: "Custom watermark text requires Pro or Enterprise" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Position, opacity, size require at least Pro (they customize the watermark appearance)
      const positionOpacityFields = ["watermark_position", "watermark_opacity", "watermark_size"];
      for (const f of positionOpacityFields) {
        if (updates[f] !== undefined && !["pro", "enterprise"].includes(profile.subscription_tier)) {
          return new Response(
            JSON.stringify({ error: "Watermark customization requires Pro or Enterprise" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Validate watermark_position values
      if (updates.watermark_position !== undefined) {
        const validPositions = ["top-left", "top-right", "bottom-left", "bottom-right", "center"];
        if (!validPositions.includes(updates.watermark_position as string)) {
          return new Response(
            JSON.stringify({ error: "Invalid watermark position" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Validate watermark_opacity (0.0 - 1.0)
      if (updates.watermark_opacity !== undefined) {
        const opacity = Number(updates.watermark_opacity);
        if (isNaN(opacity) || opacity < 0 || opacity > 1) {
          return new Response(
            JSON.stringify({ error: "Watermark opacity must be between 0 and 1" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        updates.watermark_opacity = opacity;
      }

      // Validate watermark_size (0.5 - 3.0, multiplier)
      if (updates.watermark_size !== undefined) {
        const size = Number(updates.watermark_size);
        if (isNaN(size) || size < 0.5 || size > 3) {
          return new Response(
            JSON.stringify({ error: "Watermark size must be between 0.5 and 3" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        updates.watermark_size = size;
      }

      if (Object.keys(updates).length === 0) {
        return new Response(
          JSON.stringify({ error: "No valid fields to update" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: updated, error: updateError } = await supabaseAdmin
        .from("profiles")
        .update(updates)
        .eq("id", profile.id)
        .select()
        .single();

      if (updateError) {
        return new Response(
          JSON.stringify({ error: "Failed to update profile" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ profile: updated }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── LIST EVENT PASSES ───────────────────────────────────────
    if (action === "list-passes") {
      const { data: passes, error } = await supabaseAdmin
        .from("event_passes")
        .select("*")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch event passes" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ passes: passes ?? [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── DELETE ACCOUNT (GDPR) ───────────────────────────────────
    if (action === "delete-account" && req.method === "DELETE") {
      const { confirm } = await req.json().catch(() => ({ confirm: false }));

      if (confirm !== true) {
        return new Response(
          JSON.stringify({ error: "Must send { confirm: true } to delete account" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[AccountManager] Deleting account for user ${user.id} (profile ${profile.id})`);

      // 1. Delete all movie storage files
      const { data: movies } = await supabaseAdmin
        .from("movies")
        .select("id, video_path, audio_path, audio_tracks, subtitle_tracks, variants")
        .eq("profile_id", profile.id);

      if (movies && movies.length > 0) {
        const allPaths: string[] = [];
        for (const movie of movies) {
          if (movie.video_path) allPaths.push(movie.video_path);
          if (movie.audio_path) allPaths.push(movie.audio_path);
          if (Array.isArray(movie.audio_tracks)) {
            for (const t of movie.audio_tracks) {
              if ((t as Record<string, unknown>).storagePath) allPaths.push((t as Record<string, unknown>).storagePath as string);
            }
          }
          if (Array.isArray(movie.subtitle_tracks)) {
            for (const t of movie.subtitle_tracks) {
              if ((t as Record<string, unknown>).storagePath) allPaths.push((t as Record<string, unknown>).storagePath as string);
            }
          }
          if (Array.isArray(movie.variants)) {
            for (const v of movie.variants) {
              if ((v as Record<string, unknown>).path) allPaths.push((v as Record<string, unknown>).path as string);
            }
          }
        }

        if (allPaths.length > 0) {
          await supabaseAdmin.storage.from("movies").remove(allPaths);
          console.log(`[AccountManager] Deleted ${allPaths.length} storage files`);
        }

        // Delete movie rows
        await supabaseAdmin.from("movies").delete().eq("profile_id", profile.id);
      }

      // 2. Delete event passes (CASCADE should handle this, but be explicit)
      await supabaseAdmin.from("event_passes").delete().eq("profile_id", profile.id);

      // 3. Delete sessions
      await supabaseAdmin.from("sessions").delete().eq("profile_id", profile.id);

      // 4. Delete profile
      await supabaseAdmin.from("profiles").delete().eq("id", profile.id);

      // 5. Delete auth user
      const { error: deleteAuthError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
      if (deleteAuthError) {
        console.error("[AccountManager] Failed to delete auth user:", deleteAuthError.message);
      }

      console.log(`[AccountManager] Account deleted for user ${user.id}`);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── SUBSCRIPTION INFO ───────────────────────────────────────
    if (action === "subscription-info") {
      if (!profile.stripe_subscription_id) {
        return new Response(
          JSON.stringify({ subscription: null }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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

      try {
        const sub = await stripe.subscriptions.retrieve(profile.stripe_subscription_id);
        return new Response(
          JSON.stringify({
            subscription: {
              status: sub.status,
              current_period_end: sub.current_period_end,
              current_period_start: sub.current_period_start,
              cancel_at_period_end: sub.cancel_at_period_end,
              interval: sub.items?.data?.[0]?.price?.recurring?.interval ?? null,
            },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (stripeErr: any) {
        console.error("[AccountManager] Stripe subscription fetch error:", stripeErr?.message);
        return new Response(
          JSON.stringify({ subscription: null }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use: update-profile, subscription-info, list-passes, delete-account" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[AccountManager] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
