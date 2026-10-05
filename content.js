// content.js — bootstrap: registers independent feature modules and a shared SPA observer.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});
  const F = window.YTCAL_FEATURES || {};
  const features = [];
  const enabledKeys = [];

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
        features.push(new Cls());
        enabledKeys.push(key);
      }
    }

    // Shared, frame-throttled mutation observer.
    let scheduled = false;
    const run = (fn) => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        for (const f of features) {
          if (typeof f[fn] === "function") {
            try {
              f[fn]();
            } catch (e) {
              console.error("[ytcal] feature", fn, e);
            }
          }
        }
      });
    };

    new MutationObserver(() => run("onMutate")).observe(document.body, {
      childList: true,
      subtree: true,
    });

    // SPA navigation.
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

    for (const f of features) {
      try {
        f.start();
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
