// content.js — bootstrap: registers independent feature modules and a shared SPA observer.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});
  const F = window.YTCAL_FEATURES || {};
  const features = [];
  const enabledKeys = [];

  // Coalesce YouTube's mutation storm: features run at most once per window instead
  // of on every animation frame.
  const MUTATE_MIN_MS = 300;

  // These only affect on-screen rendering, so they are skipped while the tab/window
  // is idle. The time tracker is intentionally NOT in this set: background/PiP
  // watching must keep being tracked.
  const VISIBLE_ONLY = new Set(["qualityFilter", "scoreBadge", "watchStats"]);

  function enabled(key) {
    return F[key] !== false;
  }

  function boot() {
    const registry = [
      ["timeTracker", YTCAL.TimeTrackerFeature],
      ["qualityFilter", YTCAL.QualityFilterFeature],
      ["scoreBadge", YTCAL.ScoreBadgeFeature],
      ["watchStats", YTCAL.WatchStatsFeature],
    ];
    for (const [key, Cls] of registry) {
      if (enabled(key) && typeof Cls === "function") {
        features.push({ key, instance: new Cls() });
        enabledKeys.push(key);
      }
    }

    // One shared scan context per pass: findItems() + extractMetadata() are computed
    // once and reused by every feature (see core.createScanContext).
    let ctx = null;
    const context = () => (ctx || (ctx = YTCAL.core.createScanContext()));

    // Idle = hidden tab or unfocused window.
    let idle = null;
    const isIdle = () => document.hidden || !document.hasFocus();

    const run = (fn) => {
      ctx = null;
      for (const { key, instance } of features) {
        if (idle && VISIBLE_ONLY.has(key)) continue;
        if (typeof instance[fn] === "function") {
          try {
            instance[fn](context());
          } catch (e) {
            console.error("[ytcal] feature", fn, e);
          }
        }
      }
    };

    // Trailing throttle. The first burst runs immediately (lastMutateAt starts far in
    // the past); afterwards at most one run per MUTATE_MIN_MS.
    let mutateTimer = null;
    let lastMutateAt = -1e9;
    const scheduleMutate = () => {
      if (mutateTimer) return;
      const wait = Math.max(0, MUTATE_MIN_MS - (performance.now() - lastMutateAt));
      mutateTimer = setTimeout(() => {
        mutateTimer = null;
        lastMutateAt = performance.now();
        run("onMutate");
      }, wait);
    };

    // Tiles scrolling into view are picked up by the shared viewport gate (core.js).
    YTCAL.core.setViewportListener(scheduleMutate);

    const syncIdle = (initial) => {
      const next = isIdle();
      if (next === idle) return;
      idle = next;
      document.documentElement.classList.toggle("ytcal-idle", idle);
      if (!initial && !idle) {
        // Returned to view: run everything that was skipped, immediately.
        clearTimeout(mutateTimer);
        mutateTimer = null;
        lastMutateAt = performance.now();
        run("onMutate");
      }
    };

    // Shared, debounced mutation observer (features no longer own one).
    new MutationObserver(scheduleMutate).observe(document.body, {
      childList: true,
      subtree: true,
    });

    // SPA navigation — dispatched once (features subscribe to yt:navigate).
    ["pushState", "replaceState"].forEach((m) => {
      const orig = history[m];
      history[m] = function (...args) {
        const r = orig.apply(this, args);
        window.dispatchEvent(new Event("yt:navigate"));
        return r;
      };
    });
    window.addEventListener("popstate", () => window.dispatchEvent(new Event("yt:navigate")));
    window.addEventListener("yt:navigate", () => run("onNavigate"));

    document.addEventListener("visibilitychange", () => syncIdle(false));
    window.addEventListener("focus", () => syncIdle(false));
    window.addEventListener("blur", () => syncIdle(false));

    syncIdle(true);

    for (const { key, instance } of features) {
      if (idle && VISIBLE_ONLY.has(key)) continue;
      try {
        instance.start(context());
      } catch (e) {
        console.error("[ytcal] start", e);
      }
    }
    run("onNavigate");

    console.log("[ytcal] loaded | features:", enabledKeys.join(", "));
  }

  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
