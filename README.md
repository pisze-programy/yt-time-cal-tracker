# yt-time-cal-tracker

Firefox extension that tracks your YouTube watch time into Google Calendar, and
filters/scores low-quality videos in feeds, search results and the sidebar.

## Features

| Module | Flag | What it does |
|---|---|---|
| Time tracker | `timeTracker` | Logs watch time to Google Calendar. |
| Quality filter | `qualityFilter` | Blurs low-quality tiles and shows Reveal / Not interested actions. |
| Score badge | `scoreBadge` | Colored quality badge on video tiles (feed, search, sidebar). |
| Watch stats | `watchStats` | Views / likes / age / comments + ER, VPH and score on the watch page. |

All modules default to **ON**, are independent, and are toggled in `feature-flags.js`.
Scope: home feed, search, sidebar, watch page. Shorts are intentionally out of scope.

## Install (Firefox)

`about:debugging` → **Load Temporary Add-on…** → select `manifest.json`.

## Configuration

### 1. Google Calendar

Create a local `config.js` (git-ignored) with your service-account credentials:

```js
const GOOGLE_CONFIG = {
  client_email: "",
  private_key: "",
  calendar_id: ""
};
```

Service account setup:

- console.cloud.google.com → new project → enable **Google Calendar API**
- Credentials → Create Credentials → Service Account → Keys → Add Key → JSON
- In Google Calendar: Settings and sharing → Share with specific people →
  add `client_email` with "Make changes to events"
- Share the Calendar ID with the service account

`private_key` must contain literal `\n` sequences, not real newlines — paste it
straight from the downloaded JSON.

> **Key rotation.** The key never belongs in git (`config.js` is ignored and has
> never been committed). To rotate: create a new JSON key for the same service
> account, update `config.js`, verify, then delete the old key. The service
> account identity is unchanged, so Calendar sharing does not need to be redone.
> Note that a key shipped inside a browser extension is readable by anyone who
> installs it; if this is ever published, keep the key server-side instead.

### 2. Feature flags — `feature-flags.js`

```js
window.YTCAL_FEATURES = {
  qualityFilter: true,
  scoreBadge: true,
  watchStats: true,
  timeTracker: true,
  thresholds: {
    minViewsForScore: 100,
    lowQualityMaxViews: 100,
    lowQualityMinAgeHours: 6,
    lowQualityMinVph: 100,
    lowQualityOldHours: 48,
    lowQualityMaxViewsOld: 1000,
    lowQualityMaxEngagement: 0.002,
    commentWeight: 3,
    priorViews: 30,
    priorHours: 3,
  },
};
```

## Scoring algorithm

Raw `views/time` and `likes/views` explode on small samples, and "many views but
few likes" is a different signal than high velocity. The score combines
established methods:

1. **Wilson score lower bound** (robust to small samples) — Evan Miller,
   *How Not To Sort By Average Rating*; Reddit `_sorts.pyx`;
   JS library `msn0/wilson-score-interval`.
   ```
   n = V ;  p = (L + 3·C) / V        // comment weight 2–3× (comments/view ≈ ⅓ likes/view)
   lb = (p + z²/2n − z·√((p(1−p)+z²/4n)/n)) / (1 + z²/n),  z = 1.96
   ```
2. **Bayesian-smoothed view velocity** — `vph = (V + m) / (T + T0)`, `m = 30`, `T0 = 3h`.
3. **Aggregate 0–100** — `core.analyze()` scores each video **only from its own data + age**,
   against a fixed reference (no feed comparison, deterministic):
   ```
   z = clamp((x − μ)/σ, −3, 3)                    // μ/σ are fixed constants
   f = clamp((T − 24) / 48, 0, 1)                 // velocity fades out 24h → 72h
   score = 100 · sigmoid((0.30+0.35·f)·z_V + 0.35·(1−f)·z_VPH + 0.35·z_ER)
   ```
   Missing engagement is neutral (`z_ER = 0`) and reported as `confidence 0.65` (vs 1.0).
   Verdict (one per video, consumed by badge + filter + watch row): 7 steps —
   `Low` (absolute low-quality policy wins) · `Weak` · `Average` · `Good` · `Strong`
   · `Excellent` · `Top`, plus `Suspicious` (high reach, very low engagement).
   Bands use fixed score cuts (20/35/50/66/76/88).

Low-quality rule (feeds/sidebar expose no like counts). Fresh videos are not judged
by velocity, and old videos are judged by total reach because views/hour decays:
```
low ⟺ V ≥ 200 ∧ wilsonLB < lowQualityMaxEngagement                    // many views, no reaction
     ∨ (T ≥ lowQualityMinAgeHours ∧ T ≤ lowQualityOldHours
          ∧ (V < lowQualityMaxViews ∨ V/T < lowQualityMinVph))       // 466 views / 11h -> low
     ∨ (T > lowQualityOldHours ∧ V < lowQualityMaxViewsOld)          // stale, no traction
```

Ranking variant (single number, no calibration): Hacker News gravity `(V−1)/(T+2)^1.8`.

References: Evan Miller (Wilson), Hacker News `news.arc` gravity, Reddit `_sorts.pyx`,
arXiv:2403.00454 (likes/comments correlation), arXiv:2410.00289 (NAWP/ECR),
Pinto et al. WSDM 2013 (early view patterns), vidIQ VPH / Outlier Score.

## "Not interested"

Direct `POST https://www.youtube.com/youtubei/v1/feedback?prettyPrint=false`:

- The `feedbackToken` is extracted from the renderer data (`el.data`) or
  `ytInitialData`, matched by the `NOT_INTERESTED` icon type.
- `context` comes from `ytcfg`; `Authorization` is a **SAPISIDHASH** computed from cookies.
- If the token/auth is unavailable or the POST fails, it falls back to clicking the
  native "Not interested" menu item.
- Revealed/dismissed state is kept **per session** only.

## Tests

```bash
npm test        # node tests/algorithm.test.js — parser, Wilson bound, thresholds
```

## Manual smoke test (Firefox)

1. `about:debugging` → Load Temporary Add-on → `manifest.json`.
2. Home/search/subscriptions: low-quality tiles are blurred with actions; Reveal
   unblurs, Not interested removes the tile.
3. Tiles show a `LOW/WEAK/AVG/GOOD/HYPE` badge. A video with thousands of views in
   a few hours must be GOOD/HYPE and must not be blurred.
4. `/watch`: a stats bar appears under the title with views/likes/age/comments.
5. Console (`[ytcal]`): `feedback: 'not interested' sent` or `-> falling back`.
6. Calendar: watch more than 3 minutes and verify a calendar entry.

## License

Do whatever you like.
