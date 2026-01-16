import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface Session {
  id: string;
  code: string;
  title: string;
  audio_url: string | null;
  audio_filename: string | null;
  is_playing: boolean;
  current_time_ms: number;
  last_sync_at: string;
  created_at: string;
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
      
      setSession(data as Session);
      return data as Session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create session';
      setError(message);
      toast.error(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Upload audio file
  const uploadAudio = useCallback(async (file: File) => {
    if (!session) return null;
    
    setIsLoading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const filePath = `${session.id}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('audio-files')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('audio-files')
        .getPublicUrl(filePath);

      // Update session with audio URL
      const { error: updateError } = await supabase
        .from('sessions')
        .update({
          audio_url: publicUrl,
          audio_filename: file.name,
        })
        .eq('id', session.id);

      if (updateError) throw updateError;

      setSession(prev => prev ? { ...prev, audio_url: publicUrl, audio_filename: file.name } : null);
      toast.success('Audio uploaded successfully!');
      return publicUrl;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload audio';
      toast.error(message);
      return null;
    } finally {
      setIsLoading(false);
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

      setSession(sessionData as Session);
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
          setSession(payload.new as Session);
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
