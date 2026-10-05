// feedback.js — sends "Not interested" via a direct POST to /youtubei/v1/feedback.
// The feedback token is read from the renderer data / ytInitialData; if unavailable,
// it falls back to clicking the native menu item.
(function () {
  "use strict";

  const YTCAL = (window.YTCAL = window.YTCAL || {});
  const { log, warn } = YTCAL.core;
  const ORIGIN = "https://www.youtube.com";

  // Matches YouTube's own localized menu label as a fallback when the icon type is absent.
  const NOT_INTERESTED_LABEL = /nie interesuje|not interested/i;

  function getCookie(name) {
    const key = name.replace(/[.$?*|{}()[\]\\/+^]/g, "\\$&");
    const m = document.cookie.match(new RegExp("(?:^|; )" + key + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function sha1Hex(str) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function ytcfgGet(key) {
    try {
      const cfg = window.ytcfg;
      if (!cfg) return null;
      if (typeof cfg.get === "function") {
        const v = cfg.get(key);
        if (v != null) return v;
      }
      if (cfg.data_ && cfg.data_[key] != null) return cfg.data_[key];
    } catch (_) {}
    return null;
  }

  function getContext() {
    const ctx = ytcfgGet("INNERTUBE_CONTEXT");
    if (ctx) return ctx;
    return {
      client: {
        clientName: "WEB",
        clientVersion: ytcfgGet("INNERTUBE_CLIENT_VERSION") || "2.20240101.00.00",
        hl: document.documentElement.lang || "en",
        gl: "US",
      },
    };
  }

  async function buildAuth() {
    const clientVersion = ytcfgGet("INNERTUBE_CLIENT_VERSION") || "2.20240101.00.00";
    const visitorData = ytcfgGet("VISITOR_DATA");
    const sessionIndex = ytcfgGet("SESSION_INDEX");

    const ts = Math.floor(Date.now() / 1000);
    const parts = [];
    const push = async (label, cookie) => {
      if (!cookie) return;
      parts.push(`${label} ${ts}_${await sha1Hex(`${ts} ${cookie} ${ORIGIN}`)}_u`);
    };
    await push("SAPISIDHASH", getCookie("SAPISID"));
    await push("SAPISID1PHASH", getCookie("__Secure-1PAPISID"));
    await push("SAPISID3PHASH", getCookie("__Secure-3PAPISID"));

    return {
      clientVersion,
      visitorData,
      authUser: sessionIndex == null ? 0 : sessionIndex,
      authorization: parts.length ? parts.join(" ") : null,
    };
  }

  // ---- NOT_INTERESTED token extraction ------------------------------------

  function tokenInSubtree(node) {
    const seen = new Set();
    const stack = [node];
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== "object" || seen.has(n)) continue;
      seen.add(n);
      if (n.feedbackEndpoint && typeof n.feedbackEndpoint.feedbackToken === "string") {
        return n.feedbackEndpoint.feedbackToken;
      }
      for (const k in n) stack.push(n[k]);
    }
    return null;
  }

  function itemText(node) {
    if (typeof node.text === "string") return node.text;
    if (node.title) {
      if (typeof node.title.simpleText === "string") return node.title.simpleText;
      if (node.title.runs && node.title.runs[0]) return node.title.runs[0].text || "";
    }
    return "";
  }

  function collectTokens(root, wantedVideoId) {
    const seen = new Set();
    const hits = [];
    (function walk(node, ctx) {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);

      let v = ctx;
      if (typeof node.videoId === "string" && node.videoId.length === 11) v = node.videoId;
      else if (typeof node.contentId === "string" && /^[\w-]{11}$/.test(node.contentId)) v = node.contentId;

      const icon =
        (node.icon && node.icon.iconType) ||
        (node.icon && node.icon.icon && node.icon.icon.iconType);
      if (icon === "NOT_INTERESTED" || NOT_INTERESTED_LABEL.test(itemText(node))) {
        const tok = tokenInSubtree(node);
        if (tok) hits.push({ videoId: v, token: tok });
      }

      for (const k in node) walk(node[k], v);
    })(root, null);

    if (wantedVideoId) {
      const hit = hits.find((h) => h.videoId === wantedVideoId);
      if (hit) return hit.token;
    }
    return hits.length ? hits[0].token : null;
  }

  function findFeedbackToken(el, videoId) {
    const data = YTCAL.core.getRendererData(el);
    if (data) {
      const t = collectTokens(data, videoId);
      if (t) return t;
    }
    if (window.ytInitialData) {
      const t = collectTokens(window.ytInitialData, videoId);
      if (t) return t;
    }
    return null;
  }

  // ---- fallback: click the native menu item -------------------------------

  const NOT_INTERESTED_ICON_PREFIX = "M12 1C5.925 1 1 5.925 1 12";

  function nativeNotInterested(el) {
    const trigger = el.querySelector(
      'button[aria-haspopup="true"], ytd-menu-renderer #button, ytd-menu-renderer button, ' +
        '[aria-label*="działa" i], [aria-label*="actions" i]'
    );
    if (!trigger) return Promise.resolve(false);
    trigger.click();

    return new Promise((resolve) => {
      const done = (ok) => {
        obs.disconnect();
        clearTimeout(timer);
        resolve(ok);
      };
      const obs = new MutationObserver(() => {
        const item = Array.from(
          document.querySelectorAll("yt-list-item-view-model, ytd-menu-service-item-renderer")
        ).find((n) => {
          const path = n.querySelector("svg path");
          const d = path ? path.getAttribute("d") || "" : "";
          return (
            d.startsWith(NOT_INTERESTED_ICON_PREFIX) || NOT_INTERESTED_LABEL.test(n.textContent || "")
          );
        });
        if (item) {
          item.click();
          done(true);
        }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => done(false), 2200);
    });
  }

  // ---- send ---------------------------------------------------------------

  async function sendNotInterested(el, videoId) {
    let token = null;
    try {
      token = findFeedbackToken(el, videoId);
    } catch (e) {
      warn("feedback: token lookup failed", e);
    }

    if (!token) {
      log("feedback: no feedbackToken -> falling back to native menu", videoId);
      return nativeNotInterested(el);
    }

    let auth;
    try {
      auth = await buildAuth();
    } catch (e) {
      warn("feedback: auth failed", e);
      return nativeNotInterested(el);
    }

    const headers = {
      "Content-Type": "application/json",
      "X-Origin": ORIGIN,
      Origin: ORIGIN,
      "X-Youtube-Client-Name": "1",
      "X-Youtube-Client-Version": auth.clientVersion,
      "X-Goog-AuthUser": String(auth.authUser),
    };
    if (auth.visitorData) headers["X-Goog-Visitor-Id"] = auth.visitorData;
    if (auth.authorization) headers.Authorization = auth.authorization;

    const body = {
      context: getContext(),
      feedbackTokens: [token],
      isFeedbackTokenUnencrypted: false,
      shouldMerge: false,
    };

    try {
      const res = await fetch("/youtubei/v1/feedback?prettyPrint=false", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        warn("feedback: POST rejected", res.status, "-> falling back");
        return nativeNotInterested(el);
      }
      log("feedback: 'not interested' sent", videoId, res.status);
      return true;
    } catch (e) {
      warn("feedback: POST failed", e, "-> falling back");
      return nativeNotInterested(el);
    }
  }

  YTCAL.feedback = { sendNotInterested, findFeedbackToken };
})();
