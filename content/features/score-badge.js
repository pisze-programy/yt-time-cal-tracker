// score-badge.js — renders the verdict chip on video tiles (single source of truth: core.analyze).
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});

  YTCAL.ScoreBadgeFeature = class {
    get enabled() {
      return !window.YTCAL_FEATURES || window.YTCAL_FEATURES.scoreBadge !== false;
    }

    start() {
      if (!this.enabled) {
        console.log("[ytcal] scoreBadge disabled");
        return;
      }
      this.scan();
    }

    onNavigate() {
      if (this.enabled) this.scan();
    }

    onMutate() {
      if (this.enabled) this.scan();
    }

    scan() {
      const core = YTCAL.core;
      const t = (window.YTCAL_FEATURES && window.YTCAL_FEATURES.thresholds) || {};
      const minViews = t.minViewsForScore != null ? t.minViewsForScore : 100;

      for (const el of core.findItems()) {
        if (!core.isOutermost(el)) continue;
        if (core.isShort(el)) continue;
        // Re-inject if YouTube rebuilt the thumbnail and removed our badge.
        if (el.querySelector(".ytcal-thumb-badge, .ytcal-badge")) continue;

        const meta = core.extractMetadata(el);
        if (meta.views == null || meta.views < minViews) continue;

        const a = core.analyze({ views: meta.views, ageHours: meta.ageHours, durationSec: meta.durationSec });
        if (!a) continue;

        this.#injectBadge(el, a);
      }
    }

    // Thumbnail host for both the new view-model and classic layouts.
    #findThumbnail(el) {
      return (
        el.querySelector("yt-thumbnail-view-model") ||
        el.querySelector("ytd-thumbnail") ||
        el.querySelector("#thumbnail") ||
        el.querySelector("a#thumbnail")
      );
    }

    #tooltip(a) {
      const scoreTxt =
        a.verdict === "Low" || a.verdict === "Suspicious" ? "" : ` (${Math.round(a.score)}/100)`;
      const parts = [`${a.verdict}${scoreTxt}`];
      if (a.reason) parts.push(a.reason);
      parts.push(`Reach: ${a.labels.reach}`);
      parts.push(`Velocity: ${a.labels.velocity}`);
      parts.push(`Engagement: ${a.metrics.engagementKnown ? a.labels.engagement : "likes unavailable"}`);
      return parts.join(" · ");
    }

    #injectBadge(el, a) {
      const badge = document.createElement("span");
      badge.className =
        `ytcal-badge ytcal-band-${a.band}` + (a.metrics.engagementKnown ? "" : " ytcal-no-engagement");
      badge.textContent = a.verdict;
      badge.title = this.#tooltip(a);

      // Preferred: overlay badge on the thumbnail, top-right (margin 8px), clear of the native "Nowość".
      const thumb = this.#findThumbnail(el);
      if (thumb) {
        if (thumb.querySelector(".ytcal-thumb-badge")) return true;
        const wrap = document.createElement("yt-thumbnail-overlay-badge-view-model");
        wrap.className =
          "ytcal-thumb-badge ytThumbnailOverlayBadgeViewModelHost ytThumbnailOverlayBadgeViewModelLarge";
        wrap.appendChild(badge);
        thumb.appendChild(wrap);
        return true;
      }

      // Fallback for layouts without a thumbnail element: metadata row.
      const target = el.querySelector('[class*="MetadataRow"]') || el.querySelector("#metadata-line");
      if (!target) return false;
      if (target.querySelector(".ytcal-badge")) return true;
      target.appendChild(badge);
      return true;
    }
  };
})();
