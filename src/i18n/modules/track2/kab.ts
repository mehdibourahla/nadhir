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
  pushTest: {
    title: "Sekyed ilɣa-inu",
    subtitle:
      "Azen yiwen n ulɣu n usekyed ɣer yibenk-a deg ubadu Isekyaden n yilɣa. Mačči d alɣu n umihi.",
    sendButton: "Azen alɣu n usekyed",
    sending: "Tuzna n ulɣu n usekyed...",
    waiting: "Aṛaju n usentem n tuṭṭfa (mazal {{seconds}} s)...",
    confirmReceived: "Ṭṭfeɣ-t",
    notReceivedYet: "Mazal ur d-yewweḍ ara",
    received: "Alɣu n usekyed yewweḍ-d ɣef {{time}}.",
    sendAnother: "Azen asekyed nniḍen",
    timeoutTitle: "Ulac asentem n tuṭṭfa deffir {{seconds}} s",
    timeoutBody:
      "Ma yella ulɣu ur d-iban ara, senqed iɣewwaren n tbatrit n Android, askar Ur ssexlaɛ ara akked yibuda n Nadhir ddaw-a.",
    openGuide: "Ldi amnir n tbatrit n Android",
    channelNote:
      "Yettwaɛeyyen deg ubadu Isekyaden n yilɣa akken ilɣa uɛjilen ad qqimen msebḍan.",
    webNote:
      "Deg yiminig web, eǧǧ ilɣa ttwasirgen deg yiminig akked unagraw. Deg tilifun Android, wali amnir n tbatrit ddaw-a ma ttɛeṭṭilen yilɣa.",
    permissionDenied:
      "Ilɣa weḥlen deg yibenk-a. Sireg ilɣa deg yiɣewwaren n unagraw neɣ n yiminig syin ɛreḍ tikkelt nniḍen.",
    unsupported: "Ilɣa push ur ttwasefraken ara deg yiminig-a.",
    unconfigured: "Tuzna n yilɣa push ur telli ara tura.",
    tryAgain: "Ɛreḍ tikkelt nniḍen",
    errors: {
      unsupported: "Ilɣa push ur ttwasefraken ara deg yibenk-a.",
      unconfigured: "Tuzna n yilɣa push ur tettwahegga ara tura.",
      denied:
        "Tasiregt n yilɣa tettwagi. Rmed ilɣa deg yiɣewwaren syin ɛreḍ tikkelt nniḍen.",
      signIn: "Qqen tikkelt nniḍen akken ad tsekydeḍ ilɣa n umiḍan-ik.",
      deviceNotRegistered:
        "Rmed qbel ilɣa n yibenk-a sufella akken Nadhir ad isenqed ibenk-a yeqqen ɣer umiḍan-ik.",
      rateLimited:
        "Aṭas n yisutren n usekyed. Rǧu {{seconds}} s send ad tɛerḍeḍ tikkelt nniḍen.",
      invalid:
        "Ur izmir ara ad isenqed ajetun n yibenk-a. Smiren asebter syin ɛreḍ tikkelt nniḍen.",
      providerFailed:
        "Amefkay n yilɣa yugi asekyed-a. Smiren ilɣa syin ɛreḍ tikkelt nniḍen.",
      unavailable:
        "Asekyed n yilɣa ur yelli ara tura. Ɛreḍ tikkelt nniḍen deg kra n wakud.",
    },
  },
  oemBattery: {
    title: "Amnir n tbatrit Android (ma ttɛeṭṭilen yilɣa)",
    subtitle:
      "Aṭas n tilifunat Android sseḥbasen isnasen deg ugilal akken ad ḥerzen tabatrit. Sbadu iɣewwaren-a ilmend n tmarka n tilifun-ik.",
    toggleShow: "Sken imecwaṛen",
    toggleHide: "Ffer imecwaṛen",
    intro:
      "Ḍfer imecwaṛen n yibenk-ik akken Nadhir ad yessiweḍ ilɣa uɛjilen ula mi yergel ugdu.",
    channelsHint:
      "Senqed daɣen Iɣewwaren > Isnasen > Nadhir > Ilɣa teǧǧeḍ rmden Ilɣa uɛjilen, Tiɣriyin tunṣibin, Izilzalen akked Isekyaden n yilɣa.",
    tabListLabel: "Fren tamarka n tilifun-ik Android",
    stepNumber: "Amecwaṛ {{n}}",
    hmsCaveat:
      "Tilifunat Huawei war Google Play Services (HMS kan) ur zmiren ara ad ṭṭfen ilɣa push Firebase s wudem aneṣli. Seqdec asnas web Nadhir neɣ ibuda unṣiben n Telegram akked WhatsApp.",
    oems: {
      xiaomi: {
        name: "Xiaomi / Redmi / POCO",
        subtitle: "MIUI / HyperOS",
        steps: {
          s1: "Ldi Iɣewwaren > Isnasen > Sefrek isnasen > Nadhir syin rmed Asenker awurman (Autostart).",
          s2: "Deg usebter-nni n Nadhir, ldi Aseḥrez n tbatrit syin fren Ulac tilisa (No restrictions).",
          s3: "Ldi Ilɣa deg usebter n Nadhir teǧǧeḍ agdu yerglen, imesli, ahuzzu akked Ilɣa uɛjilen.",
          s4: "Ma mazal ttɛeṭṭilen yilɣa, ldi asnas Security > Tabatrit, senqed Nadhir ur yesɛi tilisa syin sekkreḍ Nadhir deg yisnasen ineggura.",
        },
      },
      samsung: {
        name: "Samsung Galaxy",
        subtitle: "OneUI",
        steps: {
          s1: "Ldi Iɣewwaren > Isnasen > Nadhir > Tabatrit syin fren War tilisa (Unrestricted).",
          s2: "Ldi Iɣewwaren > Tabatrit > Tilisa n useqdec deg ugilal > Isnasen ur nettgganen ara, sit ɣef + ternuḍ Nadhir.",
          s3: "Deg Tilisa n useqdec deg ugilal, senqed Isnasen yeṭṭsen akked Isnasen yeṭṭsen s telqayt tekkseḍ Nadhir ma yella din.",
          s4: "Ldi Iɣewwaren > Isnasen > Nadhir > Ilɣa > Taggayin n yilɣa syin rmed imesli d tneflit i Ilɣa uɛjilen d Tiɣriyin tunṣibin.",
        },
      },
      huawei: {
        name: "Huawei / Honor",
        subtitle: "EMUI / MagicOS",
        steps: {
          s1: "Ldi Iɣewwaren > Tabatrit > Asenker n yisnasen, af-d Nadhir, sens Asefrek awurman syin rmed Asenker awurman, Asenker wis sin akked Aselkem deg ugilal.",
          s2: "Ldi Iɣewwaren > Isnasen > Isnasen > umuɣ > Anekcum uzzig > Aselhu n tbatrit > Akk isnasen > Nadhir syin fren Ur sireg ara.",
          s3: "Ldi Iɣewwaren > Ilɣa > Nadhir syin sireg ilɣa, tizrawin akked ugdu yerglen.",
          s4: "Tamawt: tilifunat Huawei war Google Play Services (HMS kan) ur ṭṭafent ara ilɣa push Firebase; seqdec asnas web neɣ ibuda unṣiben Telegram akked WhatsApp.",
        },
      },
      oppo: {
        name: "Oppo / Realme",
        subtitle: "ColorOS / Realme UI",
        steps: {
          s1: "Ldi Iɣewwaren > Isnasen > Asefrek n yisnasen > Nadhir > Aseqdec n tbatrit syin rmed Armud zdat, Armud deg ugilal akked Asenker awurman.",
          s2: "Ldi Iɣewwaren > Tabatrit > Ugar n yiɣewwaren > Selhu aseqdec n tbatrit > Nadhir syin fren Ur tteselhu ara.",
          s3: "Deg Iɣewwaren > Tabatrit > Ugar n yiɣewwaren, sens aselhu n yiḍes akken ilɣa n yiḍ ur ttɛeṭṭilen ara.",
          s4: "Ldi Iɣewwaren > Isnasen > Asefrek n yisnasen > Nadhir > Sefrek ilɣa syin sireg agdu yerglen, tizrawin akked yimesli.",
        },
      },
      tecno: {
        name: "Tecno / Infinix",
        subtitle: "HiOS / XOS",
        steps: {
          s1: "Ldi Phone Master (neɣ Iɣewwaren > Asefrek n yisnasen > Asefrek n usenker awurman) syin rmed Nadhir.",
          s2: "Ldi Iɣewwaren > Battery Lab (neɣ Tabatrit) > Iɣewwaren n tbatrit > Aselhu n tbatrit > Akk isnasen > Nadhir syin fren Ur tteselhu ara.",
          s3: "Deg Phone Master > Toolbox > App Freeze (neɣ Battery Lab), senqed Nadhir ur yejmid ara yerna yettwasireg deg ugilal.",
          s4: "Ldi Iɣewwaren > Ammas n yilɣa > Nadhir syin sireg ilɣa, agdu yerglen akked yimesli.",
        },
      },
    },
  },
  whatsapp: {
    header: "Nadhir",
    algiersTime: "{{time}} (akud n Lezzayer)",
    sourceLine: "Aɣbalu: {{source}}",
    areaLine: "Tamnaḍt: {{area}}",
    detailsLink: "Talqayt: {{url}}",
    whySeeingPrefix: "Ayɣer i ttwaliɣ aya: {{line}}",
    infoDisclaimer:
      "Talɣut kan. Ḍfer iwellihen n Umesten Aɣarim (14) d yiduba unṣiben.",
    phaseInitial: "Taɣri turmidt",
    phaseUpdate: "Aleqqem n teɣri",
    phaseEnd: "Taggara n uḍfar",
    severityExtreme: "Afellay",
    severitySevere: "Iqseḥ",
  },
  emailDigest: {
    subjectSingle: "Nadhir: {{title}}",
    subjectDigest: "Nadhir: {{count}} n yilɣa n temnaḍt ({{zone}})",
    subjectUrgentPrefix: "[Aɛjil] ",
    heading: "Agzul n yilɣa n temnaḍin-ik Nadhir",
    headingUrgent: "Alɣu aɛjil n temnaḍt sɣur Nadhir",
    intro:
      "Ileqman n yimihiten yettwaḍefren i yemṣadan d temnaḍin-ik n uɛassi.",
    urgentBypassNote:
      "Yettwaɛeyyen deg yisragen-ik n tsusmi acku yewweḍ ɣer talast taɛjilt.",
    algiersTime: "{{time}} (akud n Lezzayer)",
    sourceLabel: "Aɣbalu: {{source}}",
    areaLabel: "Tamnaḍt: {{area}}",
    viewDetails: "Ldi deg Nadhir",
    whySeeingLabel: "Ayɣer i ttwaliɣ aya?",
    infoDisclaimer:
      "Nadhir yessawaḍ iḍfaren akked teɣriyin tunṣibin yettwabedren s uɣbalu-nsent. Ḍfer iwellihen n Umesten Aɣarim (14) d yiduba unṣiben.",
    managePreferences: "Sefrek iɣewwaren n ugzul n yimayl neɣ sens imaylen",
    settingsLabel: "Agzul n yimayl n temnaḍin n uɛassi",
    settingsHint:
      "Ṭṭef s yimayl ileqman n yimihiten n temnaḍin-ik n uɛassi. Imihiten uɛjilen (ONM afellay, tidyanin tunṣibin turmidin, izilzalen M5+, times taɛjilt) zeggren isragen n tsusmi.",
    frequencyLabel: "Asnagar n ugzul n yimayl",
    frequency: {
      off: "Yensa",
      immediate: "Imir-a",
      hourly: "Agzul yal asrag",
      daily: "Agzul ayalas",
    },
  },
};
