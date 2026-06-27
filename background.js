import { GOOGLE_CONFIG } from './config.js';

browser.runtime.onMessage.addListener((message) => {
  if (message.action === "LOG_YOUTUBE_EVENT") {
    processCalendarEvent(message).catch(console.error);
  }
});

async function processCalendarEvent(data) {
  const now = new Date();

  const endDate = new Date(Math.round(now.getTime() / 60000) * 60000);
  const startDate = new Date(endDate.getTime() - (data.durationSec * 1000));

  const aiSummary = "$Summary";

  const token = await getGoogleAuthToken(GOOGLE_CONFIG.client_email, GOOGLE_CONFIG.private_key);

  if (!token) return;

  const eventBody = {
    summary: `YT: ${data.title}`,
    description: `URL: ${data.url}\n\nSummary:\n${aiSummary}`,
    start: { dateTime: startDate.toISOString() },
    end: { dateTime: endDate.toISOString() }
  };

  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CONFIG.calendar_id)}/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(eventBody)
  });

  if (response.ok) {
    console.log(`Event added: ${data.title}`);
  } else {
    const text = await response.text();
    console.error(`Google Calendar API Error: ${text}`);
  }
}

async function getGoogleAuthToken(email, privateKey) {
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);

  const claim = btoa(JSON.stringify({
    iss: email,
    scope: "https://www.googleapis.com/auth/calendar.events",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }));

  const signatureInput = `${header}.${claim}`;
  const signed = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    await importPrivateKey(privateKey),
    new TextEncoder().encode(signatureInput)
  );

  const jwt = `${signatureInput}.${btoa(String.fromCharCode(...new Uint8Array(signed)))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });

  const tokenData = await res.json();
  return tokenData.access_token;
}

async function importPrivateKey(pem) {
  const pemHeader = "-----BEGIN PRIVATE KEY-----";
  const pemFooter = "-----END PRIVATE KEY-----";
  const pemContents = pem.substring(pemHeader.length, pem.length - pemFooter.length).replace(/\s/g, "");
  const binaryDerString = atob(pemContents);
  const binaryDer = new Uint8Array(binaryDerString.length);
  for (let i = 0; i < binaryDerString.length; i++) {
    binaryDer[i] = binaryDerString.charCodeAt(i);
  }
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}
