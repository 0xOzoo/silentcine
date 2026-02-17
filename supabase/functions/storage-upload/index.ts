import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-host-token, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB max
const ALLOWED_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/aac",
  "audio/flac",
  "video/mp4",
  "video/webm",
  "video/mkv",
  "video/x-matroska",
  "application/octet-stream", // For unknown file types
];

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

    if (req.method === "POST") {
      // Rate limit: 3 uploads per minute per IP (persistent)
      if (!await checkRateLimit(supabaseAdmin, `upload:${ip}`, 3, 60)) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Handle file upload
      const formData = await req.formData();
      const file = formData.get("file") as File;
      const sessionId = formData.get("sessionId") as string;
      
      // Get host token from header for authorization
      const hostToken = req.headers.get("x-host-token");

      if (!file || !sessionId) {
        return new Response(
          JSON.stringify({ error: "File and sessionId are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Require host token for uploads
      if (!hostToken) {
        return new Response(
          JSON.stringify({ error: "Host token required for uploads" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        return new Response(
          JSON.stringify({ error: "File too large. Maximum size is 500MB" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Validate file type (relaxed for video formats)
      const fileType = file.type || "application/octet-stream";
      const fileName = file.name.toLowerCase();
      const isValidType = ALLOWED_TYPES.includes(fileType) || 
        fileName.endsWith(".mp3") || 
        fileName.endsWith(".mp4") || 
        fileName.endsWith(".mkv") || 
        fileName.endsWith(".webm") ||
        fileName.endsWith(".wav") ||
        fileName.endsWith(".ogg") ||
        fileName.endsWith(".flac") ||
        fileName.endsWith(".aac");

      if (!isValidType) {
        return new Response(
          JSON.stringify({ error: "Invalid file type. Only audio/video files are allowed" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify session exists AND host token matches
      const { data: sessionData, error: sessionError } = await supabaseAdmin
        .from("sessions")
        .select("id, host_token")
        .eq("id", sessionId)
        .maybeSingle();

      if (sessionError || !sessionData) {
        return new Response(
          JSON.stringify({ error: "Invalid session" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify host token matches the session
      if (sessionData.host_token !== hostToken) {
        return new Response(
          JSON.stringify({ error: "Unauthorized - invalid host token" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Generate file path
      const fileExt = file.name.split(".").pop();
      const filePath = `${sessionId}/${Date.now()}.${fileExt}`;

      // Upload file using service role
      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadError } = await supabaseAdmin.storage
        .from("audio-files")
        .upload(filePath, arrayBuffer, {
          contentType: fileType,
          upsert: false,
        });

      if (uploadError) {
        console.error("Upload error:", uploadError);
        return new Response(
          JSON.stringify({ error: "Failed to upload file" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Generate signed URL for access (valid for 24 hours)
      const { data: signedData, error: signedError } = await supabaseAdmin.storage
        .from("audio-files")
        .createSignedUrl(filePath, 86400); // 24 hours

      if (signedError) {
        console.error("Signed URL error:", signedError);
        return new Response(
          JSON.stringify({ error: "Failed to generate access URL" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ 
          url: signedData.signedUrl,
          filePath,
          fileName: file.name,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET endpoint removed - use signed URLs from session data instead
    // This prevents unauthenticated file access
    if (req.method === "GET") {
      return new Response(
        JSON.stringify({ error: "Use signed URLs from session data to access files" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Server error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});