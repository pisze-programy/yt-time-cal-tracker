// time-tracker.js — watch-time session tracker -> Google Calendar.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});

  class YouTubeSessionTracker {
    #MIN_WATCH_SEC = 180;
    #PAUSE_TIMEOUT_MS = 5 * 60 * 1000;
    #ENDED_COMMIT_MS = 15 * 1000;
    #MAX_RECOVER_AGE_MS = 24 * 3600 * 1000;
    #SAMPLE_MS = 5000;
    #SESSIONS_KEY = "ytcal_sessions";
    #TAG = "[ytcal]";

    #session = null;
    #pauseTimer = null;
    #sampleTimer = null;
    #attachedVideo = null;
    #boundOnPlay = null;
    #boundOnPause = null;
    #boundOnEnded = null;
    #boundOnSeeking = null;
    #boundOnSeeked = null;
    #lastSampleAt = 0;
    #lastMediaTime = null;
    #seeking = false;
    #lastPersistAt = 0;
    #restore = null;

    constructor() {
      this.#boundOnPlay = () => this.#onPlay();
      this.#boundOnPause = () => this.#onPause();
      this.#boundOnEnded = () => this.#onEnded();
      this.#boundOnSeeking = () => this.#onSeeking();
      this.#boundOnSeeked = () => this.#onSeeked();

      // Delegated capture finds the <video> even after YouTube re-creates it during SPA
      // navigation — no second MutationObserver needed.
      document.addEventListener(
        "play",
        (e) => {
          if (e.target && e.target.tagName === "VIDEO") {
            if (this.#isInlinePreview(e.target)) return;
            this.#attachVideo(e.target);
          }
        },
        true
      );
      this.#bindNavigationEvents();
      this.#bindPageLifecycleEvents();

      const video = this.#findPrimaryVideo();
      if (video) this.#attachVideo(video);
      this.#recoverPersistedSessions();

      console.log(this.#TAG, "time-tracker loaded");
    }

    // --- environment & metadata helpers ---

    #isShortsPage() {
      return typeof location !== "undefined" && String(location.pathname || "").startsWith("/shorts");
    }

    #isInlinePreview(video) {
      return Boolean(
        video &&
          typeof video.closest === "function" &&
          video.closest("#inline-preview-player, ytd-video-preview")
      );
    }

    #isMiniplayerActive() {
      return Boolean(
        document.querySelector("ytd-miniplayer[active], ytd-app[miniplayer-is-active]")
      );
    }

    #isAdPlaying() {
      return Boolean(
        document.querySelector(".html5-video-player.ad-showing, .html5-video-player.ad-interrupting")
      );
    }

    #findPrimaryVideo() {
      const v =
        document.querySelector("#movie_player video, ytd-player video") ||
        document.querySelector("video");
      return v && !this.#isInlinePreview(v) ? v : null;
    }

    #getWatchSearchVideoId() {
      try {
        if (location.pathname !== "/watch") return null;
        if (typeof location.search === "string" && location.search) {
          return new URLSearchParams(location.search).get("v");
        }
        return new URL(location.href).searchParams.get("v");
      } catch (_) {
        return null;
      }
    }

    #readPlayerVideoDetails() {
      try {
        const unwrap = (YTCAL.core && YTCAL.core.unwrap) || ((x) => x);
        const player = unwrap(document.querySelector("#movie_player"));
        if (player && typeof player.getPlayerResponse === "function") {
          const pr = player.getPlayerResponse();
          if (pr && pr.videoDetails) return pr.videoDetails;
        }
      } catch (_) {}
      return null;
    }

    // Returns the active videoId for /watch or an active Miniplayer, or null on Shorts,
    // home hover previews, and non-watch pages.
    #resolveVideoId(video) {
      if (this.#isShortsPage()) return null;
      if (this.#isInlinePreview(video)) return null;

      const watchId = this.#getWatchSearchVideoId();
      if (watchId) return watchId;

      if (
        this.#isMiniplayerActive() ||
        (video && typeof video.closest === "function" && video.closest("ytd-miniplayer"))
      ) {
        const vd = this.#readPlayerVideoDetails();
        if (vd && vd.videoId) return vd.videoId;
        if (this.#session && video && !video.paused) return this.#session.videoId;
      }

      return null;
    }

    #canonicalUrl(videoId) {
      return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    }

    #resolveTitle(videoId) {
      const vd = this.#readPlayerVideoDetails();
      if (vd && vd.videoId === videoId && vd.title) return String(vd.title).trim();

      if (this.#getWatchSearchVideoId() === videoId) {
        const domTitle =
          document
            .querySelector(
              "ytd-watch-metadata h1 yt-formatted-string, h1.ytd-video-primary-info-renderer yt-formatted-string"
            )
            ?.textContent.trim() || "";
        if (domTitle) return domTitle;

        const docTitle = String(document.title || "")
          .replace(/^\(\d+\)\s*/, "")
          .replace(/\s*-\s*YouTube$/, "")
          .trim();
        if (docTitle && docTitle !== "YouTube") return docTitle;
      }
      return "";
    }

    #resolveChannel(videoId) {
      const vd = this.#readPlayerVideoDetails();
      if (vd && vd.videoId === videoId && vd.author) return String(vd.author).trim();

      if (this.#getWatchSearchVideoId() === videoId) {
        return (
          document
            .querySelector(
              "ytd-watch-metadata ytd-video-owner-renderer #channel-name a, ytd-video-owner-renderer #channel-name a"
            )
            ?.textContent.trim() ?? ""
        );
      }
      return "";
    }

    #refreshSessionMeta() {
      if (!this.#session) return;
      const vid = this.#session.videoId;
      const title = this.#resolveTitle(vid);
      if (title) this.#session.title = title;
      const channel = this.#resolveChannel(vid);
      if (channel) this.#session.channel = channel;
    }

    #generateEventId(videoId) {
      return `${videoId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    }

    // --- sampling lifecycle (event-driven: 0 timers when paused / idle) ---

    #startSampling() {
      if (this.#sampleTimer) return;
      this.#lastSampleAt = performance.now();
      const video = this.#attachedVideo;
      if (video && Number.isFinite(video.currentTime)) {
        this.#lastMediaTime = video.currentTime;
      }
      this.#sampleTimer = setInterval(() => this.#sample(), this.#SAMPLE_MS);
    }

    #stopSampling() {
      if (!this.#sampleTimer) return;
      clearInterval(this.#sampleTimer);
      this.#sampleTimer = null;
    }

    // --- session lifecycle ---

    #startSession(videoId) {
      if (!videoId) return;
      if (this.#session && this.#session.videoId === videoId) {
        this.#refreshSessionMeta();
        return;
      }
      if (this.#session) {
        this.#sample(true);
        this.#commitSession();
      }

      const now = Date.now();
      const prev =
        this.#restore &&
        this.#restore.videoId === videoId &&
        now - this.#restore.savedAt <= this.#PAUSE_TIMEOUT_MS
          ? this.#restore
          : null;
      this.#restore = null;

      const title = this.#resolveTitle(videoId) || (prev && prev.title) || "";
      const channel = this.#resolveChannel(videoId) || (prev && prev.channel) || "";

      this.#session = {
        eventId: (prev && prev.eventId) || this.#generateEventId(videoId),
        videoId,
        url: this.#canonicalUrl(videoId),
        title,
        channel,
        startedAt: prev && prev.startedAt ? new Date(prev.startedAt) : new Date(),
        watchedSec: prev ? prev.watchedSec || 0 : 0,
      };

      console.log(this.#TAG, "session start", this.#session.title || videoId, this.#session.url);
    }

    #commitSession() {
      this.#stopSampling();
      if (!this.#session) return;
      this.#refreshSessionMeta();
      const s = this.#session;
      this.#session = null;

      console.log(this.#TAG, "commit", s.title || s.videoId, `${Math.round(s.watchedSec)}s`);

      if (s.watchedSec < this.#MIN_WATCH_SEC) {
        console.log(this.#TAG, "skip – too short", Math.round(s.watchedSec), "< MIN", this.#MIN_WATCH_SEC);
        this.#clearPersisted(s.videoId);
        return;
      }

      this.#dispatchEvent(s);
    }

    #dispatchEvent(s) {
      browser.runtime
        .sendMessage({
          action: "LOG_YOUTUBE_EVENT",
          eventId: s.eventId || this.#generateEventId(s.videoId || "yt"),
          url: s.url,
          title: s.title || s.videoId || "YouTube",
          channel: s.channel || "",
          startedAt: s.startedAt instanceof Date ? s.startedAt.toISOString() : s.startedAt,
          durationSec: Math.round(s.watchedSec),
        })
        .then((res) => {
          if (!res || res.ok !== false) {
            this.#clearPersisted(s.videoId);
          }
        })
        .catch((err) => console.error(this.#TAG, "sendMessage failed", err));
    }

    // --- per-video session persistence (multi-tab safe) ---

    async #readSessionsMap() {
      try {
        const res = await browser.storage.local.get([this.#SESSIONS_KEY, "ytcal_session"]);
        const map =
          res && res[this.#SESSIONS_KEY] && typeof res[this.#SESSIONS_KEY] === "object"
            ? { ...res[this.#SESSIONS_KEY] }
            : {};
        // Migrate legacy single-key entry if present
        const legacy = res && res.ytcal_session;
        if (legacy && legacy.url) {
          try {
            const vid = new URL(legacy.url).searchParams.get("v");
            if (vid && !map[vid]) {
              map[vid] = { ...legacy, videoId: vid, eventId: this.#generateEventId(vid) };
            }
          } catch (_) {}
          browser.storage.local.remove("ytcal_session").catch(() => {});
        }
        return map;
      } catch (_) {
        return {};
      }
    }

    async #persist() {
      if (!this.#session) return;
      const s = this.#session;
      try {
        const map = await this.#readSessionsMap();
        map[s.videoId] = {
          eventId: s.eventId,
          videoId: s.videoId,
          url: s.url,
          title: s.title,
          channel: s.channel,
          startedAt: s.startedAt.toISOString(),
          watchedSec: s.watchedSec,
          savedAt: Date.now(),
        };
        await browser.storage.local.set({ [this.#SESSIONS_KEY]: map });
      } catch (_) {}
    }

    #maybePersist() {
      const now = Date.now();
      if (now - this.#lastPersistAt < 15000) return;
      this.#lastPersistAt = now;
      this.#persist();
    }

    async #clearPersisted(videoId) {
      if (!videoId) return;
      try {
        const map = await this.#readSessionsMap();
        if (!(videoId in map)) return;
        delete map[videoId];
        await browser.storage.local.set({ [this.#SESSIONS_KEY]: map });
      } catch (_) {}
    }

    // Recovers persisted sessions on boot:
    // - Recent (<= PAUSE_TIMEOUT_MS) for the current video: seamlessly merges into the
    //   current session (even if autoplay already started before this async read finished).
    // - Stale (> PAUSE_TIMEOUT_MS, <= 24h): never glued to a new watch time; if >= MIN_WATCH_SEC,
    //   flushed immediately as its own separate calendar entry at its real original timestamp.
    async #recoverPersistedSessions() {
      try {
        const map = await this.#readSessionsMap();
        const now = Date.now();
        const currentVid = this.#resolveVideoId(this.#attachedVideo);
        const toFlush = [];
        let changed = false;

        for (const [vid, saved] of Object.entries(map)) {
          if (!saved || !saved.savedAt || !saved.startedAt) {
            delete map[vid];
            changed = true;
            continue;
          }
          const age = now - saved.savedAt;
          if (age > this.#MAX_RECOVER_AGE_MS) {
            delete map[vid];
            changed = true;
            continue;
          }
          if (age > this.#PAUSE_TIMEOUT_MS) {
            delete map[vid];
            changed = true;
            if ((saved.watchedSec || 0) >= this.#MIN_WATCH_SEC) {
              toFlush.push(saved);
            }
            continue;
          }
          // Recent (within pause window) for the video currently open in this tab
          if (vid === currentVid) {
            if (this.#session && this.#session.videoId === vid) {
              // Autoplay started before async restore completed — merge previous slice in.
              this.#session.eventId = saved.eventId || this.#session.eventId;
              this.#session.startedAt = new Date(saved.startedAt);
              this.#session.watchedSec += saved.watchedSec || 0;
              if (!this.#session.title && saved.title) this.#session.title = saved.title;
              if (!this.#session.channel && saved.channel) this.#session.channel = saved.channel;
            } else {
              this.#restore = saved;
            }
          }
        }

        if (changed) {
          await browser.storage.local.set({ [this.#SESSIONS_KEY]: map });
        }
        for (const s of toFlush) {
          this.#dispatchEvent(s);
        }
      } catch (_) {}
    }

    // --- playback event handlers ---

    #onPlay() {
      const videoId = this.#resolveVideoId(this.#attachedVideo);
      if (!videoId) return;

      clearTimeout(this.#pauseTimer);
      this.#pauseTimer = null;

      if (!this.#session || this.#session.videoId !== videoId) {
        this.#startSession(videoId);
      } else {
        this.#refreshSessionMeta();
      }
      this.#startSampling();
    }

    #onPause() {
      this.#sample(true);
      this.#persist();
      this.#stopSampling();
      if (!this.#session || this.#pauseTimer) return;
      this.#pauseTimer = setTimeout(() => {
        this.#pauseTimer = null;
        this.#commitSession();
      }, this.#PAUSE_TIMEOUT_MS);
    }

    #onEnded() {
      this.#sample(true);
      this.#persist();
      this.#stopSampling();
      if (!this.#session) return;
      clearTimeout(this.#pauseTimer);
      this.#pauseTimer = setTimeout(() => {
        this.#pauseTimer = null;
        this.#commitSession();
      }, this.#ENDED_COMMIT_MS);
    }

    #onSeeking() {
      if (!this.#seeking) {
        // Capture watch time accumulated right before the seek jump.
        this.#sample(true);
        this.#seeking = true;
      }
    }

    #onSeeked() {
      this.#seeking = false;
      this.#lastSampleAt = performance.now();
      const video = this.#attachedVideo;
      if (video && Number.isFinite(video.currentTime)) {
        this.#lastMediaTime = video.currentTime;
      }
    }

    // Watched time is accumulated from playbackRate-adjusted media-time deltas clamped to
    // wall-clock elapsed time. Works accurately across 0.5x–2x speeds, throttled background
    // tabs / PiP, buffering, and pauses, while excluding ads and seeks.
    #sample(fromEvent = false) {
      const video = this.#attachedVideo || this.#findPrimaryVideo();
      if (!video) {
        this.#stopSampling();
        return;
      }

      const now = performance.now();
      const dt = this.#lastSampleAt ? (now - this.#lastSampleAt) / 1000 : 0;
      this.#lastSampleAt = now;

      const t = Number.isFinite(video.currentTime) ? video.currentTime : null;

      if (this.#isAdPlaying()) {
        if (t != null) this.#lastMediaTime = t;
        return;
      }

      if (this.#session && t != null && this.#lastMediaTime != null && !this.#seeking) {
        const mediaDelta = t - this.#lastMediaTime;
        if (mediaDelta > 0) {
          const rate =
            Number.isFinite(video.playbackRate) && video.playbackRate > 0 ? video.playbackRate : 1;
          const realMediaSec = mediaDelta / rate;
          const add = dt > 0 ? Math.min(realMediaSec, dt) : realMediaSec;
          if (!video.paused || fromEvent || realMediaSec < dt) {
            this.#session.watchedSec += add;
          }
        }
      }
      if (t != null) this.#lastMediaTime = t;
      if (this.#session && (!this.#session.title || !this.#session.channel)) {
        this.#refreshSessionMeta();
      }
      if (!fromEvent) this.#maybePersist();
      if (video.paused && !fromEvent) this.#stopSampling();
    }

    #attachVideo(video) {
      if (this.#isInlinePreview(video)) return;
      if (this.#attachedVideo === video) return;
      if (this.#attachedVideo) {
        const old = this.#attachedVideo;
        old.removeEventListener("play", this.#boundOnPlay);
        old.removeEventListener("pause", this.#boundOnPause);
        old.removeEventListener("ended", this.#boundOnEnded);
        old.removeEventListener("seeking", this.#boundOnSeeking);
        old.removeEventListener("seeked", this.#boundOnSeeked);
      }
      video.addEventListener("play", this.#boundOnPlay);
      video.addEventListener("pause", this.#boundOnPause);
      video.addEventListener("ended", this.#boundOnEnded);
      video.addEventListener("seeking", this.#boundOnSeeking);
      video.addEventListener("seeked", this.#boundOnSeeked);
      this.#attachedVideo = video;
      this.#lastMediaTime = Number.isFinite(video.currentTime) ? video.currentTime : null;

      if (!video.paused) this.#onPlay();
    }

    #bindNavigationEvents() {
      // Sample right before YouTube swaps the player source and resets video.currentTime.
      window.addEventListener("yt:navigate-start", () => {
        if (!this.#session) return;
        this.#sample(true);
        this.#persist();
      });

      window.addEventListener("yt:navigate", () => {
        const currentVid = this.#resolveVideoId(this.#attachedVideo);
        if (!this.#session) return;

        if (!currentVid || currentVid !== this.#session.videoId) {
          clearTimeout(this.#pauseTimer);
          this.#pauseTimer = null;
          this.#commitSession();
        } else {
          // Same video (e.g. DOM finished rendering or &t= param changed): refresh metadata.
          this.#refreshSessionMeta();
        }
      });
    }

    #bindPageLifecycleEvents() {
      // Commits happen on a real pause (timeout), ended, navigation away from the video and
      // unload. Deliberately NOT on visibilitychange: background / PiP playback must
      // keep accumulating watch time instead of being truncated after the pause timeout.
      const flush = () => {
        clearTimeout(this.#pauseTimer);
        this.#pauseTimer = null;
        this.#sample(true);
        this.#persist();
        this.#commitSession();
      };
      window.addEventListener("pagehide", flush);
      window.addEventListener("beforeunload", flush);
    }
  }

  YTCAL.TimeTrackerFeature = class {
    #tracker = null;
    start() {
      if (window.YTCAL_FEATURES && window.YTCAL_FEATURES.timeTracker === false) {
        console.log("[ytcal] timeTracker disabled");
        return;
      }
      if (this.#tracker) return;
      this.#tracker = new YouTubeSessionTracker();
    }
  };
})();
