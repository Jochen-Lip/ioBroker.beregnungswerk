'use strict';

const FARBE = {
    AN: '#4caf50',
    AUS: '#f44336',
    WARN: '#ff9800',
    INFO: '#2196f3',
    NEUTRAL: '#9e9e9e',
};

const WETTER_ANBIETER_DEFAULT = 'open-meteo-weather.0';
const OPEN_METEO_ORT_DEFAULT = 'Neu_Wulmstorf';
const WETTERDATEN_TYPEN = ['Standort', 'Niederschlag_Heute', 'Niederschlag_Morgen', 'Temperatur', 'Luftfeuchtigkeit'];
const KONFIG_DAUER_DEFAULT = 1;
const KONFIG_WIEDERHOLUNGEN_DEFAULT = 2;
const VENTIL_ANZAHL = 4;
const NACHTRUHE_VON_DEFAULT = '22:00 Uhr';
const NACHTRUHE_BIS_DEFAULT = '07:00 Uhr';
const WHATSAPP_INSTANZ_DEFAULT = 'whatsapp-cmb.0';
const TELEGRAM_INSTANZ_DEFAULT = 'telegram.0';
const WHATSAPP_ADAPTER_NAMEN = ['whatsapp-cmb', 'whatsapp'];
const TELEGRAM_ADAPTER_NAME = 'telegram';

const TANK_WERT_AKTUEL_BESCHREIBUNG =
    'Quell-Datenpunkt für den aktuellen Füllstand. Einrichten: Rechtsklick, dann Wert bearbeiten, State-ID eintragen (ID unter Objekt bearbeiten kopieren).';

/** Nur Migration / Aufräumen alter Installationen – keine aktiven Datenpunkte */
const LEGACY_DP_BASE = '0_userdata.0.Beregnungswerk';
const ALT_DP_BASE = '0_userdata.0.MeineBewaesserung';
const LEGACY_TEST_DP_BASE = '0_userdata.0.DatenPunkte_Bewässerung_(TEST)';
const VERALTETES_DP_BASIS = '0_userdata.0.meinebewaesserung';

const ASTRO_TYP_STATES = {
    sunrise: 'Sonnenaufgang',
    sunriseEnd: 'Sonnenaufgang Ende',
    sunset: 'Sonnenuntergang',
    sunsetStart: 'Sonnenuntergang Beginn',
    dawn: 'Morgendämmerung',
    dusk: 'Abenddämmerung',
    goldenHour: 'Goldene Stunde (Abend)',
    goldenHourEnd: 'Goldene Stunde (Morgen)',
    solarNoon: 'Sonnenhöchststand',
    night: 'Nachtbeginn',
    nightEnd: 'Nachtende',
};

const ZUSTAND = { PAUSE: 0, BEREIT: 1, BEWAESSERUNG: 2 };

function buildPaths(namespace) {
    const DP_BASE = namespace;
    const STEUERUNG_BASE = `${DP_BASE}.Steuerung`;
    const WETTERDATEN_BASE = `${STEUERUNG_BASE}.Wetterdaten`;
    const SCHLEIFE_BASE = `${DP_BASE}.SchleifenSteuerung`;
    const TANK_BASE = `${DP_BASE}.WassertankSteuerung`;
    const GARTEN_BASE = `${DP_BASE}.GartenpumpeSteuerung`;
    const NACHRICHTEN_BASE = `${DP_BASE}.Nachrichten`;
    const TEST_BASE = `${DP_BASE}.Test`;

    return {
        DP_BASE,
        STEUERUNG_BASE,
        WETTERDATEN_BASE,
        WETTERDATEN_KONFIG: `${WETTERDATEN_BASE}.Konfig`,
        WETTERDATEN_MESSWERTE: `${WETTERDATEN_BASE}.Messwerte`,
        WETTERDATEN_SCHWELLE: `${WETTERDATEN_BASE}.Schwelle`,
        ANBIETER_SPEICHER_ID: `${WETTERDATEN_BASE}.Konfig.AnbieterSpeicher`,
        SCHLEIFE_BASE,
        TANK_BASE,
        TANK_KONFIG: `${TANK_BASE}.Konfig`,
        TANK_ANZEIGEN: `${TANK_BASE}.Anzeigen`,
        TANK_DP_PFAD_AUSWAHL_UNTEN: `${TANK_BASE}.Konfig.Tank_Untere_Schalter`,
        TANK_DP_PFAD_AUSWAHL_OBEN: `${TANK_BASE}.Konfig.Tank_Obene_Schalter`,
        TANK_DP_PFAD_AUSWAHL_ISTWERT: `${TANK_BASE}.Konfig.Tank_Wert_Aktuel`,
        TANK_DP_BRUNNENPUMPE_KONFIG: `${TANK_BASE}.Konfig.Brunnenpumpe`,
        TANK_DP_ANZEIGE_UNTEN: `${TANK_BASE}.Anzeigen.Tank_unten_Soll`,
        TANK_DP_ANZEIGE_OBEN: `${TANK_BASE}.Anzeigen.Tank_oben_Soll`,
        TANK_DP_ANZEIGE_ISTWERT: `${TANK_BASE}.Anzeigen.TankIstwert_Anzeige`,
        TANK_DP_MANUELL_PUMPE: `${TANK_BASE}.Konfig.ManuellPumpe`,
        TANK_DP_PUMPE: `${TEST_BASE}.Brunnenpumpe`,
        TANK_DP_UNTEN_TEST: `${TEST_BASE}.Tank-unten`,
        TANK_DP_OBEN_TEST: `${TEST_BASE}.tank-oben`,
        TANK_ISTWERT_SENSOR_DEFAULT: `${TEST_BASE}.TankIstwert`,
        GARTEN_BASE,
        GARTEN_KONFIG: `${GARTEN_BASE}.Konfig`,
        GARTEN_ANZEIGEN: `${GARTEN_BASE}.Anzeigen`,
        GARTENPUMPE_AUSGANG_DEFAULT: `${TEST_BASE}.Gartenpumpe`,
        NACHRICHTEN_BASE,
        NACHRICHTEN_KONFIG: `${NACHRICHTEN_BASE}.Konfig`,
        NACHRICHTEN_ANZEIGEN: `${NACHRICHTEN_BASE}.Anzeigen`,
        TEST_BASE,
        FEUCHT_SENSOR_DEFAULT: `${TEST_BASE}.luft`,
        TEMP_SENSOR_DEFAULT: `${TEST_BASE}.temp`,
        ventilBase: (nr) => `${DP_BASE}.Ventil${nr}`,
        ventilZielDefault: (nr) => `${TEST_BASE}.Ventil${nr}`,
    };
}

module.exports = {
    FARBE,
    WETTER_ANBIETER_DEFAULT,
    OPEN_METEO_ORT_DEFAULT,
    WETTERDATEN_TYPEN,
    KONFIG_DAUER_DEFAULT,
    KONFIG_WIEDERHOLUNGEN_DEFAULT,
    VENTIL_ANZAHL,
    NACHTRUHE_VON_DEFAULT,
    NACHTRUHE_BIS_DEFAULT,
    WHATSAPP_INSTANZ_DEFAULT,
    TELEGRAM_INSTANZ_DEFAULT,
    WHATSAPP_ADAPTER_NAMEN,
    TELEGRAM_ADAPTER_NAME,
    TANK_WERT_AKTUEL_BESCHREIBUNG,
    LEGACY_DP_BASE,
    ALT_DP_BASE,
    LEGACY_TEST_DP_BASE,
    VERALTETES_DP_BASIS,
    ASTRO_TYP_STATES,
    ZUSTAND,
    buildPaths,
};
