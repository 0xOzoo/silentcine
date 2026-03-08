import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Film, CreditCard, Settings, Trash2, Share2, Clock, AlertTriangle,
  CheckCircle, XCircle, Loader2, ArrowLeft, Pencil, KeyRound, Shield,
  Ticket, ExternalLink, Upload, Image as ImageIcon, Type, CalendarDays,
  Play, Lock, Crown, Download,
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
    <div className="py-10 px-4">
      <div className="container max-w-5xl mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors mb-10"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Home
        </Link>

        {/* Header */}
        <div className="flex items-end justify-between border-b border-border/30 pb-6 mb-8">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.25em] uppercase text-primary mb-2">
              Dashboard
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight">Your Films</h1>
          </div>
          <TierBadge tier={tier} />
        </div>

        {/* Free user upgrade notice */}
        {isFree && (
          <div className="flex items-center justify-between border-l-2 border-primary/60 pl-4 py-1.5 mb-8">
            <div>
              <p className="text-sm font-medium">Films expire in 7 days on Free</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upgrade to Pro for permanent storage.
              </p>
            </div>
            <Link
              to="/pricing"
              className="text-xs text-primary underline underline-offset-4 hover:text-primary/80 transition-colors shrink-0 ml-4"
            >
              Upgrade
            </Link>
          </div>
        )}

        {/* Tab navigation */}
        <nav className="flex items-center gap-8 border-b border-border/30 mb-8">
          {[
            { value: 'movies',   label: 'Films'    },
            { value: 'billing',  label: 'Billing'  },
            { value: 'settings', label: 'Settings' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`pb-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === value
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        {activeTab === 'movies'   && <MoviesTab />}
        {activeTab === 'billing'  && <BillingTab />}
        {activeTab === 'settings' && <SettingsTab />}
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
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted-foreground mb-4">{error}</p>
        <button onClick={fetchMovies} className="text-xs text-primary underline underline-offset-4">Retry</button>
      </div>
    );
  }

  const activeMovies = movies.filter(m => m.status !== 'archived');
  const archivedMovies = movies.filter(m => m.status === 'archived');

  if (movies.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-primary mb-4">No Films Yet</p>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto mb-8">
          Upload a video to get started. Audio is extracted automatically.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*,.mkv,.avi,.mov,.webm,.mp4,.m4v,.mpeg,.mpg"
          className="hidden"
          onChange={handleUploadFile}
          disabled={uploading}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg text-sm font-semibold transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          {uploading ? 'Processing...' : 'Upload a Video'}
        </button>
        {uploading && extractionProgress && (
          <div className="w-full max-w-xs mt-6 mx-auto space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{extractionProgress.message}</span>
              <span>{extractionProgress.percent}%</span>
            </div>
            <Progress value={extractionProgress.percent} className="h-1" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Header row: stats strip + upload button */}
      <div className="flex items-center justify-between pb-5 border-b border-border/30">
        <div className="flex items-center gap-5 text-xs text-muted-foreground">
          <span>
            <span className="text-foreground font-semibold text-base mr-1.5">{activeMovies.length}</span>active
          </span>
          <span className="text-border/60">·</span>
          <span>
            <span className="text-foreground font-semibold text-base mr-1.5">{archivedMovies.length}</span>archived
          </span>
          <span className="text-border/60">·</span>
          <span>
            <span className="text-foreground font-semibold text-base mr-1.5">
              {movies.reduce((sum, m) => sum + (m.audio_tracks?.length ?? 0), 0)}
            </span>tracks
          </span>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,.mkv,.avi,.mov,.webm,.mp4,.m4v,.mpeg,.mpg"
            className="hidden"
            onChange={handleUploadFile}
            disabled={uploading}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-semibold transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-60"
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading ? 'Processing...' : 'Upload'}
          </button>
        </div>
      </div>

      {/* Upload progress */}
      {uploading && extractionProgress && (
        <div className="py-4 space-y-1.5 border-b border-border/30">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{extractionProgress.message}</span>
            <span>{extractionProgress.percent}%</span>
          </div>
          <Progress value={extractionProgress.percent} className="h-1" />
        </div>
      )}
      {uploadError && (
        <p className="text-xs text-destructive py-3 border-b border-border/30">{uploadError}</p>
      )}

      {/* Active movies */}
      {activeMovies.map(movie => {
        const statusCfg = STATUS_CONFIG[movie.status] || STATUS_CONFIG.error;
        const retention = getRetentionRemaining(movie.created_at, movie.retention_policy);

        return (
          <div key={movie.id} className="flex items-start justify-between gap-4 py-4 border-b border-border/30">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h3 className="font-semibold text-sm truncate">{movie.title || 'Untitled'}</h3>
                <span className={`flex items-center gap-1 text-[11px] ${statusCfg.className}`}>
                  {statusCfg.icon} {statusCfg.label}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>{formatDate(movie.created_at)}</span>
                <span className="uppercase tracking-wide text-[10px]">{movie.quality_profile}</span>
                {retention && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />{retention}
                  </span>
                )}
                {movie.audio_tracks?.length > 0 && (
                  <span>{movie.audio_tracks.length} audio{movie.audio_tracks.length > 1 ? ' tracks' : ' track'}</span>
                )}
                {movie.subtitle_tracks?.length > 0 && (
                  <span>{movie.subtitle_tracks.length} subtitle{movie.subtitle_tracks.length > 1 ? 's' : ''}</span>
                )}
              </div>
              {movie.processing_error && (
                <p className="text-[11px] text-red-400 mt-1 truncate">{movie.processing_error}</p>
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

            <div className="flex items-center gap-0.5 shrink-0">
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
        );
      })}

      {/* Archived movies */}
      {archivedMovies.length > 0 && (
        <>
          <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-muted-foreground pt-6 pb-3">
            Archived ({archivedMovies.length})
          </p>
          {archivedMovies.map(movie => (
            <div key={movie.id} className="flex items-center justify-between py-3.5 border-b border-border/20 opacity-50">
              <div>
                <p className="text-sm truncate">{movie.title || 'Untitled'}</p>
                <p className="text-[11px] text-muted-foreground">Archived {movie.archived_at ? formatDate(movie.archived_at) : ''}</p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="text-destructive text-xs">Delete</Button>
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
            </div>
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
    <div className={`flex items-center justify-between py-4 border-b border-border/30 ${isDone ? 'opacity-40' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 flex-wrap mb-0.5">
          <span className={`text-xs font-semibold ${cfg.color.split(' ')[0]}`}>{cfg.label}</span>
          <span className="text-[11px] text-muted-foreground">
            Purchased {formatDate(pass.purchase_date)}
          </span>
        </div>

        {pass.status === 'active' && pass.expires_at && !isExpired && (
          <div className="flex items-center gap-1.5 mt-1">
            <Clock className="w-3 h-3 text-green-400 shrink-0" />
            <span className="text-xs font-mono text-green-400">{countdown}</span>
            <span className="text-[11px] text-muted-foreground">remaining</span>
          </div>
        )}
        {pass.status === 'active' && pass.activation_date && !isExpired && (
          <p className="text-[11px] text-muted-foreground mt-0.5">Activated {formatDate(pass.activation_date)}</p>
        )}
        {pass.status === 'active' && isExpired && (
          <p className="text-[11px] text-red-400 mt-0.5">This pass has expired.</p>
        )}
        {pass.status === 'pending' && (
          <p className="text-[11px] text-muted-foreground mt-0.5">Activate before {formatDate(pass.max_activation_date)}</p>
        )}
        {pass.status === 'used' && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Used.{pass.activation_date && ` Activated ${formatDate(pass.activation_date)}.`}
          </p>
        )}
        {pass.status === 'expired' && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {pass.activation_date ? 'Expired 48h after activation.' : 'Never activated.'}
          </p>
        )}
      </div>

      {pass.status === 'pending' && (
        <button
          onClick={() => onActivate(pass.id)}
          disabled={activatingPassId === pass.id}
          className="shrink-0 ml-4 inline-flex items-center justify-center bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
        >
          {activatingPassId === pass.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Activate'}
        </button>
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
    <div>
      {/* Current Plan */}
      <div className="pb-8 border-b border-border/30">
        <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-primary mb-5">Current Plan</p>

        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <TierBadge tier={tier} />
              {isExpiring && expiresAt && (
                <span className="text-xs text-yellow-400">
                  Grace period until {expiresAt.toLocaleDateString()}
                </span>
              )}
            </div>
            {subInfo && (
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5" />
                  {subInfo.cancel_at_period_end
                    ? `Cancels ${new Date(subInfo.current_period_end * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                    : `Renews ${new Date(subInfo.current_period_end * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                  }
                </span>
                {subInfo.interval && (
                  <span className="uppercase tracking-wide text-[10px]">
                    Billed {subInfo.interval === 'year' ? 'yearly' : 'monthly'}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 shrink-0">
            {isPaid && profile?.stripe_customer_id && (
              <button
                onClick={handleManageBilling}
                disabled={portalLoading}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5 underline underline-offset-4 disabled:opacity-60"
              >
                {portalLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ExternalLink className="w-3 h-3" />}
                Manage Billing
              </button>
            )}
            <Link
              to="/pricing"
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              {isPaid ? 'Change Plan' : 'Upgrade Plan'}
            </Link>
          </div>
        </div>

        {/* Plan features strip */}
        <div className="flex flex-wrap divide-x divide-border/30">
          {[
            { label: 'Listeners', value: hasUnlimitedListeners ? 'Unlimited' : String(maxListeners) },
            { label: 'Movies',    value: concurrentMovies === -1 ? 'Unlimited' : String(concurrentMovies) },
            { label: 'Quality',   value: maxQuality },
            { label: 'Storage',   value: storageLabel },
            { label: 'Retention', value: retention.replace('_', ' ') },
          ].map(item => (
            <div key={item.label} className="px-6 first:pl-0 py-1">
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">{item.label}</p>
              <p className="text-sm font-semibold text-foreground">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Event Passes */}
      <div className="pt-8">
        <div className="flex items-center justify-between mb-5">
          <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-primary">Event Passes</p>
          <Link
            to="/pricing"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
          >
            Buy Pass
          </Link>
        </div>

        {passesLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : passesError ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground mb-3">{passesError}</p>
            <button onClick={fetchPasses} className="text-xs text-primary underline underline-offset-4">Retry</button>
          </div>
        ) : passes.length === 0 ? (
          <div className="py-8">
            <p className="text-sm text-muted-foreground">No event passes yet.</p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">One-time 48-hour access passes for a single screening.</p>
          </div>
        ) : (
          <div>
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
      </div>
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

  // Determine the preview watermark: image or text
  const previewImageUrl = watermarkImageUrl || null;
  const previewText = watermarkText || 'SilentCine';
  const hasAnyWatermark = !!previewImageUrl || !!previewText;

  return (
    <div>

      {/* ── Profile ── */}
      <section className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-12 py-8 border-b border-border/30">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-primary mb-1">Profile</p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            Your display name is shown to viewers during a screening.
          </p>
        </div>
        <div className="space-y-4 max-w-sm">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs uppercase tracking-wide text-muted-foreground">Email</Label>
            <Input id="email" value={user?.email ?? ''} disabled className="opacity-50" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="displayName" className="text-xs uppercase tracking-wide text-muted-foreground">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save Changes'}
          </button>
        </div>
      </section>

      {/* ── Watermark ── */}
      <section className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-12 py-8 border-b border-border/30">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-primary mb-1">Watermark</p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            Customize the watermark overlaid on your screenings.
          </p>
          {!isPro && (
            <div className="flex items-center gap-1.5 mt-3">
              <Lock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Pro feature.</span>
              <Link to="/pricing" className="text-xs text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">Upgrade</Link>
            </div>
          )}
        </div>
        <div className="space-y-6 max-w-sm">

          {/* Custom text */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Custom Text</Label>
            <Input
              value={watermarkText}
              onChange={e => setWatermarkText(e.target.value)}
              placeholder='Default: "SilentCine"'
              maxLength={40}
              disabled={!isPro}
            />
            <p className="text-xs text-muted-foreground">Replaces the default "SilentCine" text.</p>
          </div>

          {/* Logo image — Enterprise only */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              Logo Image
              {!isEnterpriseUser && (
                <span className="text-[10px] text-muted-foreground/60 normal-case tracking-normal font-normal">Enterprise</span>
              )}
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
            <p className="text-xs text-muted-foreground">Max 2 MB. Leave empty to remove the watermark entirely.</p>
          </div>

          {/* Position picker */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Position</Label>
            <div className="flex flex-wrap gap-2">
              {POSITION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setWatermarkPosition(opt.value)}
                  disabled={!isPro}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors disabled:opacity-40 ${
                    watermarkPosition === opt.value
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Opacity */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Opacity</Label>
              <span className="text-xs text-muted-foreground tabular-nums">{Math.round(watermarkOpacity * 100)}%</span>
            </div>
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

          {/* Size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Size</Label>
              <span className="text-xs text-muted-foreground tabular-nums">{Math.round(watermarkSize * 100)}%</span>
            </div>
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
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Preview</Label>
              <div className="relative w-full aspect-video bg-zinc-900 rounded-lg overflow-hidden border border-border">
                <div className="absolute inset-0 flex items-center justify-center text-zinc-700">
                  <Film className="w-16 h-16" />
                </div>
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
            <button
              onClick={handleSaveProfile}
              disabled={saving}
              className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
            </button>
          )}
        </div>
      </section>

      {/* ── Custom Branding CSS ── */}
      <section className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-12 py-8 border-b border-border/30">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-primary mb-1">Custom Branding</p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            Inject a CSS file for full white-label branding.
          </p>
          {!isEnterpriseUser && (
            <div className="flex items-center gap-1.5 mt-3">
              <Lock className="w-3 h-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Enterprise only.</span>
              <Link to="/pricing" className="text-xs text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">Upgrade</Link>
            </div>
          )}
        </div>
        <div className="space-y-3 max-w-sm">
          <Input
            type="url"
            value={brandingUrl}
            onChange={e => setBrandingUrl(e.target.value)}
            placeholder="https://yourdomain.com/branding.css"
            disabled={!isEnterpriseUser}
          />
          <p className="text-xs text-muted-foreground">
            Hosted on your domain (HTTPS). Loaded after the default theme — your overrides apply automatically.
          </p>
          <div className="flex items-center gap-4">
            {isEnterpriseUser && (
              <button
                onClick={handleSaveProfile}
                disabled={saving}
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
              </button>
            )}
            <a
              href="/branding-template.css"
              download="branding-template.css"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
            >
              <Download className="w-3.5 h-3.5" />
              Download Template
            </a>
          </div>
        </div>
      </section>

      {/* ── Password ── */}
      <section className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-12 py-8 border-b border-border/30">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-primary mb-1">Password</p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            Choose a new password for your account.
          </p>
        </div>
        <form onSubmit={handleChangePassword} className="space-y-4 max-w-sm">
          <div className="space-y-1.5">
            <Label htmlFor="newPassword" className="text-xs uppercase tracking-wide text-muted-foreground">New Password</Label>
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
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword" className="text-xs uppercase tracking-wide text-muted-foreground">Confirm Password</Label>
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
          <button
            type="submit"
            disabled={passwordLoading}
            className="inline-flex items-center gap-2 border border-border text-foreground px-5 py-2.5 rounded-lg text-sm font-medium hover:border-foreground/40 transition-colors disabled:opacity-60"
          >
            {passwordLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Update Password'}
          </button>
        </form>
      </section>

      {/* ── Danger Zone ── */}
      <section className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6 md:gap-12 py-8 pl-5 border-l-2 border-destructive/50">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-destructive mb-1">Danger Zone</p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            Permanently delete your account and all data. This cannot be undone.
          </p>
        </div>
        <div>
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
        </div>
      </section>

    </div>
  );
};

export default Dashboard;
