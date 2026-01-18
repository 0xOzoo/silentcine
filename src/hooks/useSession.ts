import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface AudioTrack {
  index: number;
  label: string;
  language: string;
}

export interface SubtitleTrack {
  index: number;
  label: string;
  language: string;
}

export interface Session {
  id: string;
  code: string;
  title: string;
  audio_url: string | null;
  audio_filename: string | null;
  video_url: string | null;
  is_playing: boolean;
  current_time_ms: number;
  last_sync_at: string;
  created_at: string;
  audio_tracks: AudioTrack[];
  subtitle_tracks: SubtitleTrack[];
  selected_audio_track: number;
  selected_subtitle_track: number;
}

export interface SessionListener {
  id: string;
  session_id: string;
  connected_at: string;
  last_ping_at: string;
}

// Generate a unique listener token
const generateListenerToken = (): string => {
  return crypto.randomUUID();
};

// Helper to get/set host token from localStorage
const getHostToken = (sessionCode: string): string | null => {
  return localStorage.getItem(`host_token_${sessionCode}`);
};

const setHostToken = (sessionCode: string, token: string): void => {
  localStorage.setItem(`host_token_${sessionCode}`, token);
};

// Helper to call session manager edge function
const callSessionManager = async (
  action: string,
  method: string,
  body?: Record<string, unknown>,
  hostToken?: string | null
): Promise<Response> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  
  if (hostToken) {
    headers["x-host-token"] = hostToken;
  }

  return fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-manager?action=${action}`,
    {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }
  );
};

export function useHostSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [hostToken, setHostTokenState] = useState<string | null>(null);
  const [listeners, setListeners] = useState<SessionListener[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create a new session via edge function
  const createSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await callSessionManager("create", "POST", { title: "Untitled Session" });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to create session");
      }

      const { session: sessionData, hostToken: token } = await response.json();
      
      // Store host token securely in localStorage
      setHostToken(sessionData.code, token);
      setHostTokenState(token);
      
      setSession(sessionData);
      return sessionData;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create session";
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Helper to update session via edge function
  const updateSession = useCallback(async (updates: Record<string, unknown>) => {
    if (!session || !hostToken) return false;
    
    try {
      const response = await callSessionManager(
        "update",
        "PUT",
        { sessionId: session.id, updates },
        hostToken
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update session");
      }

      const { session: updatedSession } = await response.json();
      setSession(updatedSession);
      return true;
    } catch (err) {
      console.error("Failed to update session:", err);
      return false;
    }
  }, [session, hostToken]);

  // Upload audio file via edge function (secure)
  const uploadAudio = useCallback(async (file: File) => {
    if (!session) return null;
    
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sessionId", session.id);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storage-upload`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Upload failed");
      }

      const { url, fileName } = await response.json();

      // Update session with audio URL via secure edge function
      const success = await updateSession({
        audio_url: url,
        audio_filename: fileName,
      });

      if (!success) throw new Error("Failed to update session");

      toast.success("Audio uploaded successfully!");
      return url;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to upload audio";
      toast.error(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [session, updateSession]);

  // Update session with video URL and tracks
  const updateVideoInfo = useCallback(async (
    videoUrl: string,
    audioTracks: AudioTrack[],
    subtitleTracks: SubtitleTrack[]
  ) => {
    await updateSession({
      video_url: videoUrl,
      audio_tracks: audioTracks,
      subtitle_tracks: subtitleTracks,
    });
  }, [updateSession]);

  // Update selected tracks
  const updateSelectedTracks = useCallback(async (
    audioTrack: number,
    subtitleTrack: number
  ) => {
    await updateSession({
      selected_audio_track: audioTrack,
      selected_subtitle_track: subtitleTrack,
    });
  }, [updateSession]);

  // Update playback state
  const updatePlaybackState = useCallback(async (isPlaying: boolean, currentTimeMs: number) => {
    await updateSession({
      is_playing: isPlaying,
      current_time_ms: currentTimeMs,
      last_sync_at: new Date().toISOString(),
    });
  }, [updateSession]);

  // Subscribe to listener changes
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel(`listeners:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "session_listeners",
          filter: `session_id=eq.${session.id}`,
        },
        async () => {
          // Refetch listeners from public view (excludes tokens)
          const { data } = await supabase
            .from("session_listeners_public" as any)
            .select("id, session_id, connected_at, last_ping_at")
            .eq("session_id", session.id);
          
          setListeners((data as unknown as SessionListener[]) || []);
        }
      )
      .subscribe();

    // Initial fetch from public view (excludes tokens)
    supabase
      .from("session_listeners_public" as any)
      .select("id, session_id, connected_at, last_ping_at")
      .eq("session_id", session.id)
      .then(({ data }) => {
        setListeners((data as unknown as SessionListener[]) || []);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.id]);

  return {
    session,
    listeners,
    isLoading,
    error,
    createSession,
    uploadAudio,
    updatePlaybackState,
    updateVideoInfo,
    updateSelectedTracks,
  };
}

export function useListenerSession(sessionCode: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listenerToken] = useState(() => generateListenerToken());

  // Connect to a session via edge function
  const connect = useCallback(async () => {
    if (!sessionCode) return false;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch session via secure edge function
      const response = await callSessionManager(
        "join",
        "GET",
        undefined,
        undefined
      );

      // Build URL with code parameter
      const joinResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-manager?action=join&code=${sessionCode.toUpperCase()}`,
        { method: "GET" }
      );

      if (!joinResponse.ok) {
        const errorData = await joinResponse.json();
        throw new Error(errorData.error || "Session not found");
      }

      const { session: sessionData } = await joinResponse.json();

      // Register as a listener
      const { error: insertError } = await supabase
        .from("session_listeners")
        .upsert({
          session_id: sessionData.id,
          listener_token: listenerToken,
          last_ping_at: new Date().toISOString(),
        }, {
          onConflict: "session_id,listener_token",
        });

      if (insertError) throw insertError;

      setSession(sessionData);
      setIsConnected(true);
      toast.success("Connected to session!");
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect";
      setError(message);
      toast.error(message);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [sessionCode, listenerToken]);

  // Disconnect from session
  const disconnect = useCallback(async () => {
    if (!session) return;
    
    try {
      await supabase
        .from("session_listeners")
        .delete()
        .eq("session_id", session.id)
        .eq("listener_token", listenerToken);
    } catch (err) {
      console.error("Failed to disconnect:", err);
    }
    
    setIsConnected(false);
    setSession(null);
  }, [session, listenerToken]);

  // Subscribe to session updates (realtime sync)
  useEffect(() => {
    if (!session || !isConnected) return;

    const channel = supabase
      .channel(`session:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "sessions",
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          const data = payload.new as Record<string, unknown>;
          setSession({
            id: data.id as string,
            code: data.code as string,
            title: data.title as string,
            audio_url: data.audio_url as string | null,
            audio_filename: data.audio_filename as string | null,
            video_url: data.video_url as string | null,
            is_playing: data.is_playing as boolean,
            current_time_ms: data.current_time_ms as number,
            last_sync_at: data.last_sync_at as string,
            created_at: data.created_at as string,
            audio_tracks: (data.audio_tracks as AudioTrack[]) || [],
            subtitle_tracks: (data.subtitle_tracks as SubtitleTrack[]) || [],
            selected_audio_track: (data.selected_audio_track as number) ?? 0,
            selected_subtitle_track: (data.selected_subtitle_track as number) ?? -1,
          });
        }
      )
      .subscribe();

    // Ping every 30 seconds to stay connected
    const pingInterval = setInterval(async () => {
      await supabase
        .from("session_listeners")
        .update({ last_ping_at: new Date().toISOString() })
        .eq("session_id", session.id)
        .eq("listener_token", listenerToken);
    }, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(pingInterval);
      disconnect();
    };
  }, [session?.id, isConnected, listenerToken, disconnect]);

  return {
    session,
    isConnected,
    isLoading,
    error,
    connect,
    disconnect,
  };
}
