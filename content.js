let watchedSeconds = 0;
let lastUrl = location.href;
let intervalId = null;

function startTracking() {
  if (intervalId) clearInterval(intervalId);

  intervalId = setInterval(() => {
    const video = document.querySelector('video');

    if (video && !video.paused && !video.ended && video.readyState > 2) {
      watchedSeconds++;
    }

    if (location.href !== lastUrl) {
      triggerLogAndReset();
    }
  }, 1000);
}

function triggerLogAndReset() {
  // Skip, >= 3min is free!
  if (watchedSeconds >= 180) {
    browser.runtime.sendMessage({
      action: "LOG_YOUTUBE_EVENT",
      url: lastUrl,
      title: document.title,
      durationSec: watchedSeconds
    }).catch(() => {});
  }

  watchedSeconds = 0;
  lastUrl = location.href;
}

window.addEventListener('beforeunload', () => {
  triggerLogAndReset();
});

startTracking();
