import type { Track2Translation } from "./en";

export const track2Fr: Track2Translation = {
  notificationChannels: {
    urgent: {
      name: "Alertes urgentes",
      description:
        "Vigilances ONM extrêmes, incidents actifs de la Protection Civile, séismes M5+ et incendies probables.",
    },
    official: {
      name: "Bulletins officiels",
      description:
        "Vigilances météo ONM sévères et mises à jour officielles sur les inondations, tempêtes et routes.",
    },
    earthquakes: {
      name: "Séismes",
      description:
        "Séismes de magnitude 4,0 à 4,9 enregistrés près des communes suivies.",
    },
    civil: {
      name: "Mises à jour civiles et résumés",
      description:
        "Mises à jour civiles générales, avis routiers et résumés de suivi.",
    },
    test: {
      name: "Tests de notification",
      description:
        "Notifications de test que vous lancez pour vérifier la réception sur cet appareil.",
    },
    legacy: {
      description:
        "Canal de secours conservé pour la compatibilité avec les versions antérieures.",
    },
  },
  provenance: {
    whySeeing: "Pourquoi je vois ceci ?",
    triggerLabel: "Déclencheur",
    areaLabel: "Zone",
    ruleLabel: "Règle",
    sourceLabel: "Source",
    observedLabel: "Observé le",
    statusLabel: "Nature",
    radiusKm: "dans un rayon de {{km}} km",
    trigger: {
      watch_zone: "Votre zone surveillée",
      current_commune: "Votre commune actuelle (calculée sur l'appareil)",
      commune_topic: "Alertes de commune suivie",
      wilaya_warning: "Bulletin à l'échelle de la wilaya",
      national_feed: "Flux national des risques",
      self_test: "Votre test de notification",
    },
    authority: {
      official: "Autorité officielle",
      probable: "Probable (signaux croisés)",
      observed: "Données observées",
      model: "Estimation de modèle",
    },
    rule: {
      onmExtreme: "Vigilance météo ONM extrême",
      onmSevere: "Vigilance météo ONM sévère",
      onmWarning: "Bulletin météo officiel ONM",
      dgpcFire: "Incident incendie officiel de la Protection Civile",
      dgpcNonFire:
        "Bulletin officiel Protection Civile inondation, tempête ou route",
      probableFire: "Détection thermique satellite avec contexte indépendant",
      m4Quake: "Séisme M4,0+ dans un rayon de 100 km",
      m5Quake: "Séisme M5,0+ seuil urgent",
      watchZone: "Risque détecté dans votre zone surveillée",
      roadDanger: "Danger ou coupure de route signalé",
      civilUpdate: "Mise à jour de risque civil",
      selfTest: "Test de réception lancé manuellement",
      generic: "Règle de risque actif correspondante pour cette zone",
    },
  },
};
