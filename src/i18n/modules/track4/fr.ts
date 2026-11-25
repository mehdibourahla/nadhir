import type { Track4Translation } from "./en";

export const track4Fr: Track4Translation = {
  officialSource: {
    disclaimerWithSource:
      "Relayé depuis le canal public officiel de {{source}}. Information uniquement, pas une consigne officielle.",
  },
  quakeOfficial: {
    eyebrow: "Bulletin sismique officiel",
    attributionLabel: "Bulletin CRAAG",
    magnitudeLabel: "Magnitude CRAAG",
    placeLabel: "Localisation CRAAG",
    viewBulletin: "Voir le bulletin CRAAG",
    standaloneNote:
      "Mesure sismique officielle publiée par le CRAAG. Information uniquement, pas une évaluation des dégâts ni une consigne.",
  },
  rainfallObserved: {
    title: "Pluie satellitaire observée sur 30 min",
    satelliteBadge: "Observé par satellite",
    rateUnit: "{{rate}} mm/h",
    accum30mUnit: "{{mm}} mm / 30 min",
    distinctFromModel:
      "Estimation satellitaire des précipitations sur 30 minutes, distincte des prévisions numériques.",
  },
  privacyCompliance: {
    badge: "Loi algérienne n° 18-07 et loi n° 25-11 (ANPDP)",
    policyVersionLabel: "Version de la politique : {{version}}",
    manageInSettings: "Gérer mes consentements et télécharger mes données",
    sections: {
      legalFrameworkTitle: "Cadre juridique, responsable et autorité ANPDP",
      legalFrameworkBody:
        "Nadhir traite les données personnelles conformément à la loi algérienne n° 18-07 du 10 juin 2018 relative à la protection des personnes physiques dans le traitement des données à caractère personnel, modifiée et complétée par la loi n° 25-11 du 24 juillet 2025, sous le contrôle de l'Autorité Nationale de Protection des Données à Caractère Personnel (ANPDP). Nadhir est un projet personnel indépendant d'intérêt général : les traitements liés au compte optionnel reposent sur votre consentement explicite et révocable ainsi que sur l'alerte publique aux risques.",
      minimizationTitle: "Minimisation des données et confidentialité locale",
      minimizationBody:
        "La carte des risques, les prévisions, le mode Survie et les alertes push par commune fonctionnent sans compte. La détection de la commune courante s'exécute uniquement sur votre appareil à partir des limites administratives intégrées : le suivi n'envoie jamais votre position exacte ni le code de votre commune aux serveurs de Nadhir. Les photos de signalement passent par notre serveur pour supprimer les coordonnées GPS, l'identifiant d'appareil et les métadonnées EXIF avant stockage. Nadhir n'intègre aucun SDK publicitaire, analytique ou de suivi de plantage.",
      crossBorderTitle: "Infrastructure et sous-traitants transfrontaliers",
      crossBorderBody:
        "La diffusion web publique, les API, les cartes de partage et la protection anti-abus Turnstile fonctionnent sur Cloudflare Workers et R2. Les comptes, la base Postgres et le stockage privé des photos sont hébergés sur Supabase (région UE), avec un worker d'ingestion situé dans l'UE. Les notifications push utilisent Firebase Cloud Messaging (Google) et Apple Push Notification Service avec des empreintes SHA-256 uniquement. Les résumés e-mail optionnels passent par Resend sans conserver d'adresse e-mail brute dans les journaux d'envoi. La classification des signalements citoyens utilise une passerelle LLM UE/cloud qui reçoit uniquement le texte et la commune, jamais votre e-mail ni vos coordonnées exactes. Les fonds de carte (CARTO) et la météo (Open-Meteo) reçoivent des requêtes web standard sans identité de compte.",
      retentionTitle: "Durées de conservation et archivage à froid",
      retentionBody:
        "Les signalements citoyens expirent de la carte publique après 6 heures (ou jusqu'à 24 heures s'ils sont confirmés par des témoins connectés à proximité). Les tables opérationnelles météo, risques, diffusions et exécutions de sources sont archivées en Parquet vérifiés puis purgées de Postgres après 90 jours (92 jours pour source_jobs). La suppression du compte dans les Paramètres efface toutes vos photos de signalement et supprime immédiatement votre profil, vos zones, vos alertes, vos consentements, vos webhooks et vos signalements.",
      anpdpRightsTitle: "Vos droits au titre des lois 18-07 et 25-11",
      anpdpRightsBody:
        "Vous disposez des droits d'information, d'accès à vos données personnelles, de portabilité via export JSON structuré, de rectification dans les Paramètres, d'opposition et de retrait du consentement à tout moment sans affecter les traitements antérieurs licites, ainsi que d'effacement complet par suppression du compte. Si vous estimez que vos droits ne sont pas respectés, vous pouvez contacter Nadhir ou saisir l'ANPDP.",
    },
    settings: {
      title: "Confidentialité, consentements et export (Lois 18-07 / 25-11)",
      subtitle:
        "Consultez ou retirez vos consentements optionnels et téléchargez une copie JSON de vos données personnelles.",
      readFullPolicy: "Lire la politique de confidentialité complète",
      loading: "Chargement de vos préférences de confidentialité...",
      loadError: "Impossible de charger vos consentements pour le moment.",
      retry: "Réessayer",
      consentsTitle: "Consentements de traitement",
      consentsHint:
        "Chaque choix enregistre la version active de la politique et son horodatage. Vous pouvez accorder ou retirer un consentement optionnel à tout moment.",
      granted: "Accordé",
      withdrawn: "Retiré",
      notRecorded: "Non enregistré",
      grantAction: "Accorder le consentement",
      withdrawAction: "Retirer le consentement",
      updatedAt: "Mis à jour : {{date}}",
      saveSuccess: "Préférence de confidentialité enregistrée.",
      saveError:
        "Impossible d'enregistrer votre préférence de confidentialité. Réessayez.",
      purposes: {
        privacy_policy: {
          label: "Prise de connaissance de la politique de confidentialité",
          description:
            "Confirme votre lecture de la notice conforme aux lois 18-07 et 25-11.",
        },
        citizen_reports: {
          label: "Signalements citoyens de risques",
          description:
            "Traitement des signalements et des photos purgées d'EXIF que vous choisissez d'envoyer.",
        },
        zone_alerts: {
          label: "Zones de veille enregistrées",
          description:
            "Conservation de vos zones nommées pour déclencher les alertes correspondantes.",
        },
        email_digest: {
          label: "Résumés e-mail par zone",
          description:
            "Envoi d'e-mails de synthèse optionnels pour vos zones via Resend.",
        },
        push_alerts: {
          label: "Notifications push liées au compte",
          description:
            "Envoi des alertes du compte connecté via une référence d'appareil hachée uniquement.",
        },
        on_device_commune: {
          label: "Préférence commune courante sur l'appareil",
          description:
            "Enregistre votre confirmation que le suivi n'envoie jamais votre position exacte aux serveurs de Nadhir.",
        },
      },
      exportTitle: "Télécharger mes données personnelles (JSON)",
      exportDescription:
        "Exporte votre compte, profil, consentements, zones de veille, signalements, historique d'alertes et métadonnées masquées d'appareils et webhooks. Les secrets et champs internes de modération sont exclus.",
      exportButton: "Télécharger l'export JSON",
      exporting: "Préparation de l'export...",
      exportSuccess: "Export des données personnelles téléchargé.",
      exportError:
        "Impossible de générer votre export de données pour le moment. Réessayez.",
    },
  },
  photoUpload: {
    exifNotice:
      "Les coordonnées GPS, le modèle d'appareil photo et les métadonnées EXIF sont supprimés automatiquement sur notre serveur avant le stockage.",
    uploading: "Nettoyage et envoi de la photo...",
    invalidFormat: "Seules les photos JPEG, PNG ou WebP sont acceptées.",
    tooLarge: "La photo dépasse la limite de {{maxMb}} Mo.",
    uploadFailed: "Échec de l'envoi de la photo. Réessayez.",
    authRequired: "Connectez-vous pour envoyer une photo de signalement.",
  },
  turnstile: {
    label: "Vérification anti-abus",
    verifying: "Chargement de la vérification anti-abus...",
    required: "Veuillez compléter la vérification avant d'envoyer.",
    expired: "La vérification a expiré. Veuillez recommencer.",
    failed: "La vérification n'a pas pu aboutir. Veuillez réessayer.",
    retry: "Relancer la vérification",
    notice: "Protégé par Cloudflare Turnstile contre les envois automatisés.",
  },
};
