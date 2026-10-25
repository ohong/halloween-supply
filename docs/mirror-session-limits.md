# Mirror session limits

Video and voice each allow 30 session-start requests per public IP per hour.
The Vercel firewall enforces this across deployments. The per-process backstop
uses `MIRROR_SESSION_STARTS_PER_HOUR` in `lib/live-mirror/session-limits.ts`.
Keep these values aligned when changing the policy.

The previous firewall limit was three starts. Everyone on one Wi-Fi network
shared that allowance, including failed connections and mode changes. Firewall
traffic confirmed both video and voice rules blocked legitimate sessions.
Raising the existing limit fixes that failure without introducing browser
identity storage. Per-browser quotas would separate shoppers but require a
durable identity and quota store.

Production rules:

| Rule | Path | Method | Limit | Exceeded response |
| --- | --- | --- | --- | --- |
| Mirror video sessions | `/api/live-mirror/video` | POST | 30/hour/IP | 429 |
| Mirror voice sessions | `/api/live-mirror/voice` | POST | 30/hour/IP | 429 |

Each video session still ends after three minutes. Reconnects require an
explicit user action. Photo-generation and text-command quotas are unchanged.
The higher allowance permits more paid sessions; it is a shared-network limit,
not a per-person quota or a total spending cap.

The client preserves specific JSON errors from the app. A non-JSON firewall
429 shows a request-limit message; a 403 shows a blocked-request message.
An origin check or provider rejection must not be relabeled as an hourly cap.

After publishing the firewall change, a production browser test passed phone
pairing, live Lucy video (22 decoded frames), GPT Live speech changing an outfit,
voice styling in photo mode, and complete media cleanup. Both browser contexts
used synthetic media; this does not verify physical iPhone Safari behavior.
