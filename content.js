class YouTubeSessionTracker {
  #MIN_WATCH_SEC = 180;
  #PAUSE_TIMEOUT_MS = 5 * 60 * 1000;
  #TAG = "[yt-cal]";

  #session = null;
  #pauseTimer = null;
  #attachedVideo = null;
  #boundOnPlay = null;
  #boundOnPause = null;

  constructor() {
    this.#boundOnPlay = () => this.#onPlay();
    this.#boundOnPause = () => this.#onPause();
    this.#patchHistoryApi();
    this.#observeDom();
    this.#bindNavigationEvents();
    this.#bindPageLifecycleEvents();
    setInterval(() => this.#tick(), 1000);

    const video = document.querySelector("video");
    if (video) this.#attachVideo(video);

    console.log(this.#TAG, "loaded");
  }

  #startSession() {
    const url = location.href;
    if (this.#session?.url === url) return;
    if (this.#session) this.#commitSession();

    this.#session = {
      url,
      title: this.#resolveTitle(),
      channel: this.#resolveChannel(),
      startedAt: new Date(),
      watchedSec: 0,
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
      return;
    }

    browser.runtime.sendMessage({
      action: "LOG_YOUTUBE_EVENT",
      url: s.url,
      title: s.title,
      channel: s.channel,
      startedAt: s.startedAt.toISOString(),
      durationSec: s.watchedSec,
    }).catch((err) => console.error(this.#TAG, "sendMessage failed", err));
  }

  #resolveTitle() {
    return document.querySelector(
      "h1.ytd-video-primary-info-renderer yt-formatted-string"
    )?.textContent.trim() ?? document.title.replace(/^\(\d+\)\s*/, "").replace(" - YouTube", "").trim();
  }

  #resolveChannel() {
    return document.querySelector(
      "ytd-video-owner-renderer #channel-name a"
    )?.textContent.trim() ?? "";
  }


  #onPlay() {
    clearTimeout(this.#pauseTimer);
    this.#pauseTimer = null;
    console.log(this.#TAG, "play", location.href);

    if (!this.#session || this.#session.url !== location.href) this.#startSession();
  }

  #onPause() {
    if (this.#pauseTimer) return;
    console.log(this.#TAG, "pause – starting", this.#PAUSE_TIMEOUT_MS / 60000, "min timeout");
    this.#pauseTimer = setTimeout(() => {
      console.log(this.#TAG, "pause timeout expired");
      this.#pauseTimer = null;
      this.#commitSession();
    }, this.#PAUSE_TIMEOUT_MS);
  }

  #tick() {
    const video = document.querySelector("video");
    if (video && !video.paused && !video.ended && video.readyState > 2 && this.#session) {
      this.#session.watchedSec++;
    }
  }

  #attachVideo(video) {
    if (this.#attachedVideo === video) return;
    if (this.#attachedVideo) {
      this.#attachedVideo.removeEventListener("play", this.#boundOnPlay);
      this.#attachedVideo.removeEventListener("pause", this.#boundOnPause);
      this.#attachedVideo.removeEventListener("ended", this.#boundOnPause);
    }
    video.addEventListener("play", this.#boundOnPlay);
    video.addEventListener("pause", this.#boundOnPause);
    video.addEventListener("ended", this.#boundOnPause);
    this.#attachedVideo = video;
    console.log(this.#TAG, "video attached, paused:", video.paused);

    if (!video.paused) this.#onPlay();
  }

  #observeDom() {
    new MutationObserver(() => {
      const video = document.querySelector("video");
      if (video && video !== this.#attachedVideo) this.#attachVideo(video);
    }).observe(document.body, { childList: true, subtree: true });
  }

  #patchHistoryApi() {
    ["pushState", "replaceState"].forEach((method) => {
      const orig = history[method];
      history[method] = function (...args) {
        const result = orig.apply(this, args);
        window.dispatchEvent(new Event("yt:navigate"));
        return result;
      };
    });
  }

  #bindNavigationEvents() {
    window.addEventListener("yt:navigate", () => {
      console.log(this.#TAG, "navigate", location.pathname);
      if (location.pathname !== "/watch") {
        clearTimeout(this.#pauseTimer);
        this.#pauseTimer = null;
        this.#commitSession();
      }
    });

    window.addEventListener("popstate", () =>
      window.dispatchEvent(new Event("yt:navigate"))
    );
  }

  #bindPageLifecycleEvents() {
    document.addEventListener("visibilitychange", () => {
      console.log(this.#TAG, "visibility", document.visibilityState);
      if (document.visibilityState === "hidden") {
        this.#onPause();
      } else {
        const video = document.querySelector("video");
        if (video && !video.paused) this.#onPlay();
      }
    });

    window.addEventListener("beforeunload", () => {
      console.log(this.#TAG, "beforeunload");
      clearTimeout(this.#pauseTimer);
      this.#pauseTimer = null;
      this.#commitSession();
    });
  }
}

new YouTubeSessionTracker();
