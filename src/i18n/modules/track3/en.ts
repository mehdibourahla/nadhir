export const track3En = {
  track3: {
    ui: {
      alertsLoadError:
        "Could not load your alerts. Check your connection and try again.",
      alertActionError: "Could not update this alert. Try again.",
      unreadBadge: "Unread",
      algiersTimeLabel: "Algiers time",
      severityLabel: "Severity",
      sourceLabel: "Source",
      placeLabel: "Area",
      officialBadge: "Official",
      mediaBadge: "Press report",
      seismicMagnitude: "M{{magnitude}}",
    },
    sheet: {
      heightGroup: "Map panel height",
      peek: "Compact",
      half: "Half",
      full: "Full",
      expandToHalf: "Open panel to half height",
      expandToFull: "Expand panel to full height",
      collapseToPeek: "Collapse panel to compact bar",
      dragHandle: "Adjust map panel height",
    },
    filters: {
      ariaLabel: "Filter map by hazard",
      all: "All",
      fire: "Fire",
      weather: "Weather",
      flood: "Flood",
      road: "Road",
      earthquake: "Earthquake",
      other: "Other",
      count: "{{count}}",
    },
    emergency: {
      sheetTitle: "Emergency 14 and Check-In",
      openSheet: "Emergency 14, Position Card and Check-In",
      headerChip: "14",
      headerChipLabel: "Open Emergency 14, Position Card and Check-In",
      universalSection: "Emergency tools for all hazards",
      guidanceSection: "Standing guidance by hazard",
      selectHazard: "Select situation",
      noInstructionNotice:
        "No official instruction for your area yet. Pre-approved standing guidance follows.",
      notAvailable: "Not available",
      notAvailableOffline: "Not available offline",
      noPackSaved: "No offline pack saved",
      gpsActive: "Device GPS position",
      gpsWaiting: "Waiting for device GPS",
      copyCoords: "Copy coordinates",
      coordsCopied: "Coordinates copied",
      sosSaveOfflineNote:
        "Call did not connect? Save a local note on this phone (not sent)",
      dial14Sub: "Civil Protection, all emergencies, free",
      dial1070Sub: "Forests and DGF",
      dial112Sub: "General emergency",
      hazards: {
        general: "General",
        fire: "Fire",
        flood: "Flood",
        earthquake: "Earthquake",
        storm: "Storm",
      },
      guidance: {
        general: {
          title: "General preparedness",
          step1:
            "Call Civil Protection on 14 if anyone is in danger, and read your Position Card aloud.",
          step2:
            "Follow instructions from Civil Protection, Gendarmerie or local authorities first.",
          step3:
            "Keep your phone charged and use Check-In to send your position to family by SMS or WhatsApp.",
        },
        fire: {
          title: "Wildfire standing guidance",
          step1:
            "Call 14 (Civil Protection) or 1070 (Forests) with your commune and coordinates.",
          step2:
            "Gather ID, essential medicines, water and your phone charger in case authorities order evacuation.",
          step3:
            "Do not drive toward smoke or along narrow forest roads with low visibility.",
          step4:
            "If sheltered indoors, close windows, shutters and vents, and stay ready for authority instructions.",
        },
        flood: {
          title: "Flood and flash-flood standing guidance",
          step1:
            "Call 14 immediately if water rises rapidly or anyone is stranded.",
          step2:
            "Move to higher ground or an upper floor away from wadis, riverbeds, basements and underpasses.",
          step3:
            "Never walk or drive through moving water or flooded roadways.",
          step4:
            "Switch off electricity and gas at the main breaker if water enters the building and you can reach it without stepping in water.",
        },
        earthquake: {
          title: "Earthquake standing guidance",
          step1:
            "During shaking, drop down, take cover under sturdy furniture away from glass, and hold on until shaking stops.",
          step2:
            "After shaking stops, exit calmly by stairs (never elevators) and stay clear of facades, walls and power lines.",
          step3:
            "Expect aftershocks. Check for gas smell before using switches, lighters or open flames.",
          step4:
            "Call 14 if anyone is injured or trapped, and keep phone lines brief for emergency responders.",
          coastalTsunami:
            "Offshore M5.0+ earthquake recorded: if you are on the coast or near a harbour, move inland to higher ground immediately and wait for official authority clearance before returning.",
        },
        storm: {
          title: "Severe storm and wind standing guidance",
          step1:
            "Call 14 if falling debris, downed lines or storm damage puts anyone in danger.",
          step2:
            "Stay indoors away from large windows, skylights and exterior doors.",
          step3:
            "Keep clear of isolated trees, scaffolding, metal poles and downed power cables.",
          step4:
            "Delay driving during strong gusts, dust walls, hail or heavy downpours with low visibility.",
        },
      },
      openAreaCriteria: {
        fireTitle: "Open-area criteria for fire",
        earthquakeTitle: "Open-area criteria for earthquake",
        otherTitle: "Open-area suitability note",
        earthquake1:
          "Clear of buildings, balconies, perimeter walls and glass facades.",
        earthquake2:
          "Clear of overhead power lines, transformers and tall streetlamps.",
        earthquake3:
          "Clear of bridges, steep unstable slopes and narrow alleys.",
        floodNote:
          "Map open areas (squares, stadiums, beaches, parking lots) are often on low ground or near wadis. Do not gather in low-lying open areas during flooding; move to higher ground or an upper floor.",
        stormNote:
          "Open ground offers no shelter from flying debris, hail or lightning during a severe storm. Use a solid enclosed building instead.",
        generalNote:
          "Map open areas come from OpenStreetMap data only and are not verified refuges. Judge site conditions directly and follow official instructions.",
      },
      prompt: {
        floodTitle: "Flood risk near your area",
        floodBody:
          "Active flood alert or incident recorded for your area ({{km}} km). Open Emergency 14, Position Card and flood standing guidance.",
        stormTitle: "Severe storm warning for your area",
        stormBody:
          "Official severe weather warning active for your area. Open Emergency 14, Position Card and storm standing guidance.",
        quakeTitle: "M{{magnitude}} earthquake recorded nearby",
        quakeBody:
          "An M{{magnitude}} earthquake was recorded about {{km}} km from this phone. Open Emergency 14, Position Card and earthquake standing guidance.",
        offshoreQuakeNote:
          "Offshore M5.0+ event: coastal tsunami standing guidance is available inside.",
        sourceOfficial: "Official incident report",
        sourceOnm: "ONM weather vigilance",
        sourceSeismic: "Seismic network observation",
        openEmergencyTools: "Open Emergency 14 & Check-In",
      },
      observations: {
        floodNear: "Official flood incident recorded about {{km}} km away.",
        stormNear: "Official weather warning active for {{area}}.",
        quakeNear: "M{{magnitude}} earthquake recorded about {{km}} km away.",
        incidentNear: "Official incident recorded about {{km}} km away.",
      },
      report: {
        flood: "Flooding",
        storm: "Storm damage",
        earthquake: "Earthquake damage",
      },
    },
    forecast: {
      metaTitle: "Multi-Hazard Forecast for Algeria · Nadhir",
      metaDescription:
        "Official ONM weather warnings, fire danger, hourly weather, air quality, official incidents and seismic context across Algeria.",
      authorityBannerTitle: "Official warnings vs. model forecasts",
      authorityBannerBody:
        "Official weather warnings come from ONM · Météo Algérie and cover the full wilaya. Weather, fire danger (Open-Meteo) and air quality (CAMS) are numerical model outputs, not observed rainfall or lightning detection: a quiet model never refutes an ONM warning, and no warning is not a guarantee of absence of risk.",
      onmEvent: {
        snow: "Snow and ice",
        cold: "Cold wave",
        flood: "Flooding",
        waves: "High waves",
        fog: "Dense fog",
      },
      viewWilayaPage: "Open {{wilaya}} page",
      localContextTitle: "Live multi-hazard context near {{place}}",
      localContextBody:
        "Official bulletins, recent seismic observations and nearest airport station, separate from model forecasts.",
      incidentsTitle: "Official incidents (72h)",
      incidentsError: "Could not load official incidents for this wilaya.",
      incidentsEmpty:
        "No official DGPC or authority incident recorded in this wilaya over the last 72 hours.",
      incidentsCount: "{{count}} active incident(s)",
      quakesTitle: "Seismic observations (72h, 100 km)",
      quakesError: "Could not load recent seismic observations.",
      quakesEmpty:
        "No earthquake of magnitude 2.0+ recorded within 100 km over the last 72 hours.",
      quakeDistance: "{{km}} km away",
      stationTitle: "Nearest observed station",
      stationError: "Could not load observed airport weather stations.",
      stationEmpty:
        "No fresh airport station observation within 50 km in the last 3 hours.",
      stationObservedBadge: "Observed",
      stationModelNote: "Observed at {{station}} ({{km}} km), not a model.",
      stationTemp: "{{temp}}°C",
      stationWind: "Wind {{wind}} km/h",
      stationGust: "Gusts {{gust}} km/h",
      stationVisibility: "Visibility {{km}} km",
      nationalIncidents: "{{count}} official incident(s)",
      nationalQuake: "M{{magnitude}} earthquake",
      wilayaDirectoryTitle: "Browse all 69 wilayas",
      wilayaDirectoryBody:
        "Direct bilingual hazard pages for every Algerian wilaya under Law 26-06.",
      wilayaDirectoryToggle: "Show all 69 wilayas",
      wilayaDirectoryHide: "Hide wilaya list",
      openWilayaLink: "Wilaya page",
      retryAction: "Try again",
    },
    wilaya: {
      metaTitle:
        "{{wilaya}} ({{code}}) Alerts and Multi-Hazard Outlook · Nadhir",
      metaDescription:
        "Official ONM · Météo Algérie warnings, active incidents, probable fires, recent earthquakes, fire danger and communes for Wilaya of {{wilaya}} ({{code}}), Algeria.",
      ogImageAlt:
        "Multi-hazard alert summary for Wilaya of {{wilaya}}, Algeria",
      heading: "Wilaya of {{wilaya}}",
      codeBadge: "Wilaya {{code}}",
      coordsLabel: "Coordinates",
      communesStat: "{{count}} communes",
      languageSwitcherLabel: "Page language",
      backToMap: "Live map",
      openForecast: "Multi-hazard forecast",
      openEmergency: "Emergency 14",
      dataUnavailableTitle: "Live hazard feed temporarily unavailable",
      dataUnavailableBody:
        "Static information for Wilaya of {{wilaya}} is shown below. Live hazard feeds could not be reached right now.",
      dataPartialNote:
        "Some hazard sources could not be loaded right now. Other sections remain available.",
      retryLoad: "Reload live data",
      updatedAt: "Checked {{time}} (Algiers)",
      hazardsTitle: "Current hazard situation",
      honestEmptyTitle:
        "No active warnings or probable hazards currently listed",
      honestEmptyBody:
        "No active ONM · Météo Algérie warning, official incident, probable fire or nearby earthquake is currently recorded for Wilaya of {{wilaya}}. Absence of listed alerts does not guarantee absence of risk.",
      onmSectionTitle: "Official ONM · Météo Algérie warnings",
      onmAttribution: "ONM · Météo Algérie",
      onmValidWindow: "Valid {{from}} to {{to}}",
      incidentsSectionTitle: "Official incidents (72h)",
      firesSectionTitle: "Active probable fires (72h)",
      firesConfirmedBadge: "Confirmed",
      firesProbableBadge: "Probable fire",
      firesDetections: "{{count}} satellite detections",
      heatSignalsNote:
        "{{count}} uncorroborated satellite heat signal(s) also detected in this wilaya. Heat signals alone are not confirmed fires.",
      quakesSectionTitle: "Recent earthquakes (72h, within 100 km)",
      quakeDepth: "Depth {{km}} km",
      fireDangerSectionTitle: "Fire danger summary (today)",
      fireDangerFwi: "FWI {{fwi}}",
      fireDangerPercentile: "p{{percentile}}",
      fireDangerFuelLimited:
        "{{count}} commune(s) have sparse vegetation (fuel-limited).",
      fireDangerAllFuelLimited:
        "All reported communes in this wilaya are currently marked fuel-limited (sparse vegetation).",
      stationSectionTitle: "Nearest observed weather station",
      stationObservedLabel: "Observed METAR",
      communesSectionTitle: "Communes in Wilaya of {{wilaya}}",
      communesSectionBody:
        "Open a commune in the multi-hazard forecast for 6-day weather, fire danger and air quality.",
      communesOfflineNote:
        "Wilaya of {{wilaya}} includes {{count}} communes. The interactive list could not be loaded right now; open the multi-hazard forecast to search all communes.",
      showAllCommunes: "Show all {{count}} communes",
      showFewerCommunes: "Show fewer communes",
      neighboringTitle: "Other wilayas",
      notFoundTitle: "Wilaya not found",
      notFoundBody:
        "This wilaya page does not match any of the 69 Algerian wilayas.",
      notFoundBackForecast: "Browse all 69 wilayas on Forecast",
      notFoundBackMap: "Return to live map",
      kind: {
        forest_fire: "Wildfire",
        brush_fire: "Brush fire",
        crop_fire: "Crop fire",
        urban_fire: "Urban fire",
        flood: "Flood",
        storm: "Storm",
        road: "Road hazard",
        structure: "Structural incident",
        other: "Incident",
      },
    },
  },
};

export type Track3Translation = typeof track3En;
