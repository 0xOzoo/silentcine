import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-listener-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Database-based rate limiting (persistent across cold starts)
// deno-lint-ignore no-explicit-any
async function checkRateLimit(
  supabase: any,
  key: string,
  maxRequests: number,
  windowSeconds: number = 60
): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      p_key: key,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    });

    if (error) {
      console.error("Rate limit check error:", error);
      // Fail open to avoid blocking legitimate requests on DB errors
      return true;
    }

    return data === true;
  } catch (err) {
    console.error("Rate limit exception:", err);
    return true; // Fail open
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const listenerToken = req.headers.get("x-listener-token");

    // JOIN: Register as a listener
    if (req.method === "POST" && action === "join") {
      // Rate limit: 10 joins per minute per IP (persistent)
      if (!await checkRateLimit(supabaseAdmin, `listener_join:${ip}`, 10, 60)) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { sessionId } = await req.json();

      if (!sessionId || !listenerToken) {
        return new Response(
          JSON.stringify({ error: "sessionId and listener token required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate listener token format (UUID)
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(listenerToken)) {
        return new Response(
          JSON.stringify({ error: "Invalid listener token format" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify session exists
      const { data: sessionData, error: sessionError } = await supabaseAdmin
        .from("sessions")
        .select("id")
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionError || !sessionData) {
        return new Response(
          JSON.stringify({ error: "Session not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Register/update listener
      const { error: upsertError } = await supabaseAdmin
        .from("session_listeners")
        .upsert({
          session_id: sessionId,
          listener_token: listenerToken,
          last_ping_at: new Date().toISOString(),
        }, {
          onConflict: "session_id,listener_token",
        });

      if (upsertError) {
        console.error("Failed to register listener:", upsertError);
        return new Response(
          JSON.stringify({ error: "Failed to join session" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Listener joined session ${sessionId}`);

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // PING: Update last_ping_at
    if (req.method === "PUT" && action === "ping") {
      // Rate limit: 5 pings per minute per listener token (persistent)
      if (!await checkRateLimit(supabaseAdmin, `ping:${listenerToken || ip}`, 5, 60)) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { sessionId } = await req.json();

      if (!sessionId || !listenerToken) {
        return new Response(
          JSON.stringify({ error: "sessionId and listener token required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: updateError } = await supabaseAdmin
        .from("session_listeners")
        .update({ last_ping_at: new Date().toISOString() })
        .eq("session_id", sessionId)
        .eq("listener_token", listenerToken);

      if (updateError) {
        console.error("Failed to update ping:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update ping" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // LEAVE: Disconnect from session
    if (req.method === "DELETE" && action === "leave") {
      const sessionId = url.searchParams.get("sessionId");

      if (!sessionId || !listenerToken) {
        return new Response(
          JSON.stringify({ error: "sessionId and listener token required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { error: deleteError } = await supabaseAdmin
        .from("session_listeners")
        .delete()
        .eq("session_id", sessionId)
        .eq("listener_token", listenerToken);

      if (deleteError) {
        console.error("Failed to leave session:", deleteError);
        return new Response(
          JSON.stringify({ error: "Failed to leave session" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`Listener left session ${sessionId}`);

      return new Response(
        JSON.stringify({ success: true }),
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