// Feature flags — edit here to enable/disable modules.
// All modules default to ON. Changes take effect after reloading the page.
window.YTCAL_FEATURES = {
  // Shows a blur overlay on low-quality videos with reveal/dismiss actions.
  qualityFilter: true,
  // Renders a colored quality badge on video tiles (feed, search, sidebar).
  scoreBadge: true,
  // Renders a stats bar (views/likes/age/comments + score) on the watch page.
  watchStats: true,
  // Tracks watch time and syncs it to Google Calendar.
  timeTracker: true,

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
};
