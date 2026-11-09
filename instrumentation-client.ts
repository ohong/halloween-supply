import { initBotId } from "botid/client/core";
import posthog from "posthog-js";

// Error tracking only. Session recording, autocapture, pageviews, surveys and flags stay off: the site handles
// camera images, and PostHog is here to show unhandled errors. Memory persistence sets no cookie or storage.
// With the token or host unset, PostHog does not start and the app runs unchanged.
const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

if (token && host) {
  posthog.init(token, {
    api_host: host,
    capture_exceptions: true,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    advanced_disable_flags: true,
    persistence: "memory",
  });
} else if (process.env.NODE_ENV === "development") {
  for (const name of [!token && "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", !host && "NEXT_PUBLIC_POSTHOG_HOST"]) {
    if (name) console.error(`${name} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${name} is configured`);
  }
}

// Paid POST routes, each of which calls rejectBot() from lib/bot-guard.ts first. Keep the two in step.
// Never the Stripe webhook, cron, or GET routes. "*" matches one path segment.
initBotId({
  protect: [
    "/api/try-on",
    "/api/try-on/3d",
    "/api/outfits",
    "/api/custom-looks",
    "/api/screenshot-costume",
    "/api/clip-costume",
    "/api/saved-looks",
    "/api/saved-looks/*/retry",
    "/api/chat",
    "/api/costume-search",
    "/api/live-mirror/voice",
    "/api/live-mirror/video",
    "/api/live-mirror/reference",
    "/api/live-mirror/command",
    "/api/live-mirror/mix",
    "/api/live-mirror/feedback",
    "/api/checkout",
  ].map(path => ({ path, method: "POST" })),
});
