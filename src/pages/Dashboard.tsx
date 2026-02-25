import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Film, CreditCard, Settings, Trash2, Share2, Clock, AlertTriangle,
  CheckCircle, XCircle, Loader2, ArrowLeft, Pencil, KeyRound, Shield,
  Ticket, ExternalLink, Upload, Image as ImageIcon, Type, CalendarDays,
  Play, Lock, Crown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useTier } from '@/hooks/useTier';
import TierBadge from '@/components/TierBadge';
import RetentionBanner from '@/components/RetentionBanner';
import { Progress } from '@/components/ui/progress';
import { TIER_LIMITS } from '@/types/profile';
import type { EventPass, WatermarkPosition } from '@/types/profile';
import {
  extractAudioFromVideo,
  isVideoFile,
  ExtractionError,
  type ExtractionProgress,
} from '@/utils/extractAudio';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── Types ────────────────────────────────────────────────────────────

interface Movie {
  id: string;
  title: string;
  status: string;
  video_path: string | null;
  audio_path: string | null;
  retention_policy: string;
  quality_profile: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  has_audio_extracted: boolean;
  audio_tracks: unknown[];
  subtitle_tracks: unknown[];
  variants: unknown[];
  processing_error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────

// Cache the auth token to avoid calling getSession() on every single apiCall
let _cachedToken: string | null = null;
let _tokenFetchedAt = 0;
const TOKEN_CACHE_MS = 30_000; // refresh token cache every 30s

async function getAuthToken(): Promise<string | null> {
  const now = Date.now();
  if (_cachedToken && now - _tokenFetchedAt < TOKEN_CACHE_MS) {
    return _cachedToken;
  }
  const session = await supabase.auth.getSession();
  _cachedToken = session.data.session?.access_token ?? null;
  _tokenFetchedAt = now;
  return _cachedToken;
}

const API_TIMEOUT_MS = 12_000; // 12s timeout to prevent infinite spinners

async function apiCall(endpoint: string, options: RequestInit = {}) {
  try {
    const token = await getAuthToken();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${token || ANON_KEY}`,
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[apiCall] ${endpoint} returned ${res.status}: ${text}`);
      return { error: `Request failed (${res.status})` };
    }
    return await res.json();
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      console.error(`[apiCall] ${endpoint} timed out after ${API_TIMEOUT_MS}ms`);
      return { error: 'Request timed out' };
    }
    console.error(`[apiCall] ${endpoint} error:`, err);
    return { error: 'Network error' };
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function getRetentionRemaining(createdAt: string, policy: string) {
  if (policy === 'permanent') return null;
  const days = policy === '7_days' ? 7 : 30;
  const expires = new Date(createdAt).getTime() + days * 86400000;
  const ms = expires - Date.now();
  if (ms <= 0) return 'Expired';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  return `${d}d ${h}h`;
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
  uploaded: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, label: 'Processing', className: 'text-blue-400' },
  processing: { icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, label: 'Processing', className: 'text-blue-400' },
  ready: { icon: <CheckCircle className="w-3.5 h-3.5" />, label: 'Ready', className: 'text-green-400' },
  archived: { icon: <AlertTriangle className="w-3.5 h-3.5" />, label: 'Archived', className: 'text-yellow-400' },
  error: { icon: <XCircle className="w-3.5 h-3.5" />, label: 'Error', className: 'text-red-400' },
};

// ══════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════════════════════════════

const Dashboard = () => {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const { tier, isFree, isPaid, label: tierLabel } = useTier();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'movies';

  const setTab = (tab: string) => setSearchParams({ tab }, { replace: true });

  // Refresh profile on mount so tier/badge updates after payment webhook.
  // Fire-and-forget: don't block tab rendering while waiting for profile fetch.
  useEffect(() => {
    refreshProfile().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="container max-w-5xl mx-auto">
        <Button variant="ghost" asChild className="mb-6">
          <Link to="/"><ArrowLeft className="w-4 h-4 mr-2" />Home</Link>
        </Button>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage your movies, billing, and account settings.
            </p>
          </div>
          <TierBadge tier={tier} />
        </div>

        {/* Free user upgrade banner */}
        {isFree && (
          <Card className="mb-6 border-primary/30 bg-primary/5">
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium text-sm">Upgrade to keep your movies permanently</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Free tier movies expire in 7 days. Upgrade to Pro for permanent storage.
                </p>
              </div>
              <Button size="sm" asChild>
                <Link to="/pricing">Upgrade</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="movies" className="gap-1.5">
              <Film className="w-4 h-4" />Movies
            </TabsTrigger>
            <TabsTrigger value="billing" className="gap-1.5">
              <CreditCard className="w-4 h-4" />Billing
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5">
              <Settings className="w-4 h-4" />Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="movies"><MoviesTab /></TabsContent>
          <TabsContent value="billing"><BillingTab /></TabsContent>
          <TabsContent value="settings"><SettingsTab /></TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// MOVIES TAB
// ══════════════════════════════════════════════════════════════════════

const MoviesTab = () => {
  const [movies, setMovies] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { tier } = useTier();
  const navigate = useNavigate();

  // Upload/extraction state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fetchMovies = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await apiCall('movie-manager?action=list');
    if (data.error) {
      setError(data.error);
      setMovies([]);
    } else {
      setMovies(data.movies ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchMovies(); }, [fetchMovies]);

  const handleDelete = async (movieId: string) => {
    const data = await apiCall('movie-manager?action=delete', {
      method: 'DELETE',
      body: JSON.stringify({ movieId }),
    });
    if (data.success) {
      toast.success('Movie deleted');
      setMovies(prev => prev.filter(m => m.id !== movieId));
    } else {
      toast.error(data.error || 'Failed to delete');
    }
  };

  const handleShare = (movie: Movie) => {
    const text = `Check out "${movie.title}" on SilentCine`;
    if (navigator.share) {
      navigator.share({ title: movie.title, text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    }
  };

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-selected
    e.target.value = '';

    if (!isVideoFile(file)) {
      toast.error('Please select a video file (MP4, WebM, MKV, etc.)');
      return;
    }

    setUploading(true);
    setUploadError(null);
    setExtractionProgress(null);

    try {
      await extractAudioFromVideo(file, (progress) => {
        setExtractionProgress(progress);
      });

      toast.success('Video uploaded and audio extracted!');
      await fetchMovies(); // refresh list
    } catch (err) {
      const msg = err instanceof ExtractionError ? err.message : 'Upload failed';
      setUploadError(msg);
      toast.error(msg);
    } finally {
      setUploading(false);
      setExtractionProgress(null);
    }
  };

  const handleHost = (movieId: string) => {
    navigate(`/?movieId=${movieId}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive mb-3" />
          <h3 className="font-medium mb-1">Failed to load movies</h3>
          <p className="text-muted-foreground text-sm mb-4">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchMovies}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  const activeMovies = movies.filter(m => m.status !== 'archived');
  const archivedMovies = movies.filter(m => m.status === 'archived');

  if (movies.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <Film className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-medium mb-1">No movies yet</h3>
          <p className="text-muted-foreground text-sm max-w-xs mb-4">
            Upload a video to get started. Audio will be extracted automatically.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mkv,.avi,.mov,.webm,.mp4,.m4v,.mpeg,.mpg"
            className="hidden"
            onChange={handleUploadFile}
            disabled={uploading}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
            {uploading ? 'Processing...' : 'Upload a Video'}
          </Button>
          {uploading && extractionProgress && (
            <div className="w-full max-w-xs mt-4 space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{extractionProgress.message}</span>
                <span>{extractionProgress.percent}%</span>
              </div>
              <Progress value={extractionProgress.percent} className="h-2" />
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Upload button + progress */}
      <div className="flex items-center justify-end gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mkv,.avi,.mov,.webm,.mp4,.m4v,.mpeg,.mpg"
          className="hidden"
          onChange={handleUploadFile}
          disabled={uploading}
        />
        <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
          {uploading ? 'Processing...' : 'Upload Movie'}
        </Button>
      </div>
      {uploading && extractionProgress && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{extractionProgress.message}</span>
            <span>{extractionProgress.percent}%</span>
          </div>
          <Progress value={extractionProgress.percent} className="h-2" />
        </div>
      )}
      {uploadError && (
        <p className="text-xs text-destructive">{uploadError}</p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="text-xl font-bold">{activeMovies.length}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Archived</p>
          <p className="text-xl font-bold">{archivedMovies.length}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Audio Tracks</p>
          <p className="text-xl font-bold">{movies.reduce((sum, m) => sum + (m.audio_tracks?.length ?? 0), 0)}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Subtitles</p>
          <p className="text-xl font-bold">{movies.reduce((sum, m) => sum + (m.subtitle_tracks?.length ?? 0), 0)}</p>
        </CardContent></Card>
      </div>

      {/* Movie list */}
      {activeMovies.map(movie => {
        const statusCfg = STATUS_CONFIG[movie.status] || STATUS_CONFIG.error;
        const retention = getRetentionRemaining(movie.created_at, movie.retention_policy);

        return (
          <Card key={movie.id} className="border-border">
            <CardContent className="py-4 px-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium truncate">{movie.title || 'Untitled'}</h3>
                    <span className={`flex items-center gap-1 text-xs ${statusCfg.className}`}>
                      {statusCfg.icon} {statusCfg.label}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatDate(movie.created_at)}</span>
                    <Badge variant="outline" className="text-[10px]">{movie.quality_profile}</Badge>
                    {retention && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {retention}
                      </span>
                    )}
                    {movie.audio_tracks?.length > 0 && (
                      <span>{movie.audio_tracks.length} audio track{movie.audio_tracks.length > 1 ? 's' : ''}</span>
                    )}
                    {movie.subtitle_tracks?.length > 0 && (
                      <span>{movie.subtitle_tracks.length} subtitle{movie.subtitle_tracks.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  {movie.processing_error && (
                    <p className="text-xs text-red-400 mt-1 truncate">{movie.processing_error}</p>
                  )}
                  {movie.retention_policy !== 'permanent' && (
                    <div className="mt-2">
                      <RetentionBanner
                        createdAt={movie.created_at}
                        retentionPolicy={movie.retention_policy as 'permanent' | '7_days' | '30_days'}
                        warningDays={3}
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {movie.status === 'ready' && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:text-primary" onClick={() => handleHost(movie.id)} title="Host this movie">
                      <Play className="w-4 h-4" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleShare(movie)}>
                    <Share2 className="w-4 h-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete "{movie.title || 'Untitled'}"?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete the video, audio, and subtitle files from storage. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(movie.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {archivedMovies.length > 0 && (
        <>
          <Separator className="my-4" />
          <h3 className="text-sm font-medium text-muted-foreground mb-2">Archived ({archivedMovies.length})</h3>
          {archivedMovies.map(movie => (
            <Card key={movie.id} className="border-border opacity-60">
              <CardContent className="py-3 px-5 flex items-center justify-between">
                <div>
                  <p className="text-sm truncate">{movie.title || 'Untitled'}</p>
                  <p className="text-xs text-muted-foreground">Archived {movie.archived_at ? formatDate(movie.archived_at) : ''}</p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-destructive">Delete</Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete archived movie?</AlertDialogTitle>
                      <AlertDialogDescription>This will remove all remaining data for this movie.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(movie.id)} className="bg-destructive text-destructive-foreground">Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// EVENT PASS CARD (with live countdown)
// ══════════════════════════════════════════════════════════════════════

function useCountdown(expiresAt: string | null) {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!expiresAt) return;

    const update = () => {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining('Expired');
        return;
      }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  return remaining;
}

const EventPassCard = ({
  pass,
  activatingPassId,
  onActivate,
}: {
  pass: EventPass;
  activatingPassId: string | null;
  onActivate: (id: string) => void;
}) => {
  const countdown = useCountdown(pass.status === 'active' ? pass.expires_at : null);
  const isExpired = countdown === 'Expired';

  const statusConfig = {
    pending: { color: 'text-blue-400 border-blue-400/30', label: 'Pending', bg: '' },
    active: {
      color: isExpired ? 'text-red-400 border-red-400/30' : 'text-green-400 border-green-400/30',
      label: isExpired ? 'Expired' : 'Active',
      bg: isExpired ? '' : 'bg-green-500/5',
    },
    used: { color: 'text-muted-foreground border-border', label: 'Used', bg: '' },
    expired: { color: 'text-muted-foreground border-border', label: 'Expired', bg: '' },
  };
  const cfg = statusConfig[pass.status] || statusConfig.expired;

  const isDone = pass.status === 'used' || pass.status === 'expired' || (pass.status === 'active' && isExpired);

  return (
    <div className={`flex items-center justify-between border rounded-lg p-3 transition-colors ${cfg.bg} ${isDone ? 'opacity-50 border-border' : pass.status === 'active' ? 'border-green-400/30' : 'border-border'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className={`text-xs ${cfg.color}`}>
            {cfg.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Purchased {formatDate(pass.purchase_date)}
          </span>
        </div>

        {/* Active with time remaining */}
        {pass.status === 'active' && pass.expires_at && !isExpired && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Clock className="w-3 h-3 text-green-400 shrink-0" />
            <span className="text-xs font-mono text-green-400">{countdown}</span>
            <span className="text-xs text-muted-foreground">remaining</span>
          </div>
        )}

        {/* Active with activation date */}
        {pass.status === 'active' && pass.activation_date && !isExpired && (
          <p className="text-xs text-muted-foreground mt-0.5">
            Activated {formatDate(pass.activation_date)}
          </p>
        )}

        {/* Active but countdown reached zero */}
        {pass.status === 'active' && isExpired && (
          <p className="text-xs text-red-400 mt-1">
            This pass has expired. Access has been revoked.
          </p>
        )}

        {/* Pending: waiting for user to activate */}
        {pass.status === 'pending' && (
          <p className="text-xs text-muted-foreground mt-1">
            Ready to activate. Must be activated by {formatDate(pass.max_activation_date)}.
          </p>
        )}

        {/* Used */}
        {pass.status === 'used' && (
          <p className="text-xs text-muted-foreground mt-1">
            This pass has been fully used.
            {pass.activation_date && ` Activated ${formatDate(pass.activation_date)}.`}
          </p>
        )}

        {/* Expired (never activated or activation window passed) */}
        {pass.status === 'expired' && (
          <p className="text-xs text-muted-foreground mt-1">
            {pass.activation_date
              ? `Expired after 48h. Activated ${formatDate(pass.activation_date)}.`
              : 'Activation window expired. This pass was never activated.'
            }
          </p>
        )}
      </div>

      {/* Only show Activate button for pending passes */}
      {pass.status === 'pending' && (
        <Button
          size="sm"
          onClick={() => onActivate(pass.id)}
          disabled={activatingPassId === pass.id}
          className="shrink-0 ml-3"
        >
          {activatingPassId === pass.id ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            'Activate'
          )}
        </Button>
      )}
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// BILLING TAB
// ══════════════════════════════════════════════════════════════════════

interface SubscriptionInfo {
  status: string;
  current_period_end: number;
  current_period_start: number;
  cancel_at_period_end: boolean;
  interval: 'month' | 'year' | null;
}

const BillingTab = () => {
  const { profile, refreshProfile } = useAuth();
  const { tier, label: tierLabel, isPaid, isEvent, maxListeners, concurrentMovies, maxQuality, retention, storageLabel, hasUnlimitedListeners, isExpiring, expiresAt } = useTier();
  const [portalLoading, setPortalLoading] = useState(false);
  const [passes, setPasses] = useState<EventPass[]>([]);
  const [passesLoading, setPassesLoading] = useState(true);
  const [passesError, setPassesError] = useState<string | null>(null);
  const [activatingPassId, setActivatingPassId] = useState<string | null>(null);
  const [subInfo, setSubInfo] = useState<SubscriptionInfo | null>(null);

  const fetchPasses = useCallback(async () => {
    setPassesLoading(true);
    setPassesError(null);
    const data = await apiCall('account-manager?action=list-passes');
    if (data.error) {
      setPassesError(data.error);
      setPasses([]);
    } else {
      setPasses(data.passes ?? []);
    }
    setPassesLoading(false);
  }, []);

  const fetchSubscriptionInfo = useCallback(async () => {
    const data = await apiCall('account-manager?action=subscription-info');
    if (data.subscription) {
      setSubInfo(data.subscription);
    }
  }, []);

  useEffect(() => { fetchPasses(); }, [fetchPasses]);
  useEffect(() => { if (isPaid) fetchSubscriptionInfo(); }, [isPaid, fetchSubscriptionInfo]);

  const handleActivatePass = async (passId: string) => {
    setActivatingPassId(passId);
    const { data, error } = await supabase.rpc('activate_event_pass' as any, {
      p_pass_id: passId,
    });
    setActivatingPassId(null);

    if (error) {
      toast.error(error.message || 'Failed to activate pass');
      return;
    }

    // The RPC returns false if the pass was not in 'pending' state
    if (data === false) {
      toast.error('This pass has already been activated or has expired.');
      await fetchPasses();
      return;
    }

    toast.success('Event Pass activated! You have 48 hours of access.');
    // Refresh passes list and profile (tier badge update)
    await fetchPasses();
    await refreshProfile();
  };

  const handleManageBilling = async () => {
    if (!profile?.id) return;
    setPortalLoading(true);
    const data = await apiCall('customer-portal', {
      method: 'POST',
      body: JSON.stringify({ profileId: profile.id }),
    });
    setPortalLoading(false);
    if (data.url) {
      window.location.href = data.url;
    } else {
      toast.error(data.error || 'Failed to open billing portal');
    }
  };

  const tierConfig = TIER_LIMITS[tier];

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Current Plan
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <TierBadge tier={tier} />
            {isExpiring && expiresAt && (
              <span className="text-xs text-yellow-400">
                Grace period until {expiresAt.toLocaleDateString()}
              </span>
            )}
          </div>

          {/* Subscription billing info */}
          {subInfo && (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <CalendarDays className="w-3.5 h-3.5" />
                <span>
                  {subInfo.cancel_at_period_end
                    ? `Cancels on ${new Date(subInfo.current_period_end * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                    : `Next payment: ${new Date(subInfo.current_period_end * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                  }
                </span>
              </div>
              {subInfo.interval && (
                <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  Billed {subInfo.interval === 'year' ? 'yearly' : 'monthly'}
                </span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Listeners</p>
              <p className="font-medium">{hasUnlimitedListeners ? 'Unlimited' : maxListeners}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Movies</p>
              <p className="font-medium">{concurrentMovies === -1 ? 'Unlimited' : concurrentMovies}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Quality</p>
              <p className="font-medium">{maxQuality}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Storage</p>
              <p className="font-medium">{storageLabel}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Retention</p>
              <p className="font-medium">{retention.replace('_', ' ')}</p>
            </div>
          </div>

          <Separator />

          <div className="flex flex-col sm:flex-row gap-2">
            {isPaid && profile?.stripe_customer_id ? (
              <Button variant="outline" onClick={handleManageBilling} disabled={portalLoading}>
                {portalLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (
                  <><ExternalLink className="w-4 h-4 mr-2" />Manage Billing</>
                )}
              </Button>
            ) : null}
            <Button variant={isPaid ? 'ghost' : 'default'} asChild>
              <Link to="/pricing">{isPaid ? 'Change Plan' : 'Upgrade Plan'}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Event Passes */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Ticket className="w-5 h-5" />
            Event Passes
          </CardTitle>
          <CardDescription>One-time 48-hour access passes</CardDescription>
        </CardHeader>
        <CardContent>
          {passesLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : passesError ? (
            <div className="text-center py-6">
              <p className="text-destructive text-sm mb-2">{passesError}</p>
              <Button variant="outline" size="sm" onClick={fetchPasses}>Retry</Button>
            </div>
          ) : passes.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-muted-foreground text-sm mb-3">No event passes purchased yet.</p>
              <Button variant="outline" size="sm" asChild>
                <Link to="/pricing">Buy Event Pass</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {passes.map(pass => (
                <EventPassCard
                  key={pass.id}
                  pass={pass}
                  activatingPassId={activatingPassId}
                  onActivate={handleActivatePass}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ══════════════════════════════════════════════════════════════════════

const POSITION_OPTIONS: { value: WatermarkPosition; label: string }[] = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-right', label: 'Bottom Right' },
  { value: 'center', label: 'Center' },
];

const POSITION_CSS: Record<WatermarkPosition, string> = {
  'top-left': 'top-2 left-2',
  'top-right': 'top-2 right-2',
  'bottom-left': 'bottom-2 left-2',
  'bottom-right': 'bottom-2 right-2',
  'center': 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
};

const SettingsTab = () => {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const { tier } = useTier();
  const navigate = useNavigate();

  const isPro = tier === 'pro' || tier === 'enterprise';
  const isEnterpriseUser = tier === 'enterprise';

  // Profile editing
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [brandingUrl, setBrandingUrl] = useState(profile?.custom_branding_url ?? '');
  const [watermarkText, setWatermarkText] = useState(profile?.watermark_text ?? '');
  const [watermarkImageUrl, setWatermarkImageUrl] = useState(profile?.watermark_image_url ?? '');
  const [watermarkPosition, setWatermarkPosition] = useState<WatermarkPosition>(
    (profile?.watermark_position as WatermarkPosition) ?? 'top-right'
  );
  const [watermarkOpacity, setWatermarkOpacity] = useState(profile?.watermark_opacity ?? 0.3);
  const [watermarkSize, setWatermarkSize] = useState(profile?.watermark_size ?? 1.0);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Password change
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Delete account
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be under 2 MB');
      return;
    }

    setUploadingImage(true);
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
      // Upload to public 'watermarks' bucket, nested under user's auth UID
      const userId = user?.id ?? profile?.id;
      const path = `${userId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('watermarks')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('watermarks').getPublicUrl(path);
      if (urlData?.publicUrl) {
        setWatermarkImageUrl(urlData.publicUrl);
        toast.success('Image uploaded');
      }
    } catch (err) {
      toast.error('Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    const body: Record<string, string | number | null> = {};
    if (displayName !== (profile?.display_name ?? '')) body.display_name = displayName;
    if (brandingUrl !== (profile?.custom_branding_url ?? '')) body.custom_branding_url = brandingUrl;
    if (watermarkText !== (profile?.watermark_text ?? '')) body.watermark_text = watermarkText || null;
    if (watermarkImageUrl !== (profile?.watermark_image_url ?? '')) body.watermark_image_url = watermarkImageUrl || null;
    if (watermarkPosition !== (profile?.watermark_position ?? 'top-right')) body.watermark_position = watermarkPosition;
    if (watermarkOpacity !== (profile?.watermark_opacity ?? 0.3)) body.watermark_opacity = watermarkOpacity;
    if (watermarkSize !== (profile?.watermark_size ?? 1.0)) body.watermark_size = watermarkSize;

    if (Object.keys(body).length === 0) {
      toast.info('No changes to save');
      setSaving(false);
      return;
    }

    const data = await apiCall('account-manager?action=update-profile', {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    setSaving(false);

    if (data.profile) {
      toast.success('Profile updated');
      refreshProfile().catch(() => {});
    } else {
      toast.error(data.error || 'Failed to update');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setPasswordLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordLoading(false);

    if (error) {
      toast.error(error.message);
    } else {
      toast.success('Password updated');
      setNewPassword('');
      setConfirmPassword('');
    }
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    const data = await apiCall('account-manager?action=delete-account', {
      method: 'DELETE',
      body: JSON.stringify({ confirm: true }),
    });
    setDeleteLoading(false);

    if (data.success) {
      toast.success('Account deleted');
      await signOut();
      navigate('/');
    } else {
      toast.error(data.error || 'Failed to delete account');
    }
  };

  // Helper to render a locked overlay on a section
  const LockedOverlay = ({ requiredTier }: { requiredTier: string }) => (
    <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] rounded-lg flex flex-col items-center justify-center z-10">
      <Lock className="w-5 h-5 text-muted-foreground mb-1.5" />
      <p className="text-xs text-muted-foreground font-medium">Requires {requiredTier}</p>
      <Button variant="outline" size="sm" asChild className="mt-2">
        <Link to="/pricing"><Crown className="w-3 h-3 mr-1" />Upgrade</Link>
      </Button>
    </div>
  );

  // Determine the preview watermark: image or text
  const previewImageUrl = watermarkImageUrl || null;
  const previewText = watermarkText || 'SilentCine';
  const hasAnyWatermark = !!previewImageUrl || !!previewText;

  return (
    <div className="space-y-6">
      {/* Profile */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Pencil className="w-5 h-5" />
            Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={user?.email ?? ''} disabled className="opacity-60" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <Button onClick={handleSaveProfile} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>

      {/* Watermark — unified card (Pro feature, logo upload requires Enterprise) */}
      <Card className="border-border relative">
        {!isPro && <LockedOverlay requiredTier="Pro" />}
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Type className="w-5 h-5" />
            Watermark
            {!isPro && <Badge variant="outline" className="text-xs ml-auto">Pro</Badge>}
          </CardTitle>
          <CardDescription>Customize the watermark shown on your screenings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Custom text */}
          <div className="space-y-2">
            <Label className="text-sm">Custom Text</Label>
            <Input
              value={watermarkText}
              onChange={e => setWatermarkText(e.target.value)}
              placeholder='Default: "SilentCine"'
              maxLength={40}
              disabled={!isPro}
            />
            <p className="text-xs text-muted-foreground">Replace the default "SilentCine" watermark with your own text.</p>
          </div>

          <Separator />

          {/* Logo image — Enterprise only */}
          <div className="space-y-2 relative">
            {isPro && !isEnterpriseUser && (
              <div className="absolute inset-0 bg-background/60 backdrop-blur-[1px] rounded-lg flex flex-col items-center justify-center z-10 -m-2 p-2">
                <Lock className="w-4 h-4 text-muted-foreground mb-1" />
                <p className="text-xs text-muted-foreground font-medium">Requires Enterprise</p>
              </div>
            )}
            <Label className="text-sm flex items-center gap-2">
              Logo Image
              {!isEnterpriseUser && <Badge variant="outline" className="text-[10px] py-0">Enterprise</Badge>}
            </Label>
            <div className="flex gap-2">
              <Input
                value={watermarkImageUrl}
                onChange={e => setWatermarkImageUrl(e.target.value)}
                placeholder="https://yourdomain.com/logo.png"
                type="url"
                className="flex-1"
                disabled={!isEnterpriseUser}
              />
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() => imageInputRef.current?.click()}
                disabled={!isEnterpriseUser || uploadingImage}
                title="Upload image"
              >
                {uploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Max 2 MB. Leave empty for no watermark (white-label).</p>
          </div>

          <Separator />

          {/* Position picker */}
          <div className="space-y-2">
            <Label className="text-sm">Position</Label>
            <div className="flex flex-wrap gap-2">
              {POSITION_OPTIONS.map(opt => (
                <Button
                  key={opt.value}
                  variant={watermarkPosition === opt.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setWatermarkPosition(opt.value)}
                  disabled={!isPro}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Opacity slider */}
          <div className="space-y-2">
            <Label className="text-sm">Opacity: {Math.round(watermarkOpacity * 100)}%</Label>
            <input
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={watermarkOpacity}
              onChange={e => setWatermarkOpacity(parseFloat(e.target.value))}
              className="w-full accent-primary"
              disabled={!isPro}
            />
          </div>

          {/* Size slider */}
          <div className="space-y-2">
            <Label className="text-sm">Size: {Math.round(watermarkSize * 100)}%</Label>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={watermarkSize}
              onChange={e => setWatermarkSize(parseFloat(e.target.value))}
              className="w-full accent-primary"
              disabled={!isPro}
            />
          </div>

          {/* Live preview */}
          {hasAnyWatermark && (
            <div className="space-y-2">
              <Label className="text-sm">Preview</Label>
              <div className="relative w-full aspect-video bg-zinc-900 rounded-lg overflow-hidden border border-border">
                {/* Fake video placeholder */}
                <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
                  <Film className="w-16 h-16" />
                </div>
                {/* Watermark preview */}
                <div className={`absolute ${POSITION_CSS[watermarkPosition]} pointer-events-none select-none`}>
                  {previewImageUrl ? (
                    <img
                      src={previewImageUrl}
                      alt="Watermark preview"
                      className="w-auto"
                      style={{ opacity: watermarkOpacity, height: `${2 * watermarkSize}rem` }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <span
                      className="font-display text-white font-bold tracking-wide"
                      style={{ opacity: watermarkOpacity, fontSize: `${0.875 * watermarkSize}rem` }}
                    >
                      {previewText}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {isPro && (
            <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Custom Branding CSS — Enterprise feature */}
      <Card className="border-border relative">
        {!isEnterpriseUser && <LockedOverlay requiredTier="Enterprise" />}
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            Custom Branding CSS
            {!isEnterpriseUser && <Badge variant="outline" className="text-xs ml-auto">Enterprise</Badge>}
          </CardTitle>
          <CardDescription>Inject a custom CSS file for full white-label branding</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            type="url"
            value={brandingUrl}
            onChange={e => setBrandingUrl(e.target.value)}
            placeholder="https://yourdomain.com/branding.css"
            disabled={!isEnterpriseUser}
          />
          {isEnterpriseUser && (
            <Button size="sm" onClick={handleSaveProfile} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="w-5 h-5" />
            Change Password
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                minLength={6}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                minLength={6}
                required
              />
            </div>
            <Button type="submit" variant="outline" disabled={passwordLoading}>
              {passwordLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update Password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-lg text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Permanently delete your account and all associated data. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete Account</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete your account, all your movies, event passes,
                  and storage files. If you have an active subscription, it will be cancelled.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDeleteAccount}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteLoading}
                >
                  {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Yes, delete my account'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
