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
  pushTest: {
    title: "Tester mes notifications",
    subtitle:
      "Envoie une notification de test sur cet appareil via le canal Tests de notification. Ceci n'est pas une alerte de danger.",
    sendButton: "Envoyer une notification de test",
    sending: "Envoi de la notification de test...",
    waiting:
      "En attente de confirmation de réception ({{seconds}} s restantes)...",
    confirmReceived: "Je l'ai reçue",
    notReceivedYet: "Pas encore reçue",
    received: "Notification de test reçue à {{time}}.",
    sendAnother: "Envoyer un autre test",
    timeoutTitle: "Aucune confirmation de réception après {{seconds}} s",
    timeoutBody:
      "Si la notification n'est pas apparue, vérifiez l'optimisation batterie Android, le mode Ne pas déranger et les canaux Nadhir ci-dessous.",
    openGuide: "Ouvrir le guide batterie Android",
    channelNote:
      "Envoyée sur le canal Tests de notification afin de garder les alertes urgentes distinctes.",
    webNote:
      "Dans un navigateur, gardez les notifications autorisées dans le navigateur et le système. Sur téléphone Android, consultez le guide batterie ci-dessous en cas de retard.",
    permissionDenied:
      "Les notifications sont bloquées sur cet appareil. Autorisez-les dans les paramètres système ou navigateur puis réessayez.",
    unsupported:
      "Les notifications push ne sont pas prises en charge sur ce navigateur.",
    unconfigured: "La livraison push est temporairement indisponible.",
    tryAgain: "Réessayer",
    errors: {
      unsupported:
        "Les notifications push ne sont pas prises en charge sur cet appareil.",
      unconfigured: "La livraison push n'est pas configurée actuellement.",
      denied:
        "Autorisation de notification refusée. Activez les notifications dans les paramètres puis réessayez.",
      signIn:
        "Reconnectez-vous pour tester les notifications sur votre compte.",
      deviceNotRegistered:
        "Activez d'abord les notifications sur cet appareil ci-dessus afin que Nadhir vérifie que cet appareil est lié à votre compte.",
      rateLimited:
        "Trop de demandes de test. Veuillez patienter {{seconds}} s avant de réessayer.",
      invalid:
        "Impossible de valider le jeton de cet appareil. Rechargez la page puis réessayez.",
      providerFailed:
        "Le fournisseur de notifications a rejeté ce test. Actualisez les notifications puis réessayez.",
      unavailable:
        "Le test de notification est temporairement indisponible. Réessayez dans un instant.",
    },
  },
  oemBattery: {
    title: "Guide batterie Android (si les alertes arrivent en retard)",
    subtitle:
      "De nombreux téléphones Android mettent les applications en veille pour économiser la batterie. Ajustez ces réglages selon votre marque.",
    toggleShow: "Afficher les étapes",
    toggleHide: "Masquer les étapes",
    intro:
      "Suivez les étapes de votre appareil afin que Nadhir puisse livrer les alertes urgentes même écran verrouillé.",
    channelsHint:
      "Vérifiez aussi Paramètres > Applications > Nadhir > Notifications et laissez activés Alertes urgentes, Bulletins officiels, Séismes et Tests de notification.",
    tabListLabel: "Choisir la marque de votre téléphone Android",
    stepNumber: "Étape {{n}}",
    hmsCaveat:
      "Les téléphones Huawei livrés sans Google Play Services (HMS uniquement) ne peuvent pas recevoir les notifications push Firebase nativement. Utilisez l'application web Nadhir ou les canaux officiels Telegram et WhatsApp.",
    oems: {
      xiaomi: {
        name: "Xiaomi / Redmi / POCO",
        subtitle: "MIUI / HyperOS",
        steps: {
          s1: "Ouvrez Paramètres > Applications > Gérer les applications > Nadhir et activez Démarrage automatique.",
          s2: "Sur la même fiche Nadhir, ouvrez Économiseur de batterie puis sélectionnez Aucune restriction.",
          s3: "Ouvrez Notifications sur la fiche Nadhir et autorisez écran verrouillé, son, vibration et Alertes urgentes.",
          s4: "Si les alertes restent retardées, ouvrez l'application Sécurité > Batterie, vérifiez l'absence de restriction pour Nadhir et verrouillez Nadhir dans les applications récentes.",
        },
      },
      samsung: {
        name: "Samsung Galaxy",
        subtitle: "OneUI",
        steps: {
          s1: "Ouvrez Paramètres > Applications > Nadhir > Batterie et choisissez Non restreinte.",
          s2: "Ouvrez Paramètres > Batterie > Limites d'utilisation en arrière-plan > Applications jamais en veille automatique, appuyez sur + et ajoutez Nadhir.",
          s3: "Dans Limites d'utilisation en arrière-plan, vérifiez Applications en veille et Applications en veille profonde et retirez Nadhir s'il y figure.",
          s4: "Ouvrez Paramètres > Applications > Nadhir > Notifications > Catégories de notification et activez son et fenêtre contextuelle pour Alertes urgentes et Bulletins officiels.",
        },
      },
      huawei: {
        name: "Huawei / Honor",
        subtitle: "EMUI / MagicOS",
        steps: {
          s1: "Ouvrez Paramètres > Batterie > Lancement d'applications, trouvez Nadhir, désactivez Gérer automatiquement et activez Lancement automatique, Lancement secondaire et Exécution en arrière-plan.",
          s2: "Ouvrez Paramètres > Applications > Applications > menu > Accès spécial > Optimisation de la batterie > Toutes les applications > Nadhir et choisissez Ne pas autoriser.",
          s3: "Ouvrez Paramètres > Notifications > Nadhir et autorisez les notifications, bannières et alertes sur écran verrouillé.",
          s4: "Remarque : les modèles Huawei sans Google Play Services (HMS uniquement) ne reçoivent pas les notifications push Firebase nativement ; utilisez l'application web ou les canaux officiels Telegram et WhatsApp.",
        },
      },
      oppo: {
        name: "Oppo / Realme",
        subtitle: "ColorOS / Realme UI",
        steps: {
          s1: "Ouvrez Paramètres > Applications > Gestion des applications > Nadhir > Utilisation de la batterie et activez Activité au premier plan, Activité en arrière-plan et Démarrage automatique.",
          s2: "Ouvrez Paramètres > Batterie > Plus de paramètres > Optimiser l'utilisation de la batterie > Nadhir et sélectionnez Ne pas optimiser.",
          s3: "Dans Paramètres > Batterie > Plus de paramètres, désactivez l'optimisation de veille nocturne afin d'éviter les retards la nuit.",
          s4: "Ouvrez Paramètres > Applications > Gestion des applications > Nadhir > Gérer les notifications et autorisez écran verrouillé, bannières et son.",
        },
      },
      tecno: {
        name: "Tecno / Infinix",
        subtitle: "HiOS / XOS",
        steps: {
          s1: "Ouvrez Phone Master (ou Paramètres > Gestion des applications > Gestion du démarrage automatique) et activez Nadhir.",
          s2: "Ouvrez Paramètres > Battery Lab (ou Batterie) > Paramètres de batterie > Optimisation de la batterie > Toutes les applications > Nadhir et choisissez Ne pas optimiser.",
          s3: "Dans Phone Master > Boîte à outils > App Freeze (ou Battery Lab > Consommation des applications), vérifiez que Nadhir n'est pas gelé et reste autorisé en arrière-plan.",
          s4: "Ouvrez Paramètres > Centre de notifications > Nadhir et autorisez les notifications, l'écran verrouillé et le son.",
        },
      },
    },
  },
  whatsapp: {
    header: "Nadhir",
    algiersTime: "{{time}} (heure d'Alger)",
    sourceLine: "Source : {{source}}",
    areaLine: "Zone : {{area}}",
    detailsLink: "Détails : {{url}}",
    whySeeingPrefix: "Pourquoi je vois ceci : {{line}}",
    infoDisclaimer:
      "Information uniquement. Suivez les consignes de la Protection Civile (14) et des autorités officielles.",
    phaseInitial: "Bulletin actif",
    phaseUpdate: "Mise à jour du bulletin",
    phaseEnd: "Fin d'observation",
    severityExtreme: "Extrême",
    severitySevere: "Sévère",
  },
  emailDigest: {
    subjectSingle: "Nadhir : {{title}}",
    subjectDigest: "Nadhir : {{count}} alertes de zone ({{zone}})",
    subjectUrgentPrefix: "[Urgent] ",
    heading: "Votre résumé d'alertes de zone Nadhir",
    headingUrgent: "Alerte de zone urgente Nadhir",
    intro:
      "Mises à jour de risques observés correspondant à vos zones surveillées.",
    urgentBypassNote:
      "Envoyé pendant vos heures silencieuses car un seuil urgent a été atteint.",
    algiersTime: "{{time}} (heure d'Alger)",
    sourceLabel: "Source : {{source}}",
    areaLabel: "Zone : {{area}}",
    viewDetails: "Ouvrir dans Nadhir",
    whySeeingLabel: "Pourquoi je vois ceci ?",
    infoDisclaimer:
      "Nadhir relaie les observations et les bulletins officiels attribués. Suivez les consignes de la Protection Civile (14) et des autorités officielles.",
    managePreferences:
      "Gérer les préférences de résumé e-mail ou désactiver les e-mails",
    settingsLabel: "Résumé e-mail des zones surveillées",
    settingsHint:
      "Recevez par e-mail les mises à jour de risques de vos zones surveillées. Les risques urgents (vigilance ONM extrême, incidents officiels actifs, séismes M5+, incendies urgents) franchissent les heures silencieuses.",
    frequencyLabel: "Fréquence du résumé e-mail",
    frequency: {
      off: "Désactivé",
      immediate: "Immédiat",
      hourly: "Résumé horaire",
      daily: "Résumé quotidien",
    },
  },
};
