'use strict';

const C = require('./constants');

function commonSchalter(name, desc, def = false, labels = { false: 'Aus', true: 'Ein' }) {
    return {
        name, desc, type: 'boolean', role: 'switch', read: true, write: true, def, states: labels,
        custom: { materialize: { false: C.FARBE.AUS, true: C.FARBE.AN } },
    };
}

function commonAnzeige(name, desc, def = false, labels = { false: 'Aus', true: 'An' }) {
    return {
        name, desc, type: 'boolean', role: 'indicator', read: true, write: false, def, states: labels,
        custom: { materialize: { false: C.FARBE.AUS, true: C.FARBE.AN } },
    };
}

function commonTaster(name, desc, label) {
    return {
        name, desc, type: 'boolean', role: 'button', read: true, write: true, def: false,
        states: { false: label, true: label },
        custom: { materialize: { false: C.FARBE.INFO, true: C.FARBE.INFO } },
    };
}

function commonSperre(name, desc) {
    return {
        name, desc, type: 'boolean', role: 'indicator', read: true, write: false, def: false,
        states: { false: 'Frei', true: 'Gesperrt' },
        custom: { materialize: { false: C.FARBE.AN, true: C.FARBE.AUS } },
    };
}

function buildSteuerungStates(P) {
    const S = P.STEUERUNG_BASE;
    const ZS = `${S}.Zeitschaltuhr`;
    return [
        { id: `${S}.Status`, val: 'Zeitsteuerung aus', common: { name: 'Status gesamt', type: 'string', role: 'text', read: true, write: false, def: 'Zeitsteuerung aus' } },
        { id: `${S}.RegelAktiv`, val: false, common: commonAnzeige('Zeitsteuerung / Automatik', 'Spiegelt SchleifenSteuerung.Aktiv') },
        { id: `${S}.Zeitmodus`, val: 0, common: { name: 'Zeitmodus', type: 'number', role: 'value', read: true, write: false, def: 0, states: { 0: 'Nächste: Feste Zeit', 1: 'Nächste: Astro-Zeit' } } },
        { id: `${S}.ZeitschaltuhrAusgeloest`, val: false, common: commonAnzeige('Zeitschaltuhr ausgelöst', 'Kurzimpuls bei Auslösung') },
        { id: `${S}.ZeitschaltuhrLetzteAusloesung`, val: '–', common: { name: 'Letzte Auslösung', type: 'string', role: 'text', read: true, write: false, def: '–' } },
        { id: `${ZS}.Schaltzeit1`, val: '06:00', common: { name: 'Schaltzeit 1', type: 'string', role: 'text', read: true, write: true, def: '06:00' } },
        { id: `${ZS}.Schaltzeit1Aktiv`, val: true, common: commonSchalter('Schaltzeit 1 aktiv', 'Erste tägliche Schaltzeit') },
        { id: `${ZS}.Schaltzeit1Astro`, val: false, common: { name: 'Schaltzeit 1 Astro', type: 'boolean', role: 'switch', read: true, write: true, def: false, states: { false: 'Fest', true: 'Astro' } } },
        { id: `${ZS}.Schaltzeit1AstroTyp`, val: 'sunrise', common: { name: 'Schaltzeit 1 Astro-Typ', type: 'string', role: 'text', read: true, write: true, def: 'sunrise', states: C.ASTRO_TYP_STATES } },
        { id: `${ZS}.Schaltzeit1AstroOffset`, val: 0, common: { name: 'Schaltzeit 1 Astro-Verschiebung', type: 'number', role: 'level', read: true, write: true, def: 0, min: -180, max: 180, unit: 'min' } },
        { id: `${ZS}.Schaltzeit1Anzeige`, val: '–', common: { name: 'Schaltzeit 1 berechnet', type: 'string', role: 'text', read: true, write: false, def: '–' } },
        { id: `${ZS}.Schaltzeit2`, val: '18:00', common: { name: 'Schaltzeit 2', type: 'string', role: 'text', read: true, write: true, def: '18:00' } },
        { id: `${ZS}.Schaltzeit2Aktiv`, val: true, common: commonSchalter('Schaltzeit 2 aktiv', 'Zweite tägliche Schaltzeit') },
        { id: `${ZS}.Schaltzeit2Astro`, val: false, common: { name: 'Schaltzeit 2 Astro', type: 'boolean', role: 'switch', read: true, write: true, def: false, states: { false: 'Fest', true: 'Astro' } } },
        { id: `${ZS}.Schaltzeit2AstroTyp`, val: 'sunset', common: { name: 'Schaltzeit 2 Astro-Typ', type: 'string', role: 'text', read: true, write: true, def: 'sunset', states: C.ASTRO_TYP_STATES } },
        { id: `${ZS}.Schaltzeit2AstroOffset`, val: 0, common: { name: 'Schaltzeit 2 Astro-Verschiebung', type: 'number', role: 'level', read: true, write: true, def: 0, min: -180, max: 180, unit: 'min' } },
        { id: `${ZS}.Schaltzeit2Anzeige`, val: '–', common: { name: 'Schaltzeit 2 berechnet', type: 'string', role: 'text', read: true, write: false, def: '–' } },
        { id: `${ZS}.TagMo`, val: true, common: { name: 'Montag', type: 'boolean', role: 'switch', read: true, write: true, def: true } },
        { id: `${ZS}.TagDi`, val: true, common: { name: 'Dienstag', type: 'boolean', role: 'switch', read: true, write: true, def: true } },
        { id: `${ZS}.TagMi`, val: true, common: { name: 'Mittwoch', type: 'boolean', role: 'switch', read: true, write: true, def: true } },
        { id: `${ZS}.TagDo`, val: true, common: { name: 'Donnerstag', type: 'boolean', role: 'switch', read: true, write: true, def: true } },
        { id: `${ZS}.TagFr`, val: true, common: { name: 'Freitag', type: 'boolean', role: 'switch', read: true, write: true, def: true } },
        { id: `${ZS}.TagSa`, val: false, common: { name: 'Samstag', type: 'boolean', role: 'switch', read: true, write: true, def: false } },
        { id: `${ZS}.TagSo`, val: false, common: { name: 'Sonntag', type: 'boolean', role: 'switch', read: true, write: true, def: false } },
    ];
}

function buildSchleifeStates(P) {
    const S = P.SCHLEIFE_BASE;
    const states = [
        { id: `${S}.Aktiv`, val: false, common: commonSchalter('Automatik / Schleifenmodus', 'Automatik = Schleife', false, { false: 'Manuell', true: 'Automatik' }) },
        { id: `${S}.Status`, val: 'Bereit', common: { name: 'Schleifen-Status', type: 'string', role: 'text', read: true, write: false, def: 'Bereit' } },
        { id: `${S}.Laeuft`, val: false, common: commonAnzeige('Schleife läuft', 'true solange mindestens ein Ventil läuft') },
        { id: `${S}.AktuellesVentil`, val: 0, common: { name: 'Aktuelles Ventil', type: 'number', role: 'value', read: true, write: false, def: 0, min: 0, max: 4, states: { 0: '–', 1: 'Ventil1', 2: 'Ventil2', 3: 'Ventil3', 4: 'Ventil4' } } },
        { id: `${S}.PauseZwischenSek`, val: 5, common: { name: 'Pause zwischen Ventilen', type: 'number', role: 'level', read: true, write: true, def: 5, min: 0, max: 3600, unit: 's' } },
        { id: `${S}.PauseZwischenSek_Hinweis`, val: 'Manuell → ManuellStart', common: { name: 'Startmodus', type: 'string', role: 'text', read: true, write: false, def: 'Manuell → ManuellStart' } },
        { id: `${S}.BrunnenpumpePauseSek`, val: 30, common: { name: 'Brunnenpumpe Pause pro Zyklus', type: 'number', role: 'level', read: true, write: true, def: 30, min: 0, max: 3600, unit: 's' } },
        { id: `${S}.GesamtzeitSek`, val: 0, common: { name: 'Gesamtzeit (berechnet)', type: 'number', role: 'value.interval', read: true, write: false, def: 0, unit: 's' } },
        { id: `${S}.GesamtzeitMaxMin`, val: 5, common: { name: 'Max-Gesamtzeit', type: 'number', role: 'level', read: true, write: true, def: 5, min: 1, max: 600, unit: 'min' } },
        { id: `${S}.GesamtzeitFehler`, val: false, common: { name: 'Gesamtzeit Fehler', type: 'boolean', role: 'indicator', read: true, write: false, def: false, states: { false: 'OK', true: 'Fehler' } } },
        { id: `${S}.GesamtzeitAnzeige`, val: '0 s (Limit 5 min)', common: { name: 'Gesamtzeit Anzeige', type: 'string', role: 'text', read: true, write: false, def: '0 s (Limit 5 min)' } },
        { id: `${S}.ManuellStart`, val: false, common: commonTaster('Manuell starten', 'Schleife sofort starten', 'Start') },
        { id: `${S}.ManuellStopp`, val: false, common: commonTaster('Manuell stoppen', 'Schleife beenden', 'Stopp') },
        { id: `${S}.PauseEin`, val: false, common: commonTaster('Pause ein', 'Aktives Ventil pausieren', 'Pause Ein') },
        { id: `${S}.PauseAus`, val: false, common: commonTaster('Pause aus', 'Fortsetzen', 'Pause Aus') },
    ];
    for (let nr = 1; nr <= C.VENTIL_ANZAHL; nr++) {
        states.push({ id: `${S}.Ventil${nr}`, val: true, common: commonSchalter(`Ventil${nr} in Schleife`, `Ventil ${nr} in Schleife`) });
    }
    return states;
}

function buildTankStates(P) {
    return [
        { id: `${P.TANK_ANZEIGEN}.Status`, val: 'Standby', common: { name: 'Status Tanksteuerung', type: 'string', role: 'text', read: true, write: false, def: 'Standby' } },
        { id: P.TANK_DP_MANUELL_PUMPE, val: true, common: commonSchalter('Automatik Schalter', 'false=Reparatur, true=Automatik', true, { false: 'Reparatur/AUS', true: 'Automatik EIN' }) },
        { id: P.TANK_DP_ANZEIGE_UNTEN, val: 20, common: { name: 'Einschaltpunkt (Unten)', type: 'number', role: 'value.min', read: true, write: true, def: 20, min: 0, max: 100, unit: '%' } },
        { id: P.TANK_DP_ANZEIGE_OBEN, val: 90, common: { name: 'Ausschaltpunkt (Oben)', type: 'number', role: 'value.max', read: true, write: true, def: 90, min: 0, max: 100, unit: '%' } },
        { id: P.TANK_DP_ANZEIGE_ISTWERT, val: 0, common: { name: 'Tank-Istwert', type: 'number', role: 'value', read: true, write: false, def: 0, min: 0, max: 100, unit: '%' } },
        { id: P.TANK_DP_PFAD_AUSWAHL_UNTEN, val: P.TANK_DP_ANZEIGE_UNTEN, common: { name: 'Datenpfad Unten', type: 'string', role: 'text', read: true, write: true, def: P.TANK_DP_ANZEIGE_UNTEN } },
        { id: P.TANK_DP_PFAD_AUSWAHL_OBEN, val: P.TANK_DP_ANZEIGE_OBEN, common: { name: 'Datenpfad Oben', type: 'string', role: 'text', read: true, write: true, def: P.TANK_DP_ANZEIGE_OBEN } },
        { id: P.TANK_DP_PFAD_AUSWAHL_ISTWERT, val: P.TANK_ISTWERT_SENSOR_DEFAULT, common: { name: 'Datenpfad Istwert', type: 'string', role: 'text', read: true, write: true, def: P.TANK_ISTWERT_SENSOR_DEFAULT } },
        { id: P.TANK_DP_BRUNNENPUMPE_KONFIG, val: P.TANK_DP_PUMPE, common: { name: 'Datenpfad Brunnenpumpe', type: 'string', role: 'text', read: true, write: true, def: P.TANK_DP_PUMPE } },
    ];
}

function buildGartenStates(P) {
    return [
        { id: `${P.GARTEN_BASE}.Aktiv`, val: true, common: commonAnzeige('Gartenpumpe aktiv', 'Automatik außerhalb Nachtruhe', true) },
        { id: `${P.GARTEN_KONFIG}.GartenpumpeAusgang`, val: P.GARTENPUMPE_AUSGANG_DEFAULT, common: { name: 'Gartenpumpe Ausgang', type: 'string', role: 'text', read: true, write: true, def: P.GARTENPUMPE_AUSGANG_DEFAULT } },
        { id: `${P.GARTEN_KONFIG}.NachtruheVon`, val: C.NACHTRUHE_VON_DEFAULT, common: { name: 'Nachtruhe von', type: 'string', role: 'text', read: true, write: true, def: C.NACHTRUHE_VON_DEFAULT } },
        { id: `${P.GARTEN_KONFIG}.NachtruheBis`, val: C.NACHTRUHE_BIS_DEFAULT, common: { name: 'Nachtruhe bis', type: 'string', role: 'text', read: true, write: true, def: C.NACHTRUHE_BIS_DEFAULT } },
        { id: `${P.GARTEN_KONFIG}.NachtruheAktiv`, val: true, common: commonSchalter('Nachtruhe aktiv', 'Pumpe während Nachtruhe aus') },
        { id: `${P.GARTEN_ANZEIGEN}.NachtruheGeradeAktiv`, val: false, common: commonAnzeige('Nachtruhe gerade aktiv', 'Anzeige') },
        { id: `${P.GARTEN_ANZEIGEN}.Gartenpumpe`, val: false, common: commonAnzeige('Gartenpumpe', 'Aktueller Pumpenzustand') },
        { id: `${P.GARTEN_ANZEIGEN}.PumpeVisSteuerung`, val: false, common: commonAnzeige('PumpeVisSteuerung', 'Ventil-Ausgang angesteuert') },
        { id: `${P.GARTEN_ANZEIGEN}.Status`, val: 'Inaktiv', common: { name: 'Gartenpumpe-Status', type: 'string', role: 'text', read: true, write: false, def: 'Inaktiv' } },
    ];
}

function buildNachrichtenStates(P) {
    const K = P.NACHRICHTEN_KONFIG;
    const A = P.NACHRICHTEN_ANZEIGEN;
    return [
        { id: `${K}.WhatsApp_Aktiv`, val: false, common: commonSchalter('WhatsApp aktiv', 'Nachrichten über WhatsApp') },
        { id: `${K}.WhatsApp_Instanz`, val: C.WHATSAPP_INSTANZ_DEFAULT, common: { name: 'WhatsApp Instanz', type: 'string', role: 'text', read: true, write: true, def: C.WHATSAPP_INSTANZ_DEFAULT } },
        { id: `${K}.WhatsApp_TestSenden`, val: false, common: commonTaster('WhatsApp Test', 'Testnachricht WhatsApp', 'Test') },
        { id: `${A}.WhatsApp_InstanzenVerfuegbar`, val: C.WHATSAPP_INSTANZ_DEFAULT, common: { name: 'WhatsApp Instanzen', type: 'string', role: 'text', read: true, write: false, def: C.WHATSAPP_INSTANZ_DEFAULT } },
        { id: `${K}.Telegram_Aktiv`, val: false, common: commonSchalter('Telegram aktiv', 'Nachrichten über Telegram') },
        { id: `${K}.Telegram_Instanz`, val: C.TELEGRAM_INSTANZ_DEFAULT, common: { name: 'Telegram Instanz', type: 'string', role: 'text', read: true, write: true, def: C.TELEGRAM_INSTANZ_DEFAULT } },
        { id: `${K}.Telegram_User`, val: '', common: { name: 'Telegram User', type: 'string', role: 'text', read: true, write: true, def: '' } },
        { id: `${K}.Telegram_ChatId`, val: '', common: { name: 'Telegram ChatId', type: 'string', role: 'text', read: true, write: true, def: '' } },
        { id: `${K}.Telegram_TestSenden`, val: false, common: commonTaster('Telegram Test', 'Testnachricht Telegram', 'Test') },
        { id: `${A}.Telegram_InstanzenVerfuegbar`, val: C.TELEGRAM_INSTANZ_DEFAULT, common: { name: 'Telegram Instanzen', type: 'string', role: 'text', read: true, write: false, def: C.TELEGRAM_INSTANZ_DEFAULT } },
        { id: `${A}.Telegram_AuthInfo`, val: '', common: { name: 'Telegram Auth-Info', type: 'string', role: 'text', read: true, write: false, def: '' } },
        { id: `${K}.Email_Aktiv`, val: false, common: commonSchalter('E-Mail aktiv', 'Nachrichten per E-Mail') },
        { id: `${K}.Email_Adresse`, val: '', common: { name: 'E-Mail Adresse', type: 'string', role: 'text', read: true, write: true, def: '' } },
        { id: `${K}.Email_TestSenden`, val: false, common: commonTaster('E-Mail Test', 'Testnachricht E-Mail', 'Test') },
        { id: `${K}.BeiManuell`, val: true, common: commonSchalter('Bei manuell', 'Nachricht bei manuellem Start') },
        { id: `${K}.BeiZeitgesteuert`, val: true, common: commonSchalter('Bei Zeitsteuerung', 'Nachricht bei Zeitschaltuhr') },
        { id: `${K}.Tankstand_InNachricht`, val: false, common: commonSchalter('Tankstand in Nachricht', 'Tank-Istwert mitsenden') },
        { id: `${A}.LetzteNachricht`, val: '', common: { name: 'Letzte Nachricht', type: 'string', role: 'text', read: true, write: false, def: '' } },
        { id: `${A}.LetzterVersand`, val: '–', common: { name: 'Letzter Versand', type: 'string', role: 'text', read: true, write: false, def: '–' } },
        { id: `${A}.Tankstand_Aktuell`, val: '–', common: { name: 'Tankstand aktuell', type: 'string', role: 'text', read: true, write: false, def: '–' } },
        { id: `${A}.Status`, val: 'Bereit', common: { name: 'Nachrichten-Status', type: 'string', role: 'text', read: true, write: false, def: 'Bereit' } },
    ];
}

function buildWetterStates(P) {
    const K = P.WETTERDATEN_KONFIG;
    const M = P.WETTERDATEN_MESSWERTE;
    const W = P.WETTERDATEN_SCHWELLE;
    const states = [
        { id: `${K}.Wetter_Anbieter`, val: C.WETTER_ANBIETER_DEFAULT, common: { name: 'Wetter-Anbieter', type: 'string', role: 'value', read: true, write: true, def: C.WETTER_ANBIETER_DEFAULT } },
        { id: `${K}.OpenMeteoOrt`, val: C.OPEN_METEO_ORT_DEFAULT, common: { name: 'Open-Meteo Ort', type: 'string', role: 'text', read: true, write: true, def: C.OPEN_METEO_ORT_DEFAULT } },
        { id: P.ANBIETER_SPEICHER_ID, val: '{}', common: { name: 'Anbieter-Speicher', type: 'string', role: 'json', read: true, write: false, def: '{}' } },
        { id: `${M}.Standort`, val: 'Keine Daten', common: { name: 'Standort', type: 'string', role: 'text', read: true, write: true, def: 'Keine Daten' } },
        { id: `${M}.Temperatur`, val: 'Keine Daten', common: { name: 'Temperatur', type: 'mixed', role: 'value.temperature', unit: '°C', read: true, write: true, def: 'Keine Daten' } },
        { id: `${M}.Niederschlag_Heute`, val: 'Keine Daten', common: { name: 'Niederschlag heute', type: 'mixed', role: 'value.precipitation', unit: 'mm', read: true, write: true, def: 'Keine Daten' } },
        { id: `${M}.Niederschlag_Morgen`, val: 'Keine Daten', common: { name: 'Niederschlag morgen', type: 'mixed', role: 'value.precipitation', unit: 'mm', read: true, write: true, def: 'Keine Daten' } },
        { id: `${M}.Luftfeuchtigkeit`, val: 'Keine Daten', common: { name: 'Luftfeuchtigkeit', type: 'mixed', role: 'value.humidity', unit: '%', read: true, write: true, def: 'Keine Daten' } },
        { id: `${W}.FeuchtigkeitAktiv`, val: false, common: commonSchalter('Schwelle Feuchtigkeit aktiv', 'Wetter-Feuchteschwelle') },
        { id: `${W}.FeuchtigkeitWert`, val: 40, common: { name: 'Schwellwert Feuchtigkeit', type: 'number', role: 'level', read: true, write: true, def: 40, unit: '%' } },
        { id: `${W}.TemperaturAktiv`, val: false, common: commonSchalter('Schwelle Temperatur aktiv', 'Wetter-Temperaturschwelle') },
        { id: `${W}.TemperaturWert`, val: 25, common: { name: 'Schwellwert Temperatur', type: 'number', role: 'level', read: true, write: true, def: 25, unit: '°C' } },
        { id: `${W}.NiederschlagHeuteAktiv`, val: false, common: commonSchalter('Schwelle Regen heute aktiv', 'Niederschlag heute') },
        { id: `${W}.NiederschlagHeuteWert`, val: 5, common: { name: 'Schwellwert Regen heute', type: 'number', role: 'level', read: true, write: true, def: 5, unit: 'mm' } },
        { id: `${W}.NiederschlagMorgenAktiv`, val: false, common: commonSchalter('Schwelle Regen morgen aktiv', 'Niederschlag morgen') },
        { id: `${W}.NiederschlagMorgenWert`, val: 5, common: { name: 'Schwellwert Regen morgen', type: 'number', role: 'level', read: true, write: true, def: 5, unit: 'mm' } },
        { id: `${W}.Vergleich`, val: true, common: { name: 'Vergleich obere Schwelle', type: 'boolean', role: 'switch', read: true, write: true, def: true, states: { false: 'untere', true: 'obere' } } },
        { id: `${W}.Ueberschritten`, val: false, common: commonAnzeige('Wetterschwelle überschritten', 'Sperrt Automatik') },
    ];
    for (const typ of C.WETTERDATEN_TYPEN) {
        states.push({ id: `${K}.Quellpfad_${typ}`, val: '', common: { name: `Quellpfad ${typ}`, type: 'string', role: 'text', read: true, write: true, def: '' } });
    }
    return states;
}

function buildVentilStates(P, nr) {
    const base = P.ventilBase(nr);
    const ziel = P.ventilZielDefault(nr);
    return [
        { id: `${base}.Konfig.Aktiviert`, val: true, common: { name: `Ventil ${nr} freigeben`, type: 'boolean', role: 'indicator', read: true, write: false, def: true } },
        { id: `${base}.Konfig.Bewaesserungsdauer`, val: C.KONFIG_DAUER_DEFAULT, common: { name: `Ventil ${nr} Dauer`, type: 'number', role: 'level', read: true, write: true, def: C.KONFIG_DAUER_DEFAULT, min: 1, max: 120, unit: 'min' } },
        { id: `${base}.Konfig.Wiederholungen`, val: C.KONFIG_WIEDERHOLUNGEN_DEFAULT, common: { name: `Ventil ${nr} Wiederholungen`, type: 'number', role: 'level', read: true, write: true, def: C.KONFIG_WIEDERHOLUNGEN_DEFAULT, min: 1, max: 99 } },
        { id: `${base}.Konfig.FeuchtigkeitSensor`, val: P.FEUCHT_SENSOR_DEFAULT, common: { name: `Ventil ${nr} Feuchtigkeitssensor`, type: 'string', role: 'text', read: true, write: true, def: P.FEUCHT_SENSOR_DEFAULT } },
        { id: `${base}.Konfig.Temperatursensor`, val: P.TEMP_SENSOR_DEFAULT, common: { name: `Ventil ${nr} Temperatursensor`, type: 'string', role: 'text', read: true, write: true, def: P.TEMP_SENSOR_DEFAULT } },
        { id: `${base}.Konfig.Ventil${nr}Ausgang`, val: ziel, common: { name: `Ventil ${nr} Ausgang`, type: 'string', role: 'text', read: true, write: true, def: ziel } },
        { id: `${base}.Steuerung.Ventil${nr}_AusAn`, val: false, common: commonSchalter(`Ventil${nr} Aus/An`, 'Manueller Start/Stopp') },
        { id: `${base}.Steuerung.Pause`, val: false, common: commonSchalter(`Ventil ${nr} Pause`, 'Bewässerung anhalten', false, { false: 'Läuft', true: 'Pause' }) },
        { id: `${base}.Steuerung.Zustand`, val: C.ZUSTAND.BEREIT, common: { name: `Ventil ${nr} Zustand`, type: 'number', role: 'level', read: true, write: true, def: C.ZUSTAND.BEREIT, min: 0, max: 2, states: { 0: 'Pause', 1: 'Bereit', 2: 'Bewässerung' } } },
        { id: `${base}.Steuerung.Aktiv`, val: false, common: commonAnzeige(`Ventil ${nr} Aktiv`, 'Bewässerung läuft') },
        { id: `${base}.Steuerung.SchwelleSperre`, val: false, common: commonSperre(`Ventil ${nr} SchwelleSPERRE`, 'Schwelle überschritten') },
        { id: `${base}.Steuerung.Restzeit`, val: 0, common: { name: `Ventil ${nr} Restzeit`, type: 'number', role: 'value.interval', read: true, write: false, def: 0, unit: 's' } },
        { id: `${base}.Steuerung.RestzeitAnzeige`, val: '0', common: { name: `Ventil ${nr} Restzeit Anzeige`, type: 'string', role: 'text', read: true, write: false, def: '0' } },
        { id: `${base}.Steuerung.WiederholungenAktuel`, val: 0, common: { name: `Ventil ${nr} Wiederholung aktuell`, type: 'number', role: 'value', read: true, write: false, def: 0, min: 0 } },
        { id: `${base}.Messwerte.FeuchtigkeitAnzeige`, val: '– %', common: { name: `Ventil ${nr} Feuchtigkeit`, type: 'string', role: 'text', read: true, write: false, def: '– %' } },
        { id: `${base}.Messwerte.ExternTempAnzeige`, val: '– °C', common: { name: `Ventil ${nr} Temperatur`, type: 'string', role: 'text', read: true, write: false, def: '– °C' } },
        { id: `${base}.Messwerte.LetzteBewaesserung`, val: '–', common: { name: `Ventil ${nr} Letzte Bewässerung`, type: 'string', role: 'text', read: true, write: false, def: '–' } },
        { id: `${base}.Schwelle.FeuchtigkeitAktiv`, val: false, common: commonSchalter(`Ventil ${nr} Schwelle Feuchtigkeit`, 'Feuchte-Schwelle') },
        { id: `${base}.Schwelle.FeuchtigkeitWert`, val: 40, common: { name: `Ventil ${nr} Schwellwert Feuchtigkeit`, type: 'number', role: 'level', read: true, write: true, def: 40, min: 0, max: 100, unit: '%' } },
        { id: `${base}.Schwelle.TemperaturAktiv`, val: false, common: commonSchalter(`Ventil ${nr} Schwelle Temperatur`, 'Temperatur-Schwelle') },
        { id: `${base}.Schwelle.TemperaturWert`, val: 25, common: { name: `Ventil ${nr} Schwellwert Temperatur`, type: 'number', role: 'level', read: true, write: true, def: 25, min: -30, max: 60, unit: '°C' } },
        { id: `${base}.Schwelle.Vergleich`, val: true, common: { name: `Ventil ${nr} Schwelle Vergleich`, type: 'boolean', role: 'switch', read: true, write: true, def: true, states: { false: 'untere', true: 'obere' } } },
        { id: `${base}.Schwelle.Ueberschritten`, val: false, common: commonAnzeige(`Ventil ${nr} Schwelle überschritten`, 'Berechnet') },
    ];
}

function buildTestStates(P) {
    return [
        { id: P.TANK_ISTWERT_SENSOR_DEFAULT, val: 0, common: { name: 'Tank Istwert (Test)', type: 'number', role: 'value', read: true, write: true, def: 0, min: 0, max: 100, unit: '%' } },
        { id: P.TANK_DP_UNTEN_TEST, val: 20, common: { name: 'Tank unten (Test)', type: 'number', role: 'value', read: true, write: true, def: 20, unit: '%' } },
        { id: P.TANK_DP_OBEN_TEST, val: 90, common: { name: 'Tank oben (Test)', type: 'number', role: 'value', read: true, write: true, def: 90, unit: '%' } },
        { id: P.TANK_DP_PUMPE, val: false, common: commonSchalter('Brunnenpumpe (Test)', 'Test-Aktor') },
        { id: P.GARTENPUMPE_AUSGANG_DEFAULT, val: false, common: commonSchalter('Gartenpumpe (Test)', 'Test-Aktor') },
        { id: P.FEUCHT_SENSOR_DEFAULT, val: 50, common: { name: 'Feuchtigkeit (Test)', type: 'number', role: 'value.humidity', read: true, write: true, def: 50, unit: '%' } },
        { id: P.TEMP_SENSOR_DEFAULT, val: 20, common: { name: 'Temperatur (Test)', type: 'number', role: 'value.temperature', read: true, write: true, def: 20, unit: '°C' } },
    ];
}

function getStateDefinitions(namespace) {
    const P = C.buildPaths(namespace);
    const list = [];
    list.push(...buildSteuerungStates(P));
    list.push(...buildSchleifeStates(P));
    list.push(...buildTankStates(P));
    list.push(...buildGartenStates(P));
    list.push(...buildNachrichtenStates(P));
    list.push(...buildWetterStates(P));
    list.push(...buildTestStates(P));
    for (let nr = 1; nr <= C.VENTIL_ANZAHL; nr++) {
        list.push(...buildVentilStates(P, nr));
        list.push({ id: P.ventilZielDefault(nr), val: false, common: commonSchalter(`Ventil${nr} (Test)`, 'Test-Aktor Ventil') });
    }
    return list;
}

module.exports = { getStateDefinitions };
