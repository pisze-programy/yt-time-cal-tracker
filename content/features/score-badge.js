// score-badge.js — renders the verdict chip on video tiles (single source of truth: core.analyze).
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});

  YTCAL.ScoreBadgeFeature = class extends YTCAL.TileFeature {
    #scan = YTCAL.createTileScanner({
      // Re-inject if YouTube rebuilt the thumbnail and removed our badge.
      shouldSkip: (el) => !!el.querySelector(".ytcal-thumb-badge, .ytcal-badge"),
      handle: (el, meta) => {
        const t = (window.YTCAL_FEATURES && window.YTCAL_FEATURES.thresholds) || {};
        const minViews = t.minViewsForScore != null ? t.minViewsForScore : 100;
        if (meta.views == null || meta.views < minViews) {
          this.#clearBadge(el);
          return;
        }

        const a = YTCAL.core.analyze({
          views: meta.views,
          ageHours: meta.ageHours,
          durationSec: meta.durationSec,
        });
        if (a) this.#injectBadge(el, a);
        else this.#clearBadge(el);
      },
    });

    constructor() {
      super("scoreBadge");
    }

    scan(ctx) {
      this.#scan(ctx);
    }

    #clearBadge(el) {
      for (const n of el.querySelectorAll(".ytcal-thumb-badge, .ytcal-badge")) {
        n.remove();
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

    #badgeLabel(a) {
      if (a.verdict === "Low" || a.verdict === "Suspicious") return a.verdict;
      return `${a.verdict} · ${Math.round(a.score)}`;
    }

    #injectBadge(el, a) {
      const cls =
        `ytcal-badge ytcal-band-${a.band}` + (a.metrics.engagementKnown ? "" : " ytcal-no-engagement");
      const title = this.#tooltip(a);
      const text = this.#badgeLabel(a);

      // Preferred: overlay badge on the thumbnail, top-right (margin 8px), clear of the native "Nowość".
      const thumb = this.#findThumbnail(el);
      if (thumb) {
        const existing = thumb.querySelector(".ytcal-thumb-badge .ytcal-badge");
        if (existing) {
          existing.className = cls;
          existing.textContent = text;
          existing.title = title;
          return true;
        }
        const badge = document.createElement("span");
        badge.className = cls;
        badge.textContent = text;
        badge.title = title;
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
      const existing = target.querySelector(".ytcal-badge");
      if (existing) {
        existing.className = cls;
        existing.textContent = text;
        existing.title = title;
        return true;
      }
      const badge = document.createElement("span");
      badge.className = cls;
      badge.textContent = text;
      badge.title = title;
      target.appendChild(badge);
      return true;
    }
  };
})();
