import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    if (req.method === "POST") {
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

    if (req.method === "GET") {
      // Generate signed URL for existing file
      const url = new URL(req.url);
      const filePath = url.searchParams.get("filePath");
      const sessionId = url.searchParams.get("sessionId");

      if (!filePath || !sessionId) {
        return new Response(
          JSON.stringify({ error: "filePath and sessionId are required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify file belongs to session
      if (!filePath.startsWith(sessionId + "/")) {
        return new Response(
          JSON.stringify({ error: "Unauthorized access" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: signedData, error: signedError } = await supabaseAdmin.storage
        .from("audio-files")
        .createSignedUrl(filePath, 86400);

      if (signedError) {
        return new Response(
          JSON.stringify({ error: "Failed to generate access URL" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ url: signedData.signedUrl }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
