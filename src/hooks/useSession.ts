import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DEBUG = import.meta.env.DEV;
const log = (...args: unknown[]) => { if (DEBUG) console.log('[Session]', ...args); };

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

// Helper to get/set host token from sessionStorage (auto-cleanup on tab close)
const getHostToken = (sessionCode: string): string | null => {
  return sessionStorage.getItem(`host_token_${sessionCode}`);
};

const setHostToken = (sessionCode: string, token: string): void => {
  sessionStorage.setItem(`host_token_${sessionCode}`, token);
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
  const [lastListenerTime, setLastListenerTime] = useState<number>(Date.now());

  // Terminate session via edge function
  const terminateSession = useCallback(async (sessionId: string, token: string) => {
    try {
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-manager?action=terminate&sessionId=${sessionId}`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "x-host-token": token,
          },
        }
      );
      log("Session terminated");
    } catch (err) {
      log("Failed to terminate session:", err);
    }
  }, []);

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
      log("Failed to update session:", err);
      return false;
    }
  }, [session, hostToken]);

  // Upload audio file via edge function (secure with host token) with real progress tracking
  const uploadAudio = useCallback(async (
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<string | null> => {
    if (!session || !hostToken) {
      toast.error("Session or host token not available");
      return null;
    }
    
    setIsLoading(true);
    
    return new Promise((resolve) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sessionId", session.id);

      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100;
          onProgress?.(percentComplete);
        }
      });

      xhr.addEventListener("load", async () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const response = JSON.parse(xhr.responseText);
            const { url, fileName } = response;

            // Update session with audio URL via secure edge function
            const success = await updateSession({
              audio_url: url,
              audio_filename: fileName,
            });

            if (!success) {
              toast.error("Failed to update session");
              resolve(null);
            } else {
              toast.success("Audio uploaded successfully!");
              resolve(url);
            }
          } catch {
            toast.error("Failed to parse upload response");
            resolve(null);
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            toast.error(errorData.error || "Upload failed");
          } catch {
            toast.error("Upload failed");
          }
          resolve(null);
        }
        setIsLoading(false);
      });

      xhr.addEventListener("error", () => {
        toast.error("Upload failed - network error");
        setIsLoading(false);
        resolve(null);
      });

      xhr.addEventListener("abort", () => {
        toast.error("Upload cancelled");
        setIsLoading(false);
        resolve(null);
      });

      xhr.open("POST", `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storage-upload`);
      xhr.setRequestHeader("x-host-token", hostToken);
      xhr.send(formData);
    });
  }, [session, hostToken, updateSession]);

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

  // Poll for listener count (since realtime requires direct table access with RLS)
  useEffect(() => {
    if (!session) return;

    const fetchListeners = async () => {
      const { data } = await supabase
        .from("session_listeners_public" as any)
        .select("id, session_id, connected_at, last_ping_at")
        .eq("session_id", session.id);
      
      const listenerData = (data as unknown as SessionListener[]) || [];
      setListeners(listenerData);

      // Track when we last had listeners
      if (listenerData.length > 0) {
        setLastListenerTime(Date.now());
      }
    };

    // Initial fetch
    fetchListeners();

    // Poll every 5 seconds
    const pollInterval = setInterval(fetchListeners, 5000);

    return () => {
      clearInterval(pollInterval);
    };
  }, [session?.id]);

  // Auto-terminate session if no listeners for 10 minutes
  useEffect(() => {
    if (!session || !hostToken) return;

    const checkIdleTimeout = setInterval(() => {
      const idleTime = Date.now() - lastListenerTime;
      const tenMinutes = 10 * 60 * 1000;

      if (listeners.length === 0 && idleTime >= tenMinutes) {
        log("Session idle for 10 minutes with no listeners, terminating...");
        terminateSession(session.id, hostToken);
      }
    }, 60000); // Check every minute

    return () => clearInterval(checkIdleTimeout);
  }, [session?.id, hostToken, listeners.length, lastListenerTime, terminateSession]);

  // Terminate session on tab close/beforeunload
  useEffect(() => {
    if (!session || !hostToken) return;

    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery during page unload
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-manager?action=terminate&sessionId=${session.id}`;
      
      // sendBeacon doesn't support custom headers, so we use fetch with keepalive
      navigator.sendBeacon(url); // Fallback attempt
      
      // Primary method: fetch with keepalive (allows headers)
      fetch(url, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-host-token": hostToken,
        },
        keepalive: true, // Critical for page unload
      }).catch(() => {
        // Silently fail - page is unloading
      });
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [session?.id, hostToken]);

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
    terminateSession: session && hostToken ? () => terminateSession(session.id, hostToken) : undefined,
  };
}

export function useListenerSession(sessionCode: string) {
  const [session, setSession] = useState<Session | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listenerToken] = useState(() => generateListenerToken());
  const [networkLatencyMs, setNetworkLatencyMs] = useState(0);
  const latencySamplesRef = useRef<number[]>([]);

  // Helper to call listener manager edge function
  const callListenerManager = useCallback(async (
    action: string,
    method: string,
    body?: Record<string, unknown>
  ): Promise<Response> => {
    const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/listener-manager`);
    url.searchParams.set("action", action);
    
    if (method === "DELETE" && body?.sessionId) {
      url.searchParams.set("sessionId", body.sessionId as string);
    }

    return fetch(url.toString(), {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-listener-token": listenerToken,
      },
      body: method !== "DELETE" && body ? JSON.stringify(body) : undefined,
    });
  }, [listenerToken]);

  // Connect to a session via edge function
  const connect = useCallback(async () => {
    if (!sessionCode) return false;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch session via secure edge function
      const joinResponse = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-manager?action=join&code=${sessionCode.toUpperCase()}`,
        { method: "GET" }
      );

      if (!joinResponse.ok) {
        const errorData = await joinResponse.json();
        throw new Error(errorData.error || "Session not found");
      }

      const { session: sessionData } = await joinResponse.json();

      // Register as a listener via edge function
      const listenerResponse = await callListenerManager("join", "POST", {
        sessionId: sessionData.id,
      });

      if (!listenerResponse.ok) {
        const errorData = await listenerResponse.json();
        throw new Error(errorData.error || "Failed to join session");
      }

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
  }, [sessionCode, listenerToken, callListenerManager]);

  // Disconnect from session via edge function
  const disconnect = useCallback(async () => {
    if (!session) return;
    
    try {
      await callListenerManager("leave", "DELETE", { sessionId: session.id });
    } catch (err) {
      log("Failed to disconnect:", err);
    }
    
    setIsConnected(false);
    setSession(null);
  }, [session, callListenerManager]);

  // Store session info in refs to avoid stale closures in poll intervals
  const sessionIdRef = useRef<string | null>(null);
  const sessionCodeRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
    sessionCodeRef.current = session?.code ?? null;
  }, [session?.id, session?.code]);

  // Poll for session updates (since realtime requires direct table access with RLS)
  useEffect(() => {
    if (!session || !isConnected) return;

    const initialSessionId = session.id;
    const initialSessionCode = session.code;

    // Poll for session updates every 2 seconds
    const pollSession = async () => {
      const code = sessionCodeRef.current || initialSessionCode;
      const requestTime = Date.now();
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/session-manager?action=join&code=${code}`,
          { method: "GET" }
        );
        
        if (response.ok) {
          const responseTime = Date.now();
          const { session: updatedSession, serverTimestamp } = await response.json();

          // Calculate network latency using round-trip time
          if (serverTimestamp) {
            const rtt = responseTime - requestTime;
            const oneWayLatency = rtt / 2;
            
            // Exponential moving average for jitter smoothing
            const samples = latencySamplesRef.current;
            samples.push(oneWayLatency);
            // Keep last 10 samples
            if (samples.length > 10) samples.shift();
            
            // Use median (more robust than mean against outliers)
            const sorted = [...samples].sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)];
            setNetworkLatencyMs(median);
          }

          setSession(updatedSession);
        } else if (response.status === 404) {
          // Session was terminated by host
          setIsConnected(false);
          setSession(null);
          toast.error("Session ended by host");
        }
      } catch {
        // Network error during poll - ignore, will retry next interval
      }
    };

    // Initial poll
    pollSession();

    // Poll every 2 seconds for sync updates
    const pollInterval = setInterval(pollSession, 2000);

    // Ping every 30 seconds to stay connected via edge function
    const pingInterval = setInterval(async () => {
      const sid = sessionIdRef.current || initialSessionId;
      try {
        await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/listener-manager?action=ping`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "x-listener-token": listenerToken,
            },
            body: JSON.stringify({ sessionId: sid }),
          }
        );
      } catch {
        // Ping failure - ignore, will retry next interval
      }
    }, 30000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(pingInterval);
    };
  }, [isConnected, listenerToken]);

  // Cleanup on unmount - use refs to avoid stale closure
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) {
        // Fire and forget cleanup on unmount
        fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/listener-manager?action=leave&sessionId=${sid}`,
          {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
              "x-listener-token": listenerToken,
            },
            keepalive: true,
          }
        ).catch(() => {});
      }
    };
  }, [listenerToken]);

  return {
    session,
    isConnected,
    isLoading,
    error,
    networkLatencyMs,
    connect,
    disconnect,
  };
}
