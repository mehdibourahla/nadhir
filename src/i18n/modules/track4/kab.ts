import type { Track4Translation } from "./en";

export const track4Kab: Track4Translation = {
  officialSource: {
    disclaimerWithSource:
      "Yettunefk-d seg tbadut tunṣibt n {{source}}. D talɣut kan, mačči d lameṛ unṣib.",
  },
  quakeOfficial: {
    eyebrow: "Alɣu unṣib n zzelzla",
    attributionLabel: "Alɣu n CRAAG",
    magnitudeLabel: "Tazmert CRAAG",
    placeLabel: "Amkan CRAAG",
    viewBulletin: "Wali alɣu n CRAAG",
    standaloneNote:
      "Aktazal unṣib n zzelzla i d-yessuffeɣ CRAAG. D talɣut kan, mačči d aktazal n yixeṣṣaren neɣ d lameṛ.",
  },
  rainfallObserved: {
    title: "Alehhu n ugeffur s ugensa i 30 n tedqiqin",
    satelliteBadge: "Yettwaḥrez s ugensa",
    rateUnit: "{{rate}} mm/s",
    accum30mUnit: "{{mm}} mm / 30 min",
    distinctFromModel:
      "Aktazal n ugeffur s ugensa i 30 n tedqiqin, yebḍa ɣef yisallen n umeskan n tegnewt.",
  },
  privacyCompliance: {
    badge: "Asaḍuf azzayri 18-07 d usaḍuf 25-11 (ANPDP)",
    policyVersionLabel: "Lqem n tsertit: {{version}}",
    manageInSettings: "Sefrek tisirag d usider n yisefka-iw",
    sections: {
      legalFrameworkTitle: "Akatar usḍif, amasay d udabu ANPDP",
      legalFrameworkBody:
        "Nadhir iseqdac isefka udmawanen s uqader n usaḍuf azzayri uṭṭun 18-07 n 10 yunyu 2018 ɣef ummesten n yimdanen deg usesfer n yisefka udmawanen, yettwabeddlen s usaḍuf uṭṭun 25-11 n 24 yulyu 2025, ddaw uḍfar n Udabu Aɣelnaw n Ummesten n Yisefka Udmawanen (ANPDP). Nadhir d asenfaṛ udmawan ilelli n tnafa tazayazt; asesfer n umiḍan afrayan yebna ɣef tsiregt-ik tafrawant i tzemreḍ ad tekkseḍ melmi tebɣiḍ.",
      minimizationTitle: "Asenɣes n yisefka d tbaḍnit deg yibenk",
      minimizationBody:
        "Takarḍa n yimihiten, isallen n tegnewt, askar n tudert d yilɣa n tɣiwanin teddun mebla amiḍan. Tifrat n tɣiwant tamirant tettili kan deg yibenk-ik s tlisa tadeblanin yellan deg usnas: aḍfar ur yettazen ara werǧin adeg-ik uzmir neɣ tangalt n tɣiwant-ik ɣer yiqeddacen n Nadhir. Tiwlafin n yineɣmisen ttɛeddint ɣef uqeddac-nneɣ akken ad kksent isefka n GPS, takamira d EXIF uqbel aḥraz. Nadhir ur yesɛi ara ula d yiwen n ufecku n udellel neɣ n tesleḍt tuffiɣt.",
      crossBorderTitle: "Taddart tatiknikt d yimsemrasen izerglisen",
      crossBorderBody:
        "Asissen n web, API, tikarḍiwin n beṭṭu d ummesten mgal ispamen Turnstile teddun ɣef Cloudflare Workers d R2. Imiḍanen, taffa Postgres d uḥraz uslig n tewlafin ttwazedɣen ɣur Supabase (tamnaḍt n Turuft) s umahil n usisef deg Turuft. Ilɣa usrid ttawḍen s Firebase Cloud Messaging (Google) d Apple Push Notification Service s wemḍan n usengel SHA-256 kan. Igzulen n yimayl ifrayanen ttɛeddin s Resend mebla aḥraz n tensa n yimayl deg yiɣmisen n tuzna. Asismel n yineɣmisen n yiɣermanen iseqdac tawwurt LLM i d-yettawin kan aḍris d tɣiwant, werǧin imayl-ik neɣ isemlan-ik uzmiren. Tikarḍiwin CARTO d tegnewt Open-Meteo ttaṭṭafent isutren n web mebla tamagit n umiḍan.",
      retentionTitle: "Tanzagt n uḥraz d uḥraz asemmaḍ",
      retentionBody:
        "Ineɣmisen n yiɣermanen ttfakkan seg tkarḍa tazayazt seld 6 n tsaɛtin (neɣ alamma d 24 n tsaɛtin ma sentmen-ten yinagan yeqqnen iqerben). Tifelwiyin n tegnewt, imihi, asuffeɣ d uselkem n yiɣbula ttwaḥerzent deg yifuyla Parquet yettwasneqden sakin ttwaksent seg Postgres seld 90 n wussan (92 n wussan i source_jobs). Tukksa n umiḍan-ik deg Yiɣewwaren tettekkes akk tiwlafin-ik seg uḥraz u tettekkes imir-nni umaɣnu-ik, timnaḍin-ik, ilɣa-ik, tisirag-ik, webhooks d yineɣmisen-ik.",
      anpdpRightsTitle: "Izerfan-ik ddaw yisaḍufen 18-07 d 25-11",
      anpdpRightsBody:
        "Ɣur-k azref n telɣut tafrawant, anekcum ɣer yisefka-ik udmawanen, asifeḍ n yisefka s umasal JSON, aseɣti deg Yiɣewwaren, agdal d tukksa n tsiregt melmi tebɣiḍ mebla ma tḥuza asesfer usḍif yezrin, d tukksa tummidt s tukksa n umiḍan. Ma twalaḍ izerfan-ik ur ttwaqadren ara, tzemreḍ ad tenermseḍ Nadhir neɣ ad tesserseḍ acetki ɣur udabu ANPDP.",
    },
    settings: {
      title: "Tabaḍnit, tisirag d usifeḍ n yisefka (Asaḍuf 18-07 / 25-11)",
      subtitle:
        "Wali neɣ kkes tisirag-ik tifrayanin n usesfer u sider anɣel JSON n yisefka-ik udmawanen.",
      readFullPolicy: "Ɣer tasertit n tbaḍnit tummidt",
      loading: "Asali n yismenyifen n tbaḍnit...",
      loadError: "Ur nezmir ara ad d-nsali tisirag n tbaḍnit tura.",
      retry: "Ɛreḍ tikkelt-nniḍen",
      consentsTitle: "Tisirag n usesfer",
      consentsHint:
        "Yal aɣtas n tsiregt yesseklas lqem amiran n tsertit d wakud-is. Tzemreḍ ad tefkeḍ neɣ ad tekkseḍ tisirag tifrayanin melmi tebɣiḍ.",
      granted: "Tettunefk",
      withdrawn: "Tettwakkes",
      notRecorded: "Ur tettwasekles ara",
      grantAction: "Efkaḍ tasiregt",
      withdrawAction: "Kkes tasiregt",
      updatedAt: "Amucceḍ aneggaru: {{date}}",
      saveSuccess: "Asmenyif n tbaḍnit yettwasekles.",
      saveError:
        "Ur nezmir ara ad nsekles asmenyif n tbaḍnit. Ɛreḍ tikkelt-nniḍen.",
      purposes: {
        privacy_policy: {
          label: "Tamussni n tsertit n tbaḍnit",
          description:
            "Yessentam belli teɣriḍ alɣu n tbaḍnit n yisaḍufen 18-07 d 25-11.",
        },
        citizen_reports: {
          label: "Ineɣmisen n yiɣermanen ɣef yimihiten",
          description:
            "Asesfer n yineɣmisen d tewlafin seg wacu ttwakksent EXIF i tferneḍ ad tazneḍ.",
        },
        zone_alerts: {
          label: "Timnaḍin n uɛassi yettwaḥerzen",
          description:
            "Aḥraz n temnaḍin-ik yettwasemman i umṣada n yilɣa n yimihiten.",
        },
        email_digest: {
          label: "Igzulen n yimayl i temnaḍin",
          description:
            "Tuzna n yimaylen ifrayanen n ugzul i temnaḍin-ik s Resend.",
        },
        push_alerts: {
          label: "Ilɣa usrid n umiḍan",
          description:
            "Tuzna n yilɣa n umiḍan yeqqnen s tamselɣut n yibenk yettwacferen kan.",
        },
        on_device_commune: {
          label: "Asmenyif n tɣiwant tamirant deg yibenk",
          description:
            "Yesseklas belli teẓriḍ aḍfar ur yettazen ara werǧin adeg-ik uzmir ɣer yiqeddacen n Nadhir.",
        },
      },
      exportTitle: "Sider isefka-iw udmawanen (JSON)",
      exportDescription:
        "Yessufuɣ-d talqayt n umiḍan-ik, amaɣnu, tisirag, timnaḍin n uɛassi, ineɣmisen, amazray n yilɣa d yisefka yeffren n yibenkan d webhooks. Tuffirin d yigran igensanen n usenqed ttwakksen.",
      exportButton: "Sider afaylu JSON",
      exporting: "Aheggi n usifeḍ...",
      exportSuccess: "Afaylu n yisefka udmawanen yettwasider.",
      exportError:
        "Ur nezmir ara ad d-nesnulfu asifeḍ n yisefka tura. Ɛreḍ tikkelt-nniḍen.",
    },
  },
  photoUpload: {
    exifNotice:
      "Isemlan GPS, amudim n tkamira d yisefka EXIF ttwakkasen s wudem awurman deg uqeddac-nneɣ uqbel aḥraz n tewlaft.",
    uploading: "Asizdeg d usali n tewlaft...",
    invalidFormat: "Ala tiwlafin JPEG, PNG neɣ WebP i yettwaqbalen.",
    tooLarge: "Tawlaft tugar talast n {{maxMb}} Mo.",
    uploadFailed: "Asali n tewlaft ur yeddi ara. Ɛreḍ tikkelt-nniḍen.",
    authRequired: "Qqen akken ad tessaliḍ tawlaft n uneɣmis.",
  },
  turnstile: {
    label: "Asenqed mgal ispamen",
    verifying: "Asali n usenqed mgal ispamen...",
    required: "Med asenqed uqbel ad tazneḍ.",
    expired: "Asenqed yemmut. Ttxil-k ɛreḍ tikkelt-nniḍen.",
    failed: "Asenqed ur yeddi ara. Ttxil-k ɛreḍ tikkelt-nniḍen.",
    retry: "Ɛreḍ asenqed tikkelt-nniḍen",
    notice: "Yettwaḥrez s Cloudflare Turnstile mgal tuzniwin tiwurmanin.",
  },
};
