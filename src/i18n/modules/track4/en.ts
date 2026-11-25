export const track4En = {
  officialSource: {
    disclaimerWithSource:
      "Relayed from {{source}}'s official public channel. Information only, not an official order.",
  },
  quakeOfficial: {
    eyebrow: "Official seismic bulletin",
    attributionLabel: "CRAAG bulletin",
    magnitudeLabel: "CRAAG magnitude",
    placeLabel: "CRAAG location",
    viewBulletin: "View CRAAG bulletin",
    standaloneNote:
      "Official seismic measurement published by CRAAG. Information only, not a damage assessment or directive.",
  },
  rainfallObserved: {
    title: "Observed 30-min satellite rainfall",
    satelliteBadge: "Satellite observed",
    rateUnit: "{{rate}} mm/h",
    accum30mUnit: "{{mm}} mm / 30 min",
    distinctFromModel:
      "Satellite rainfall estimate over 30 minutes, separate from numerical weather forecasts.",
  },
  privacyCompliance: {
    badge: "Algerian Law No. 18-07 and Law No. 25-11 (ANPDP)",
    policyVersionLabel: "Policy version: {{version}}",
    manageInSettings: "Manage consents and download my data",
    sections: {
      legalFrameworkTitle: "Legal framework, controller, and ANPDP authority",
      legalFrameworkBody:
        "Nadhir processes personal data in compliance with Algerian Law No. 18-07 of 10 June 2018 on the protection of natural persons in the processing of personal data, as amended by Law No. 25-11 of 24 July 2025, under the oversight of the National Authority for the Protection of Personal Data (ANPDP). Nadhir is an independent personal public-interest project; optional account processing relies on your explicit, withdrawable consent and public-interest hazard alerting.",
      minimizationTitle: "Data minimization and on-device privacy",
      minimizationBody:
        "Core hazard maps, forecasts, Survival Mode, and commune push topics work without creating an account. Current Commune matching runs strictly on your device against bundled administrative boundaries: following never sends your exact position or commune code to Nadhir servers. Report photos pass through our server to strip GPS, camera, and EXIF metadata before storage. Nadhir bundles zero advertising, analytics, or crash-reporting SDKs.",
      crossBorderTitle: "Infrastructure and cross-border sub-processors",
      crossBorderBody:
        "Public web delivery, APIs, share cards, and Turnstile anti-abuse verification run on Cloudflare Workers and R2. Accounts, Postgres records, and private photo storage are hosted on Supabase (EU region), paired with an EU ingestion worker. Push delivery uses Firebase Cloud Messaging (Google) and Apple Push Notification Service with SHA-256 device hashes only. Optional zone email digests use Resend without storing raw email addresses in delivery logs. Citizen report text classification uses an EU/cloud LLM gateway that receives hazard text and commune context only, never your email or exact coordinates. Map tiles (CARTO) and weather lookups (Open-Meteo) see standard web requests without account identity.",
      retentionTitle: "Retention schedule and cold-archive lifecycle",
      retentionBody:
        "Citizen reports expire from the public map after 6 hours (or up to 24 hours when witnessed by nearby signed-in users). Operational weather, risk, broadcast, and source-run tables are archived to verified Parquet snapshots and pruned from hot Postgres after 90 days (92 days for source_jobs). Deleting your account in Settings removes all report photos from storage and cascades across your profile, zones, alerts, consents, webhooks, and reports immediately.",
      anpdpRightsTitle: "Your rights under Law 18-07 and Law 25-11",
      anpdpRightsBody:
        "You have the right to clear information, access to your personal data, structured JSON data portability export, rectification in Settings, opposition and consent withdrawal at any time without affecting prior lawful processing, and full erasure via account deletion. If you believe your rights are not respected, you may contact Nadhir or lodge a complaint with the ANPDP.",
    },
    settings: {
      title: "Privacy, consents, and data export (Law 18-07 / 25-11)",
      subtitle:
        "Inspect or withdraw your optional processing consents and download a JSON copy of your personal data.",
      readFullPolicy: "Read full privacy notice",
      loading: "Loading your privacy preferences...",
      loadError: "Could not load your privacy consents right now.",
      retry: "Try again",
      consentsTitle: "Processing consents",
      consentsHint:
        "Every consent decision records the active policy version and timestamp. You can grant or withdraw optional consents at any time.",
      granted: "Granted",
      withdrawn: "Withdrawn",
      notRecorded: "Not recorded",
      grantAction: "Grant consent",
      withdrawAction: "Withdraw consent",
      updatedAt: "Updated: {{date}}",
      saveSuccess: "Privacy preference updated.",
      saveError: "Could not save your privacy preference. Try again.",
      purposes: {
        privacy_policy: {
          label: "Privacy notice acknowledgement",
          description:
            "Confirms you have read the Law 18-07 and Law 25-11 privacy notice.",
        },
        citizen_reports: {
          label: "Citizen hazard reports",
          description:
            "Processing of reports and EXIF-stripped photos you choose to submit.",
        },
        zone_alerts: {
          label: "Saved watch zones",
          description:
            "Storing your named watch areas to match nearby hazard alerts.",
        },
        email_digest: {
          label: "Zone email digests",
          description:
            "Sending optional hazard digest emails for your saved zones via Resend.",
        },
        push_alerts: {
          label: "Account push notifications",
          description:
            "Delivering signed-in alert notifications using a hashed device reference.",
        },
        on_device_commune: {
          label: "On-device Current Commune preference",
          description:
            "Records your acknowledgement that following never sends your exact position to Nadhir servers.",
        },
      },
      exportTitle: "Download my personal data (JSON)",
      exportDescription:
        "Exports your account details, profile, consents, watch zones, reports, alert history, and masked device/webhook metadata. Secrets and internal moderation fields are excluded.",
      exportButton: "Download JSON export",
      exporting: "Preparing export...",
      exportSuccess: "Personal data export downloaded.",
      exportError: "Could not generate your data export right now. Try again.",
    },
  },
  photoUpload: {
    exifNotice:
      "GPS coordinates, camera model, and EXIF metadata are stripped automatically on our server before the photo is stored.",
    uploading: "Sanitizing and uploading photo...",
    invalidFormat: "Only JPEG, PNG, or WebP photos are accepted.",
    tooLarge: "Photo exceeds the {{maxMb}} MB limit.",
    uploadFailed: "Photo upload failed. Try again.",
    authRequired: "Sign in to upload a report photo.",
  },
  turnstile: {
    label: "Anti-abuse verification",
    verifying: "Loading anti-abuse check...",
    required: "Complete the verification check before submitting.",
    expired: "Verification expired. Please run the check again.",
    failed: "Verification could not be completed. Please try again.",
    retry: "Retry check",
    notice: "Protected by Cloudflare Turnstile against automated spam.",
  },
};

export type Track4Translation = typeof track4En;
