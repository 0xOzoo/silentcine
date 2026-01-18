import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-listener-token",
};

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
    const listenerToken = req.headers.get("x-listener-token");

    // JOIN: Register as a listener
    if (req.method === "POST" && action === "join") {
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
