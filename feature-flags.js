// Feature flags — edit here to enable/disable modules.
// All modules default to ON. Changes take effect after reloading the page.
window.YTCAL_FEATURES = {
  // Shows a blur overlay on low-quality videos with reveal/dismiss actions.
  qualityFilter: true,
  // Renders a colored quality badge on video tiles (feed, search, sidebar).
  scoreBadge: true,
  // Renders a stats bar (views/likes/age/comments + score) on the watch page.
  watchStats: true,
  // Adds an estimated-earnings field (watch-time anchored) + SocialBlade link on the watch page.
  monetization: true,
  // Tracks watch time and syncs it to Google Calendar.
  timeTracker: true,
  // Second-row verdict chips under the home chip bar. Each chip toggles blur for
  // one verdict; verdicts listed here start switched OFF (blurred).
  verdictFilter: true,
  verdictHiddenByDefault: ["Low"],

  // Scoring thresholds (see core.js -> analyze / isLowQuality).
  thresholds: {
    minViewsForScore: 100,          // badge-only: hide the tile badge below this view count (filter still runs)
    lowQualityMaxViews: 100,        // absolute floor: fewer than X views ...
    lowQualityMinAgeHours: 6,       // ... and older than Y hours = low quality
    lowQualityMinVph: 100,          // velocity floor (views/hour) within the first days
    lowQualityOldHours: 48,         // after this age, judge by total reach instead of velocity
    lowQualityMaxViewsOld: 1000,    // old content below this total = low quality
    lowQualityMaxEngagement: 0.002, // many views but Wilson LB below 0.2% = low quality
    commentWeight: 1,               // 1 = industry (likes + comments) / views; likes:comments ~ 10:1
    priorViews: 30,                 // Bayesian smoothing for view velocity
    priorHours: 3,
    durationWeight: 0.25,           // how strongly video length adjusts expected velocity
    durationNeutralMin: 8,          // length (minutes) that leaves velocity unchanged
  },

  // Monetization estimate (see README). Foreign videos expose neither average view
  // duration nor real revenue, so the result is always a RANGE. CPM is the advertiser
  // rate in PLN per 1000 impressions; country is the detected viewer market (fallback).
  revenue: {
    currency: "PLN",
    country: "PL",                  // fallback market when the session country is unreadable
    creatorShare: 0.55,             // creator's share of ad revenue
    adFill: 0.45,                   // share of views with at least one ad (40-60%)
    midRollGapMin: 8,               // mid-rolls only exist for videos >= 8 minutes
    bandLow: 0.75,                  // residual CPM/fill uncertainty on top of each watch-time scenario
    bandHigh: 1.35,
    rpmScale: 1.0,                  // multiply the prior RPM (calibration; ~1.5 for high-retention PL news)
    rpmOverride: null,              // absolute RPM in PLN that pins the estimate (own-channel calibration)
    cpmPlnByCountry: {              // advertiser CPM (PLN) by market; _default is the fallback
      PL: 30, CZ: 26, DE: 60, GB: 70, US: 100, UA: 10, IN: 5, _default: 30,
    },
    nicheFactor: {                  // CPM multiplier per YouTube category
      default: 1.0, Finance: 2.0, Business: 1.8, "Science & Technology": 1.4,
      Education: 1.2, "Howto & Style": 1.15, "News & Politics": 1.1, Sports: 1.0,
      Documentary: 0.9, "Autos & Vehicles": 0.9, "Travel & Events": 0.9,
      "People & Blogs": 0.85, "Film & Animation": 0.85, Comedy: 0.8, Entertainment: 0.8,
      Videoblogging: 0.75, Gaming: 0.7, Movies: 0.7, Trailers: 0.6, Shows: 0.6,
      Music: 0.5, "Pets & Animals": 0.5, "Nonprofits & Activism": 0.5,
      "Short Movies": 0.6, Shorts: 0.15,
    },
    retention: {                    // AVD is a range (we don't know how long viewers watch):
      low: { base: 0.35, exponent: -0.25 },   // casual / poorly retained
      high: { base: 0.75, exponent: -0.18 },  // engaged audience; both decay with length
      min: 0.05, max: 0.85, floorSec: 20,
    },
    retentionByNiche: {             // per-category multiplier on the retention curve
      default: 1.0, "News & Politics": 1.2, Education: 1.15, "Howto & Style": 1.15,
      "Science & Technology": 1.1, Sports: 1.05, Documentary: 1.05, Music: 1.0,
      "Nonprofits & Activism": 1.0, "Autos & Vehicles": 0.95, "Travel & Events": 0.95,
      "Pets & Animals": 0.95, Comedy: 0.9, "Film & Animation": 0.9, Movies: 0.9,
      "Short Movies": 0.9, Shorts: 0.9, Entertainment: 0.85, Gaming: 0.85,
      Videoblogging: 0.85, "People & Blogs": 0.85, Trailers: 0.8, Shows: 0.8,
    },
  },
};
