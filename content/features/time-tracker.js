// time-tracker.js — istniejący tracker czasu -> Google Calendar (modularyzacja).
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});

  class YouTubeSessionTracker {
    #MIN_WATCH_SEC = 180;
    #PAUSE_TIMEOUT_MS = 5 * 60 * 1000;
    #SAMPLE_MS = 5000;
    #TAG = "[ytcal]";

    #session = null;
    #pauseTimer = null;
    #sampleTimer = null;
    #attachedVideo = null;
    #boundOnPlay = null;
    #boundOnPause = null;
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
      this.#boundOnSeeking = () => {
        this.#seeking = true;
      };
      this.#boundOnSeeked = () => {
        this.#seeking = false;
      };
      // Delegated capture finds the <video> even after YouTube re-creates it during SPA
      // navigation — no second MutationObserver needed.
      document.addEventListener(
        "play",
        (e) => {
          if (e.target && e.target.tagName === "VIDEO") this.#attachVideo(e.target);
        },
        true
      );
      this.#bindNavigationEvents();
      this.#bindPageLifecycleEvents();
      this.#lastSampleAt = performance.now();
      this.#sampleTimer = setInterval(() => this.#sample(), this.#SAMPLE_MS);

      const video = document.querySelector("video");
      if (video) this.#attachVideo(video);
      this.#restoreSession();

      console.log(this.#TAG, "time-tracker loaded");
    }

    #startSession() {
      const url = location.href;
      if (this.#session && this.#session.url === url) return;
      if (this.#session) this.#commitSession();

      const prev = this.#restore && this.#restore.url === url ? this.#restore : null;
      this.#restore = null;

      this.#session = {
        url,
        title: this.#resolveTitle(),
        channel: this.#resolveChannel(),
        startedAt: prev && prev.startedAt ? new Date(prev.startedAt) : new Date(),
        watchedSec: prev ? prev.watchedSec || 0 : 0,
      };

      console.log(this.#TAG, "session start", this.#session.title, url);
    }

    #commitSession() {
      if (!this.#session) return;
      const s = this.#session;
      this.#session = null;

      console.log(this.#TAG, "commit", s.title, `${s.watchedSec}s`);

      if (s.watchedSec < this.#MIN_WATCH_SEC) {
        console.log(this.#TAG, "skip – too short", s.watchedSec, "< MIN", this.#MIN_WATCH_SEC);
        this.#clearPersisted();
        return;
      }

      browser.runtime
        .sendMessage({
          action: "LOG_YOUTUBE_EVENT",
          url: s.url,
          title: s.title,
          channel: s.channel,
          startedAt: s.startedAt.toISOString(),
          durationSec: s.watchedSec,
        })
        .then(() => this.#clearPersisted())
        .catch((err) => console.error(this.#TAG, "sendMessage failed", err));
    }

    // --- session persistence: survive reloads / crashes without losing watch time ---

    #persist() {
      if (!this.#session) return;
      browser.storage.local
        .set({
          ytcal_session: {
            url: this.#session.url,
            title: this.#session.title,
            channel: this.#session.channel,
            startedAt: this.#session.startedAt.toISOString(),
            watchedSec: this.#session.watchedSec,
            savedAt: Date.now(),
          },
        })
        .catch(() => {});
    }

    #maybePersist() {
      const now = Date.now();
      if (now - this.#lastPersistAt < 15000) return;
      this.#lastPersistAt = now;
      this.#persist();
    }

    #clearPersisted() {
      browser.storage.local.remove("ytcal_session").catch(() => {});
    }

    // Seeds the next #startSession with the stored in-progress session (same video,
    // recent). It does not resume on its own: playback must restart first.
    async #restoreSession() {
      try {
        const { ytcal_session: saved } = await browser.storage.local.get("ytcal_session");
        if (!saved || !saved.url || !saved.savedAt || Date.now() - saved.savedAt > 6 * 3600 * 1000) {
          this.#clearPersisted();
          return;
        }
        this.#restore = saved;
      } catch (_) {}
    }

    #resolveTitle() {
      return (
        document
          .querySelector("h1.ytd-video-primary-info-renderer yt-formatted-string")
          ?.textContent.trim() ??
        document.title
          .replace(/^\(\d+\)\s*/, "")
          .replace(" - YouTube", "")
          .trim()
      );
    }

    #resolveChannel() {
      return (
        document.querySelector("ytd-video-owner-renderer #channel-name a")?.textContent.trim() ?? ""
      );
    }

    #onPlay() {
      clearTimeout(this.#pauseTimer);
      this.#pauseTimer = null;

      if (!this.#session || this.#session.url !== location.href) this.#startSession();
    }

    #onPause() {
      if (this.#pauseTimer) return;
      this.#pauseTimer = setTimeout(() => {
        this.#pauseTimer = null;
        this.#commitSession();
      }, this.#PAUSE_TIMEOUT_MS);
    }

    // Watched time is accumulated from media-time deltas clamped to the wall-clock
    // time that actually passed. A throttled background timer (or a hidden/PiP tab)
    // therefore no longer undercounts, and a pause inside the interval is not counted.
    #sample() {
      const video = this.#attachedVideo || document.querySelector("video");
      if (!video) return;

      const now = performance.now();
      const dt = this.#lastSampleAt ? (now - this.#lastSampleAt) / 1000 : 0;
      this.#lastSampleAt = now;

      const t = Number.isFinite(video.currentTime) ? video.currentTime : null;
      if (this.#session && t != null && this.#lastMediaTime != null && !this.#seeking) {
        const mediaDelta = t - this.#lastMediaTime;
        if (mediaDelta > 0) {
          const add = dt > 0 ? Math.min(mediaDelta, dt) : mediaDelta;
          // Paused now, but the media advanced -> it played part of the interval; count
          // exactly that part. A forward seek while paused is filtered by Math.min above.
          if (!video.paused || mediaDelta < dt) this.#session.watchedSec += add;
        }
      }
      if (t != null) this.#lastMediaTime = t;
      this.#maybePersist();
    }

    #attachVideo(video) {
      if (this.#attachedVideo === video) return;
      if (this.#attachedVideo) {
        const old = this.#attachedVideo;
        old.removeEventListener("play", this.#boundOnPlay);
        old.removeEventListener("pause", this.#boundOnPause);
        old.removeEventListener("ended", this.#boundOnPause);
        old.removeEventListener("seeking", this.#boundOnSeeking);
        old.removeEventListener("seeked", this.#boundOnSeeked);
      }
      video.addEventListener("play", this.#boundOnPlay);
      video.addEventListener("pause", this.#boundOnPause);
      video.addEventListener("ended", this.#boundOnPause);
      video.addEventListener("seeking", this.#boundOnSeeking);
      video.addEventListener("seeked", this.#boundOnSeeked);
      this.#attachedVideo = video;
      this.#lastMediaTime = Number.isFinite(video.currentTime) ? video.currentTime : null;

      if (!video.paused) this.#onPlay();
    }

    #bindNavigationEvents() {
      window.addEventListener("yt:navigate", () => {
        if (location.pathname !== "/watch") {
          clearTimeout(this.#pauseTimer);
          this.#pauseTimer = null;
          this.#commitSession();
        }
      });
      // popstate -> yt:navigate is dispatched once by content.js; do not duplicate it here.
    }

    #bindPageLifecycleEvents() {
      // Commits happen on a real pause (timeout), ended, navigation away from /watch and
      // unload. Deliberately NOT on visibilitychange: background / PiP playback must
      // keep accumulating watch time instead of being truncated after the pause timeout.
      const flush = () => {
        clearTimeout(this.#pauseTimer);
        this.#pauseTimer = null;
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
