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
    minViewsForScore: 100,          // below this view count the score is noise -> skip badge
    lowQualityMaxViews: 100,        // absolute floor: fewer than X views ...
    lowQualityMinAgeHours: 6,       // ... and older than Y hours = low quality
    lowQualityMinVph: 100,          // velocity floor (views/hour) within the first days
    lowQualityOldHours: 48,         // after this age, judge by total reach instead of velocity
    lowQualityMaxViewsOld: 1000,    // old content below this total = low quality
    lowQualityMaxEngagement: 0.002, // many views but Wilson LB below 0.2% = low quality
    commentWeight: 3,               // comment weight relative to a like (comments/view ~ 1/3 likes/view)
    priorViews: 30,                 // Bayesian smoothing for view velocity
    priorHours: 3,
  },
};
