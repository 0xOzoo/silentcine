# SilentScreen

Outdoor movies, personal sound. A web app that lets a host project a movie on a big screen while audience members stream synchronized audio to their individual phones via headphones — enabling outdoor screenings without noise disturbance.

## How It Works

1. **Host** opens the app on a laptop, uploads a video file
2. Audio is extracted server-side and uploaded to Supabase Storage
3. The host projects the video fullscreen; a sidebar shows a QR code and session code
4. **Listeners** scan the QR code (or enter the code) on their phones
5. Synchronized audio streams to each listener's phone — they plug in headphones and watch

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite (port 8080) |
| UI | Tailwind CSS + shadcn/ui + Framer Motion |
| Backend | Supabase Edge Functions (Deno serverless) |
| Database | Supabase (PostgreSQL) |
| File Storage | Supabase Storage (signed URLs) |
| Audio Extraction | Local worker server running native ffmpeg |
| Real-time Sync | HTTP polling (2s default, 1s outdoor mode) |
| Audio Playback | HTML `<video>` element on listener devices |

## Project Structure

```
src/
  components/       # HostSession, ListenerView, PiPQRCode, QRScanner, SyncCalibration, TrackSelector
  hooks/            # useSession (host + listener), use-toast, use-mobile
  integrations/     # Supabase client + generated types
  lib/              # OPFS caching, resumable upload (TUS)
  pages/            # Index, Listen, Login, Signup, legal pages
  utils/            # extractAudio (server extraction pipeline)
  contexts/         # AuthContext (Supabase Auth + anonymous bridge)
  types/            # Profile, EventPass, tier types
  test/             # Vitest setup + tests

worker/
  src/index.js      # Audio extraction worker (Express + ffmpeg)

supabase/
  functions/
    session-manager/   # Session CRUD, host auth, cleanup
    storage-upload/    # File upload with host token auth
    listener-manager/  # Listener join/ping/leave
  migrations/          # 16 SQL migrations (tables, RLS, rate limiting, profiles)

public/
  manifest.json     # PWA manifest
  sw.js             # Service worker (cache-first for assets, network-first for pages)
```

## Database Schema

| Table | Purpose |
|---|---|
| `sessions` | Host sessions: code, audio/video URLs, playback state, track selection, host_token |
| `session_listeners` | Connected listeners: session_id, listener_token, last_ping_at |
| `rate_limits` | Persistent rate limiting for edge functions |
| `movies` | Extraction pipeline: video_path, audio_path, status, processing_error |

Views: `sessions_public` and `session_listeners_public` (hide sensitive tokens).

All tables use RLS. Session mutations require service_role (via edge functions). Listeners are tracked with UUID tokens.

## Edge Functions

| Function | Auth | Purpose |
|---|---|---|
| `session-manager` | `x-host-token` header | Create/update/join/terminate/cleanup sessions |
| `storage-upload` | `x-host-token` header | Upload audio/video files (500MB max, 24h signed URLs) |
| `listener-manager` | `x-listener-token` header | Join, heartbeat ping (30s), leave |

All functions have `verify_jwt = false` — auth is handled via custom tokens, not Supabase Auth.

## Audio Extraction Flow

1. Browser uploads video to Supabase Storage (`movies` bucket)
2. Record inserted into `movies` table with status `uploaded`
3. Frontend POSTs `{ movieId, videoPath }` to extraction worker at `VITE_WORKER_URL`
4. Server downloads video, runs ffmpeg, uploads MP3 back to storage, updates `movies.status` to `ready`
5. Frontend polls `movies` table every 3s (10 min timeout)
6. On `ready`, frontend gets a signed URL for the audio and updates the session

## Setup

### Prerequisites

- Node.js 18+
- Supabase project with edge functions deployed
- ffmpeg installed locally (the extraction worker runs on the same machine)

### Environment Variables

Create `.env.local`:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_PROJECT_ID=your-project-id
VITE_WORKER_URL=http://localhost:3001
VITE_WORKER_SECRET=your-shared-secret
```

### Install & Run

```sh
npm install

# Start the extraction worker (separate terminal)
cd worker
cp .env.example .env   # Fill in SUPABASE_SERVICE_ROLE_KEY
npm install
npm start              # Worker on http://localhost:3001

# Start the frontend dev server
cd ..
npm run dev            # Dev server on http://localhost:8080
```

### Deploy Edge Functions

```sh
npx supabase login
npx supabase functions deploy session-manager --project-ref <your-project-id>
npx supabase functions deploy storage-upload --project-ref <your-project-id>
npx supabase functions deploy listener-manager --project-ref <your-project-id>
```

### Apply Database Migrations

Migrations are in `supabase/migrations/`. Apply them via the Supabase dashboard SQL editor or:

```sh
npx supabase db push --project-ref <your-project-id>
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server (port 8080) |
| `npm run build` | Production build |
| `npm run build:dev` | Development build |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Run tests in watch mode |

## Key Features

- **Projector mode** — Host video muted (audio only from phones), toggle with `M` key
- **Keyboard shortcuts** — Space (play/pause), Left/Right (seek 10s), F (fullscreen), M (projector toggle)
- **Outdoor-readable UI** — 64px room code, 256px QR code, high contrast sidebar
- **Mobile audio unlock** — Overlay prompts user tap to satisfy browser autoplay policy
- **Latency-compensated sync** — RTT measurement with 10-sample median, drift correction >0.5s
- **Upload retry** — 3 attempts with exponential backoff (2s, 4s)
- **Configurable sync speed** — 1s (outdoor) / 2s (indoor) toggle on listener
- **PWA** — Installable, service worker caches app shell, works offline (for the UI)
- **Web Share API** — Native share sheet on supported devices, clipboard fallback
- **QR scanner** — Listeners can scan the host's QR code with their phone camera
- **PiP QR code** — Picture-in-Picture floating QR code for fullscreen mode

## Extraction Server Contract

The frontend expects a worker at `VITE_WORKER_URL` (default `http://localhost:3001`) implementing:

```
POST /extract
Content-Type: application/json

{ "movieId": "uuid", "videoPath": "videos/1234.mp4" }
```

The server should:
1. Download the video from Supabase Storage (`movies` bucket)
2. Extract audio to MP3 via ffmpeg
3. Upload the MP3 back to Supabase Storage
4. Update the `movies` table: `status = 'ready'`, `audio_path = 'audio/xxx.mp3'`
5. On failure: `status = 'error'`, `processing_error = 'message'`
