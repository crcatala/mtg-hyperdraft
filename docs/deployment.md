# Deploying to Cloudflare

Everything (the static client, the API and the rooms) deploys as **one Worker** with three Durable
Object classes. Durable Objects with SQLite storage are available on the free Workers plan, so a
group of friends can host HyperDraft without paying anything.

- [First deploy](#first-deploy)
- [Configuration reference](#configuration-reference)
- [Managing invites](#managing-invites)
- [Kill switch](#kill-switch)
- [Public rooms (optional)](#public-rooms-optional)
- [Costs and free-plan limits](#costs-and-free-plan-limits)
- [Maintenance](#maintenance)

## First deploy

1. **Log in once** (opens a browser to authorize Wrangler with your Cloudflare account):
   ```bash
   npx wrangler login
   ```
2. **Deploy:**
   ```bash
   npm run deploy      # = vite build && wrangler deploy
   ```
   The first deploy creates the `hyperdraft` Worker and applies the Durable Object migrations (`v1`
   `RoomDurableObject`, `v2` `InviteDurableObject`, `v3` `PublicPoolDurableObject`). Wrangler prints the
   URL, e.g. `https://hyperdraft.<your-subdomain>.workers.dev`. If this is your account's first Worker,
   Cloudflare asks you to pick a `workers.dev` subdomain.
3. **Set the production secrets** (they survive redeploys; online hosting needs both):
   ```bash
   ROOM_CODE_SECRET=$(openssl rand -base64 32)
   printf '%s\n' "$ROOM_CODE_SECRET"  # copy this value to your password manager
   printf '%s' "$ROOM_CODE_SECRET" | npx wrangler secret put ROOM_CODE_SECRET
   unset ROOM_CODE_SECRET

   npm run invite:new -- sam          # prints a fresh invite entry and magic link
   npx wrangler secret put INVITE_CODES   # paste entries, comma-separated: sam:<key>,jo:<key>
   ```
   Save `ROOM_CODE_SECRET`: Cloudflare won't show secret values again, and changing this one invalidates
   all existing room codes. In `invite:new -- sam`, `sam` is just a label to identify the invite; friends
   use the generated key, not the label. Add the printed `sam:<key>` entry to `INVITE_CODES`.
4. **Share** the site URL with anyone (solo mode needs nothing), and a magic link
   `<site URL>/?invite=<key>` with each friend who should be able to host. Room and invite links are
   built from whatever host serves the app, so any hostname you attach to the Worker works too.

## Configuration reference

All configuration is Worker secrets, set with `npx wrangler secret put <NAME>` (and removed with
`npx wrangler secret delete <NAME>`). Locally they come from `.dev.vars`, which `npm run dev` creates
from [`.dev.vars.example`](../.dev.vars.example).

| Secret | Required | What it does |
|---|---|---|
| `ROOM_CODE_SECRET` | For online rooms | Signs room codes so forged or mistyped codes are rejected before reaching a Durable Object. Changing it invalidates every existing room code. |
| `INVITE_CODES` | For online rooms | Who may host: `label:key` pairs, comma- or newline-separated. See [Managing invites](#managing-invites). |
| `ONLINE_ENABLED` | No | Set to `false` to turn online rooms (invite and public) off. Solo mode keeps working. |
| `PUBLIC_ROOMS_ENABLED` | No | Set to `true` to let anyone host from a small pool of public rooms. Off by default. |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | No | A Turnstile bot check before hosting a public room. Asked for only when both are set. |

## Managing invites

`INVITE_CODES` is the whole admin panel. Add an entry to invite someone; remove it to revoke (their
existing room links keep working for players); change the key but keep the label to rotate it.
Cloudflare won't reveal a lost invite key: generate a replacement and update the full `INVITE_CODES`
value, keeping any other entries you still use. The label is the invite's identity: renaming it starts a
fresh, empty "My rooms".

Each invite can create at most 10 new rooms per rolling 24 hours and keep 25 saved rooms. Rooms idle for
90 days are deleted.

## Kill switch

```bash
echo false | npx wrangler secret put ONLINE_ENABLED   # online rooms off, instantly
npx wrangler secret delete ONLINE_ENABLED             # back on
```

Solo mode keeps working either way: it runs entirely in the browser.

## Public rooms (optional)

Public rooms let anyone host a game without an invite code, from a small shared pool. **They're off unless
you turn them on:**

```bash
echo true | npx wrangler secret put PUBLIC_ROOMS_ENABLED      # turn on
npx wrangler secret delete PUBLIC_ROOMS_ENABLED               # turn off again
```

How they work:

- **3 public rooms at once**, shared by everyone. A slot frees up as soon as its room closes.
- **Each room lasts up to 3 hours**, and closes sooner **once nobody has been connected for 15
  minutes**. Its link stops working and nothing in it is kept. Everyone in the room sees a countdown and
  gets warnings 30, 10 and 1 minute before it closes.
- **12 room-hours per UTC day** for all public rooms together. Each new room books its whole lifetime up
  front (3 hours, or whatever is left of today's budget, shortening the last rooms of the day) and gets
  back the time it didn't use when it closes early. Whatever happens in the rooms, public rooms can't run
  for more than 12 hours a day in total. That's all three tables used from start to finish, plus one more
  full room, before any time comes back from rooms that closed early.
- **One public room per visitor at a time, and 2 per UTC day.** Visitors are told apart by IP address (a
  whole /64 for IPv6). The pool only stores a keyed hash of it, never the address itself.
- **An invite code takes precedence.** A browser with a valid invite hosts invite rooms as before, which
  never use public slots. Solo mode is unaffected, and `ONLINE_ENABLED=false` turns public rooms off too.
- Tune the limits in `src/shared/publicRooms.ts` (`PUBLIC_LIMITS`). The hosting status shown on the home
  page is cached by the Worker for 15 seconds, so visitors loading the page don't each wake the pool.

### Optional: Turnstile bot check

[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) is a free CAPTCHA alternative that
most visitors never see. With it, a script can't grab every public slot the moment one frees up. The check
is asked for **only when both keys are set**:

1. In the Cloudflare dashboard, go to **Turnstile → Add widget**. Add your site's hostname (e.g.
   `hyperdraft.<your-subdomain>.workers.dev`, plus any custom domain) and pick **Managed** mode.
2. Store the two keys it gives you:
   ```bash
   npx wrangler secret put TURNSTILE_SITE_KEY      # public "site key", sent to browsers
   npx wrangler secret put TURNSTILE_SECRET_KEY    # "secret key", stays on the server
   ```
   Delete either one to turn the check off. Failed checks are rejected by the Worker before any Durable
   Object is involved, so they don't use Durable Object quota. Tokens must come from your site and from the
   public-room widget (Cloudflare's `hostname` and `action` checks). Cloudflare's test keys skip those two
   checks. Without Turnstile, a script can still send create requests, and each one wakes the pool, so
   set it up if public rooms see much traffic.

### Optional: a rate-limiting rule

If you serve the Worker from a zone on your Cloudflare account, add a WAF rate-limiting rule there, e.g.
requests to URI path starting with `/api/` above 60 per 10 seconds per IP → Block. Blocked requests never
reach the Worker, so floods can't use up your daily free-plan requests. (`workers.dev` hosts can't have WAF
rules.)

## Costs and free-plan limits

HyperDraft is built to stay inside Cloudflare's free Workers plan:

- **Static files are served as Worker assets**, so only `/api/*` requests (lobby calls and room
  websockets) run the Worker. **Card images** load straight from Scryfall's CDN in each browser and never
  touch your account.
- **Rooms hibernate** between moves: an idle websocket doesn't keep a Durable Object awake, and WebSocket
  messages are billed at 20:1 as requests.
- **Room codes are signed**, so guessed or mistyped codes are rejected by the Worker without waking a
  Durable Object. The draft clock pauses (no alarms) while nobody is connected.
- **Flood control** caps every room at 10 messages/s and 1 state change/s sustained (state changes are
  what cost storage writes). See [Architecture](architecture.md#how-it-fits-together).

**The gotcha:** when any Durable Object free-tier daily limit is exceeded, Durable Object calls fail for
the **whole account** until the daily reset (00:00 UTC). Every room stops working, not just the busy one.
Solo mode keeps working because it never talks to the server.

### Worst-case estimates

The flood limits put a ceiling on what a single room can cost, even if someone hammers it non-stop. Per
**room-hour**, at its limits, a room uses at most about:

| Free daily limit | One room-hour, worst case | Why |
|---|---|---|
| Duration, 13,000 GB-s | about 450 GB-s | one Durable Object kept awake for an hour |
| Storage writes, 100k rows | about 3,600 + bursts | 1 state change/s |
| Requests, 100k | about 1,800 for messages handled | 10 messages/s ÷ 20 (WebSocket messages bill 20:1) |

Real games use far less, since rooms hibernate between moves and nobody clicks ten times a second for an
hour. Duration is the tightest limit: roughly 28 room-hours pegged at the limits in a day would use it up.
With invite-only hosting you decide who can open rooms, so in practice a friends' game night is a small
fraction of the free tier.

Public rooms get their own daily budget so strangers can't eat into it. Even if every public room is
flooded around the clock, they stay well inside the limits:

| Free daily limit | Public rooms at most | Why |
|---|---|---|
| Duration, 13,000 GB-s | about 5,400 GB-s | 12 room-hours × 450 GB-s per room kept awake for an hour |
| Storage writes, 100k rows | about 44,000 | 12 room-hours × 1 state change/s, plus bursts |
| Requests, 100k | about 22,000 for messages handled | 12 room-hours × 10 messages/s ÷ 20 (WebSocket messages bill 20:1) |

Messages dropped just before a flooding socket is closed, reconnects and page loads add some requests on
top. That leaves more than half of each limit for invite rooms.

If you outgrow the free plan, the Workers Paid plan ($5/month) turns these hard daily limits into small
overage charges. Check Cloudflare's current
[Workers](https://developers.cloudflare.com/workers/platform/pricing/) and
[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/) pricing, since
limits can change.

## Maintenance

- `npx wrangler tail`: live logs from the deployed Worker (room errors, imports).
- Renaming the Worker: change `name` in `wrangler.jsonc`.
- If you ever rename or remove a Durable Object class, add a new migration entry. Never edit an applied
  migration (`v1`, `v2`, `v3`).
