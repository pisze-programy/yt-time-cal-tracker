// Run: node tests/time-tracker.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const TRACKER_SRC = fs.readFileSync(path.join(ROOT, "content", "features", "time-tracker.js"), "utf8");
const BG_SRC = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");

let pass = 0;
let fail = 0;
function eq(actual, expected, msg) {
  if (actual === expected) pass++;
  else {
    fail++;
    console.error(`FAIL ${msg}: got ${actual}, want ${expected}`);
  }
}
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`FAIL ${msg}`);
  }
}

function flushMicrotasks() {
  return new Promise((r) => setImmediate(r));
}

function createStorage(initial = {}) {
  const store = JSON.parse(JSON.stringify(initial));
  const listeners = [];
  return {
    store,
    api: {
      async get(keys) {
        if (typeof keys === "string") return { [keys]: store[keys] };
        if (Array.isArray(keys)) {
          const out = {};
          for (const k of keys) out[k] = store[k];
          return out;
        }
        return { ...store };
      },
      async set(obj) {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) {
          changes[k] = { oldValue: store[k], newValue: JSON.parse(JSON.stringify(v)) };
          store[k] = JSON.parse(JSON.stringify(v));
        }
        for (const fn of listeners) fn(changes, "local");
      },
      async remove(keys) {
        for (const k of [].concat(keys)) delete store[k];
      },
    },
    onChanged: {
      addListener(fn) { listeners.push(fn); },
    },
  };
}

function createTrackerHarness({
  url = "https://www.youtube.com/watch?v=vidA",
  title = "Video A",
  channel = "Channel A",
  playing = false,
  playbackRate = 1,
  inlinePreview = false,
  miniplayer = false,
  adShowing = false,
  storage = createStorage(),
  startEpochMs = 1795160000000,
} = {}) {
  let simEpoch = startEpochMs;
  let perfNow = 1000;
  let nextTimer = 1;
  const timers = new Map();
  const sentMessages = [];
  const docListeners = {};
  const winListeners = {};
  const videoListeners = {};

  const state = {
    url,
    title,
    channel,
    miniplayer,
    adShowing,
  };

  const video = {
    tagName: "VIDEO",
    paused: !playing,
    currentTime: 0,
    playbackRate,
    closest(sel) {
      if (inlinePreview && sel.includes("inline-preview-player")) return {};
      if (state.miniplayer && sel.includes("ytd-miniplayer")) return {};
      return null;
    },
    addEventListener(ev, fn) { (videoListeners[ev] = videoListeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      if (videoListeners[ev]) videoListeners[ev] = videoListeners[ev].filter((f) => f !== fn);
    },
    emit(ev) {
      for (const fn of (videoListeners[ev] || []).slice()) fn({ target: video });
    },
  };

  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(simEpoch);
      else super(...args);
    }
    static now() { return simEpoch; }
  }

  function parseLoc() {
    const u = new URL(state.url);
    return { href: u.href, pathname: u.pathname, search: u.search, origin: u.origin };
  }

  const ctx = vm.createContext({
    Date: FakeDate,
    URL,
    URLSearchParams,
    performance: { now: () => perfNow },
    setTimeout(fn, ms = 0) {
      const id = nextTimer++;
      timers.set(id, { id, fn, at: perfNow + ms, interval: null });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, ms = 0) {
      const id = nextTimer++;
      timers.set(id, { id, fn, at: perfNow + ms, interval: ms });
      return id;
    },
    clearInterval(id) { timers.delete(id); },
    document: {
      get title() { return `${state.title} - YouTube`; },
      querySelector(sel) {
        if (sel.includes("ad-showing")) return state.adShowing ? {} : null;
        if (sel.includes("ytd-miniplayer")) return state.miniplayer ? {} : null;
        if (sel === "#movie_player") {
          const u = new URL(state.url);
          const v = u.searchParams.get("v") || (state.miniplayer ? "vidA" : null);
          return {
            getPlayerResponse: () => ({
              videoDetails: { videoId: v, title: state.title, author: state.channel },
            }),
          };
        }
        if (sel.includes("video")) return video;
        if (sel.includes("h1")) return { textContent: state.title };
        if (sel.includes("channel-name")) return { textContent: state.channel };
        return null;
      },
      addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
    },
    get location() { return parseLoc(); },
    addEventListener(ev, fn) { (winListeners[ev] = winListeners[ev] || []).push(fn); },
    browser: {
      runtime: {
        sendMessage(msg) {
          sentMessages.push(msg);
          return Promise.resolve({ ok: true });
        },
      },
      storage: { local: storage.api },
    },
    console: { log() {}, warn() {}, error() {} },
    YTCAL_FEATURES: { timeTracker: true },
  });
  ctx.window = ctx;
  vm.runInContext(TRACKER_SRC, ctx);
  const feature = new ctx.YTCAL.TimeTrackerFeature();
  feature.start();

  function advance(ms) {
    const end = perfNow + ms;
    while (true) {
      let next = null;
      for (const t of timers.values()) {
        if (t.at <= end && (!next || t.at < next.at)) next = t;
      }
      if (!next) break;
      const step = next.at - perfNow;
      perfNow = next.at;
      simEpoch += step;
      if (!video.paused) video.currentTime += (step / 1000) * video.playbackRate;
      if (next.interval != null) next.at = perfNow + next.interval;
      else timers.delete(next.id);
      next.fn();
    }
    const rem = end - perfNow;
    perfNow = end;
    simEpoch += rem;
    if (!video.paused) video.currentTime += (rem / 1000) * video.playbackRate;
  }

  function emitWin(ev) {
    for (const fn of (winListeners[ev] || []).slice()) fn({});
  }

  function play() {
    video.paused = false;
    for (const fn of (docListeners.play || []).slice()) fn({ target: video });
    video.emit("play");
  }

  function pause() {
    video.paused = true;
    video.emit("pause");
  }

  function ended() {
    video.paused = true;
    video.emit("ended");
  }

  function seekTo(sec) {
    video.emit("seeking");
    video.currentTime = sec;
    video.emit("seeked");
  }

  return {
    state, video, storage, sentMessages, timers,
    advance, emitWin, play, pause, ended, seekTo,
    get epoch() { return simEpoch; },
  };
}

async function runTests() {
  // 1. Shorts are completely ignored
  {
    const h = createTrackerHarness({ url: "https://www.youtube.com/shorts/short123" });
    await flushMicrotasks();
    h.play();
    h.advance(240000);
    h.pause();
    h.advance(310000);
    eq(h.sentMessages.length, 0, "shorts: never logs calendar events");
  }

  // 2. Home hover previews are ignored
  {
    const h = createTrackerHarness({ url: "https://www.youtube.com/", inlinePreview: true });
    await flushMicrotasks();
    h.play();
    h.advance(240000);
    h.pause();
    h.advance(310000);
    eq(h.sentMessages.length, 0, "hover preview on home: never logs calendar events");
  }

  // 3. Playback rates (0.5x and 2x both count real wall-clock watching time)
  {
    const hSlow = createTrackerHarness({ playbackRate: 0.5 });
    await flushMicrotasks();
    hSlow.play();
    hSlow.advance(200000); // 200s real time at 0.5x = 100s media time
    hSlow.pause();
    hSlow.advance(305000);
    eq(hSlow.sentMessages.length, 1, "0.5x speed: commits after 200s real time");
    ok(
      Math.abs(hSlow.sentMessages[0].durationSec - 200) <= 2,
      `0.5x speed: real time ~200s (got ${hSlow.sentMessages[0].durationSec}s)`
    );

    const hFast = createTrackerHarness({ playbackRate: 2.0 });
    await flushMicrotasks();
    hFast.play();
    hFast.advance(200000); // 200s real time at 2x = 400s media time
    hFast.pause();
    hFast.advance(305000);
    eq(hFast.sentMessages.length, 1, "2x speed: commits after 200s real time");
    ok(
      Math.abs(hFast.sentMessages[0].durationSec - 200) <= 2,
      `2x speed: real time ~200s, not 400s (got ${hFast.sentMessages[0].durationSec}s)`
    );
  }

  // 4. Seeking does not inflate watch time & preserves pre-seek watch time
  {
    const h = createTrackerHarness();
    await flushMicrotasks();
    h.play();
    h.advance(100000); // watch 100s
    h.seekTo(900);     // jump forward +800s
    h.advance(100000); // watch 100s
    h.seekTo(10);      // jump backward
    h.pause();
    h.advance(305000);
    eq(h.sentMessages.length, 1, "seeking: commits valid session");
    ok(
      Math.abs(h.sentMessages[0].durationSec - 200) <= 2,
      `seeking: exact 200s watched across forward+backward seeks (got ${h.sentMessages[0].durationSec}s)`
    );
  }

  // 5. Ads are excluded from watch time
  {
    const h = createTrackerHarness();
    await flushMicrotasks();
    h.play();
    h.advance(100000);
    h.state.adShowing = true;
    h.advance(60000); // 60s ad
    h.state.adShowing = false;
    h.advance(100000);
    h.pause();
    h.advance(305000);
    eq(h.sentMessages.length, 1, "ads: commits session");
    ok(
      Math.abs(h.sentMessages[0].durationSec - 200) <= 6,
      `ads: excludes 60s ad (~200s, got ${h.sentMessages[0].durationSec}s)`
    );
  }

  // 6. Long pause (>5 min) then resume creates TWO separate calendar entries at real times
  {
    const t0 = 1795160000000;
    const h = createTrackerHarness({ startEpochMs: t0 });
    await flushMicrotasks();
    h.play();
    h.advance(200000); // Block 1: 200s starting at t0
    h.pause();
    h.advance(310000); // Pause 5m10s -> commits Block 1
    eq(h.sentMessages.length, 1, "long pause: commits block 1");

    h.advance(600000); // Wait another 10 min
    const block2Start = h.epoch;
    h.play();
    h.advance(240000); // Block 2: 240s starting ~18 min later
    h.pause();
    h.advance(310000);
    eq(h.sentMessages.length, 2, "long pause + resume: creates separate block 2");
    ok(
      h.sentMessages[0].eventId !== h.sentMessages[1].eventId,
      "separate blocks have distinct eventIds"
    );
    ok(
      Math.abs(Date.parse(h.sentMessages[1].startedAt) - block2Start) < 2000,
      "block 2 startedAt reflects real resume time"
    );
  }

  // 7. Quick reload within 5 min merges even when autoplay beats async storage read
  {
    const t0 = 1795160000000;
    const storage = createStorage({
      ytcal_sessions: {
        vidA: {
          eventId: "vidA:orig",
          videoId: "vidA",
          url: "https://www.youtube.com/watch?v=vidA",
          title: "Video A",
          channel: "Channel A",
          startedAt: new Date(t0 - 150000).toISOString(),
          watchedSec: 120,
          savedAt: t0 - 30000, // 30s ago -> within 5 min
        },
      },
    });
    const h = createTrackerHarness({ playing: true, storage, startEpochMs: t0 });
    await flushMicrotasks(); // resolves async recover AFTER synchronous autoplay #startSession!
    h.advance(90000); // +90s => total 210s >= 180s
    h.pause();
    h.advance(305000);
    eq(h.sentMessages.length, 1, "quick reload with autoplay: merges and commits");
    eq(h.sentMessages[0].eventId, "vidA:orig", "quick reload: keeps original eventId");
    ok(
      h.sentMessages[0].durationSec >= 208 && h.sentMessages[0].durationSec <= 212,
      `quick reload: merged 120+90=210s (got ${h.sentMessages[0].durationSec}s)`
    );
  }

  // 8. Reload/restart AFTER >5 min flushes stale session separately & starts fresh entry
  {
    const t0 = 1795160000000;
    const oldStart = new Date(t0 - 3 * 3600 * 1000).toISOString();
    const storage = createStorage({
      ytcal_sessions: {
        vidA: {
          eventId: "vidA:morning",
          videoId: "vidA",
          url: "https://www.youtube.com/watch?v=vidA",
          title: "Video A",
          channel: "Channel A",
          startedAt: oldStart,
          watchedSec: 300,
          savedAt: t0 - 2 * 3600 * 1000, // 2h ago -> stale (> 5 min)
        },
      },
    });
    const h = createTrackerHarness({ playing: true, storage, startEpochMs: t0 });
    await flushMicrotasks();
    eq(h.sentMessages.length, 1, "stale recovery: flushes old uncommitted session immediately");
    eq(h.sentMessages[0].startedAt, oldStart, "stale recovery: keeps original morning timestamp");
    eq(h.sentMessages[0].durationSec, 300, "stale recovery: keeps original 300s duration");

    h.advance(200000);
    h.pause();
    h.advance(305000);
    eq(h.sentMessages.length, 2, "stale recovery: new watch creates separate afternoon entry");
    ok(
      Math.abs(Date.parse(h.sentMessages[1].startedAt) - t0) < 2000,
      "stale recovery: new entry has real current startedAt"
    );
  }

  // 9. Multi-tab isolation: short skip on Tab B must not wipe Tab A's persisted session
  {
    const storage = createStorage();
    const tabA = createTrackerHarness({ url: "https://www.youtube.com/watch?v=vidA", storage });
    const tabB = createTrackerHarness({ url: "https://www.youtube.com/watch?v=vidB", title: "Video B", storage });
    await flushMicrotasks();

    tabA.play();
    tabA.advance(20000); // persists vidA
    tabA.pause();
    await flushMicrotasks();
    ok(Boolean(storage.store.ytcal_sessions && storage.store.ytcal_sessions.vidA), "multi-tab: vidA persisted");

    tabB.play();
    tabB.advance(10000); // < 180s
    tabB.state.url = "https://www.youtube.com/";
    tabB.emitWin("yt:navigate"); // commits (<180s skip) and clears ONLY vidB
    await flushMicrotasks();
    ok(Boolean(storage.store.ytcal_sessions && storage.store.ytcal_sessions.vidA), "multi-tab: vidA preserved after tabB skip");
  }

  // 10. URL query change (&t=...) on same video does not split session; SPA switch commits A & starts B
  {
    const h = createTrackerHarness({ url: "https://www.youtube.com/watch?v=vidA", title: "Video A", channel: "Chan A" });
    await flushMicrotasks();
    h.play();
    h.advance(120000);
    h.state.url = "https://www.youtube.com/watch?v=vidA&t=120s";
    h.emitWin("yt:navigate");
    eq(h.sentMessages.length, 0, "same videoId URL param change: does not split session");

    h.advance(80000); // total 200s on vidA
    h.emitWin("yt:navigate-start");
    h.state.url = "https://www.youtube.com/watch?v=vidB";
    h.state.title = "Video B";
    h.state.channel = "Chan B";
    h.video.currentTime = 0;
    h.emitWin("yt:navigate");
    eq(h.sentMessages.length, 1, "SPA video switch: commits vidA");
    eq(h.sentMessages[0].title, "Video A", "SPA video switch: vidA keeps Video A title");
    eq(h.sentMessages[0].channel, "Chan A", "SPA video switch: vidA keeps Chan A");
    eq(h.sentMessages[0].url, "https://www.youtube.com/watch?v=vidA", "canonical URL without &t=");
  }

  // 11. Miniplayer continuity: navigating to / while miniplayer is active keeps session alive
  {
    const h = createTrackerHarness({ url: "https://www.youtube.com/watch?v=vidA" });
    await flushMicrotasks();
    h.play();
    h.advance(120000);
    h.state.miniplayer = true;
    h.state.url = "https://www.youtube.com/";
    h.emitWin("yt:navigate");
    eq(h.sentMessages.length, 0, "miniplayer: navigating to / does not kill active session");
    h.advance(90000); // total 210s
    h.ended();
    h.advance(16000); // ended commits after 15s (not 5 min!)
    eq(h.sentMessages.length, 1, "ended: commits promptly after 15s (including miniplayer time)");
    ok(h.sentMessages[0].durationSec >= 208, `miniplayer + ended duration ~210s (got ${h.sentMessages[0].durationSec}s)`);
  }

  // 12. background.js: Promise return, dedup, minute rounding, offline queue retry, 401 token refresh
  {
    const { privateKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const storage = createStorage({
      ytcal_google_config: {
        client_email: "test@example.iam.gserviceaccount.com",
        private_key: privateKey,
        calendar_id: "cal123",
      },
    });

    let msgListener = null;
    let onlineListener = null;
    let tokenCalls = 0;
    let calCalls = 0;
    let calBodies = [];
    let mode = "offline"; // offline -> 401-once -> ok

    const bgCtx = vm.createContext({
      Date,
      TextEncoder,
      Uint8Array,
      btoa: (s) => Buffer.from(s, "binary").toString("base64"),
      atob: (s) => Buffer.from(s, "base64").toString("binary"),
      crypto: crypto.webcrypto,
      addEventListener(ev, fn) { if (ev === "online") onlineListener = fn; },
      console: { log() {}, warn() {}, error() {} },
      browser: {
        runtime: { onMessage: { addListener(fn) { msgListener = fn; } } },
        storage: { local: storage.api, onChanged: storage.onChanged },
      },
      async fetch(url, opts) {
        if (url.includes("oauth2.googleapis.com")) {
          tokenCalls++;
          return { ok: true, status: 200, async json() { return { access_token: `tok_${tokenCalls}`, expires_in: 3600 }; } };
        }
        calCalls++;
        if (mode === "offline") throw new Error("Network down");
        if (mode === "401-once") {
          mode = "ok";
          return { ok: false, status: 401, async text() { return "Unauthorized"; } };
        }
        calBodies.push(JSON.parse(opts.body));
        return { ok: true, status: 200, async json() { return { htmlLink: "https://cal/1" }; } };
      },
    });
    vm.runInContext(BG_SRC, bgCtx);
    await flushMicrotasks();

    // Send event while offline: onMessage must return a Promise and keep event queued
    const msg = {
      action: "LOG_YOUTUBE_EVENT",
      eventId: "evt_1",
      title: "Deep Dive",
      url: "https://www.youtube.com/watch?v=vid1",
      channel: "Tech",
      startedAt: "2026-11-20T08:00:40.000Z",
      durationSec: 215, // 3m35s -> should round to 4 min (not truncate to 3 min!)
    };
    const p1 = msgListener(msg);
    ok(p1 && typeof p1.then === "function", "background: onMessage returns a Promise");
    await p1;
    eq(storage.store.ytcal_pending_events.length, 1, "background: offline event retained in pending queue");
    eq(calBodies.length, 0, "background: not created yet while offline");

    // Back online with expired token (401 once) -> refreshes token, retries, succeeds!
    mode = "401-once";
    onlineListener();
    await new Promise((r) => setTimeout(r, 30));
    eq(calBodies.length, 1, "background: queued event delivered on online + 401 retry");
    eq(tokenCalls, 2, "background: refreshed OAuth token after 401");
    eq(storage.store.ytcal_pending_events.length, 0, "background: pending queue drained after delivery");

    // Verify minute rounding (215s -> 4 min: 08:00 -> 08:04)
    eq(calBodies[0].start.dateTime, "2026-11-20T08:00:00.000Z", "background: start floored to minute");
    eq(calBodies[0].end.dateTime, "2026-11-20T08:04:00.000Z", "background: 215s rounded to 4 min (not truncated to 3)");
    ok(calBodies[0].description.includes("Watched: 4 min"), "background: description includes watched minutes");

    // Duplicate eventId is ignored
    const dupRes = await msgListener(msg);
    eq(dupRes.deduped, true, "background: duplicate eventId deduplicated");
    eq(calBodies.length, 1, "background: duplicate did not create second calendar event");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

runTests();
