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
  listener_token: string;
  connected_at: string;
  last_ping_at: string;
}

// Generate a unique session code
const generateCode = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Generate a unique listener token
const generateListenerToken = (): string => {
  return crypto.randomUUID();
};

// Helper to parse session data from DB
const parseSessionData = (data: Record<string, unknown>): Session => {
  return {
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
  };
};

export function useHostSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [listeners, setListeners] = useState<SessionListener[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create a new session
  const createSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const code = generateCode();
      
      const { data, error: insertError } = await supabase
        .from('sessions')
        .insert({
          code,
          title: 'Untitled Session',
        })
        .select()
        .single();

      if (insertError) throw insertError;
      
      const sessionObj = parseSessionData(data as Record<string, unknown>);
      setSession(sessionObj);
      return sessionObj;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Upload audio file via edge function (secure)
  const uploadAudio = useCallback(async (file: File) => {
    if (!session) return null;
    
    setIsLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('sessionId', session.id);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/storage-upload`,
        {
          method: 'POST',
          body: formData,
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const { url, fileName } = await response.json();

      // Update session with audio URL
      const { error: updateError } = await supabase
        .from('sessions')
        .update({
          audio_url: url,
          audio_filename: fileName,
        })
        .eq('id', session.id);

      if (updateError) throw updateError;

      setSession(prev => prev ? { ...prev, audio_url: url, audio_filename: fileName } : null);
      toast.success('Audio uploaded successfully!');
      return url;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload audio';
      toast.error(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  // Update session with video URL and tracks
  const updateVideoInfo = useCallback(async (
    videoUrl: string,
    audioTracks: AudioTrack[],
    subtitleTracks: SubtitleTrack[]
  ) => {
    if (!session) return;
    
    try {
      const { error: updateError } = await supabase
        .from('sessions')
        .update({
          video_url: videoUrl,
          audio_tracks: JSON.parse(JSON.stringify(audioTracks)),
          subtitle_tracks: JSON.parse(JSON.stringify(subtitleTracks)),
        })
        .eq('id', session.id);

      if (updateError) throw updateError;
      
      setSession(prev => prev ? { 
        ...prev, 
        video_url: videoUrl,
        audio_tracks: audioTracks,
        subtitle_tracks: subtitleTracks,
      } : null);
    } catch (err) {
      console.error('Failed to update video info:', err);
    }
  }, [session]);

  // Update selected tracks (for listener preference sync)
  const updateSelectedTracks = useCallback(async (
    audioTrack: number,
    subtitleTrack: number
  ) => {
    if (!session) return;
    
    try {
      const { error: updateError } = await supabase
        .from('sessions')
        .update({
          selected_audio_track: audioTrack,
          selected_subtitle_track: subtitleTrack,
        })
        .eq('id', session.id);

      if (updateError) throw updateError;
      
      setSession(prev => prev ? { 
        ...prev, 
        selected_audio_track: audioTrack,
        selected_subtitle_track: subtitleTrack,
      } : null);
    } catch (err) {
      console.error('Failed to update selected tracks:', err);
    }
  }, [session]);

  // Update playback state
  const updatePlaybackState = useCallback(async (isPlaying: boolean, currentTimeMs: number) => {
    if (!session) return;
    
    try {
      const { error: updateError } = await supabase
        .from('sessions')
        .update({
          is_playing: isPlaying,
          current_time_ms: currentTimeMs,
          last_sync_at: new Date().toISOString(),
        })
        .eq('id', session.id);

      if (updateError) throw updateError;
      
      setSession(prev => prev ? { 
        ...prev, 
        is_playing: isPlaying, 
        current_time_ms: currentTimeMs,
        last_sync_at: new Date().toISOString(),
      } : null);
    } catch (err) {
      console.error('Failed to update playback state:', err);
    }
  }, [session]);

  // Subscribe to listener changes
  useEffect(() => {
    if (!session) return;

    const channel = supabase
      .channel(`listeners:${session.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_listeners',
          filter: `session_id=eq.${session.id}`,
        },
        async () => {
          // Refetch listeners on any change
          const { data } = await supabase
            .from('session_listeners')
            .select('*')
            .eq('session_id', session.id);
          
          setListeners((data || []) as SessionListener[]);
        }
      )
      .subscribe();

    // Initial fetch
    supabase
      .from('session_listeners')
      .select('*')
      .eq('session_id', session.id)
      .then(({ data }) => {
        setListeners((data || []) as SessionListener[]);
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

  // Connect to a session
  const connect = useCallback(async () => {
    if (!sessionCode) return false;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Find the session by code
      const { data: sessionData, error: fetchError } = await supabase
        .from('sessions')
        .select('*')
        .eq('code', sessionCode.toUpperCase())
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!sessionData) {
        setError('Session not found');
        toast.error('Session not found. Please check the code.');
        return false;
      }

      // Register as a listener
      const { error: insertError } = await supabase
        .from('session_listeners')
        .upsert({
          session_id: sessionData.id,
          listener_token: listenerToken,
          last_ping_at: new Date().toISOString(),
        }, {
          onConflict: 'session_id,listener_token',
        });

      if (insertError) throw insertError;

      setSession(parseSessionData(sessionData as Record<string, unknown>));
      setIsConnected(true);
      toast.success('Connected to session!');
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
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
        .from('session_listeners')
        .delete()
        .eq('session_id', session.id)
        .eq('listener_token', listenerToken);
    } catch (err) {
      console.error('Failed to disconnect:', err);
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
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          setSession(parseSessionData(payload.new as Record<string, unknown>));
        }
      )
      .subscribe();

    // Ping every 30 seconds to stay connected
    const pingInterval = setInterval(async () => {
      await supabase
        .from('session_listeners')
        .update({ last_ping_at: new Date().toISOString() })
        .eq('session_id', session.id)
        .eq('listener_token', listenerToken);
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
