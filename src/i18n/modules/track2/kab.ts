import type { Track2Translation } from "./en";

export const track2Kab: Track2Translation = {
  notificationChannels: {
    urgent: {
      name: "Ilɣa uɛjilen",
      description:
        "Vigilances ONM extrêmes, incidents actifs de la Protection Civile, séismes M5+ et incendies probables.",
    },
    official: {
      name: "Tiɣriyin tunṣibin",
      description:
        "Vigilances météo ONM sévères et mises à jour officielles sur les inondations, tempêtes et routes.",
    },
    earthquakes: {
      name: "Izilzalen",
      description:
        "Séismes de magnitude 4,0 à 4,9 enregistrés près des communes suivies.",
    },
    civil: {
      name: "Ileqman iɣarimen",
      description:
        "Mises à jour civiles générales, avis routiers et résumés de suivi.",
    },
    test: {
      name: "Isekyaden n yilɣa",
      description:
        "Notifications de test que vous lancez pour vérifier la réception sur cet appareil.",
    },
    legacy: {
      description:
        "Canal de secours conservé pour la compatibilité avec les versions antérieures.",
    },
  },
  provenance: {
    whySeeing: "Ayɣer i ttwaliɣ aya?",
    triggerLabel: "Ssebba",
    areaLabel: "Tamnaḍt",
    ruleLabel: "Alugen",
    sourceLabel: "Aɣbalu",
    observedLabel: "Akud n uḍfar",
    statusLabel: "Aẓar",
    radiusKm: "deg uzegdu n {{km}} km",
    trigger: {
      watch_zone: "Tamnaḍt-ik n uɛassi",
      current_commune: "Taɣiwant-ik tamirant (deg yibenk-ik kan)",
      commune_topic: "Ilɣa n tɣiwant yettwaḍefren",
      wilaya_warning: "Taɣri n twilayt",
      national_feed: "Asuddem aɣelnaw n yimihiten",
      self_test: "Asekyed-ik n yilɣa",
    },
    authority: {
      official: "Adabu unṣib",
      probable: "Yezmer (timatar yemgaraden)",
      observed: "Isefka yettwaḍefren",
      model: "Asikzel n tneɣruft",
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
