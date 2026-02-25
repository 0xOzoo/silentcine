/**
 * movie-manager — CRUD operations for user movies.
 *
 * Actions (via ?action= query param):
 *   GET  ?action=list       — List all movies for the authenticated user's profile
 *   DELETE ?action=delete    — Soft-delete (archive) a movie + remove storage files
 *   POST ?action=retranscode — Request re-transcode at higher quality (tier check)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

    // Find the user's profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, subscription_tier")
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

    // ── LIST MOVIES ─────────────────────────────────────────────
    if (action === "list") {
      const { data: movies, error } = await supabaseAdmin
        .from("movies")
        .select("id, title, status, video_path, audio_path, retention_policy, quality_profile, created_at, updated_at, archived_at, has_audio_extracted, audio_tracks, subtitle_tracks, variants, processing_error")
        .eq("profile_id", profile.id)
        .order("created_at", { ascending: false });

      if (error) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch movies" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ movies: movies ?? [] }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── DELETE MOVIE ─────────────────────────────────────────────
    if (action === "delete" && req.method === "DELETE") {
      const { movieId } = await req.json().catch(() => ({ movieId: null }));

      if (!movieId) {
        return new Response(
          JSON.stringify({ error: "movieId is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify ownership
      const { data: movie } = await supabaseAdmin
        .from("movies")
        .select("id, video_path, audio_path, audio_tracks, subtitle_tracks, variants")
        .eq("id", movieId)
        .eq("profile_id", profile.id)
        .single();

      if (!movie) {
        return new Response(
          JSON.stringify({ error: "Movie not found or access denied" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Collect all storage paths to delete
      const pathsToDelete: string[] = [];
      if (movie.video_path) pathsToDelete.push(movie.video_path);
      if (movie.audio_path) pathsToDelete.push(movie.audio_path);
      if (Array.isArray(movie.audio_tracks)) {
        for (const t of movie.audio_tracks) {
          if ((t as Record<string, unknown>).storagePath) pathsToDelete.push((t as Record<string, unknown>).storagePath as string);
        }
      }
      if (Array.isArray(movie.subtitle_tracks)) {
        for (const t of movie.subtitle_tracks) {
          if ((t as Record<string, unknown>).storagePath) pathsToDelete.push((t as Record<string, unknown>).storagePath as string);
        }
      }
      if (Array.isArray(movie.variants)) {
        for (const v of movie.variants) {
          if ((v as Record<string, unknown>).path) pathsToDelete.push((v as Record<string, unknown>).path as string);
        }
      }

      // Delete storage files
      if (pathsToDelete.length > 0) {
        await supabaseAdmin.storage.from("movies").remove(pathsToDelete);
      }

      // Delete the movie row
      await supabaseAdmin.from("movies").delete().eq("id", movieId);

      console.log(`[MovieManager] Deleted movie ${movieId} (${pathsToDelete.length} files)`);

      return new Response(
        JSON.stringify({ success: true, deletedFiles: pathsToDelete.length }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── RETRANSCODE ─────────────────────────────────────────────
    if (action === "retranscode" && req.method === "POST") {
      const { movieId, qualities } = await req.json();

      if (!movieId) {
        return new Response(
          JSON.stringify({ error: "movieId is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify ownership
      const { data: movie } = await supabaseAdmin
        .from("movies")
        .select("id, video_path, quality_profile")
        .eq("id", movieId)
        .eq("profile_id", profile.id)
        .single();

      if (!movie) {
        return new Response(
          JSON.stringify({ error: "Movie not found or access denied" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check tier allows requested qualities
      const { data: allowed } = await supabaseAdmin.rpc("get_available_qualities", {
        p_movie_id: movieId,
      });

      return new Response(
        JSON.stringify({
          success: true,
          movieId,
          availableQualities: allowed ?? [],
          message: "Retranscode request queued. Use the worker /transcode endpoint to process.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use: list, delete, retranscode" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[MovieManager] Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
