/**
 * enforce-retention — Daily cron job to enforce content retention policies.
 *
 * 1. Expire lapsed event passes (48h window)
 * 2. Notify about movies expiring in 2 days (returns list for email)
 * 3. Archive movies past their retention date
 * 4. Delete Storage files for movies archived >7 days ago
 * 5. Clean up old webhook events (>90 days)
 *
 * Called via Supabase cron or manual trigger.
 * Protected by service_role — no CORS needed for cron.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const results: Record<string, unknown> = {};

    // 1. Expire lapsed event passes
    console.log("[Retention] Expiring lapsed event passes...");
    const { data: expiredPasses, error: passError } = await supabase.rpc("expire_event_passes");
    if (passError) {
      console.error("[Retention] expire_event_passes error:", passError.message);
    }
    results.expired_passes = expiredPasses ?? 0;
    console.log(`[Retention] Expired ${results.expired_passes} event passes`);

    // 2. Get movies expiring in the next 2 days (for email notifications)
    console.log("[Retention] Checking for movies expiring soon...");
    const { data: expiringMovies, error: notifyError } = await supabase.rpc("notify_retention_expiring", {
      p_days_ahead: 2,
    });
    if (notifyError) {
      console.error("[Retention] notify_retention_expiring error:", notifyError.message);
    }
    results.expiring_soon = expiringMovies?.length ?? 0;

    if (expiringMovies && expiringMovies.length > 0) {
      console.log(`[Retention] ${expiringMovies.length} movies expiring within 2 days:`);
      for (const m of expiringMovies) {
        console.log(`  - "${m.movie_title}" (${m.profile_email}) expires at ${m.expires_at}`);
      }
      // TODO: Send email notifications via Supabase Edge Function / Resend / etc.
      // For now, just log them.
    }

    // 3. Archive expired movies
    console.log("[Retention] Archiving expired movies...");
    const { data: archivedCount, error: archiveError } = await supabase.rpc("enforce_retention");
    if (archiveError) {
      console.error("[Retention] enforce_retention error:", archiveError.message);
    }
    results.archived_movies = archivedCount ?? 0;
    console.log(`[Retention] Archived ${results.archived_movies} movies`);

    // 4. Delete Storage files for movies archived >7 days ago
    console.log("[Retention] Cleaning up old archived movie files...");
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data: oldArchived, error: fetchError } = await supabase
      .from("movies")
      .select("id, video_path, audio_path, audio_tracks, subtitle_tracks, variants")
      .eq("status", "archived")
      .lt("archived_at", sevenDaysAgo);

    if (fetchError) {
      console.error("[Retention] Failed to fetch old archived movies:", fetchError.message);
    }

    let deletedFiles = 0;
    if (oldArchived && oldArchived.length > 0) {
      for (const movie of oldArchived) {
        const pathsToDelete: string[] = [];

        // Collect all storage paths
        if (movie.video_path) pathsToDelete.push(movie.video_path);
        if (movie.audio_path) pathsToDelete.push(movie.audio_path);

        // Audio tracks
        if (Array.isArray(movie.audio_tracks)) {
          for (const track of movie.audio_tracks) {
            if (track.storagePath) pathsToDelete.push(track.storagePath);
          }
        }

        // Subtitle tracks
        if (Array.isArray(movie.subtitle_tracks)) {
          for (const track of movie.subtitle_tracks) {
            if (track.storagePath) pathsToDelete.push(track.storagePath);
          }
        }

        // Video variants
        if (Array.isArray(movie.variants)) {
          for (const variant of movie.variants) {
            if (variant.path) pathsToDelete.push(variant.path);
          }
        }

        // Delete files from Storage
        if (pathsToDelete.length > 0) {
          const { error: deleteError } = await supabase.storage
            .from("movies")
            .remove(pathsToDelete);

          if (deleteError) {
            console.error(`[Retention] Failed to delete files for movie ${movie.id}:`, deleteError.message);
          } else {
            deletedFiles += pathsToDelete.length;
            console.log(`[Retention] Deleted ${pathsToDelete.length} files for movie ${movie.id}`);
          }
        }

        // Delete the movie row itself
        await supabase.from("movies").delete().eq("id", movie.id);
      }
    }
    results.deleted_files = deletedFiles;
    results.deleted_movies = oldArchived?.length ?? 0;

    // 5. Clean up old webhook events
    console.log("[Retention] Cleaning up old webhook events...");
    const { data: cleanedEvents, error: cleanError } = await supabase.rpc("cleanup_webhook_events", {
      p_days_old: 90,
    });
    if (cleanError) {
      console.error("[Retention] cleanup_webhook_events error:", cleanError.message);
    }
    results.cleaned_webhook_events = cleanedEvents ?? 0;

    console.log("[Retention] Cron run complete:", JSON.stringify(results));

    return new Response(
      JSON.stringify({ success: true, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Retention] Unhandled error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
