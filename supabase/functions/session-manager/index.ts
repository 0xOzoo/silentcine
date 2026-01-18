import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-host-token",
};

// Generate a secure session code
function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const randomValues = new Uint8Array(6);
  crypto.getRandomValues(randomValues);
  
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // CREATE SESSION - generates a new session with host token
    if (req.method === "POST" && action === "create") {
      const { title } = await req.json().catch(() => ({ title: "Untitled Session" }));
      
      const code = generateCode();
      const hostToken = crypto.randomUUID();

      const { data, error } = await supabaseAdmin
        .from("sessions")
        .insert({
          code,
          title: title || "Untitled Session",
          host_token: hostToken,
        })
        .select()
        .single();

      if (error) {
        console.error("Create session error:", error);
        return new Response(
          JSON.stringify({ error: "Failed to create session" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Session created: ${code}`);

      // Return session data with host token (only returned on creation)
      return new Response(
        JSON.stringify({
          session: {
            id: data.id,
            code: data.code,
            title: data.title,
            audio_url: data.audio_url,
            audio_filename: data.audio_filename,
            video_url: data.video_url,
            is_playing: data.is_playing,
            current_time_ms: data.current_time_ms,
            last_sync_at: data.last_sync_at,
            created_at: data.created_at,
            audio_tracks: data.audio_tracks || [],
            subtitle_tracks: data.subtitle_tracks || [],
            selected_audio_track: data.selected_audio_track ?? 0,
            selected_subtitle_track: data.selected_subtitle_track ?? -1,
          },
          hostToken,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // UPDATE SESSION - requires valid host token
    if (req.method === "PUT" && action === "update") {
      const hostToken = req.headers.get("x-host-token");
      
      if (!hostToken) {
        return new Response(
          JSON.stringify({ error: "Host token required" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const body = await req.json();
      const { sessionId, updates } = body;

      if (!sessionId || !updates) {
        return new Response(
          JSON.stringify({ error: "sessionId and updates required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate allowed fields only
      const allowedFields = [
        "title", "audio_url", "audio_filename", "video_url",
        "is_playing", "current_time_ms", "last_sync_at",
        "audio_tracks", "subtitle_tracks",
        "selected_audio_track", "selected_subtitle_track"
      ];

      const sanitizedUpdates: Record<string, unknown> = {};
      for (const key of Object.keys(updates)) {
        if (allowedFields.includes(key)) {
          sanitizedUpdates[key] = updates[key];
        }
      }

      if (Object.keys(sanitizedUpdates).length === 0) {
        return new Response(
          JSON.stringify({ error: "No valid fields to update" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify host token matches the session
      const { data: sessionData, error: fetchError } = await supabaseAdmin
        .from("sessions")
        .select("id, host_token")
        .eq("id", sessionId)
        .single();

      if (fetchError || !sessionData) {
        return new Response(
          JSON.stringify({ error: "Session not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (sessionData.host_token !== hostToken) {
        console.warn(`Invalid host token attempt for session ${sessionId}`);
        return new Response(
          JSON.stringify({ error: "Invalid host token" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Perform the update
      const { data: updatedData, error: updateError } = await supabaseAdmin
        .from("sessions")
        .update(sanitizedUpdates)
        .eq("id", sessionId)
        .select()
        .single();

      if (updateError) {
        console.error("Update session error:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update session" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Session ${sessionId} updated successfully`);

      return new Response(
        JSON.stringify({
          session: {
            id: updatedData.id,
            code: updatedData.code,
            title: updatedData.title,
            audio_url: updatedData.audio_url,
            audio_filename: updatedData.audio_filename,
            video_url: updatedData.video_url,
            is_playing: updatedData.is_playing,
            current_time_ms: updatedData.current_time_ms,
            last_sync_at: updatedData.last_sync_at,
            created_at: updatedData.created_at,
            audio_tracks: updatedData.audio_tracks || [],
            subtitle_tracks: updatedData.subtitle_tracks || [],
            selected_audio_track: updatedData.selected_audio_track ?? 0,
            selected_subtitle_track: updatedData.selected_subtitle_track ?? -1,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET SESSION (for listeners) - public access via session code
    if (req.method === "GET" && action === "join") {
      const sessionCode = url.searchParams.get("code");
      
      if (!sessionCode) {
        return new Response(
          JSON.stringify({ error: "Session code required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate code format
      if (!/^[A-Z0-9]{1,10}$/.test(sessionCode.toUpperCase())) {
        return new Response(
          JSON.stringify({ error: "Invalid session code format" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await supabaseAdmin
        .from("sessions")
        .select("id, code, title, audio_url, audio_filename, video_url, is_playing, current_time_ms, last_sync_at, created_at, audio_tracks, subtitle_tracks, selected_audio_track, selected_subtitle_track")
        .eq("code", sessionCode.toUpperCase())
        .maybeSingle();

      if (error) {
        console.error("Fetch session error:", error);
        return new Response(
          JSON.stringify({ error: "Failed to fetch session" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!data) {
        return new Response(
          JSON.stringify({ error: "Session not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          session: {
            id: data.id,
            code: data.code,
            title: data.title,
            audio_url: data.audio_url,
            audio_filename: data.audio_filename,
            video_url: data.video_url,
            is_playing: data.is_playing,
            current_time_ms: data.current_time_ms,
            last_sync_at: data.last_sync_at,
            created_at: data.created_at,
            audio_tracks: data.audio_tracks || [],
            subtitle_tracks: data.subtitle_tracks || [],
            selected_audio_track: data.selected_audio_track ?? 0,
            selected_subtitle_track: data.selected_subtitle_track ?? -1,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Server error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
