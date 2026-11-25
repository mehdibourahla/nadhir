import type { Track3Translation } from "./en";

export const track3Fr: Track3Translation = {
  track3: {
    ui: {
      alertsLoadError:
        "Impossible de charger vos alertes. Vérifiez votre connexion et réessayez.",
      alertActionError: "Impossible de mettre à jour cette alerte. Réessayez.",
      unreadBadge: "Non lue",
      algiersTimeLabel: "Heure d'Alger",
      severityLabel: "Gravité",
      sourceLabel: "Source",
      placeLabel: "Zone",
      officialBadge: "Officiel",
      mediaBadge: "Presse",
      seismicMagnitude: "M{{magnitude}}",
    },
    sheet: {
      heightGroup: "Hauteur du panneau de carte",
      peek: "Compact",
      half: "Moyen",
      full: "Plein",
      expandToHalf: "Ouvrir le panneau à mi-hauteur",
      expandToFull: "Déplier le panneau en pleine hauteur",
      collapseToPeek: "Réduire le panneau en barre compacte",
      dragHandle: "Ajuster la hauteur du panneau",
    },
    filters: {
      ariaLabel: "Filtrer la carte par aléa",
      all: "Tous",
      fire: "Incendie",
      weather: "Météo",
      flood: "Inondation",
      road: "Route",
      earthquake: "Séisme",
      other: "Autre",
      count: "{{count}}",
    },
    emergency: {
      sheetTitle: "Urgence 14 et pointage",
      openSheet: "Urgence 14, fiche position et pointage",
      headerChip: "14",
      headerChipLabel: "Ouvrir Urgence 14, fiche position et pointage",
      universalSection: "Outils d'urgence pour tous les aléas",
      guidanceSection: "Consignes permanentes par aléa",
      selectHazard: "Choisir la situation",
      noInstructionNotice:
        "Aucune consigne officielle pour votre zone pour l'instant. Consignes permanentes pré-approuvées ci-dessous.",
      notAvailable: "Indisponible",
      notAvailableOffline: "Indisponible hors ligne",
      noPackSaved: "Aucun pack hors ligne enregistré",
      gpsActive: "Position GPS de l'appareil",
      gpsWaiting: "En attente du GPS de l'appareil",
      copyCoords: "Copier les coordonnées",
      coordsCopied: "Coordonnées copiées",
      sosSaveOfflineNote:
        "L'appel n'a pas abouti ? Enregistrer une note locale (non envoyée)",
      dial14Sub: "Protection civile, toutes urgences, gratuit",
      dial1070Sub: "Forêts et DGF",
      dial112Sub: "Urgence générale",
      hazards: {
        general: "Général",
        fire: "Incendie",
        flood: "Inondation",
        earthquake: "Séisme",
        storm: "Tempête",
      },
      guidance: {
        general: {
          title: "Préparation générale",
          step1:
            "Appelez la Protection civile au 14 si quelqu'un est en danger et lisez votre fiche position.",
          step2:
            "Suivez en priorité les consignes de la Protection civile, de la Gendarmerie ou des autorités locales.",
          step3:
            "Gardez votre téléphone chargé et utilisez le pointage pour envoyer votre position par SMS ou WhatsApp.",
        },
        fire: {
          title: "Consignes permanentes incendie",
          step1:
            "Appelez le 14 (Protection civile) ou le 1070 (Forêts) en donnant votre commune et vos coordonnées.",
          step2:
            "Rassemblez pièces d'identité, médicaments, eau et chargeur au cas où les autorités ordonnent l'évacuation.",
          step3:
            "Ne conduisez pas vers la fumée ni sur des routes forestières étroites à faible visibilité.",
          step4:
            "Si vous vous abritez à l'intérieur, fermez fenêtres, volets et aérations, et restez prêt à suivre les autorités.",
        },
        flood: {
          title: "Consignes permanentes inondation et crue éclair",
          step1:
            "Appelez immédiatement le 14 si l'eau monte vite ou si quelqu'un est bloqué.",
          step2:
            "Montez sur un point haut ou à l'étage, loin des oueds, lits de rivières, sous-sols et trémies.",
          step3:
            "Ne marchez et ne conduisez jamais dans une eau en mouvement ni sur une chaussée inondée.",
          step4:
            "Coupez l'électricité et le gaz au disjoncteur principal si l'eau entre et que l'accès reste sec.",
        },
        earthquake: {
          title: "Consignes permanentes séisme",
          step1:
            "Pendant la secousse, baissez-vous, abritez-vous sous un meuble solide loin des vitres et tenez bon jusqu'à l'arrêt.",
          step2:
            "Après la secousse, sortez calmement par les escaliers (jamais l'ascenseur) et éloignez-vous des façades, murs et câbles.",
          step3:
            "Attendez-vous à des répliques. Vérifiez l'absence d'odeur de gaz avant d'actionner interrupteurs ou flammes.",
          step4:
            "Appelez le 14 en cas de blessé ou de personne coincée et gardez les appels brefs pour les secours.",
          coastalTsunami:
            "Séisme en mer M5.0+ enregistré : si vous êtes sur le littoral ou près d'un port, gagnez immédiatement les hauteurs à l'intérieur des terres et attendez l'avis officiel des autorités avant de redescendre.",
        },
        storm: {
          title: "Consignes permanentes tempête et vent violent",
          step1:
            "Appelez le 14 si des chutes d'objets, câbles à terre ou dégâts mettent quelqu'un en danger.",
          step2:
            "Restez à l'intérieur, loin des grandes vitres, verrières et portes extérieures.",
          step3:
            "Éloignez-vous des arbres isolés, échafaudages, poteaux métalliques et câbles tombés au sol.",
          step4:
            "Reportez tout trajet en voiture lors de fortes rafales, tempêtes de sable, grêle ou averses réduisant la visibilité.",
        },
      },
      openAreaCriteria: {
        fireTitle: "Critères d'espace ouvert pour un incendie",
        earthquakeTitle: "Critères d'espace ouvert pour un séisme",
        otherTitle: "Note sur les espaces ouverts",
        earthquake1:
          "Éloigné des immeubles, balcons, murs d'enceinte et façades vitrées.",
        earthquake2:
          "Éloigné des lignes électriques aériennes, transformateurs et hauts lampadaires.",
        earthquake3: "Éloigné des ponts, pentes instables et ruelles étroites.",
        floodNote:
          "Les espaces ouverts cartographiques (places, stades, plages, parkings) sont souvent en point bas ou près d'un oued. Ne vous rassemblez pas en point bas lors d'une inondation : montez en hauteur ou à l'étage.",
        stormNote:
          "Un terrain découvert n'offre aucune protection contre les projectiles, la grêle ou la foudre lors d'une tempête. Préférez un bâtiment clos solide.",
        generalNote:
          "Les espaces ouverts proviennent uniquement d'OpenStreetMap et ne sont pas des refuges vérifiés. Évaluez la situation sur place et suivez les consignes officielles.",
      },
      prompt: {
        floodTitle: "Risque d'inondation près de votre zone",
        floodBody:
          "Alerte ou incident d'inondation actif pour votre zone ({{km}} km). Ouvrez Urgence 14, la fiche position et les consignes inondation.",
        stormTitle: "Vigilance tempête pour votre zone",
        stormBody:
          "Vigilance météo officielle active pour votre zone. Ouvrez Urgence 14, la fiche position et les consignes tempête.",
        quakeTitle: "Séisme M{{magnitude}} enregistré à proximité",
        quakeBody:
          "Un séisme M{{magnitude}} a été enregistré à environ {{km}} km de ce téléphone. Ouvrez Urgence 14, la fiche position et les consignes séisme.",
        offshoreQuakeNote:
          "Événement en mer M5.0+ : la consigne côtière tsunami est affichée à l'intérieur.",
        sourceOfficial: "Incident officiel signalé",
        sourceOnm: "Vigilance météo ONM",
        sourceSeismic: "Observation réseau sismique",
        openEmergencyTools: "Ouvrir Urgence 14 et pointage",
      },
      observations: {
        floodNear:
          "Incident officiel d'inondation enregistré à environ {{km}} km.",
        stormNear: "Vigilance météo officielle active pour {{area}}.",
        quakeNear: "Séisme M{{magnitude}} enregistré à environ {{km}} km.",
        incidentNear: "Incident officiel enregistré à environ {{km}} km.",
      },
      report: {
        flood: "Inondation",
        storm: "Dégâts de tempête",
        earthquake: "Dégâts sismiques",
      },
    },
  },
};
