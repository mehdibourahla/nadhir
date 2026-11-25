import type { Track3Translation } from "./en";

export const track3Kab: Track3Translation = {
  track3: {
    ui: {
      alertsLoadError:
        "Ur izmir ara ad d-yali ilɣa-inek. Senqed tuqqna-k tɛiwdeḍ.",
      alertActionError: "Ur izmir ara ad ibeddel alɣu-a. Ɛiwed tikkelt-nniḍen.",
      unreadBadge: "Ur yettwaɣri ara",
      algiersTimeLabel: "Akud n Lezzayer",
      severityLabel: "Taẓeyt",
      sourceLabel: "Aɣbalu",
      placeLabel: "Tamnaḍt",
      officialBadge: "Unṣib",
      mediaBadge: "Taɣamsa",
      seismicMagnitude: "M{{magnitude}}",
    },
    sheet: {
      heightGroup: "Teɣzi n ugalis n tkarḍa",
      peek: "Amecṭuḥ",
      half: "Azgen",
      full: "Akk",
      expandToHalf: "Ldi agalis ɣer uzgen n teɣzi",
      expandToFull: "Ldi agalis ɣer teɣzi tameqqrant",
      collapseToPeek: "Senqes agalis ɣer ufeggag amecṭuḥ",
      dragHandle: "Sɣez neɣ senqes teɣzi n ugalis",
    },
    filters: {
      ariaLabel: "Sizdeg takarḍa s wanaw n wugur",
      all: "Akk",
      fire: "Times",
      weather: "Tagnit n tegnawt",
      flood: "Iḥemmalen",
      road: "Abrid",
      earthquake: "Zzelzla",
      other: "Wayeḍ",
      count: "{{count}}",
    },
    emergency: {
      sheetTitle: "Tuffɣa 14 d usali n lexbaṛ",
      openSheet: "Tuffɣa 14, tiferkit n umkan d usali n lexbaṛ",
      headerChip: "14",
      headerChipLabel: "Ldi Tuffɣa 14, tiferkit n umkan d usali n lexbaṛ",
      universalSection: "Ifecka n tuffɣa i yal anaw n wugur",
      guidanceSection: "Iwellihen imezgiyen s wanaw n wugur",
      selectHazard: "Fren tagnit",
      noInstructionNotice:
        "Ulac taludna tunṣibt i temnaḍt-ik ar tura. Iwellihen imezgiyen yettwaqeblen ddaw-a.",
      notAvailable: "Ur yella ara",
      notAvailableOffline: "Ur yella ara war aẓeṭṭa",
      noPackSaved: "Ulac takemmust war aẓeṭṭa iḥerzen",
      gpsActive: "Amkan GPS n utilifun",
      gpsWaiting: "Nettraǧu GPS n utilifun",
      copyCoords: "Nɣel timsisiyin",
      coordsCopied: "Timsisiyin ttwaneɣlent",
      sosSaveOfflineNote:
        "Ur yeddi ara usiwel? Ḥrez tazmilt deg utilifun-a (ur tettwazen ara)",
      dial14Sub: "Amesten aɣarim, akk tuffɣiwin, baṭel",
      dial1070Sub: "Tiẓegwa d DGF",
      dial112Sub: "Tuffɣa tamatut",
      hazards: {
        general: "Amatu",
        fire: "Times",
        flood: "Iḥemmalen",
        earthquake: "Zzelzla",
        storm: "Tabucidant",
      },
      guidance: {
        general: {
          title: "Aheyyi amatu",
          step1:
            "Siwel i Umesten aɣarim ɣer 14 ma yella wemdan deg wugur, tɣereḍ tiferkit n umkan-ik.",
          step2:
            "Ḍfer d tamezwarut tiludna n Umesten aɣarim, n Tamsulta neɣ n yiduba idiganen.",
          step3:
            "Ɛass acarji n utilifun-ik, tseqdceḍ asali n lexbaṛ akken ad tazneḍ amkan-ik i twacult s SMS neɣ WhatsApp.",
        },
        fire: {
          title: "Iwellihen imezgiyen n tmes n teẓgi",
          step1:
            "Siwel i 14 (Amesten aɣarim) neɣ 1070 (Tiẓegwa) s tɣiwant d temsisiyin-ik.",
          step2:
            "Snejmaɛ tikerḍiwin n tmagit, isafaren, aman d ucarji ma yella udabu yefka lamer n tuffɣa.",
          step3:
            "Ur tteddu ara s tkeṛṛust ɣer dexxan neɣ deg yiberdan uḍyiqen n teẓgi.",
          step4:
            "Ma telliḍ daxel n uxxam, mdel ṭṭwaqi d tewwura, teqqimeḍ theggaḍ i tiludna n udabu.",
        },
        flood: {
          title: "Iwellihen imezgiyen n yiḥemmalen",
          step1:
            "Siwel imir-a i 14 ma yella aman ttalin s tazzla neɣ yella win iḥebsen.",
          step2:
            "Ali ɣer umkan aɛlayan neɣ ɣer wannag afellay, bɛed ɣef yisaffen, iɣezran d yikufan.",
          step3:
            "Ur teddu ara s uḍar neɣ s tkeṛṛust daxel n waman yettazzalen neɣ abrid yeččuren d aman.",
          step4:
            "Gzem trisiti d lgaz seg ugazam agejdan ma kecmen waman s axxam u ma yezmer ad tawḍeḍ war aman.",
        },
        earthquake: {
          title: "Iwellihen imezgiyen n zzelzla",
          step1:
            "Deg wakud n zzelzla, knu, ffer ddaw n tɣawsa iǧehden bɛed ɣef zzaj, teṭṭfeḍ alamma teḥbes.",
          step2:
            "Deffir zzelzla, ffeɣ s leɛqel seg yisellumen (mačči s usali) tebɛedeḍ ɣef yiɣerban d yiguta n trisiti.",
          step3:
            "Ḥader seg zzelzlat i d-yettuɣalen. Senqed rriḥa n lgaz uqbel ad tesseɣleḍ trisiti neɣ times.",
          step4:
            "Siwel i 14 ma yella win yejreḥen neɣ iḥebsen, tesmeẓyeḍ isawalen akken ad qqimen yizirigen i usellek.",
          coastalTsunami:
            "Zzelzla deg yilel M5.0+ tettuskles: ma telliḍ ɣef yiri n yilel neɣ tama n usagen, ali imir-a ɣer yimukan iɛlayen daxel n tmurt, treǧuḍ alɣu unṣib n udabu uqbel ad tuɣaleḍ.",
        },
        storm: {
          title: "Iwellihen imezgiyen n tbucidant d waḍu iǧehden",
          step1:
            "Siwel i 14 ma yella tɣawsiwin i d-yeɣlin neɣ iguta n trisiti rran amdan deg wugur.",
          step2:
            "Qqim daxel n uxxam, bɛed ɣef ṭṭwaqi timeqqranin d tewwura n beṛṛa.",
          step3:
            "Bɛed ɣef yisekla iweḥdaniyen, iseflalen, tigejda n wuzzal d yiguta yeɣlin.",
          step4:
            "Wexxer tikeṛṛusin deg wakud n waḍu iǧehden, tabucidant n rrmel, abruri neɣ ageffur aquran.",
        },
      },
      openAreaCriteria: {
        fireTitle: "Tiseqqar n tallunt yeldin i tmes",
        earthquakeTitle: "Tiseqqar n tallunt yeldin i zzelzla",
        otherTitle: "Tazmilt ɣef tallunin yeldin",
        earthquake1: "Bɛed ɣef yixxamen, ibalkunen, iɣerban d zzaj.",
        earthquake2:
          "Bɛed ɣef yizirigen n trisiti n ufella d tgejda tiɣezfanin.",
        earthquake3:
          "Bɛed ɣef tqenṭrin, iɣallen ur nerkid ara d yiberdan uḍyiqen.",
        floodNote:
          "Tallunin yeldin n tkarḍa (imraḥen, inariren, tiflatin, imukan n tkeṛṛusin) ttiliint aṭas n tikkal deg wadday neɣ tama n wasif. Ur ttnejmaɛ ara deg wadday deg yiḥemmalen; ali ɣer ufella.",
        stormNote:
          "Akal yeldin ur yefki ara amesten mgal ayen yettafgen, abruri neɣ lebraq deg tbucidant. Ffer daxel n uxxam iǧehden yemdelen.",
        generalNote:
          "Tallunin yeldin kkant-d seg OpenStreetMap kan, ur ttwasenqdent ara. Wali tagnit s yiman-ik u ḍfer tiludna tunṣibin.",
      },
      prompt: {
        floodTitle: "Ugur n yiḥemmalen tama n temnaḍt-ik",
        floodBody:
          "Alɣu neɣ tadyant n yiḥemmalen turmidt i temnaḍt-ik ({{km}} km). Ldi Tuffɣa 14, tiferkit n umkan d yiwellihen n yiḥemmalen.",
        stormTitle: "Alɣu n tbucidant i temnaḍt-ik",
        stormBody:
          "Alɣu unṣib n tegnawt yella i temnaḍt-ik. Ldi Tuffɣa 14, tiferkit n umkan d yiwellihen n tbucidant.",
        quakeTitle: "Zzelzla M{{magnitude}} tettuskles s tama-k",
        quakeBody:
          "Zzelzla M{{magnitude}} tettuskles azal n {{km}} km seg utilifun-a. Ldi Tuffɣa 14, tiferkit n umkan d yiwellihen n zzelzla.",
        offshoreQuakeNote:
          "Tadyant deg yilel M5.0+: awellihen n yiri n yilel mgal tsunami llan daxel.",
        sourceOfficial: "Tadyant tunṣibt",
        sourceOnm: "Alɣu n tegnawt ONM",
        sourceSeismic: "Asekles n uẓeṭṭa n zzelzla",
        openEmergencyTools: "Ldi Tuffɣa 14 d usali n lexbaṛ",
      },
      observations: {
        floodNear: "Tadyant tunṣibt n yiḥemmalen tettuskles azal n {{km}} km.",
        stormNear: "Alɣu unṣib n tegnawt yella i {{area}}.",
        quakeNear: "Zzelzla M{{magnitude}} tettuskles azal n {{km}} km.",
        incidentNear: "Tadyant tunṣibt tettuskles azal n {{km}} km.",
      },
      report: {
        flood: "Iḥemmalen",
        storm: "Ixṣaṛen n tbucidant",
        earthquake: "Ixṣaṛen n zzelzla",
      },
    },
  },
};
