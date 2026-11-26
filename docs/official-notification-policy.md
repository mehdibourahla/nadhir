# Official multi-hazard notification policy

## Purpose

Relay actionable official warnings and corroborated multi-hazard alerts to affected subscribers
without turning every collected report into a notification. Collection and recovery are automatic;
source authority, meaning, validity and channel eligibility remain separate decisions.

Nadhir informs; only official authorities direct. Nadhir never originates evacuation, shelter, or
routing instructions, never infers safety or an all-clear from silence or expiry, and preserves
ONM attribution verbatim without alteration.

## Source and channel rules

| Source                                                                   | Information surface                              | Automatic push (FCM topics)                                   | Public Telegram          | WhatsApp Channel                                                      | Resend zone email digest                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Registered DGPC fire incidents (`dgpc_telegram`)                         | Map and source-linked detail                     | Fresh (24h), located official-fire commune topics             | Existing DGPC-only relay | Severe/Extreme verified DGPC relay                                    | Opt-in watch-zone digest (urgent bypasses quiet hours)                                               |
| DGPC non-fire incidents (`dgpc_telegram`: flood, storm, road, structure) | Map, official detail, CAP 1.2 feed               | Severe/Extreme meeting the 6 DGPC policy gates below          | Existing DGPC-only relay | Severe/Extreme meeting the 6 DGPC policy gates below                  | Opt-in watch-zone digest (urgent bypasses quiet hours)                                               |
| ONM structured warnings (`onm`)                                          | Official warning and weather detail              | Severe/Extreme, resolved wilaya, non-cancelled valid warning  | No                       | Severe/Extreme, non-cancelled valid warning, verbatim ONM attribution | Opt-in watch-zone digest (Extreme bypasses quiet hours)                                              |
| EMSC / CRAAG earthquakes (`emsc`)                                        | Map and earthquake detail                        | M4.0+ within 100 km (`haversineKm`), push once per event      | No                       | M4.0+ Severe/Extreme relay                                            | Opt-in watch-zone digest (M5.0+ bypasses quiet hours)                                                |
| Corroborated satellite fire clusters (Probable / Confirmed Fire)         | Map and fire detail                              | Existing corroborated fire publication policy                 | No                       | Probable/Confirmed Severe/Extreme only                                | Opt-in watch-zone digest (downwind urgent bypasses quiet hours)                                      |
| Raw satellite thermal anomalies (Heat Signals)                           | Map evidence only (non-directive)                | No                                                            | No                       | No                                                                    | No (never broadcast alone)                                                                           |
| Operator-entered authority warnings                                      | Existing reviewed authority notice               | Restricted operator workflow; not an automatic source adapter | No                       | No                                                                    | Opt-in watch-zone digest when matched to a zone                                                      |
| Reviewed ITA publications (`ita_*`, media tier)                          | Map/API, explicitly attributed media information | No                                                            | No                       | No                                                                    | No automatic public broadcast (zone road notices only when user-enabled, never bypasses quiet hours) |
| Open-Meteo forecasts (model-only weather)                                | Forecast evidence alongside official warnings    | No model-derived emergency trigger                            | No                       | No                                                                    | No model-derived emergency trigger                                                                   |

An ITA post quoting an authority remains ITA evidence. A display label, CAP document or
operator publication does not itself establish an official source. Unknown source/hazard
combinations require review and an explicitly onboarded adapter before automatic delivery.
Private operational watchdog messages are outside citizen alerting.

## Contract for new official hazards

- Preserve the registered origin, source URL/identifier, source text and issue time. Extract
  meaning with the LLM where needed; reject unsupported evidence rather than inventing facts.
- Represent hazard, authority-declared severity/urgency/certainty, affected area, onset and
  expiry. A retrospective casualty report is not proof of a continuing threat. Missing or
  ambiguous authority, geography, severity or lifecycle goes to review.
- Preserve the authority's instructions and attribution verbatim. Nadhir must not generate
  evacuation, shelter or routing instructions, or infer an all-clear from expiry or silence.
- Match only the stated area. ONM targeting is wilaya-wide; a forecast grid point does not
  narrow or contradict that official footprint.
- Automatically deliver structured Severe/Extreme warnings only through approved channels.
  Ambiguous social posts require review. Moderate/Minor information belongs on the map unless
  a later, explicit hazard-specific policy authorizes delivery.
- Use a stable source identity and revision chain. Identical reissues are silent; escalation,
  changed affected areas and material authority instructions can justify updates. Corrections
  and cancellations reference the earlier warning and invalidate its pending deliveries.
- Recheck validity and channel eligibility at publication and delivery. Preserve independent
  queues, destination receipts, retry budgets, pauses and the global kill switch.

Rain and thunderstorms retain ONM authority plus independently collected Open-Meteo context.
Forecast disagreement or unavailable model data does not cancel an official warning. Weather
codes and CAPE are supporting evidence, not observations of lightning or new trigger thresholds.

## Multi-hazard CAP chains, channels, provenance and self-test (Track 2)

### ONM CAP Update and Cancel escalation chains (F7)

- The ONM adapter parses and persists CAP 1.2 `msgType` (`Alert`, `Update`, `Cancel`) and
  `references` chains across `onm_vigilance`.
- Identical reissues remain silent. Material escalation (e.g. Severe to Extreme), affected area
  expansion, or material authority instruction changes emit an attributed update.
- Explicit CAP `Cancel` messages invalidate pending and in-flight leased deliveries across both
  `broadcast_delivery_queue` and `whatsapp_channel_deliveries` (recording `cap_cancelled`), while
  never treating silence or absence from a feed poll as an authority cancellation.
- ONM publication rejects expired, invalid and future-issued warnings. Advance warnings whose
  onset is later remain eligible. When ONM omits expiry, the bounded internal delivery deadline
  remains 24 hours after onset (or issue time when onset is absent). This is an internal delivery
  deadline, never an authority-declared expiry or all-clear.

### DGPC non-fire broadcast adapter (F8)

Verified DGPC official incidents (`source_key = 'dgpc_telegram'`) covering `flood`, `storm`,
`road`, and `structure` hazards are eligible for multi-hazard CAP 1.2 broadcasts only when all
six policy gates pass:

1. Verbatim official source evidence is preserved and non-empty.
2. Affected commune is resolved to a canonical Algeria administrative unit.
3. Incident state is `ongoing` for initial publication (retrospective/summary reports rejected).
4. Freshness window is within 12 hours (`OFFICIAL_NON_FIRE_FRESH_HOURS = 12`).
5. Source is strictly `dgpc_telegram` with non-media authority tier (ITA and media posts are
   hard-excluded).
6. Transition to `cleared`, `extinguished`, or `unlisted` invalidates pending/leased initial
   deliveries (`official_cleared`) and emits an explicit observation-ended notice without claiming
   an all-clear.

### Accountless multi-hazard commune push topics (F9)

- Accountless subscribers receive multi-hazard FCM broadcasts on canonical CAP 1.2 topics
  `v1.commune.<code>.<lang>` across `ar`, `fr`, `en`, and `kab` with zero per-subscriber PII
  stored on Nadhir servers (per ADR-0006).
- Topics cover Probable/Confirmed fires, ONM Severe/Extreme wilaya warnings, DGPC fire and
  non-fire (`flood`, `storm`, `road`, `structure`) incidents, and M4.0+ earthquakes within
  100 km (computed via ADR-0001 plain lat/lon `haversineKm`).
- Earthquakes push once per event (`idx_broadcasts_earthquake_once`): an upward magnitude revision
  crossing M4.0 triggers delivery once, and downward revisions never issue retraction pushes.
- Daily per-topic caps and global/channel kill switches remain enforced at delivery time.

### Trigger provenance, Android notification channels and user self-test (F10, F11, F12)

- **Trigger provenance footer (F10)**: Every alert view (`/alerts`, broadcast banners, civil
  situation cards), FCM push payload (`provenance_*` keys), WhatsApp Channel broadcast, and
  Resend zone email digest includes a localized "Why am I seeing this?" provenance footer stating
  trigger kind, matched area (or explicit localized "Not recorded"), triggering rule, verbatim
  source attribution, and absolute `Africa/Algiers` timestamp.
- **Distinct Android notification channels (F11)**: Six canonical channel IDs are registered at
  native Android startup and mirrored in `src/lib/notification-channels.ts` and FCM payloads:
  - `alerts_urgent`: Extreme ONM warnings, active official incidents, M5.0+ earthquakes, urgent fires.
  - `alerts_official`: Severe ONM warnings and official DGPC flood, storm, or road updates.
  - `alerts_earthquakes`: M4.0 to M4.9 earthquakes near followed communes.
  - `alerts_civil`: General civil updates and digests.
  - `alerts_test`: User-initiated notification self-tests.
  - `alerts`: Legacy fallback channel retained for older app builds.
  - All local notification re-posts strictly pass `isExactNotification: false`.
- **User self-test and OEM battery guide (F12)**: Rate-limited self-test endpoints
  (`/api/private/push-test` and `/api/public/v1/push-test`) deliver a non-hazard test push on
  `alerts_test` scoped strictly to the caller's own registered device token, paired with a
  4-locale (`ar`, `fr`, `en`, `kab`) Android OEM battery optimization guide covering Xiaomi,
  Samsung, Huawei, Oppo/Realme, and Tecno/Infinix.

## WhatsApp Channel and Resend zone email digest policy (F13)

### Automated WhatsApp Channel pipeline

- Runs on an independent queue (`whatsapp_channel_deliveries`) and independent pipeline toggle
  (`delivery_pipeline_settings` `'whatsapp_channel'`), preserving the existing 2-channel
  `broadcast_delivery_queue` (`fcm`, `telegram`) invariant.
- Enforces dual fail-closed kill switches: global `broadcast_settings.enabled = true`, pipeline
  `delivery_pipeline_settings` (`enabled = true` and `paused = false`), plus environment toggle
  `WHATSAPP_CHANNEL_ENABLED`.
- Eligibility is strictly limited to `Severe`/`Extreme` ONM (non-cancelled, non-superseded,
  valid window), `dgpc_telegram` official fire and non-fire (`flood`, `storm`, `road`,
  `structure`), `>= M4.0` earthquakes, and corroborated Probable/Confirmed fires.
- Hard exclusions: ITA / media sources, Open-Meteo / model-only outputs, raw satellite Heat
  Signals, `Minor`/`Moderate` warnings, and cancelled/cleared initial alerts.
- Message formatting is strictly attribution-first (ONM attribution verbatim unaltered), carries
  an absolute `Africa/Algiers` timestamp, canonical `https://nadhir.app/...` deep link, localized
  "Why am I seeing this?" provenance footer, zero Nadhir-authored instructions, zero em dashes,
  and zero banned safety/all-clear status labels.
- Uses idempotent deduplication keys, lease-fenced workers, bounded exponential backoff on
  transient 429 (`Retry-After` honored up to 900s) and 5xx/network failures, immediate permanent
  failure on non-429 4xx responses, and automatic cancellation triggers on ONM CAP `Cancel` or
  official incident `cleared`/`unlisted`.

### Automated Resend zone email digest pipeline

- Strict Law 18-07 explicit opt-in: accounts receive zone email digests only when
  `auth.users.email_confirmed_at IS NOT NULL`, `profiles.alert_email = true`, AND
  `profiles.email_digest_frequency IN ('immediate', 'hourly', 'daily')` (column defaults to
  `'off'` so existing accounts are never emailed without explicit consent).
- Data minimization: raw recipient email addresses are never duplicated into
  `email_digest_deliveries` or `email_digest_suppressions`, and all user-scoped rows cascade on
  `auth.users` deletion.
- Quiet hours are evaluated in `Africa/Algiers` (`UTC+1`, no DST, `hourCycle: "h23"`):
  - Non-urgent watch-zone alerts are deferred cleanly during quiet hours without marking
    `alerts.delivered_email = true`, so they deliver once quiet hours end.
  - Urgent alerts bypass quiet hours (and daily/hourly schedule windows) immediately: urgent
    downwind fires (`severity >= 5` / `phase = 'urgent'`), ONM `Extreme` warnings, active urgent
    official incidents (`severity >= 4`), and `M5.0+` earthquakes.
- Emails render strictly HTML-escaped HTML (`dir="rtl" lang="ar"` for Arabic, `dir="ltr"` for
  French/English/Kabyle) plus a plain-text fallback, validated `https://nadhir.app/...` deep
  links, attribution-first items (ONM verbatim), absolute Algiers timestamps, localized
  "Why am I seeing this?" provenance footers, zero Nadhir-authored instructions, and a direct
  preferences/opt-out link (`https://nadhir.app/settings`) plus `List-Unsubscribe` header.
- Delivery is deduplicated per `(user_id, digest_kind, window_key)` with Resend
  `Idempotency-Key`, marks `alerts.delivered_email = true` atomically only on confirmed delivery,
  retries transient 429/5xx with bounded exponential backoff, marks permanent 4xx as failed
  without retry, records hard bounces in `email_digest_suppressions` to stop future sends, and
  respects both `delivery_pipeline_settings` (`'email_digest'`) and `EMAIL_DIGEST_ENABLED`.

## Explicit remaining onboarding work

Completed in Track 2: ONM CAP `Alert`/`Update`/`Cancel` chains, DGPC non-fire
(`flood`/`storm`/`road`/`structure`) broadcast adaptation, accountless multi-hazard commune
push topics (including M4+ earthquakes), trigger provenance footers, distinct Android
notification channels, user self-test push with OEM battery guide, and automated WhatsApp
Channel + Resend zone email digest pipelines.

Remaining onboarding work for Track 4 (under the M6 New-Source Gate and `national-sources-only`
policy):

- **CRAAG official earthquake attribution matcher**: enrich EMSC M2+ instrumental earthquakes
  with official CRAAG attribution and parameters without degrading EMSC on CRAAG outages.
- **Gendarmerie Nationale (`Tariki`) road-danger adapter**: national road-danger ingestion with
  verbatim quote guard and dangers-only filtering (never confirms fires).
- **Observed 30-minute satellite rainfall (NASA IMERG Early / H-SAF)** and post-worker
  scientific feeds (MTG FCI push, MTG Lightning L2, GWIS, CLMS NDVI-SWI, GHSL), kept strictly
  distinct from Open-Meteo model forecasts.
- **Operator-entry authority warning schema**: extend manual operator-entered notices with
  explicit source issue time, expiry, hazard taxonomy, and revision identity.

Acceptance for each new adapter includes source provenance, ambiguous/expired input,
duplicate reissues, escalation, area changes, cancellation before and during retry,
missing model evidence, unauthorized publication and zero ITA/model-weather public sends.
