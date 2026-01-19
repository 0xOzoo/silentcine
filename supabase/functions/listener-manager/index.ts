import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-listener-token",
};

// Simple in-memory rate limiting (resets on function cold start)
const RATE_LIMITS: Record<string, { count: number; resetAt: number }> = {};
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

function checkRateLimit(ip: string, action: string, maxRequests: number): boolean {
  const key = `${ip}:${action}`;
  const now = Date.now();
  const record = RATE_LIMITS[key];
  
  if (!record || now > record.resetAt) {
    RATE_LIMITS[key] = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    return true;
  }
  
  if (record.count >= maxRequests) {
    return false;
  }
  
  record.count++;
  return true;
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
      // Rate limit: 10 joins per minute per IP
      if (!checkRateLimit(ip, "join", 10)) {
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
      // Rate limit: 5 pings per minute per listener token (should be ~2/minute normally)
      if (!checkRateLimit(listenerToken || ip, "ping", 5)) {
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
