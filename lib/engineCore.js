'use strict';

/**
 * Automatisch aus Beregnungswerk.js extrahiert – Bewässerungslogik.
 * @param {object} g Globale Laufzeit-Kontext (Pfade, DP, VENTILE, Shim-Funktionen)
 */
module.exports = function runEngine(g) {

    const {
        DP_BASE, LEGACY_DP_BASE, ALT_DP_BASE, LEGACY_TEST_DP_BASE, VERALTETES_DP_BASIS,
        STEUERUNG_BASE, WETTERDATEN_BASE, WETTERDATEN_KONFIG, WETTERDATEN_MESSWERTE, WETTERDATEN_SCHWELLE,
        WETTERDATEN_TYPEN, WETTER_ANBIETER_DEFAULT, ANBIETER_SPEICHER_ID, OPEN_METEO_ORT_DEFAULT,
        SCHLEIFE_BASE, V1, VENTIL_ANZAHL, TEST_DP_BASE,
        FEUCHT_SENSOR_DEFAULT, TEMP_SENSOR_DEFAULT,
        TANK_BASE, TANK_KONFIG, TANK_ANZEIGEN,
        TANK_DP_PFAD_AUSWAHL_UNTEN, TANK_DP_PFAD_AUSWAHL_OBEN, TANK_DP_PFAD_AUSWAHL_ISTWERT,
        TANK_DP_BRUNNENPUMPE_KONFIG, TANK_DP_ANZEIGE_UNTEN, TANK_DP_ANZEIGE_OBEN, TANK_DP_ANZEIGE_ISTWERT,
        TANK_DP_MANUELL_PUMPE, TANK_DP_PUMPE, TANK_DP_UNTEN_TEST, TANK_DP_OBEN_TEST, TANK_ISTWERT_SENSOR_DEFAULT,
        GARTEN_BASE, GARTEN_KONFIG, GARTEN_ANZEIGEN, GARTENPUMPE_AUSGANG_DEFAULT,
        NACHTRUHE_VON_DEFAULT, NACHTRUHE_BIS_DEFAULT,
        NACHRICHTEN_BASE, NACHRICHTEN_KONFIG, NACHRICHTEN_ANZEIGEN,
        WHATSAPP_ADAPTER_NAMEN, TELEGRAM_ADAPTER_NAME, WHATSAPP_INSTANZ_DEFAULT, TELEGRAM_INSTANZ_DEFAULT,
        KONFIG_DAUER_DEFAULT, KONFIG_WIEDERHOLUNGEN_DEFAULT, FARBE,
        DP, VENTILE, EIGENE_STATES,
        GLOBAL_STATES_LIST, WETTERDATEN_STATES_LIST, SCHLEIFE_STATES_LIST,
        TANK_STATES_LIST, GARTEN_STATES_LIST, NACHRICHTEN_STATES_LIST,
        on, schedule, log, getState, setState, existsState, getObject, existsObject,
        createState, sendTo, getInstancesOfAdapter, getAstroDate,
        getObjects, deleteState, deleteChannel, extendObject,
    } = g;

    const V1_MANUELL_ALT = `${V1}.Steuerung.ManuellEin`;


    let wetterdatenSyncTimer = null;
    let wetterdatenQuellCache = { key: '', subs: [] };
    let wetterAutomatikSperre = { blockiert: false, regelAktivVorher: false, schleifeAktivVorher: false };
    let ventilAktiviertSyncGuard = false;
    let schleifeLauf = {
        aktiv: false, stopAngefordert: false, manuellGestartet: false, queue: [], index: 0,
        pauseTimer: null, ignoriert: new Set(), ausAnEin: new Set(),
        manuellPauseSync: false, manuellPausiertNr: 0, startGrund: '',
    };
    let zeitschaltuhrZuletzt = '';
    let zeitschaltuhrAusgeloestTimer = null;
    let schedulerGestartet = false;
    let gartenpumpeLauf = { erzwungenAus: false };
    let pumpeVisSteuerungSubs = [];
    let schleifeGesamtzeitFehlerVorher = false;
    let tankTriggerUnten = null;
    let tankTriggerOben = null;
    let tankTriggerIstwert = null;
    let tankTriggerBrunnenpumpe = null;
    let tankPfadeCache = { unten: '', oben: '', istwert: '', pumpe: '' };
    let tankSchedulerGestartet = false;
    let tankPfadHinweisGesendet = new Set();

    const ZS_WOCHENTAG = [
        { dow: 0, idKey: 'zsTagSo' }, { dow: 1, idKey: 'zsTagMo' }, { dow: 2, idKey: 'zsTagDi' },
        { dow: 3, idKey: 'zsTagMi' }, { dow: 4, idKey: 'zsTagDo' }, { dow: 5, idKey: 'zsTagFr' },
        { dow: 6, idKey: 'zsTagSa' },
    ];

    function pruefeAdapterDatenpunkte() {
        let fehlend = 0;
        for (let i = 0; i < EIGENE_STATES.length; i++) {
            if (!existsState(EIGENE_STATES[i].id)) fehlend++;
        }
        if (fehlend > 0) {
            logWarn(`${fehlend}/${EIGENE_STATES.length} Datenpunkte fehlen unter ${DP_BASE}`);
        }
    }

function siehtAusWieStateId(text) {
    const s = normalisiereStateId(text);
    return !!(s && s.includes('.'));
}

/** Leerzeichen in State-IDs entfernen (häufiger Tippfehler in VIS/Konfig). */
function normalisiereStateId(pfad) {
    let s = String(pfad || '').trim();
    if (!s) return '';
    s = s.replace(/\.\s+/g, '.').replace(/\s+\./g, '.');
    s = s.replace(/\s+/g, '');
    return s;
}

function leseTankKonfigPfad(id, fallback) {
    const fb = normalisiereStateId(fallback || '');
    if (!existsState(id)) return fb;
    const roh = String(getVal(id, fb) || '').trim();
    let neu = normalisiereStateId(roh);
    if (!siehtAusWieStateId(neu)) neu = fb;
    if (neu !== roh) {
        setIntern(id, neu);
        logInfo(`Tank-Konfigpfad bereinigt: ${id} → ${neu}`);
    }
    return neu || fb;
}

/** Nur Tank_Wert_Aktuel: optional Alias, sonst Textwert. */
function leseTankWertAktuelPfad() {
    const fallback = TANK_ISTWERT_SENSOR_DEFAULT;
    if (typeof getObject === 'function' && existsState(TANK_DP_PFAD_AUSWAHL_ISTWERT)) {
        const obj = getObject(TANK_DP_PFAD_AUSWAHL_ISTWERT);
        const alias = obj?.common?.alias;
        if (alias) {
            const idBlock = alias.id;
            if (typeof idBlock === 'string' && idBlock.trim()) return normalisiereStateId(idBlock.trim());
            if (idBlock && typeof idBlock === 'object') {
                const ziel = idBlock.read || idBlock.write;
                if (ziel && String(ziel).trim()) return normalisiereStateId(String(ziel).trim());
            }
            if (alias.read && String(alias.read).trim()) return normalisiereStateId(String(alias.read).trim());
        }
    }
    return leseTankKonfigPfad(TANK_DP_PFAD_AUSWAHL_ISTWERT, fallback);
}

/** Nur Anzeige (vom Skript): Aus=rot, An=grün */
function commonAnzeige(name, desc, def = false, labels = { false: 'Aus', true: 'An' }) {
    return {
        name,
        desc,
        type: 'boolean',
        role: 'indicator',
        read: true,
        write: false,
        def,
        states: labels,
        custom: { materialize: { false: FARBE.AUS, true: FARBE.AN } },
    };
}

/** Taster (setzt kurz true, Skript quittiert) */
function commonTaster(name, desc, label) {
    return {
        name,
        desc,
        type: 'boolean',
        role: 'button',
        read: true,
        write: true,
        def: false,
        states: { false: label, true: label },
        custom: { materialize: { false: FARBE.INFO, true: FARBE.INFO } },
    };
}

/** Sperre/Hinweis: frei=grün, gesperrt=rot */
function commonSperre(name, desc) {
    return {
        name,
        desc,
        type: 'boolean',
        role: 'indicator',
        read: true,
        write: false,
        def: false,
        states: { false: 'Frei', true: 'Gesperrt' },
        custom: { materialize: { false: FARBE.AN, true: FARBE.AUS } },
    };
}

const ZIEL_WERT_EIN = true;
const ZIEL_WERT_AUS = false;

const ZUSTAND = { PAUSE: 0, BEREIT: 1, BEWAESSERUNG: 2 };

const ASTRO_TYPEN = [
    'sunrise', 'sunriseEnd', 'sunset', 'sunsetStart', 'dawn', 'dusk',
    'goldenHour', 'goldenHourEnd', 'solarNoon', 'night', 'nightEnd',
];

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

const INLINE_SUNCALC = (() => {
    const PI = Math.PI;
    const rad = PI / 180;
    const dayMs = 86400000;
    const J1970 = 2440588;
    const J2000 = 2451545;
    const J0 = 0.0009;
    const e = rad * 23.4397;

    const zeitWinkel = [
        [-0.833, 'sunrise', 'sunset'],
        [-0.833, 'sunriseEnd', 'sunsetStart'],
        [-6, 'dawn', 'dusk'],
        [-12, 'nauticalDawn', 'nauticalDusk'],
        [-18, 'nightEnd', 'night'],
        [6, 'goldenHourEnd', 'goldenHour'],
    ];

    function toJulian(date) {
        return date.valueOf() / dayMs - 0.5 + J1970;
    }

    function toDays(date) {
        return toJulian(date) - J2000;
    }

    function rightAscension(l, b) {
        return Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
    }

    function declination(l, b) {
        return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
    }

    function solarMeanAnomaly(d) {
        return rad * (357.5291 + 0.98560028 * d);
    }

    function eclipticLongitude(M) {
        const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
        const P = rad * 102.9372;
        return M + C + P + PI;
    }

    function julianCycle(d, lw) {
        return Math.round(d - J0 - lw / (2 * PI));
    }

    function approxTransit(Ht, lw, n) {
        return J0 + (Ht + lw) / (2 * PI) + n;
    }

    function solarTransitJ(ds, M, L) {
        return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    }

    function hourAngle(h, phi, d) {
        const x = (Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d));
        if (x < -1 || x > 1) return NaN;
        return Math.acos(x);
    }

    function getSetJ(h, lw, phi, dec, n, M, L) {
        const w = hourAngle(h, phi, dec);
        if (isNaN(w)) return NaN;
        const a = approxTransit(w, lw, n);
        return solarTransitJ(a, M, L);
    }

    function fromJulian(j) {
        return new Date((j + 0.5 - J1970) * dayMs);
    }

    function getTimes(date, lat, lng) {
        const lw = rad * -lng;
        const phi = rad * lat;
        const d = toDays(date);
        const n = julianCycle(d, lw);
        const ds = approxTransit(0, lw, n);
        const M = solarMeanAnomaly(ds);
        const L = eclipticLongitude(M);
        const dec = declination(L, 0);
        const Jnoon = solarTransitJ(ds, M, L);

        const result = {
            solarNoon: fromJulian(Jnoon),
            nadir: fromJulian(Jnoon - 0.5),
        };

        for (let i = 0; i < zeitWinkel.length; i++) {
            const h0 = zeitWinkel[i][0] * rad;
            const Jset = getSetJ(h0, lw, phi, dec, n, M, L);
            if (isNaN(Jset)) continue;
            const Jrise = Jnoon - (Jset - Jnoon);
            result[zeitWinkel[i][1]] = fromJulian(Jrise);
            result[zeitWinkel[i][2]] = fromJulian(Jset);
        }
        return result;
    }

    return { getTimes };
})();

/** Veraltete Datenpunkte – werden beim Start gelöscht */
const VERALTETE_STATES = [
    '0_userdata.0.Beregnungswerk.Ventil1.Konfig.HardwareAusgang',
    '0_userdata.0.Bewaesserung.Ventil1.Konfig.HardwareAusgang',
    `${V1}.Konfig.ExternSensor`,
    `${V1}.Messwerte.ExternSensorAktuell`,
    `${V1}.Messwerte.ExternSensorAnzeige`,
    `${V1}.Messwerte.FeuchtigkeitAktuell`,
    `${V1}.Schwelle.Aktiv`,
    `${V1}.Schwelle.Wert`,
    `${SCHLEIFE_BASE}.ManuellPause`,
    `${SCHLEIFE_BASE}.PauseSchalter`,
    `${DP_BASE}.Konfig.WetterQuelle`,
    `${DP_BASE}.Konfig.DasWetterInstanz`,
    `${DP_BASE}.Konfig.OpenMeteoInstanz`,
    `${DP_BASE}.Konfig.OpenMeteoOrt`,
    `${DP_BASE}.Konfig.EigeneFeuchtigkeit`,
    `${DP_BASE}.Konfig.EigeneTemperatur`,
    `${DP_BASE}.Konfig.EigeneNiederschlag`,
    `${DP_BASE}.Messwerte.WetterQuelleAnzeige`,
    `${DP_BASE}.Messwerte.FeuchtigkeitAnzeige`,
    `${DP_BASE}.Messwerte.TemperaturAnzeige`,
    `${DP_BASE}.Messwerte.NiederschlagAnzeige`,
    `${DP_BASE}.Messwerte.QuelleStatus`,
    `${DP_BASE}.Schwelle`,
    `${STEUERUNG_BASE}.Messwerte`,
    `${STEUERUNG_BASE}.Messwerte.Konfig.WetterQuelle`,
    `${STEUERUNG_BASE}.Messwerte.Konfig.DasWetterInstanz`,
    `${STEUERUNG_BASE}.Messwerte.Konfig.OpenMeteoInstanz`,
    `${STEUERUNG_BASE}.Messwerte.Konfig.OpenMeteoOrt`,
    `${STEUERUNG_BASE}.Messwerte.Konfig.EigeneFeuchtigkeit`,
    `${STEUERUNG_BASE}.Messwerte.Konfig.EigeneTemperatur`,
    `${STEUERUNG_BASE}.Messwerte.Konfig.EigeneNiederschlag`,
    `${STEUERUNG_BASE}.Messwerte.WetterQuelleAnzeige`,
    `${STEUERUNG_BASE}.Messwerte.FeuchtigkeitAnzeige`,
    `${STEUERUNG_BASE}.Messwerte.TemperaturAnzeige`,
    `${STEUERUNG_BASE}.Messwerte.NiederschlagAnzeige`,
    `${STEUERUNG_BASE}.Messwerte.QuelleStatus`,
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Standort',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Niederschlag_Heute',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Niederschlag_Morgen',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Temperatur',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Luftfeuchtigkeit',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Messwerte.Standort',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Messwerte.Niederschlag_Heute',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Messwerte.Niederschlag_Morgen',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Messwerte.Temperatur',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Messwerte.Luftfeuchtigkeit',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.FeuchtigkeitAktiv',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.FeuchtigkeitWert',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.TemperaturAktiv',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.TemperaturWert',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.NiederschlagHeuteAktiv',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.NiederschlagHeuteWert',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.NiederschlagMorgenAktiv',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.NiederschlagMorgenWert',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.Ueberschritten',
    '0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.Vergleich',
    '0_userdata.0.meinebewaesserung.0_userdata',
    `${TANK_BASE}.Aktiv`,
    `${TANK_KONFIG}.SchwelleUnten`,
    `${TANK_KONFIG}.SchwelleOben`,
    `${TANK_KONFIG}.SchwelleUntenZahl`,
    `${TANK_KONFIG}.SchwelleObenZahl`,
    `${TANK_KONFIG}.TankUntenSensor`,
    `${TANK_KONFIG}.TankObenSensor`,
    `${TANK_KONFIG}.TankIstwertSensor`,
    `${TANK_KONFIG}.BrunnenpumpeAusgang`,
    `${TANK_ANZEIGEN}.TankUnten`,
    `${TANK_ANZEIGEN}.TankOben`,
    `${TANK_ANZEIGEN}.TankIstwert`,
    `${TANK_ANZEIGEN}.Brunnenpumpe`,
];

function erzeugeVentilDP(nr) {
    const base = `${DP_BASE}.Ventil${nr}`;
    return {
        aktiviert: `${base}.Konfig.Aktiviert`,
        dauer: `${base}.Konfig.Bewaesserungsdauer`,
        wiederholungen: `${base}.Konfig.Wiederholungen`,
        feuchtSensor: `${base}.Konfig.FeuchtigkeitSensor`,
        tempSensor: `${base}.Konfig.Temperatursensor`,
        ausgang: `${base}.Konfig.Ventil${nr}Ausgang`,
        ausAn: `${base}.Steuerung.Ventil${nr}_AusAn`,
        pause: `${base}.Steuerung.Pause`,
        zustand: `${base}.Steuerung.Zustand`,
        aktiv: `${base}.Steuerung.Aktiv`,
        schwelleSperre: `${base}.Steuerung.SchwelleSperre`,
        restzeit: `${base}.Steuerung.Restzeit`,
        restzeitAnzeige: `${base}.Steuerung.RestzeitAnzeige`,
        wiederholungenAktuel: `${base}.Steuerung.WiederholungenAktuel`,
        feuchtAnzeige: `${base}.Messwerte.FeuchtigkeitAnzeige`,
        externTempAnzeige: `${base}.Messwerte.ExternTempAnzeige`,
        letzteBewaesserung: `${base}.Messwerte.LetzteBewaesserung`,
        shwVergleich: `${base}.Schwelle.Vergleich`,
        shwFeuchtAktiv: `${base}.Schwelle.FeuchtigkeitAktiv`,
        shwFeuchtWert: `${base}.Schwelle.FeuchtigkeitWert`,
        shwTempAktiv: `${base}.Schwelle.TemperaturAktiv`,
        shwTempWert: `${base}.Schwelle.TemperaturWert`,
        shwUeberschritten: `${base}.Schwelle.Ueberschritten`,
    };
}
function erzeugeVentilLaufzustand() {
    return {
        feuchtigkeitSensorAbo: '',
        temperaturSensorAbo: '',
        automatikTriggerAbo: '',
        feuchtigkeitSensorSub: null,
        temperaturSensorSub: null,
        endeTimer: null,
        restzeitTicker: null,
        laufEndeMs: 0,
        gesamtEndeMs: 0,
        wiederholungAktuell: 0,
        zyklusBeendetLaeuft: false,
        pauseGespeichert: false,
        gesamtRestBeiPause: 0,
        zyklusRestBeiPause: 0,
        startGrund: '',
    };
}
function logInfo(msg) {
    log(`[Beregnungswerk] ${msg}`, 'info');
}

function logWarn(msg) {
    log(`[Beregnungswerk] ${msg}`, 'warn');
}

/** true = Schreibvorgang von außen (Admin/VIS), nicht vom Skript selbst */
function istSkriptQuelle(from) {
    return String(from || '').indexOf('system.adapter.javascript') === 0;
}

function istNutzerEingabe(obj) {
    if (!obj?.state) return false;
    if (obj.state.ack === false) return true;
    const from = String(obj.state.from || '');
    if (from && !istSkriptQuelle(from)) {
        const alt = obj.oldState ? obj.oldState.val : undefined;
        const neu = obj.state.val;
        if (JSON.stringify(alt) !== JSON.stringify(neu)) return true;
    }
    return false;
}

function logDpAngelegt(id) {
    logInfo(`angelegt: ${id}`);
}

function getVal(id, fallback) {
    if (!existsState(id)) return fallback;
    const s = getState(id);
    return s?.val !== null && s?.val !== undefined ? s.val : fallback;
}

/** UI/Benutzer-Schreibzugriff: ack=false oder fehlend = Benutzeraktion */
const WOCHENTAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function formatDatumKurzDe(ms) {
    const d = new Date(ms || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const tag = WOCHENTAGE_KURZ[d.getDay()];
    const datum = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(-2)}`;
    const zeit = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return `${tag}, ${datum}, ${zeit}`;
}

function istBeregnungswerkState(id) {
    return id === DP_BASE || (typeof id === 'string' && id.startsWith(`${DP_BASE}.`));
}

function createStateSafe(id, val, common) {
    if (existsState(id)) return true;
    try {
        createState(id, val, common);
        if (existsState(id)) return true;
    } catch (e1) {
        /* common evtl. zu komplex – Minimal-Metadaten */
    }
    try {
        const c = common || {};
        createState(id, val, {
            name: c.name || String(id).split('.').pop(),
            type: c.type || (typeof val === 'boolean' ? 'boolean' : typeof val === 'number' ? 'number' : 'string'),
            role: c.role || (typeof val === 'boolean' ? 'switch' : typeof val === 'number' ? 'value' : 'text'),
            read: c.read !== false,
            write: c.write === true,
        });
    } catch (e2) {
        logWarn(`createState ${id}: ${e2}`);
    }
    return existsState(id);
}

/** Datenpunkt anlegen (Fallback wenn Adapter einen DP noch nicht hat). */
function createStateBw(id, val, common) {
    if (existsState(id)) return true;
    return createStateSafe(id, val, common);
}

function erstelleDatenpunktWennFehlt(s) {
    if (!s?.id) return false;
    if (existsState(s.id)) return true;
    try {
        createState(s.id, s.val, s.common);
    } catch (e) {
        logWarn(`createState ${s.id}: ${e}`);
    }
    if (existsState(s.id)) {
        logDpAngelegt(s.id);
        return true;
    }
    logWarn(`Datenpunkt nicht angelegt: ${s.id}`);
    return false;
}

function setIntern(id, val) {
    if (!existsState(id)) {
        const def = EIGENE_STATES.find((s) => s.id === id);
        if (def) {
            erstelleDatenpunktWennFehlt({ id, val, common: def.common });
        }
        if (!existsState(id)) {
            logWarn(`setIntern: Datenpunkt fehlt: ${id}`);
            return;
        }
    }
    try {
        setState(id, val, true);
    } catch (e) {
        logWarn(`setIntern setState ${id}: ${e}`);
    }
}

function konvertiereHardwareWert(id, val) {
    if (typeof getObject !== 'function') return val;
    const obj = getObject(id);
    const typ = String(obj?.common?.type || '').toLowerCase();
    if (typ !== 'string' && typ !== 'text') return val;
    const an = alsBool(val, false);
    const states = obj?.common?.states;
    if (states && typeof states === 'object') {
        const keys = Object.keys(states);
        for (let i = 0; i < keys.length; i++) {
            if (an && alsBool(keys[i], false)) return keys[i];
        }
        for (let i = 0; i < keys.length; i++) {
            if (!an && !alsBool(keys[i], true)) return keys[i];
        }
    }
    return an ? 'true' : 'false';
}

function setHardware(id, val) {
    const hw = String(id || '').trim();
    if (!hw || !existsState(hw)) return false;
    try {
        const ziel = konvertiereHardwareWert(hw, val);
        const cur = getState(hw);
        if (cur && String(cur.val) === String(ziel)) return true;
        setState(hw, ziel, false);
        return true;
    } catch (err) {
        logWarn(`Hardware setState fehlgeschlagen (${hw}): ${err}`);
        return false;
    }
}

function istZeitsteuerungAktiv() {
    return alsBool(getVal(DP.zeitsteuerung, false), false);
}

function istWetterAutomatikGesperrt() {
    return alsBool(getVal(DP.wetterdatenSchwelleUeberschritten, false), false);
}

function alsBool(val, fallback) {
    if (val === true || val === 1 || val === '1' || val === 'true' || val === 'TRUE' || val === 'on' || val === 'ON' || val === 'Ein' || val === 'Ja') {
        return true;
    }
    if (val === false || val === 0 || val === '0' || val === 'false' || val === 'FALSE' || val === 'off' || val === 'OFF' || val === 'Aus' || val === 'Nein') {
        return false;
    }
    return fallback;
}

/** Taster-Auslösung (boolean button oder Adapter-String-Typ mit z. B. „Start“). */
function istTasterAusloeser(val) {
    if (val === false || val === null || val === undefined || val === '' || val === 0 || val === '0') return false;
    return alsBool(val, true);
}

function tasterRuhewert(id) {
    if (typeof getObject === 'function' && existsState(id)) {
        const typ = String(getObject(id)?.common?.type || '').toLowerCase();
        if (typ === 'string') return '';
    }
    return false;
}

function quittiereTaster(id) {
    if (!existsState(id)) return;
    setState(id, tasterRuhewert(id), true);
}

function behandleSchleifenTasterEvent(obj, callback) {
    if (!istNutzerEingabe(obj)) return;
    if (!istTasterAusloeser(obj.state.val)) return;
    quittiereTaster(obj.id);
    if (typeof callback === 'function') callback();
}

/** Schwelle.Vergleich: false=untere, true=obere Grenze (auch ioBroker-Label-Texte) */
function parseVergleichObereSchwelle(val, fallbackOben) {
    const s = String(val ?? '').trim().toLowerCase();
    if (s === 'untere schwelle' || s === 'untere' || s === 'unten') return false;
    if (s === 'obere schwelle' || s === 'obere' || s === 'oben') return true;
    return alsBool(val, fallbackOben);
}

function leseSchaltzeitFest(nr) {
    const id = nr === 1 ? DP.zsZeit1 : DP.zsZeit2;
    const fallback = nr === 1 ? '06:00' : '18:00';
    const s = String(getVal(id, fallback) || fallback).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) {
        const fb = fallback.split(':');
        return { h: parseInt(fb[0], 10), min: parseInt(fb[1], 10) };
    }
    return {
        h: Math.max(0, Math.min(23, parseInt(m[1], 10))),
        min: Math.max(0, Math.min(59, parseInt(m[2], 10))),
    };
}

function istSchaltzeitAstro(nr) {
    const id = nr === 1 ? DP.zsZeit1Astro : DP.zsZeit2Astro;
    return alsBool(getVal(id, false), false);
}

function blockiereFesteZeitWennAstro(nr, zeitId, neuerWert) {
    if (!istSchaltzeitAstro(nr)) return false;
    const alt = getVal(zeitId, neuerWert);
    if (String(alt) !== String(neuerWert)) {
        logInfo(`Schaltzeit ${nr}: feste Zeit ignoriert (Astro aktiv) – nutze Schaltzeit${nr}Anzeige`);
    }
    setState(zeitId, alt, true);
    return true;
}

function formatLetzteAusloesung(ms) {
    const d = new Date(ms || Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

function markiereZeitschaltuhrAusgeloest(nr) {
    const jetzt = Date.now();
    setIntern(DP.zsAusgeloest, true);
    setIntern(DP.zsLetzteAusloesung, formatLetzteAusloesung(jetzt));
    if (zeitschaltuhrAusgeloestTimer) {
        clearTimeout(zeitschaltuhrAusgeloestTimer);
    }
    zeitschaltuhrAusgeloestTimer = setTimeout(() => {
        setIntern(DP.zsAusgeloest, false);
        zeitschaltuhrAusgeloestTimer = null;
    }, 5000);
    logInfo(`Zeitschaltuhr ausgelöst: Schaltzeit ${nr} (${istSchaltzeitAstro(nr) ? 'Astro' : 'fest'})`);
}

function leseAstroTyp(nr) {
    const id = nr === 1 ? DP.zsZeit1AstroTyp : DP.zsZeit2AstroTyp;
    const def = nr === 1 ? 'sunrise' : 'sunset';
    const typ = String(getVal(id, def) || def).trim();
    return ASTRO_TYPEN.includes(typ) ? typ : def;
}

function leseAstroOffset(nr) {
    const id = nr === 1 ? DP.zsZeit1AstroOffset : DP.zsZeit2AstroOffset;
    const n = parseInt(getVal(id, 0), 10);
    return isNaN(n) ? 0 : Math.max(-180, Math.min(180, n));
}

function parseKoordinate(wert) {
    if (wert === null || wert === undefined || wert === '') return NaN;
    return parseFloat(String(wert).replace(',', '.'));
}

function leseAstroKoordinaten() {
    const inst = typeof instance !== 'undefined' ? instance : 0;
    const kandidaten = [];

    try {
        const jsa = getObject(`system.adapter.javascript.${inst}`);
        if (jsa?.native) {
            kandidaten.push({
                lat: parseKoordinate(jsa.native.latitude),
                lon: parseKoordinate(jsa.native.longitude),
                quelle: `JavaScript.${inst}`,
            });
        }
    } catch (e) {
        /* ignore */
    }

    try {
        const sysc = getObject('system.config');
        if (sysc?.common) {
            kandidaten.push({
                lat: parseKoordinate(sysc.common.latitude),
                lon: parseKoordinate(sysc.common.longitude),
                quelle: 'Systemeinstellungen',
            });
        }
    } catch (e) {
        /* ignore */
    }

    for (const k of kandidaten) {
        if (!isNaN(k.lat) && !isNaN(k.lon)) {
            return k;
        }
    }
    return null;
}

function leseAstroKoordinatenInfo() {
    const k = leseAstroKoordinaten();
    if (k) return `${k.lat}°, ${k.lon}° (${k.quelle})`;
    return 'Koordinaten fehlen – JavaScript-Adapter oder System → Breiten-/Längengrad';
}

function istGueltigesAstroDatum(d) {
    return d instanceof Date && !isNaN(d.getTime());
}

function wendeAstroOffsetAn(datum, offsetMin) {
    const d = new Date(datum);
    if (offsetMin) d.setMinutes(d.getMinutes() + offsetMin);
    return d;
}

function berechneAstroZeitInline(typ, tag, offset) {
    const koord = leseAstroKoordinaten();
    if (!koord) return null;
    try {
        const datum = new Date(tag);
        datum.setHours(12, 0, 0, 0);
        const times = INLINE_SUNCALC.getTimes(datum, koord.lat, koord.lon);
        const basis = times[typ];
        if (!istGueltigesAstroDatum(basis)) {
            logWarn(`Astro "${typ}" nicht verfügbar am ${datum.toLocaleDateString('de-DE')}`);
            return null;
        }
        return wendeAstroOffsetAn(basis, offset);
    } catch (e) {
        logWarn(`Inline-Astro ${typ}: ${e}`);
        return null;
    }
}

function berechneAstroZeitMitGetAstroDate(typ, tag, offset) {
    if (typeof getAstroDate !== 'function') return null;
    const datum = new Date(tag);
    datum.setHours(12, 0, 0, 0);
    const versuche = [
        [() => getAstroDate(typ, datum, offset), false],
        [() => getAstroDate({ astro: typ, date: datum, shift: offset }), false],
        [() => getAstroDate(typ, datum), true],
        [() => getAstroDate({ astro: typ, date: datum }), true],
    ];
    for (const [fn, manuellOffset] of versuche) {
        try {
            const d = fn();
            if (!istGueltigesAstroDatum(d)) continue;
            return manuellOffset ? wendeAstroOffsetAn(d, offset) : d;
        } catch (e) {
            /* nächster Versuch */
        }
    }
    return null;
}

function berechneAstroZeitMitSuncalc(typ, tag, offset) {
    const koord = leseAstroKoordinaten();
    if (!koord) return null;
    let SunCalc;
    try {
        SunCalc = require('suncalc');
    } catch (e) {
        return null;
    }
    try {
        const datum = new Date(tag);
        datum.setHours(12, 0, 0, 0);
        const times = SunCalc.getTimes(datum, koord.lat, koord.lon);
        const basis = times[typ];
        if (!istGueltigesAstroDatum(basis)) return null;
        return wendeAstroOffsetAn(basis, offset);
    } catch (e) {
        return null;
    }
}

function berechneAstroZeit(nr, basisDatum) {
    const typ = leseAstroTyp(nr);
    const offset = leseAstroOffset(nr);
    const tag = new Date(basisDatum);

    let d = berechneAstroZeitInline(typ, tag, offset);
    if (istGueltigesAstroDatum(d)) return d;

    d = berechneAstroZeitMitGetAstroDate(typ, tag, offset);
    if (istGueltigesAstroDatum(d)) return d;

    d = berechneAstroZeitMitSuncalc(typ, tag, offset);
    if (istGueltigesAstroDatum(d)) return d;

    logWarn(`Astro Schaltzeit ${nr}: ${typ}, Offset ${offset} – keine Berechnung möglich`);
    return null;
}

function leseSchaltzeitFuerTag(nr, basisDatum) {
    const tag = new Date(basisDatum);
    tag.setHours(0, 0, 0, 0);

    if (istSchaltzeitAstro(nr)) {
        const astroDate = berechneAstroZeit(nr, tag);
        if (astroDate) {
            return {
                nr,
                h: astroDate.getHours(),
                min: astroDate.getMinutes(),
                ms: astroDate.getTime(),
                astro: true,
            };
        }
        logWarn(`Astro Schaltzeit ${nr} fehlt (${leseAstroKoordinatenInfo()}) – Fallback fest`);
    }

    const fest = leseSchaltzeitFest(nr);
    const d = datumMitZeit(tag, fest.h, fest.min);
    return { nr, h: fest.h, min: fest.min, ms: d.getTime(), astro: false };
}

function formatSchaltzeitAnzeige(nr, basisDatum) {
    if (!istSchaltzeitAktiv(nr)) return '– (aus)';
    const pad = (n) => String(n).padStart(2, '0');
    if (istSchaltzeitAstro(nr)) {
        const offset = leseAstroOffset(nr);
        const typ = leseAstroTyp(nr);
        const typName = ASTRO_TYP_STATES[typ] || typ;
        const offStr = offset > 0 ? `+${offset}` : String(offset);
        const astroDate = berechneAstroZeit(nr, basisDatum);
        if (!astroDate) {
            const typName = ASTRO_TYP_STATES[leseAstroTyp(nr)] || leseAstroTyp(nr);
            return `Fehler: ${typName} (${leseAstroKoordinatenInfo()})`;
        }
        const zeit = `${pad(astroDate.getHours())}:${pad(astroDate.getMinutes())}`;
        return `${zeit} – ${typName}, Offset ${offStr} min`;
    }
    const z = leseSchaltzeitFuerTag(nr, basisDatum);
    return `${pad(z.h)}:${pad(z.min)} (fest)`;
}

function aktualisiereSchaltzeitAnzeigen() {
    const heute = new Date();
    setIntern(DP.zsZeit1Anzeige, formatSchaltzeitAnzeige(1, heute));
    setIntern(DP.zsZeit2Anzeige, formatSchaltzeitAnzeige(2, heute));
}

function istWochentagAktiv(dayIndex) {
    const tag = ZS_WOCHENTAG.find((t) => t.dow === dayIndex);
    if (!tag) return false;
    const def = dayIndex >= 1 && dayIndex <= 5;
    return alsBool(getVal(DP[tag.idKey], def), def);
}

function istSchaltzeitAktiv(nr) {
    const id = nr === 1 ? DP.zsZeit1Aktiv : DP.zsZeit2Aktiv;
    if (!existsState(id)) return true;
    const s = getState(id);
    if (!s || s.val === null || s.val === undefined) return true;
    return alsBool(s.val, true);
}

function leseAktiveSchaltzeitenFuerTag(basisDatum) {
    const liste = [];
    if (istSchaltzeitAktiv(1)) liste.push(leseSchaltzeitFuerTag(1, basisDatum));
    if (istSchaltzeitAktiv(2)) liste.push(leseSchaltzeitFuerTag(2, basisDatum));
    liste.sort((a, b) => a.ms - b.ms);
    return liste;
}

function hatAktiveSchaltzeit() {
    return istSchaltzeitAktiv(1) || istSchaltzeitAktiv(2);
}

function hatAktivenBewaesserungstag() {
    return ZS_WOCHENTAG.some((t) => istWochentagAktiv(t.dow));
}

function datumMitZeit(basis, h, min) {
    const d = new Date(basis);
    d.setHours(h, min, 0, 0);
    return d;
}

function berechneNaechsteSchaltzeit(abMs) {
    if (!istZeitsteuerungAktiv() || !hatAktivenBewaesserungstag() || !hatAktiveSchaltzeit()) return null;

    const start = new Date(abMs || Date.now());

    for (let offset = 0; offset < 14; offset++) {
        const tag = new Date(start);
        tag.setDate(tag.getDate() + offset);
        if (!istWochentagAktiv(tag.getDay())) continue;

        for (const z of leseAktiveSchaltzeitenFuerTag(tag)) {
            if (z.ms > start.getTime()) {
                return { zeit: new Date(z.ms), nr: z.nr, astro: !!z.astro };
            }
        }
    }
    return null;
}

function berechneNaechsteBewaesserung(abMs) {
    const naechste = berechneNaechsteSchaltzeit(abMs);
    return naechste ? naechste.zeit : null;
}

function formatNaechsteBewaesserung(d) {
    const pad = (n) => String(n).padStart(2, '0');
    const zeit = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const datum = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
    return `Nächste Bewässerung ${zeit} ${datum}`;
}

function aktualisiereStatusNaechsteBewaesserung() {
    if (!istZeitsteuerungAktiv()) {
        setIntern(DP.status, 'Zeitsteuerung aus');
        setIntern(DP.zeitmodus, 0);
        return;
    }
    if (!hatAktivenBewaesserungstag()) {
        setIntern(DP.status, 'Kein Bewässerungstag gewählt');
        setIntern(DP.zeitmodus, 0);
        return;
    }
    if (!hatAktiveSchaltzeit()) {
        setIntern(DP.status, 'Keine Schaltzeit aktiv');
        setIntern(DP.zeitmodus, 0);
        return;
    }
    const naechste = berechneNaechsteSchaltzeit(Date.now());
    if (!naechste) {
        setIntern(DP.status, 'Keine Schaltzeit geplant');
        setIntern(DP.zeitmodus, 0);
        return;
    }
    setIntern(DP.status, formatNaechsteBewaesserung(naechste.zeit));
    setIntern(DP.zeitmodus, naechste.astro ? 1 : 0);
}


// ─── ZEITSCHALTUHR ───────────────────────────────────────────────────────────
// Prüfung jede Minute (Scheduler). Auslösung nur wenn RegelAktiv/Schleife.Aktiv = true.

function pruefeZeitschaltuhr() {
    aktualisiereSchaltzeitAnzeigen();
    aktualisiereStatusNaechsteBewaesserung();
    if (!istZeitsteuerungAktiv()) return;

    const now = new Date();
    if (!istWochentagAktiv(now.getDay())) return;

    let slot = null;
    let nrTreffer = 0;
    if (istSchaltzeitAktiv(1)) {
        const z1 = leseSchaltzeitFuerTag(1, now);
        if (now.getHours() === z1.h && now.getMinutes() === z1.min) {
            slot = 'S1';
            nrTreffer = 1;
        }
    }
    if (!slot && istSchaltzeitAktiv(2)) {
        const z2 = leseSchaltzeitFuerTag(2, now);
        if (now.getHours() === z2.h && now.getMinutes() === z2.min) {
            slot = 'S2';
            nrTreffer = 2;
        }
    }
    if (!slot) return;

    const pad = (n) => String(n).padStart(2, '0');
    const merker = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}:${pad(now.getMinutes())}-${slot}`;
    if (merker === zeitschaltuhrZuletzt) return;
    zeitschaltuhrZuletzt = merker;

    markiereZeitschaltuhrAusgeloest(nrTreffer);

    if (istSchleifenModusEin()) {
        if (startSchleife('Zeitschaltuhr')) {
            logInfo(`Zeitschaltuhr ${slot} → SchleifenSteuerung gestartet`);
        } else if (!istSchleifeLaeuft()) {
            logWarn(`Zeitschaltuhr ${slot}: Schleife nicht gestartet (kein Ventil frei oder Konfiguration)`);
        } else {
            logInfo(`Zeitschaltuhr ${slot}: Schleife läuft bereits`);
        }
        return;
    }

    let einzelZeitGestartet = false;
    for (const v of VENTILE) {
        if (!istVentilFrei(v) || istVentilPausiert(v) || istVentilAktiv(v)) continue;
        setzeVentil(v, true, 'Zeitschaltuhr');
        logInfo(`Zeitschaltuhr ${slot} → Ventil ${v.nr} EIN`);
        einzelZeitGestartet = true;
    }
    if (einzelZeitGestartet) sendeBewaesserungStartNachricht('Zeitschaltuhr', 'Einzel');
}


// ─── SCHLEIFEN-STEUERUNG ─────────────────────────────────────────────────────
// Ventile nacheinander; Start über Zeitschaltuhr oder ManuellStart.
// Voraussetzung pro Ventil: Konfig.Aktiviert=true, SchwelleSperre=false.

function leseSchleifeVentilDp(nr) {
    return DP[`schleifeVentil${nr}`];
}

function findeVentilZuNr(nr) {
    for (let i = 0; i < VENTILE.length; i++) {
        if (VENTILE[i].nr === nr) return VENTILE[i];
    }
    return null;
}

function setzeVentilAktiviertParallel(v, wert) {
    const an = alsBool(wert, false);
    if (ventilAktiviertSyncGuard) return an;
    ventilAktiviertSyncGuard = true;
    try {
        const schleifeId = leseSchleifeVentilDp(v.nr);
        if (existsState(v.dp.aktiviert) && alsBool(getVal(v.dp.aktiviert, true), true) !== an) {
            setIntern(v.dp.aktiviert, an);
        }
        if (schleifeId && existsState(schleifeId) && alsBool(getVal(schleifeId, true), true) !== an) {
            setIntern(schleifeId, an);
        }
    } finally {
        ventilAktiviertSyncGuard = false;
    }
    return an;
}

function behandleVentilAktiviertWechsel(v, an, quelle) {
    if (!an) {
        const warSchleifeAktuell = istSchleifeLaeuft() && leseSchleifeAktuellesVentilNr() === v.nr;
        sperreSteuerungWennDeaktiviert(v);
        if (warSchleifeAktuell) {
            logInfo(`Schleife: Ventil ${v.nr} deaktiviert (${quelle}) → überspringen`);
            plankeNaechstesSchleifenVentil('Aktiviert=false');
        }
    }
}

function syncAlleVentilAktiviertParallel() {
    for (const v of VENTILE) {
        const schleifeId = leseSchleifeVentilDp(v.nr);
        let ziel = true;
        if (existsState(schleifeId)) {
            ziel = alsBool(getVal(schleifeId, true), true);
        } else if (existsState(v.dp.aktiviert)) {
            ziel = alsBool(getVal(v.dp.aktiviert, true), true);
        }
        setzeVentilAktiviertParallel(v, ziel);
    }
    logInfo('Ventil Aktiviert: SchleifenSteuerung.Ventil1-4 ↔ Konfig.Aktiviert synchronisiert');
}

function setzeSchleifenUndVentileStartwerte() {
    if (existsState(DP.schleifeAktiv)) setIntern(DP.schleifeAktiv, false);
    if (existsState(DP.schleifeLaeuft)) setIntern(DP.schleifeLaeuft, false);
    if (existsState(DP.schleifeAktuellesVentil)) setIntern(DP.schleifeAktuellesVentil, 0);
    if (existsState(DP.schleifeStatus)) setIntern(DP.schleifeStatus, 'Bereit');
    if (existsState(DP.schleifeManuellStart)) setIntern(DP.schleifeManuellStart, tasterRuhewert(DP.schleifeManuellStart));
    if (existsState(DP.schleifeManuellStopp)) setIntern(DP.schleifeManuellStopp, tasterRuhewert(DP.schleifeManuellStopp));
    if (existsState(DP.schleifePauseEin)) setIntern(DP.schleifePauseEin, tasterRuhewert(DP.schleifePauseEin));
    if (existsState(DP.schleifePauseAus)) setIntern(DP.schleifePauseAus, tasterRuhewert(DP.schleifePauseAus));
    for (const v of VENTILE) {
        if (existsState(v.dp.schwelleSperre)) setIntern(v.dp.schwelleSperre, false);
        if (existsState(v.dp.ausAn)) setIntern(v.dp.ausAn, false);
        if (existsState(v.dp.pause)) setIntern(v.dp.pause, false);
    }
    schleifeLauf.aktiv = false;
    schleifeLauf.stopAngefordert = false;
    schleifeLauf.manuellGestartet = false;
    schleifeLauf.queue = [];
    schleifeLauf.index = 0;
    schleifeLauf.ignoriert = new Set();
    schleifeLauf.ausAnEin = new Set();
    schleifeLauf.manuellPauseSync = false;
    schleifeLauf.manuellPausiertNr = 0;
    schleifeLauf.startGrund = '';
    if (schleifeLauf.pauseTimer) {
        clearTimeout(schleifeLauf.pauseTimer);
        schleifeLauf.pauseTimer = null;
    }
    logInfo('Startzustand: SchleifenSteuerung Aus, Laeuft=Nein, Ventile AusAn/Pause/SchwelleSperre=false');
    aktualisiereSchleifenModusHinweis();
}

function istSchleifenModusEin() {
    return alsBool(getVal(DP.schleifeAktiv, false), false);
}

function istSchleifeLaeuft() {
    return schleifeLauf.aktiv === true;
}

function leseSchleifeAktuellesVentilNr() {
    return parseInt(getVal(DP.schleifeAktuellesVentil, 0), 10) || 0;
}

function istVentilInSchleifeAktiv(nr) {
    const key = `schleifeVentil${nr}`;
    return alsBool(getVal(DP[key], true), true);
}

function istVentilSchwelleGesperrt(v) {
    return istSchwelleSperreAktiv(v);
}

function leseWiederholungenAktuelDp(v) {
    return parseInt(getVal(v.dp.wiederholungenAktuel, 0), 10) || 0;
}

function istVentilSchleifeErledigt(v) {
    return (
        schleifeLauf.ignoriert &&
        schleifeLauf.ignoriert.has(v.nr) &&
        leseWiederholungenAktuelDp(v) === 0 &&
        istZustandBereit(v)
    );
}

function schleifeVorbereiteManuellStart() {
    for (const v of leseSchleifenVentilListe()) {
        if (!istVentilFrei(v)) continue;
        startWiederholungenLauf(v);
        setIntern(v.dp.zustand, ZUSTAND.BEREIT);
        setIntern(v.dp.pause, false);
        schleifeLauf.ignoriert.delete(v.nr);
    }
}

function schleifeUeberspringGrund(v) {
    if (!istVentilInSchleifeAktiv(v.nr)) return 'nicht in Schleife';
    if (!istVentilFrei(v)) return 'Aktiviert=false';
    if (istVentilSchwelleGesperrt(v)) return 'SchwelleSperre=true';
    if (istVentilSchleifeErledigt(v)) return 'WiederholungenAktuel=0 und Zustand=Bereit';
    return '';
}

function schleifeAlleVentileErledigt() {
    const liste = leseSchleifenVentilListe();
    if (!liste.length) return true;
    return liste.every((v) => {
        if (!istVentilFrei(v) || istVentilSchwelleGesperrt(v)) return true;
        return istVentilSchleifeErledigt(v);
    });
}

function schleifeStoppBedingungErfuellt() {
    return schleifeAlleVentileErledigt();
}

function istSchleifeWechselBereit(v) {
    return (
        istVentilPausiert(v) &&
        istZustandPause(v) &&
        !istVentilAktiv(v)
    );
}

function istVentilFuerSchleifeErlaubt(v) {
    return schleifeUeberspringGrund(v) === '';
}

function leseSchleifenVentilListe() {
    const liste = [];
    for (const v of VENTILE) {
        if (!istVentilInSchleifeAktiv(v.nr)) continue;
        liste.push(v);
    }
    return liste;
}

function hatSchleifeErlaubtesVentil() {
    return leseSchleifenVentilListe().some((v) => istVentilFuerSchleifeErlaubt(v));
}

function setSchleifeAnzeige(status, laeuft, aktuellesVentil) {
    if (status !== undefined) setIntern(DP.schleifeStatus, status);
    if (laeuft !== undefined) setIntern(DP.schleifeLaeuft, laeuft);
    if (aktuellesVentil !== undefined) setIntern(DP.schleifeAktuellesVentil, aktuellesVentil);
}

function schleifeStarteAktuellesVentil() {
    if (!schleifeLauf.aktiv || schleifeLauf.stopAngefordert) return;

    while (schleifeLauf.index < schleifeLauf.queue.length) {
        const kandidat = schleifeLauf.queue[schleifeLauf.index];
        const skipGrund = schleifeUeberspringGrund(kandidat);
        if (!skipGrund) break;
        logInfo(`Schleife: Ventil ${kandidat.nr} übersprungen (${skipGrund})`);
        schleifeLauf.index += 1;
    }

    if (schleifeLauf.index >= schleifeLauf.queue.length) {
        stopSchleife('alle Ventile der Schleife übersprungen');
        return;
    }

    const v = schleifeLauf.queue[schleifeLauf.index];
    if (!v) {
        stopSchleife('kein Ventil in Queue');
        return;
    }

    const skipGrund = schleifeUeberspringGrund(v);
    if (skipGrund) {
        logInfo(`Schleife: Ventil ${v.nr} übersprungen (${skipGrund})`);
        plankeNaechstesSchleifenVentil('übersprungen');
        return;
    }

    setSchleifeAnzeige(`Ventil ${v.nr} läuft`, true, v.nr);

    const ersterSchleifenDurchlauf = schleifeDarfAusAnEinschalten(v);
    if (ersterSchleifenDurchlauf) {
        setVentilAusAnSchalter(v, true, true);
        logInfo(`Schleife: Ventil ${v.nr} Ventil${v.nr}_AusAn=true (nur erster Schleifen-Durchlauf)`);
    } else if (schleifeLauf.ausAnEin.has(v.nr)) {
        logInfo(`Schleife: Ventil ${v.nr} erneuter Durchlauf – Ventil${v.nr}_AusAn wird nicht erneut gesetzt`);
    }

    if (alsBool(getVal(v.dp.pause, false), false)) {
        setIntern(v.dp.pause, false);
    }
    if (istVentilAktiv(v)) {
        logInfo(`Schleife: Ventil ${v.nr} läuft bereits (eigene Logik)`);
        return;
    }
    if (!ersterSchleifenDurchlauf && fortsetzenNachPause(v)) {
        logInfo(`Schleife: Ventil ${v.nr} fortgesetzt (eigene Logik, AusAn unverändert)`);
        return;
    }
    setzeVentil(v, true, 'SchleifenSteuerung');
}

function behandleSchleifeNachVentilZyklus(v) {
    if (!istSchleifeLaeuft() || schleifeLauf.stopAngefordert) return;
    if (leseSchleifeAktuellesVentilNr() !== v.nr) return;
    if (!istSchleifeWechselBereit(v)) {
        logWarn(`Schleife: Ventil ${v.nr} – Wechsel nicht bereit (Pause/Zustand)`);
        return;
    }

    const wieder = leseWiederholungenAktuelDp(v);

    if (wieder <= 0) {
        setIntern(v.dp.pause, false);
        setIntern(v.dp.zustand, ZUSTAND.BEREIT);
        schleifeLauf.ignoriert.add(v.nr);
        setVentilAusAnSchalter(v, false, true);
        logInfo(`Schleife: Ventil ${v.nr} erledigt (WiederholungenAktuel=0, Zustand=Bereit)`);
    } else {
        logInfo(`Schleife: Ventil ${v.nr} Pause nach Zyklus (${wieder} übrig) → nächstes Ventil`);
    }

    if (schleifeStoppBedingungErfuellt()) {
        stopSchleife('alle Ventile WiederholungenAktuel=0 und Zustand=Bereit');
        return;
    }

    plankeNaechstesSchleifenVentil(`Ventil ${v.nr}`);
}

function plankeNaechstesSchleifenVentil(grund) {
    if (!schleifeLauf.aktiv || schleifeLauf.stopAngefordert) return;

    if (schleifeStoppBedingungErfuellt()) {
        stopSchleife('alle Ventile WiederholungenAktuel=0 und Zustand=Bereit');
        return;
    }

    schleifeLauf.index += 1;

    while (schleifeLauf.index < schleifeLauf.queue.length) {
        const kandidat = schleifeLauf.queue[schleifeLauf.index];
        const skipGrund = schleifeUeberspringGrund(kandidat);
        if (!skipGrund) break;
        logInfo(`Schleife: Ventil ${kandidat.nr} übersprungen (${skipGrund})`);
        schleifeLauf.index += 1;
    }

    if (schleifeLauf.index >= schleifeLauf.queue.length) {
        const nochOffen = schleifeLauf.queue.some((k) => !schleifeUeberspringGrund(k));
        if (nochOffen) {
            schleifeLauf.index = 0;
            logInfo('Schleife: neue Runde');
            while (schleifeLauf.index < schleifeLauf.queue.length) {
                const kandidat = schleifeLauf.queue[schleifeLauf.index];
                const skipGrund = schleifeUeberspringGrund(kandidat);
                if (!skipGrund) break;
                logInfo(`Schleife: Ventil ${kandidat.nr} übersprungen (${skipGrund})`);
                schleifeLauf.index += 1;
            }
        }
        if (schleifeLauf.index >= schleifeLauf.queue.length) {
            stopSchleife('alle Ventile der Schleife durch');
            return;
        }
    }

    const pauseSek = Math.max(0, parseInt(getVal(DP.schleifePauseZwischenSek, 5), 10) || 0);
    const naechstes = schleifeLauf.queue[schleifeLauf.index];
    setSchleifeAnzeige(`Pause ${pauseSek} s → Ventil ${naechstes.nr} (${grund})`, true, 0);
    if (schleifeLauf.pauseTimer) clearTimeout(schleifeLauf.pauseTimer);
    schleifeLauf.pauseTimer = setTimeout(() => {
        schleifeLauf.pauseTimer = null;
        schleifeStarteAktuellesVentil();
    }, pauseSek * 1000);
}

function schleifeNeueRundeOderBeenden(grund) {
    stopSchleife(grund);
}

function stopSchleife(grund) {
    const warAktiv = schleifeLauf.aktiv === true;
    const startGrund = schleifeLauf.startGrund || (schleifeLauf.manuellGestartet ? 'ManuellStart' : 'Zeitschaltuhr');
    if (schleifeLauf.pauseTimer) {
        clearTimeout(schleifeLauf.pauseTimer);
        schleifeLauf.pauseTimer = null;
    }
    schleifeLauf.aktiv = false;
    schleifeLauf.stopAngefordert = false;
    schleifeLauf.manuellGestartet = false;
    schleifeLauf.queue = [];
    schleifeLauf.index = 0;
    schleifeLauf.ignoriert = new Set();
    schleifeLauf.ausAnEin = new Set();
    schleifeLauf.startGrund = '';
    const status = grund === 'ManuellStopp' ? 'Gestoppt' : `Beendet (${grund})`;
    setSchleifeAnzeige(status, false, 0);
    setIntern(DP.schleifeManuellStart, tasterRuhewert(DP.schleifeManuellStart));
    setIntern(DP.schleifeManuellStopp, tasterRuhewert(DP.schleifeManuellStopp));
    setIntern(DP.schleifePauseEin, tasterRuhewert(DP.schleifePauseEin));
    setIntern(DP.schleifePauseAus, tasterRuhewert(DP.schleifePauseAus));
    schleifeLauf.manuellPausiertNr = 0;
    logInfo(`Schleife beendet: ${grund}`);
    if (warAktiv) {
        const endGrund = grund === 'ManuellStopp' ? 'ManuellStopp' : startGrund;
        sendeBewaesserungEndeNachricht(endGrund, 'Schleife');
    }
}

function stopSchleifeMitVentilen(grund) {
    schleifeLauf.stopAngefordert = true;
    for (const v of VENTILE) {
        if (istVentilAktiv(v)) ventilBeenden(v, `Schleife ${grund}`);
    }
    stopSchleife(grund);
}

function startSchleife(grund) {
    if (schleifeLauf.aktiv) {
        logInfo(`Schleife: Start (${grund}) übersprungen – läuft bereits`);
        return false;
    }

    if (grund === 'ManuellStart') {
        if (istSchleifenModusEin()) {
            logInfo('Schleife: ManuellStart übersprungen – SchleifenSteuerung.Aktiv=Automatik (auf Manuall stellen)');
            return false;
        }
    } else if (!istSchleifenModusEin()) {
        logInfo(`Schleife: Start (${grund}) übersprungen – SchleifenSteuerung.Aktiv aus (nur ManuellStart)`);
        return false;
    }

    schleifeLauf.manuellGestartet = grund === 'ManuellStart';

    if (grund === 'ManuellStart') {
        schleifeVorbereiteManuellStart();
    }

    const liste = leseSchleifenVentilListe();
    if (!liste.length) {
        logWarn('Schleife: SchleifenSteuerung.Ventil1-4 alle aus');
        setSchleifeAnzeige('Kein Ventil in Schleife konfiguriert', false, 0);
        return false;
    }
    if (!hatSchleifeErlaubtesVentil()) {
        schleifeLauf.manuellGestartet = false;
        logWarn('Schleife: kein Ventil freigegeben (Aktiviert=true, SchwelleSperre=false nötig)');
        setSchleifeAnzeige('Kein Ventil frei in Schleife', false, 0);
        return false;
    }

    const zeitCheck = aktualisiereSchleifenGesamtzeitUeberwachung({ nachrichtErzwingen: true });
    if (zeitCheck.fehler) {
        logWarn(`Schleife: Start (${grund}) trotz Gesamtzeit-Fehler (${formatSchleifenDauerKurz(zeitCheck.berechnung.gesamtSek)})`);
    }

    schleifeLauf.aktiv = true;
    schleifeLauf.stopAngefordert = false;
    schleifeLauf.queue = liste;
    schleifeLauf.index = 0;
    schleifeLauf.ignoriert = new Set();
    schleifeLauf.ausAnEin = new Set();
    schleifeLauf.startGrund = grund;
    setSchleifeAnzeige(`Start (${grund})`, true, 0);
    logInfo(`Schleife gestartet (${grund}) – Ventile: ${liste.map((x) => x.nr).join(', ')}`);
    sendeBewaesserungStartNachricht(grund, 'Schleife');
    schleifeStarteAktuellesVentil();
    return true;
}

function ventilByNr(nr) {
    return VENTILE.find((v) => v.nr === nr) || null;
}

function schleifeAktivesVentil() {
    const nr = leseSchleifeAktuellesVentilNr();
    if (nr > 0) {
        const v = ventilByNr(nr);
        if (v) return v;
    }
    for (const v of VENTILE) {
        if (istVentilAktiv(v)) return v;
    }
    for (const v of VENTILE) {
        if (leseVentilAusAnSchalter(v) && (istVentilPausiert(v) || istZustandPause(v))) return v;
    }
    return null;
}

function schleifePauseAusschalten(v) {
    setIntern(v.dp.pause, false);
    if (fortsetzenNachPause(v)) {
        schleifeLauf.manuellPausiertNr = 0;
        return true;
    }
    if (istVentilAktiv(v)) {
        ventilPauseDeaktivieren(v);
        schleifeLauf.manuellPausiertNr = 0;
        return true;
    }
    if (
        leseVentilAusAnSchalter(v) &&
        schleifeLauf.manuellPausiertNr === v.nr &&
        istSchleifeLaeuft()
    ) {
        setIntern(v.dp.zustand, ZUSTAND.BEREIT);
        setzeVentil(v, true, 'SchleifenSteuerung');
        schleifeLauf.manuellPausiertNr = 0;
        logInfo(`Schleife PauseAus → Ventil ${v.nr} fortgesetzt (SchleifenSteuerung)`);
        return true;
    }
    setIntern(v.dp.zustand, ZUSTAND.BEREIT);
    schleifeLauf.manuellPausiertNr = 0;
    return true;
}

function schleifePauseAnwenden(pause) {
    const v = schleifeAktivesVentil();
    if (!v) return false;
    if (!istVentilFrei(v)) {
        logWarn(`Schleife Pause: Ventil ${v.nr} deaktiviert (Aktiviert=false)`);
        return false;
    }

    schleifeLauf.manuellPauseSync = true;
    setIntern(v.dp.pause, !!pause);
    if (pause) {
        schleifeLauf.manuellPausiertNr = v.nr;
        if (istVentilAktiv(v)) ventilPauseAktivieren(v);
        else setIntern(v.dp.zustand, ZUSTAND.PAUSE);
        if (istSchleifeLaeuft()) {
            setSchleifeAnzeige(`Ventil ${v.nr} pausiert (PauseEin)`, true, v.nr);
        }
        logInfo(`Schleife PauseEin → Ventil ${v.nr}.Steuerung.Pause=true`);
    } else {
        schleifePauseAusschalten(v);
        if (istSchleifeLaeuft()) {
            setSchleifeAnzeige(`Ventil ${v.nr} läuft`, true, v.nr);
        }
        logInfo(`Schleife PauseAus → Ventil ${v.nr}.Steuerung.Pause=false`);
    }
    schleifeLauf.manuellPauseSync = false;
    return true;
}

function schleifeSetzeAlleVentileZurueck(grund) {
    schleifeLauf.stopAngefordert = true;
    for (const v of VENTILE) {
        if (istVentilAktiv(v)) ventilBeenden(v, grund);
        setIntern(v.dp.pause, false);
        setIntern(v.dp.zustand, ZUSTAND.BEREIT);
        if (leseVentilAusAnSchalter(v)) {
            if (existsState(v.dp.ausAn)) setState(v.dp.ausAn, false, true);
            if (v.nr === 1 && existsState(V1_MANUELL_ALT)) setState(V1_MANUELL_ALT, false, true);
            logInfo(`Schleife ${grund}: Ventil ${v.nr} Ventil${v.nr}_AusAn → Aus`);
        }
        aktualisiereRestzeitAnzeige(v);
    }
    schleifeLauf.ausAnEin = new Set();
    schleifeLauf.stopAngefordert = false;
}

function behandleAutomatikAus(grund) {
    if (istSchleifeLaeuft() && !schleifeLauf.manuellGestartet) {
        stopSchleifeMitVentilen(grund);
        schleifeSetzeAlleVentileZurueck(grund);
    } else if (istSchleifeLaeuft()) {
        logInfo(`${grund}: manuell gestartete Schleife läuft weiter`);
    } else {
        stopSchleife(grund);
        schleifeSetzeAlleVentileZurueck(grund);
    }
}

function migriereSchleifeAktivLabels() {
    if (!existsState(DP.schleifeAktiv)) return;
    const obj = typeof getObject === 'function' ? getObject(DP.schleifeAktiv) : null;
    const labelFalse = obj?.common?.states?.false;
    const labelTrue = obj?.common?.states?.true;
    if (labelFalse === 'Manuall' && labelTrue === 'Automatik') return;
    const wert = alsBool(getVal(DP.schleifeAktiv, false), false);
    const def = SCHLEIFE_STATES_LIST.find((s) => s.id === DP.schleifeAktiv);
    if (!def) return;
    try {
        deleteState(DP.schleifeAktiv);
    } catch (e) {
        logWarn(`deleteState ${DP.schleifeAktiv}: ${e}`);
        return;
    }
    createStateBw(DP.schleifeAktiv, wert, def.common);
    logInfo('SchleifenSteuerung.Aktiv: Anzeige Manuall / Automatik');
}

function aktualisiereSchleifenModusHinweis() {
    const ein = istSchleifenModusEin();
    const text = ein ? 'Automatik → Zeitschaltuhr' : 'Manuall → ManuellStart';
    if (existsState(DP.schleifePauseZwischenHinweis)) {
        setIntern(DP.schleifePauseZwischenHinweis, text);
    }
}

function leseSchleifenGesamtzeitMaxSek() {
    const maxMin = Math.max(1, parseInt(getVal(DP.schleifeGesamtzeitMaxMin, 5), 10) || 5);
    return maxMin * 60;
}

function formatSchleifenDauerKurz(sek) {
    const s = Math.max(0, parseInt(sek, 10) || 0);
    if (s < 60) return `${s} s`;
    const min = Math.floor(s / 60);
    const rest = s % 60;
    return rest > 0 ? `${min} min ${rest} s` : `${min} min`;
}

function berechneSchleifenGesamtzeit() {
    const liste = leseSchleifenVentilListe();
    let bewaesserungSek = 0;
    let zyklen = 0;

    for (let i = 0; i < liste.length; i++) {
        const v = liste[i];
        const w = leseWiederholungen(v);
        bewaesserungSek += leseBewaesserungsdauerMin(v) * 60 * w;
        zyklen += w;
    }

    const pauseZwischenSek = Math.max(0, parseInt(getVal(DP.schleifePauseZwischenSek, 5), 10) || 0);
    const pauseSek = zyklen > 1 ? pauseZwischenSek * (zyklen - 1) : 0;
    const brunnenProZyklus = Math.max(0, parseInt(getVal(DP.schleifeBrunnenpumpePauseSek, 30), 10) || 0);
    const brunnenPauseSek = zyklen * brunnenProZyklus;
    const gesamtSek = bewaesserungSek + pauseSek + brunnenPauseSek;

    return {
        gesamtSek,
        bewaesserungSek,
        pauseSek,
        brunnenPauseSek,
        zyklen,
        ventile: liste.map((v) => v.nr),
    };
}

function sendeSchleifenGesamtzeitFehlerNachricht(berechnung) {
    if (!istNachrichtenKanalAktiv()) return;
    const maxSek = leseSchleifenGesamtzeitMaxSek();
    const ventilText = berechnung.ventile.length
        ? berechnung.ventile.map((n) => `V${n}`).join(', ')
        : 'keine';
    const text = [
        'Beregnungswerk – Schleifen-Gesamtzeit zu hoch',
        '',
        `Gesamt: ${formatSchleifenDauerKurz(berechnung.gesamtSek)} (Limit: ${formatSchleifenDauerKurz(maxSek)})`,
        `Bewässerung: ${formatSchleifenDauerKurz(berechnung.bewaesserungSek)}`,
        `Pause zwischen Ventilen: ${formatSchleifenDauerKurz(berechnung.pauseSek)}`,
        `Brunnenpumpe-Pause (geschätzt): ${formatSchleifenDauerKurz(berechnung.brunnenPauseSek)}`,
        `Ventile in Schleife: ${ventilText} (${berechnung.zyklen} Zyklen)`,
    ].join('\n');
    versendeNachrichten(text, false);
    logWarn(`Schleife: Gesamtzeit-Fehler – ${formatSchleifenDauerKurz(berechnung.gesamtSek)} > ${formatSchleifenDauerKurz(maxSek)}`);
}

function aktualisiereSchleifenGesamtzeitUeberwachung(optionen) {
    const opts = typeof optionen === 'object' && optionen !== null ? optionen : {};
    const berechnung = berechneSchleifenGesamtzeit();
    const maxSek = leseSchleifenGesamtzeitMaxSek();
    const fehler = berechnung.gesamtSek > maxSek;
    const anzeige = `${formatSchleifenDauerKurz(berechnung.gesamtSek)} (Limit ${formatSchleifenDauerKurz(maxSek)})`;

    if (existsState(DP.schleifeGesamtzeitSek)) setIntern(DP.schleifeGesamtzeitSek, berechnung.gesamtSek);
    if (existsState(DP.schleifeGesamtzeitAnzeige)) setIntern(DP.schleifeGesamtzeitAnzeige, anzeige);
    if (existsState(DP.schleifeGesamtzeitFehler)) setIntern(DP.schleifeGesamtzeitFehler, fehler);

    const warFehler = schleifeGesamtzeitFehlerVorher;
    schleifeGesamtzeitFehlerVorher = fehler;
    if (fehler && !opts.initial && (!warFehler || opts.nachrichtErzwingen)) {
        sendeSchleifenGesamtzeitFehlerNachricht(berechnung);
    }

    return { fehler, berechnung };
}

function setSchleifenAutomatikIntern(ein, optionen) {
    const opts = typeof optionen === 'object' && optionen !== null ? optionen : {};
    const grund = opts.grund || 'SchleifenSteuerung.Aktiv';
    const beiAus = opts.beiAus !== false;

    if (existsState(DP.schleifeAktiv)) setState(DP.schleifeAktiv, !!ein, true);
    if (existsState(DP.zeitsteuerung)) setState(DP.zeitsteuerung, !!ein, true);
    zeitschaltuhrZuletzt = '';
    if (zeitschaltuhrAusgeloestTimer) {
        clearTimeout(zeitschaltuhrAusgeloestTimer);
        zeitschaltuhrAusgeloestTimer = null;
    }
    setIntern(DP.zsAusgeloest, false);
    aktualisiereStatusNaechsteBewaesserung();

    if (!ein && beiAus) {
        behandleAutomatikAus(`${grund} aus`);
        logInfo('SchleifenSteuerung.Aktiv=0 – Automatik aus, nur ManuellStart');
    } else if (ein) {
        logInfo('SchleifenSteuerung.Aktiv=1 – Schleife nur über Zeitschaltuhr');
    }
    aktualisiereSchleifenModusHinweis();
}

function setZeitsteuerungIntern(ein) {
    setSchleifenAutomatikIntern(ein, { beiAus: true, grund: 'SchleifenSteuerung.Aktiv' });
}

function startSchleifenEvents() {
    on({ id: DP.schleifeAktiv, change: 'any' }, (obj) => {
        if (!istNutzerEingabe(obj)) return;
        const ein = alsBool(obj.state.val, false);
        const vorher = obj.oldState ? alsBool(obj.oldState.val, false) : !ein;
        if (vorher === ein) return;
        if (ein && istWetterAutomatikGesperrt()) {
            setSchleifenAutomatikIntern(false, { beiAus: false, grund: 'Wettersperre' });
            logWarn('SchleifenSteuerung.Aktiv blockiert – Wetterschwelle überschritten');
            return;
        }
        setSchleifenAutomatikIntern(ein, { beiAus: true, grund: 'SchleifenSteuerung.Aktiv' });
    });

    on({ id: DP.schleifeManuellStart, change: 'any' }, (obj) => {
        behandleSchleifenTasterEvent(obj, () => startSchleife('ManuellStart'));
    });

    on({ id: DP.schleifeManuellStopp, change: 'any' }, (obj) => {
        behandleSchleifenTasterEvent(obj, () => {
            if (istSchleifeLaeuft()) stopSchleifeMitVentilen('ManuellStopp');
            schleifeSetzeAlleVentileZurueck('ManuellStopp');
        });
    });

    on({ id: DP.schleifePauseEin, change: 'any' }, (obj) => {
        behandleSchleifenTasterEvent(obj, () => schleifePauseAnwenden(true));
    });

    on({ id: DP.schleifePauseAus, change: 'any' }, (obj) => {
        behandleSchleifenTasterEvent(obj, () => schleifePauseAnwenden(false));
    });

    on({ id: [DP.schleifeVentil1, DP.schleifeVentil2, DP.schleifeVentil3, DP.schleifeVentil4], change: 'any' }, (obj) => {
        if (!istNutzerEingabe(obj) || ventilAktiviertSyncGuard) return;
        const v = findeVentilZuNr(parseInt(String(obj.id || '').replace(/.*Ventil(\d)$/, '$1'), 10));
        if (!v) return;
        const an = alsBool(obj.state.val, false);
        const vorher = obj.oldState ? alsBool(obj.oldState.val, !an) : !an;
        if (vorher === an) return;
        setzeVentilAktiviertParallel(v, an);
        behandleVentilAktiviertWechsel(v, an, 'SchleifenSteuerung');
        aktualisiereSchleifenGesamtzeitUeberwachung();
    });

    on({
        id: [
            DP.schleifePauseZwischenSek,
            DP.schleifeGesamtzeitMaxMin,
            DP.schleifeBrunnenpumpePauseSek,
        ],
        change: 'ne',
    }, () => {
        aktualisiereSchleifenGesamtzeitUeberwachung();
    });

    on({ id: `${DP_BASE}.Ventil*.Konfig.Bewaesserungsdauer`, change: 'ne' }, () => {
        aktualisiereSchleifenGesamtzeitUeberwachung();
    });
    on({ id: `${DP_BASE}.Ventil*.Konfig.Wiederholungen`, change: 'ne' }, () => {
        aktualisiereSchleifenGesamtzeitUeberwachung();
    });

    on({ id: DP.schleifeLaeuft, change: 'ne' }, () => {
        aktualisiereBrunnenpumpePause();
    });
}


// ─── WASSERTANK / BRUNNENPUMPE ───────────────────────────────────────────────
// Dynamische Pfadwahl über Konfig.Tank_*; ManuellPumpe: true=Automatik EIN, false=Reparatur/AUS.
// Bei Pumpenwechsel oder Schleifen-Laeuft-Wechsel: Pause am aktiven Ventil.
// Laeuft=Ja UND Brunnenpumpe an → Pause ein, sonst Pause aus (still, wenn kein Ventil aktiv).

function leseBrunnenpumpeAusgang() {
    return leseTankKonfigPfad(DP.tankBrunnenpumpeKonfig, TANK_DP_PUMPE);
}

function aktualisiereBrunnenpumpePause() {
    if (!istSchleifeLaeuft()) return;
    const v = schleifeAktivesVentil();
    if (!v) return;
    const laeuft = alsBool(getVal(DP.schleifeLaeuft, false), false);
    const pumpePfad = leseBrunnenpumpeAusgang();
    const pumpeAn = (pumpePfad && existsState(pumpePfad))
        ? alsBool(getVal(pumpePfad, false), false)
        : false;
    schleifePauseAnwenden(laeuft && pumpeAn);
}


function tankRundeWert(val) {
    return Math.round(Number(val) || 0);
}

function setzeTankAnzeigeWennGeaendert(id, wert) {
    if (!id || !existsState(id)) return;
    if (getVal(id, null) !== wert) setState(id, wert, true);
}

function behandleTankSensorUnten(pfadUnten, obj) {
    if (pfadUnten === DP.tankAnzUnten) return;
    const wertGerundet = tankRundeWert(obj.state.val);
    if (obj.state.val !== wertGerundet) setState(pfadUnten, wertGerundet);
    setzeTankAnzeigeWennGeaendert(DP.tankAnzUnten, wertGerundet);
    setzeTankAnzeigeWennGeaendert(DP.tankUntenTest, wertGerundet);
    pruefeTankstand();
}

function behandleTankSensorOben(pfadOben, obj) {
    if (pfadOben === DP.tankAnzOben) return;
    const wertGerundet = tankRundeWert(obj.state.val);
    if (obj.state.val !== wertGerundet) setState(pfadOben, wertGerundet);
    setzeTankAnzeigeWennGeaendert(DP.tankAnzOben, wertGerundet);
    setzeTankAnzeigeWennGeaendert(DP.tankObenTest, wertGerundet);
    pruefeTankstand();
}

function behandleTankSensorIstwert(obj) {
    const wertGerundet = tankRundeWert(obj.state.val);
    setzeTankAnzeigeWennGeaendert(DP.tankAnzIstwert, wertGerundet);
    pruefeTankstand();
}

function behandleTankSollAenderung(anzDp, testDp, obj) {
    if (!obj?.state || obj.state.ack !== false) return;
    const wertGerundet = tankRundeWert(obj.state.val);
    setState(anzDp, wertGerundet, true);
    setzeTankAnzeigeWennGeaendert(testDp, wertGerundet);
    pruefeTankstand();
}

function behandleBrunnenpumpeAenderung(obj) {
    const automatikAktiv = alsBool(getVal(DP.tankManuellPumpe, true), true);
    aktualisiereBrunnenpumpePause();
    let status;
    if (alsBool(obj.state.val, false)) {
        status = 'Pumpe läuft';
    } else if (!automatikAktiv) {
        status = 'Reparatur / AUS';
    } else {
        status = 'Pumpe gestoppt / Standby';
    }
    setzeTankAnzeigeWennGeaendert(DP.tankAnzStatus, status);
}

function bereinigeAlleTankKonfigPfade() {
    leseTankKonfigPfad(DP.tankPfadUnten, TANK_DP_ANZEIGE_UNTEN);
    leseTankKonfigPfad(DP.tankPfadOben, TANK_DP_ANZEIGE_OBEN);
    leseTankKonfigPfad(TANK_DP_PFAD_AUSWAHL_ISTWERT, TANK_ISTWERT_SENSOR_DEFAULT);
    leseTankKonfigPfad(DP.tankBrunnenpumpeKonfig, TANK_DP_PUMPE);
}

function logTankPfadHinweis(rolle, pfad) {
    if (!tankPfadHinweisGesendet.has(pfad)) {
        tankPfadHinweisGesendet.add(pfad);
        logInfo(`Tank ${rolle}: Pfad „${pfad}“ wartet auf Anlage – Abo aktiv`);
    }
}

function initialisiereDynamischeTrigger() {
    stelleTankHardwareTestDatenpunkteSicher();
    bereinigeAlleTankKonfigPfade();

    const pfadUnten = leseTankKonfigPfad(DP.tankPfadUnten, TANK_DP_ANZEIGE_UNTEN);
    const pfadOben = leseTankKonfigPfad(DP.tankPfadOben, TANK_DP_ANZEIGE_OBEN);
    const pfadIstwert = leseTankWertAktuelPfad();
    const pfadBrunnenpumpe = leseBrunnenpumpeAusgang();

    const gleichePfade = pfadUnten === tankPfadeCache.unten
        && pfadOben === tankPfadeCache.oben
        && pfadIstwert === tankPfadeCache.istwert
        && pfadBrunnenpumpe === tankPfadeCache.pumpe;
    const abosVollstaendig = (!pfadUnten || pfadUnten === DP.tankAnzUnten || tankTriggerUnten)
        && (!pfadOben || pfadOben === DP.tankAnzOben || tankTriggerOben)
        && (!pfadIstwert || tankTriggerIstwert)
        && (!pfadBrunnenpumpe || tankTriggerBrunnenpumpe);
    if (gleichePfade && abosVollstaendig) return;

    if (tankTriggerUnten) unsubscribe(tankTriggerUnten);
    if (tankTriggerOben) unsubscribe(tankTriggerOben);
    if (tankTriggerIstwert) unsubscribe(tankTriggerIstwert);
    if (tankTriggerBrunnenpumpe) unsubscribe(tankTriggerBrunnenpumpe);
    tankTriggerUnten = null;
    tankTriggerOben = null;
    tankTriggerIstwert = null;
    tankTriggerBrunnenpumpe = null;

    tankPfadeCache = { unten: pfadUnten, oben: pfadOben, istwert: pfadIstwert, pumpe: pfadBrunnenpumpe };
    logInfo(`Dynamische Pfade geladen: Unten = [${pfadUnten}] | Oben = [${pfadOben}] | Istwert = [${pfadIstwert}] | Brunnenpumpe = [${pfadBrunnenpumpe}]`);

    if (pfadUnten) {
        if (pfadUnten === DP.tankAnzUnten) {
            setzeTankAnzeigeWennGeaendert(DP.tankUntenTest, tankRundeWert(getVal(DP.tankAnzUnten, 20)));
        } else {
            tankTriggerUnten = on({ id: pfadUnten, change: 'any' }, (obj) => behandleTankSensorUnten(pfadUnten, obj));
            if (existsState(pfadUnten)) {
                const initUnten = tankRundeWert(getVal(pfadUnten, 0));
                setzeTankAnzeigeWennGeaendert(DP.tankAnzUnten, initUnten);
                setzeTankAnzeigeWennGeaendert(DP.tankUntenTest, initUnten);
            } else {
                logTankPfadHinweis('Unten', pfadUnten);
            }
        }
    }

    if (pfadOben) {
        if (pfadOben === DP.tankAnzOben) {
            setzeTankAnzeigeWennGeaendert(DP.tankObenTest, tankRundeWert(getVal(DP.tankAnzOben, 90)));
        } else {
            tankTriggerOben = on({ id: pfadOben, change: 'any' }, (obj) => behandleTankSensorOben(pfadOben, obj));
            if (existsState(pfadOben)) {
                const initOben = tankRundeWert(getVal(pfadOben, 0));
                setzeTankAnzeigeWennGeaendert(DP.tankAnzOben, initOben);
                setzeTankAnzeigeWennGeaendert(DP.tankObenTest, initOben);
            } else {
                logTankPfadHinweis('Oben', pfadOben);
            }
        }
    }

    if (pfadIstwert) {
        tankTriggerIstwert = on({ id: pfadIstwert, change: 'any' }, behandleTankSensorIstwert);
        if (existsState(pfadIstwert)) {
            setzeTankAnzeigeWennGeaendert(DP.tankAnzIstwert, tankRundeWert(getVal(pfadIstwert, 0)));
        } else {
            logTankPfadHinweis('Istwert', pfadIstwert);
        }
    }

    if (pfadBrunnenpumpe) {
        tankTriggerBrunnenpumpe = on({ id: pfadBrunnenpumpe, change: 'any' }, behandleBrunnenpumpeAenderung);
        if (!existsState(pfadBrunnenpumpe)) {
            logTankPfadHinweis('Brunnenpumpe', pfadBrunnenpumpe);
        }
    }
}

function pruefeTankstand() {
    const pfadIstwert = leseTankWertAktuelPfad();
    const istwert = (pfadIstwert && existsState(pfadIstwert)) ? tankRundeWert(getVal(pfadIstwert, 0)) : 0;
    const limitUnten = tankRundeWert(getVal(DP.tankAnzUnten, 20));
    const limitOben = tankRundeWert(getVal(DP.tankAnzOben, 90));
    const automatikAktiv = alsBool(getVal(DP.tankManuellPumpe, true), true);
    const pumpePfad = leseBrunnenpumpeAusgang();

    if (!pumpePfad || !existsState(pumpePfad)) return;

    const pumpeAn = alsBool(getVal(pumpePfad, false), false);

    if (!automatikAktiv) {
        if (pumpeAn) {
            setState(pumpePfad, false);
            setzeTankAnzeigeWennGeaendert(DP.tankAnzStatus, 'Reparatur / AUS');
            logWarn('Wartungsmodus aktiv: Brunnenpumpe wurde für Reparaturarbeiten zwangsabgeschaltet.');
        }
        return;
    }

    if (istwert <= limitUnten) {
        if (!pumpeAn) {
            setState(pumpePfad, true);
            setzeTankAnzeigeWennGeaendert(DP.tankAnzStatus, 'Pumpe läuft');
            logInfo(`Wassertank unter Limit (${istwert}% <= ${limitUnten}%). Pumpe automatisch GESTARTET.`);
            aktualisiereBrunnenpumpePause();
        }
    } else if (istwert >= limitOben) {
        if (pumpeAn) {
            setState(pumpePfad, false);
            setzeTankAnzeigeWennGeaendert(DP.tankAnzStatus, 'Pumpe gestoppt / Standby');
            logInfo(`Wassertank voll (${istwert}% >= ${limitOben}%). Pumpe automatisch GESTOPPT.`);
            aktualisiereBrunnenpumpePause();
        }
    }
}

function stelleTankHardwareTestDatenpunkteSicher() {
    const liste = [
        {
            id: TANK_ISTWERT_SENSOR_DEFAULT,
            val: 0,
            common: {
                name: 'Tank Istwert (Test)',
                type: 'number',
                role: 'value',
                read: true,
                write: true,
                def: 0,
                min: 0,
                max: 100,
                unit: '%',
            },
        },
        {
            id: TANK_DP_PUMPE,
            val: false,
            common: commonSchalter('Brunnenpumpe (Test)', 'Test-Aktor Brunnenpumpe', false),
        },
        {
            id: TANK_DP_UNTEN_TEST,
            val: 20,
            common: {
                name: 'Tank unten (Test)',
                type: 'number',
                role: 'value',
                read: true,
                write: true,
                def: 20,
                min: 0,
                max: 100,
                unit: '%',
            },
        },
        {
            id: TANK_DP_OBEN_TEST,
            val: 90,
            common: {
                name: 'Tank oben (Test)',
                type: 'number',
                role: 'value',
                read: true,
                write: true,
                def: 90,
                min: 0,
                max: 100,
                unit: '%',
            },
        },
    ];
    for (let i = 0; i < liste.length; i++) {
        erstelleDatenpunktWennFehlt(liste[i]);
    }
}

function behandleTankKonfigPfadAenderung(obj) {
    if (!obj?.state || obj.state.ack !== false) return;
    const val = normalisiereStateId(String(obj.state.val || '').trim());
    setState(obj.id, val, true);
    initialisiereDynamischeTrigger();
    pruefeTankstand();
}

function startTankSchedulerBackup() {
    if (tankSchedulerGestartet) return;
    tankSchedulerGestartet = true;
    schedule('*/1 * * * *', () => {
        initialisiereDynamischeTrigger();
        pruefeTankstand();
    });
}

/** Schreibbarkeit ohne extendObject (JS-Adapter: oft verboten) */
function erzwingeSchreibbarenState(id, fallbackVal, common) {
    if (!existsObject(id)) return;

    const obj = getObject(id);
    if (!obj || obj.type !== 'state' || !obj.common || obj.common.write !== false) return;

    const wert = getVal(id, fallbackVal);
    logWarn(`${id}: write=false – wird neu angelegt (Wert=${wert})`);
    try {
        deleteState(id);
    } catch (e) {
        logWarn(`deleteState ${id}: ${e}`);
        return;
    }
    createStateBw(id, wert, common);
}

function stelleTankSollSchreibbar() {
    for (const s of TANK_STATES_LIST) {
        if (s.id === TANK_DP_ANZEIGE_UNTEN || s.id === TANK_DP_ANZEIGE_OBEN) {
            erzwingeSchreibbarenState(s.id, s.val, s.common);
        }
    }
}

function initWassertankSteuerung() {
    for (const s of TANK_STATES_LIST) {
        if (!existsState(s.id)) {
            createStateBw(s.id, s.val, s.common);
            logDpAngelegt(s.id);
        }
    }

    stelleTankSollSchreibbar();
    stelleTankHardwareTestDatenpunkteSicher();

    for (const id of [DP.tankPfadUnten, DP.tankPfadOben, DP.tankPfadIstwert, DP.tankBrunnenpumpeKonfig]) {
        on({ id, change: 'any' }, behandleTankKonfigPfadAenderung);
    }

    on({ id: DP.tankManuellPumpe, change: 'any' }, (obj) => {
        if (!obj?.state || obj.state.ack !== false) return;
        const ein = alsBool(obj.state.val, false);
        setState(DP.tankManuellPumpe, ein, true);
        logInfo(ein ? 'Wassertank: Automatik EIN' : 'Wassertank: Wartungsmodus (Pumpe AUS)');
        pruefeTankstand();
        aktualisiereBrunnenpumpePause();
    });

    on({ id: DP.tankAnzUnten, change: 'any' }, (obj) => behandleTankSollAenderung(DP.tankAnzUnten, DP.tankUntenTest, obj));
    on({ id: DP.tankAnzOben, change: 'any' }, (obj) => behandleTankSollAenderung(DP.tankAnzOben, DP.tankObenTest, obj));

    initialisiereDynamischeTrigger();
    pruefeTankstand();
    aktualisiereBrunnenpumpePause();
    startTankSchedulerBackup();
}


// ─── GARTENPUMPE / NACHTRUHE ─────────────────────────────────────────────────
// Automatik: NachtruheVon–NachtruheBis (z. B. 22:00 Uhr–07:00 Uhr) → Pumpe Aus.
// Konfig-Zeiten nur als „HH:MM Uhr“; Status zeigt Fenster sofort bei Änderung.

function normalisiereNachtruheZeit(raw, fallback) {
    const fb = normalisiereNachtruheZeitStrikt(fallback) || NACHTRUHE_VON_DEFAULT;
    if (raw === undefined || raw === null || String(raw).trim() === '') return fb;

    if (typeof raw === 'number' || /^-?\d{1,2}$/.test(String(raw).trim())) {
        const h = Math.max(0, Math.min(23, parseInt(raw, 10)));
        return `${String(h).padStart(2, '0')}:00 Uhr`;
    }

    const s = String(raw).trim();
    let m = s.match(/^(\d{1,2}):(\d{2})\s*Uhr$/i);
    if (!m) m = s.match(/^(\d{1,2}):(\d{2})$/);

    if (!m) {
        logWarn(`Nachtruhe-Zeit ungültig „${s}“ – verwende ${fb}`);
        return fb;
    }

    const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
    const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')} Uhr`;
}

function normalisiereNachtruheZeitStrikt(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return null;
    if (typeof raw === 'number' || /^-?\d{1,2}$/.test(String(raw).trim())) {
        const h = Math.max(0, Math.min(23, parseInt(raw, 10)));
        return `${String(h).padStart(2, '0')}:00 Uhr`;
    }
    const s = String(raw).trim();
    let m = s.match(/^(\d{1,2}):(\d{2})\s*Uhr$/i);
    if (!m) m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
    const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')} Uhr`;
}

function leseNachtruheZeit(dpKey, fallback) {
    return normalisiereNachtruheZeit(getVal(DP[dpKey], fallback), fallback);
}

function nachtruheZeitZuMinuten(zeitNorm) {
    const norm = normalisiereNachtruheZeitStrikt(zeitNorm) || NACHTRUHE_VON_DEFAULT;
    const m = norm.match(/^(\d{2}):(\d{2})\s*Uhr$/i);
    if (!m) return 0;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function nachtruheZeitAnzeigeKurz(zeitNorm) {
    const norm = normalisiereNachtruheZeitStrikt(zeitNorm) || NACHTRUHE_VON_DEFAULT;
    return norm.replace(/\s*Uhr$/i, '');
}

function nachtruheZeitfensterText() {
    const von = nachtruheZeitAnzeigeKurz(leseNachtruheZeit('gartenNachtruheVon', NACHTRUHE_VON_DEFAULT));
    const bis = nachtruheZeitAnzeigeKurz(leseNachtruheZeit('gartenNachtruheBis', NACHTRUHE_BIS_DEFAULT));
    return `${von}–${bis}`;
}

function istInNachtfensterMinuten(jetzt, vonMin, bisMin) {
    const nowMin = jetzt.getHours() * 60 + jetzt.getMinutes();
    if (vonMin === bisMin) return false;
    if (vonMin < bisMin) return nowMin >= vonMin && nowMin < bisMin;
    return nowMin >= vonMin || nowMin < bisMin;
}

function istGartenpumpeNachtruheKonfigAktiv() {
    return alsBool(getVal(DP.gartenNachtruheAktiv, true), true);
}

function istGartenpumpeNachtruheAktiv() {
    if (!istGartenpumpeNachtruheKonfigAktiv()) return false;
    const vonMin = nachtruheZeitZuMinuten(leseNachtruheZeit('gartenNachtruheVon', NACHTRUHE_VON_DEFAULT));
    const bisMin = nachtruheZeitZuMinuten(leseNachtruheZeit('gartenNachtruheBis', NACHTRUHE_BIS_DEFAULT));
    return istInNachtfensterMinuten(new Date(), vonMin, bisMin);
}

function aktualisiereNachtruheAnzeige() {
    const nachtGerade = istGartenpumpeNachtruheAktiv();
    setIntern(DP.gartenAnzNachtruhe, nachtGerade);
    return nachtGerade;
}

function leseGartenpumpeAusgang() {
    return String(getVal(DP.gartenPumpeAusgang, GARTENPUMPE_AUSGANG_DEFAULT) || '').trim() || GARTENPUMPE_AUSGANG_DEFAULT;
}

function leseGartenpumpeHardwareZustand() {
    const ausgang = leseGartenpumpeAusgang();
    if (!ausgang || !existsState(ausgang)) return false;
    return alsBool(getVal(ausgang, false), false);
}

function setzeGartenpumpeHardware(an, grund) {
    const ausgang = leseGartenpumpeAusgang();
    const ziel = an === true;
    const vorher = leseGartenpumpeHardwareZustand();
    if (ausgang) setHardware(ausgang, ziel);
    setIntern(DP.gartenAnzPumpe, ziel);
    if (vorher !== ziel) {
        logInfo(`Gartenpumpe: ${ziel ? 'EIN' : 'AUS'} (${grund}) → ${ausgang}`);
    }
}

function steuereGartenpumpe(grund) {
    if (!istGartenpumpeNachtruheKonfigAktiv()) {
        setIntern(DP.gartenAnzNachtruhe, false);
        setIntern(DP.gartenAktiv, true);
        setzeGartenpumpeHardware(true, grund || 'Nachtruhe deaktiviert');
        setIntern(DP.gartenAnzStatus, 'Aktiv – Nachtruhe deaktiviert');
        gartenpumpeLauf.erzwungenAus = false;
        return;
    }

    const nachtGerade = aktualisiereNachtruheAnzeige();

    if (nachtGerade) {
        setIntern(DP.gartenAktiv, false);
        setzeGartenpumpeHardware(false, grund || 'Nachtruhe');
        setIntern(DP.gartenAnzStatus, `Nachtruhe ${nachtruheZeitfensterText()} – Pumpe aus`);
        gartenpumpeLauf.erzwungenAus = true;
        return;
    }

    if (gartenpumpeLauf.erzwungenAus) {
        gartenpumpeLauf.erzwungenAus = false;
        logInfo('Gartenpumpe: Nachtruhe beendet – Pumpe wieder Ein');
    }

    setIntern(DP.gartenAktiv, true);
    setzeGartenpumpeHardware(true, grund || 'Tagbetrieb');
    setIntern(DP.gartenAnzStatus, `Aktiv – Tagbetrieb (${nachtruheZeitfensterText()})`);
}

function migriereNachtruheZeitformat() {
    const zeitDefs = GARTEN_STATES_LIST.filter(
        (s) => s.id === DP.gartenNachtruheVon || s.id === DP.gartenNachtruheBis
    );
    for (let i = 0; i < zeitDefs.length; i++) {
        const s = zeitDefs[i];
        const alt = existsState(s.id) ? getVal(s.id, s.val) : s.val;
        const neu = normalisiereNachtruheZeit(alt, s.val);
        const obj = existsObject(s.id) ? getObject(s.id) : null;
        const typeFalsch = obj && obj.common && obj.common.type !== 'string';
        if (!existsState(s.id) || typeFalsch) {
            if (existsState(s.id)) {
                try {
                    deleteState(s.id);
                } catch (e) {
                    logWarn(`deleteState ${s.id}: ${e}`);
                }
            }
            createStateBw(s.id, neu, s.common);
            logInfo(`Nachtruhe-Zeit DP neu: ${s.id} = ${neu}`);
        } else if (String(alt) !== neu) {
            setState(s.id, neu, true);
            logInfo(`Nachtruhe-Zeit migriert: ${s.id} → ${neu}`);
        }
    }
}

function startGartenpumpeEvents() {
    on({ id: `${GARTEN_KONFIG}.*`, change: 'any' }, (obj) => {
        if (!obj?.state || obj.state.ack !== false) return;
        let val = obj.state.val;
        if (obj.id === DP.gartenNachtruheVon || obj.id === DP.gartenNachtruheBis) {
            const fallback = obj.id === DP.gartenNachtruheVon ? NACHTRUHE_VON_DEFAULT : NACHTRUHE_BIS_DEFAULT;
            const roh = obj.state.val;
            val = normalisiereNachtruheZeit(roh, fallback);
            if (String(roh).trim() !== val) {
                logInfo(`Nachtruhe-Zeit normalisiert: „${roh}“ → „${val}“`);
            }
        } else if (obj.id === DP.gartenNachtruheAktiv) {
            val = alsBool(obj.state.val, true);
        }
        setState(obj.id, val, true);
        steuereGartenpumpe('Konfig geändert');
    });
}

function leseVentilHardwareZustand(v) {
    const ausgang = leseHardwareZiel(v);
    if (!ausgang || !existsState(ausgang)) return false;
    return alsBool(getVal(ausgang, false), false);
}

function istIrgendeinVentilHardwareAn() {
    for (let i = 0; i < VENTILE.length; i++) {
        if (leseVentilHardwareZustand(VENTILE[i])) return true;
    }
    return false;
}

function aktualisierePumpeVisSteuerung() {
    const an = istIrgendeinVentilHardwareAn();
    const alt = alsBool(getVal(DP.gartenAnzPumpeVisSteuerung, false), false);
    if (an !== alt) setIntern(DP.gartenAnzPumpeVisSteuerung, an);
}

function sammleVentilAusgangStateIds() {
    const ids = [];
    for (let i = 0; i < VENTILE.length; i++) {
        const hw = leseHardwareZiel(VENTILE[i]);
        if (hw && existsState(hw)) ids.push(hw);
    }
    return ids;
}

function bindePumpeVisSteuerungQuellen() {
    for (let i = 0; i < pumpeVisSteuerungSubs.length; i++) {
        const sub = pumpeVisSteuerungSubs[i];
        if (sub) unsubscribe(sub);
    }
    pumpeVisSteuerungSubs = [];
    const ids = sammleVentilAusgangStateIds();
    if (ids.length) {
        pumpeVisSteuerungSubs.push(on({ id: ids, change: 'any' }, () => aktualisierePumpeVisSteuerung()));
    }
    aktualisierePumpeVisSteuerung();
}

function startPumpeVisSteuerungEvents() {
    on({ id: VENTILE.map((v) => v.dp.ausgang), change: 'ne' }, () => bindePumpeVisSteuerungQuellen());
    bindePumpeVisSteuerungQuellen();
}


// ─── NACHRICHTEN (WhatsApp / Telegram / E-Mail) ──────────────────────────────

function adapterInstanzExistiert(adapterName, nr) {
    const sysId = `system.adapter.${adapterName}.${nr}`;
    if (typeof existsObject === 'function') {
        if (existsObject(sysId)) return true;
    }
    const inst = `${adapterName}.${nr}`;
    if (existsState(`${inst}.alive`)) return true;
    if (existsState(`${inst}.info.connection`)) return true;
    return false;
}

function findeAdapterInstanzen(adapterName) {
    if (typeof getInstancesOfAdapter === 'function') {
        try {
            const roh = getInstancesOfAdapter(adapterName);
            if (Array.isArray(roh) && roh.length) {
                return roh.filter(Boolean).map(String).sort();
            }
        } catch (e) { /* ignore */ }
    }
    const gefunden = [];
    for (let i = 0; i < 20; i++) {
        if (adapterInstanzExistiert(adapterName, i)) gefunden.push(`${adapterName}.${i}`);
    }
    return gefunden;
}

function findeWhatsAppInstanzen() {
    const alle = [];
    for (let i = 0; i < WHATSAPP_ADAPTER_NAMEN.length; i++) {
        const list = findeAdapterInstanzen(WHATSAPP_ADAPTER_NAMEN[i]);
        for (let j = 0; j < list.length; j++) alle.push(list[j]);
    }
    return alle;
}

function aktualisiereInstanzVorschlag(dpInstanzId, dpListeId, instanzen, fallback) {
    const fb = String(fallback || '').trim();
    const listeText = instanzen.length ? instanzen.join(', ') : (fb || '– keine gefunden');
    const listeDef = EIGENE_STATES.find((s) => s.id === dpListeId);
    if (listeDef) erstelleDatenpunktWennFehlt(listeDef);
    if (existsState(dpListeId)) setIntern(dpListeId, listeText);
    const instanzDef = EIGENE_STATES.find((s) => s.id === dpInstanzId);
    if (instanzDef) erstelleDatenpunktWennFehlt(instanzDef);
    if (!existsState(dpInstanzId)) return;
    const aktuell = String(getVal(dpInstanzId, '') || '').trim();
    if (instanzen.length) {
        if (!aktuell || instanzen.indexOf(aktuell) === -1) setIntern(dpInstanzId, instanzen[0]);
    } else if (!aktuell && fb) {
        setIntern(dpInstanzId, fb);
    }
}

function aktualisiereNachrichtenInstanzListen() {
    aktualisiereInstanzVorschlag(DP.nachrichtenWhatsAppInstanz, DP.nachrichtenWhatsAppInstanzen, findeWhatsAppInstanzen(), WHATSAPP_INSTANZ_DEFAULT);
    aktualisiereInstanzVorschlag(DP.nachrichtenTelegramInstanz, DP.nachrichtenTelegramInstanzen, findeAdapterInstanzen(TELEGRAM_ADAPTER_NAME), TELEGRAM_INSTANZ_DEFAULT);
}

function istManuellerStartGrund(grund) {
    const g = String(grund || '');
    return g === 'ManuellStart' || g === 'ManuellEin' || /^Ventil\d+ Aus\/An$/.test(g);
}

function istZeitgestuerterStartGrund(grund) {
    return String(grund || '') === 'Zeitschaltuhr';
}

function sollNachrichtBeiStart(grund) {
    if (istManuellerStartGrund(grund)) return alsBool(getVal(DP.nachrichtenBeiManuell, true), true);
    if (istZeitgestuerterStartGrund(grund)) return alsBool(getVal(DP.nachrichtenBeiZeit, true), true);
    return false;
}

function istNachrichtenKanalAktiv() {
    return alsBool(getVal(DP.nachrichtenWhatsAppAktiv, false), false)
        || alsBool(getVal(DP.nachrichtenTelegramAktiv, false), false)
        || alsBool(getVal(DP.nachrichtenEmailAktiv, false), false);
}

function formatZeitstempelNachricht(d) {
    const dt = d || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(dt.getDate())}.${pad(dt.getMonth() + 1)}.${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function leseVentilNachrichtenStatus(v, kontext) {
    if (!istVentilFrei(v)) return { aktiv: false, hinweis: 'gesperrt (deaktiviert)' };
    if (istVentilSchwelleGesperrt(v)) return { aktiv: false, hinweis: 'gesperrt (Schwelle)' };

    if (kontext === 'Schleife') {
        if (!istVentilInSchleifeAktiv(v.nr)) return { aktiv: false, hinweis: 'gesperrt (nicht in Schleife)' };
        const skip = schleifeUeberspringGrund(v);
        if (skip) {
            const kurz = skip.replace('SchwelleSperre=true', 'Schwelle')
                .replace('Aktiviert=false', 'deaktiviert')
                .replace('nicht in Schleife', 'nicht in Schleife');
            return { aktiv: false, hinweis: `gesperrt (${kurz})` };
        }
        return { aktiv: true, hinweis: 'aktiv' };
    }

    if (istVentilPausiert(v) || istVentilAktiv(v)) {
        return { aktiv: false, hinweis: 'gesperrt (läuft/pausiert)' };
    }
    return { aktiv: true, hinweis: 'aktiv' };
}

function leseTankstandFuerNachricht() {
    const pfad = leseTankWertAktuelPfad();
    let wert = null;
    if (pfad && existsState(pfad)) {
        wert = tankRundeWert(getVal(pfad, 0));
    } else if (existsState(DP.tankAnzIstwert)) {
        wert = tankRundeWert(getVal(DP.tankAnzIstwert, 0));
    }
    if (wert === null || wert === undefined || isNaN(wert)) return 'keine Daten';
    return `${wert} %`;
}

function istManuellerEndeGrund(grund) {
    const g = String(grund || '');
    return g === 'ManuellStart' || g === 'ManuellStopp' || g === 'ManuellEin' || /^Ventil\d+ Aus\/An$/.test(g);
}

function sollNachrichtBeiEnde(grund) {
    if (grund === 'ManuellStopp') return alsBool(getVal(DP.nachrichtenBeiManuell, true), true);
    if (istManuellerEndeGrund(grund) || istManuellerStartGrund(grund)) {
        return alsBool(getVal(DP.nachrichtenBeiManuell, true), true);
    }
    if (istZeitgestuerterStartGrund(grund)) return alsBool(getVal(DP.nachrichtenBeiZeit, true), true);
    return alsBool(getVal(DP.nachrichtenBeiManuell, true), true) || alsBool(getVal(DP.nachrichtenBeiZeit, true), true);
}

function leseVentilEndeHinweis(v, einzelVentil, kontext) {
    if (kontext === 'Schleife') {
        if (!istVentilInSchleifeAktiv(v.nr)) return 'nicht in Schleife';
        if (!istVentilFrei(v)) return 'deaktiviert';
        if (istVentilSchwelleGesperrt(v)) return 'gesperrt (Schwelle)';
        return 'beendet';
    }
    if (einzelVentil && einzelVentil.nr === v.nr) return 'beendet';
    if (istVentilAktiv(v)) return 'läuft noch';
    if (!istVentilFrei(v)) return 'deaktiviert';
    if (istVentilSchwelleGesperrt(v)) return 'gesperrt (Schwelle)';
    return 'beendet';
}

function formatAusloesungNachricht(grund, typ) {
    const g = String(grund || '');
    if (g === 'ManuellStart') return typ === 'Ende' ? 'Manuell (Schleife beendet)' : 'Manuell (Schleife)';
    if (g === 'ManuellStopp') return 'Manuell gestoppt';
    if (g === 'Zeitschaltuhr') return 'Zeitgesteuert';
    if (/^Ventil\d+ Aus\/An$/.test(g)) return g;
    return g;
}

function baueBewaesserungNachricht(grund, kontext, typ, einzelVentil) {
    const istEnde = typ === 'Ende';
    const ausloesung = formatAusloesungNachricht(grund, typ);
    const zeilen = [
        istEnde ? 'Beregnungswerk beendet' : 'Beregnungswerk gestartet',
        `Auslösung: ${ausloesung}`,
        `Zeit: ${formatZeitstempelNachricht()}`,
    ];
    if (alsBool(getVal(DP.nachrichtenTankstand, true), true)) {
        const tankText = leseTankstandFuerNachricht();
        setIntern(DP.nachrichtenAnzTankstand, tankText);
        zeilen.push(`Wassertank: ${tankText}`);
    }
    zeilen.push('', 'Ventile:');
    for (let i = 0; i < VENTILE.length; i++) {
        const v = VENTILE[i];
        const hinweis = istEnde
            ? leseVentilEndeHinweis(v, einzelVentil, kontext)
            : leseVentilNachrichtenStatus(v, kontext).hinweis;
        zeilen.push(`- Ventil ${v.nr}: ${hinweis}`);
    }
    return zeilen.join('\n');
}

function formatNachrichtenAntwort(val) {
    if (val === undefined || val === null) return '';
    if (typeof val === 'object') {
        try {
            return JSON.stringify(val);
        } catch (e) {
            return String(val);
        }
    }
    return String(val);
}

function parseNachrichtenAntwortWert(val) {
    if (val === undefined || val === null) return val;
    if (typeof val !== 'string') return val;
    const s = val.trim();
    if (!s.startsWith('{') && !s.startsWith('[')) return val;
    try {
        return JSON.parse(s);
    } catch (e) {
        return val;
    }
}

function werteAdapterErfolgText(kanal, text) {
    const s = String(text || '');
    if (!s) return null;
    if (kanal === 'WhatsApp' && /message sent|gesendet|sent successfully|success|erfolg/i.test(s)) {
        return { ok: true, detail: 'OK' };
    }
    if (kanal === 'E-Mail' && istSmtpErfolg(s)) return { ok: true, detail: 'OK' };
    if (/error|fehlgeschlagen|failed|denied|not sent/i.test(s)) {
        return { ok: false, detail: s };
    }
    return null;
}

function werteKanalVersandErgebnis(kanal, arg1, arg2) {
    for (let i = 0; i < 2; i++) {
        let val = i === 0 ? arg1 : arg2;
        if (val === undefined || val === null) continue;
        val = parseNachrichtenAntwortWert(val);
        if (typeof val === 'object' && !Array.isArray(val)) {
            const adapterErgebnis = werteAdapterErfolgObjekt(kanal, val);
            if (adapterErgebnis) return adapterErgebnis;
            if (val.error) return { ok: false, detail: formatNachrichtenAntwort(val.error) };
        }
        if (typeof val === 'string') {
            const textErgebnis = werteAdapterErfolgText(kanal, val);
            if (textErgebnis) return textErgebnis;
        }
    }
    if (arg1 !== undefined && arg1 !== null && arg1 !== false && arg1 !== 0 && arg1 !== '0'
        && arg2 !== undefined && arg2 !== null) {
        const detail = formatNachrichtenAntwort(arg1);
        return { ok: false, detail: detail || 'unbekannter Fehler' };
    }
    const val = parseNachrichtenAntwortWert(arg2 !== undefined ? arg2 : arg1);
    if (val === undefined || val === null) return { ok: true, detail: '' };
    if (typeof val === 'number') return { ok: val === 0, detail: String(val) };
    if (val === true) return { ok: true, detail: '' };
    if (val === false) return { ok: false, detail: 'abgelehnt' };
    if (typeof val === 'object' && !Array.isArray(val)) {
        const adapterErgebnis = werteAdapterErfolgObjekt(kanal, val);
        if (adapterErgebnis) return adapterErgebnis;
        return { ok: true, detail: '' };
    }
    const s = formatNachrichtenAntwort(val).trim();
    if (!s || s === '0') return { ok: true, detail: '' };
    const textErgebnis = werteAdapterErfolgText(kanal, s);
    if (textErgebnis) return textErgebnis;
    return { ok: false, detail: s };
}

function istSmtpErfolg(text) {
    const s = String(text || '');
    return /^2\d{2}\b/.test(s) || /\bOK\b/i.test(s);
}

function werteEmailVersandObjekt(val) {
    if (!val || typeof val !== 'object') return null;
    if (val.error) return { ok: false, detail: formatNachrichtenAntwort(val.error) };
    const msg = val.result || val.message || val.response || val.text;
    if (msg && istSmtpErfolg(msg)) return { ok: true, detail: 'OK' };
    if (msg && /error|fehlgeschlagen|failed/i.test(String(msg))) {
        return { ok: false, detail: String(msg) };
    }
    if (val.messageId || val.result || val.message) return { ok: true, detail: 'OK' };
    return { ok: true, detail: '' };
}

function werteWhatsAppVersandObjekt(val) {
    if (!val || typeof val !== 'object') return null;
    if (val.error) return { ok: false, detail: formatNachrichtenAntwort(val.error) };
    const msg = String(val.result || val.message || val.response || val.text || '');
    if (/message sent|gesendet|sent successfully|success|erfolg/i.test(msg)) return { ok: true, detail: 'OK' };
    if (msg && /error|fehlgeschlagen|failed|denied|not sent/i.test(msg)) {
        return { ok: false, detail: msg };
    }
    if (val.result || val.message) return { ok: true, detail: 'OK' };
    return { ok: true, detail: '' };
}

function werteTelegramMessageIdMap(val) {
    if (val === undefined || val === null) return null;
    let obj = val;
    if (Array.isArray(val)) {
        if (!val.length) return null;
        const eintrag = val[0];
        if (typeof eintrag === 'string' && eintrag.trim()) {
            try {
                obj = JSON.parse(eintrag);
            } catch (e) {
                return null;
            }
        } else if (eintrag && typeof eintrag === 'object' && !Array.isArray(eintrag)) {
            obj = eintrag;
        } else {
            return null;
        }
    } else if (typeof val === 'string' && val.trim()) {
        try {
            obj = JSON.parse(val);
        } catch (e) {
            return null;
        }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const keys = Object.keys(obj);
    if (!keys.length) return null;
    for (let i = 0; i < keys.length; i++) {
        const v = obj[keys[i]];
        if (v === undefined || v === null) return null;
        if (typeof v !== 'number' && typeof v !== 'string') return null;
    }
    return { empfaenger: keys.length, map: obj };
}

function werteTelegramVersandErgebnis(arg1, arg2) {
    for (let i = 0; i < 2; i++) {
        const val = i === 0 ? arg1 : arg2;
        if (val === undefined || val === null) continue;
        if (val === 0 || val === '0') return { ok: true, detail: '' };
        if (typeof val === 'number' && val > 0) return { ok: true, detail: `${val} Empfänger` };
        const mapInfo = werteTelegramMessageIdMap(val);
        if (mapInfo) {
            return {
                ok: true,
                detail: mapInfo.empfaenger === 1 ? 'OK' : `${mapInfo.empfaenger} Empfänger`,
            };
        }
    }
    if (arg1 !== undefined && arg1 !== null && arg1 !== false && arg1 !== 0 && arg1 !== '0'
        && arg2 !== undefined && arg2 !== null) {
        const detail = formatNachrichtenAntwort(arg1);
        return { ok: false, detail: detail || 'unbekannter Fehler' };
    }
    const val = arg2 !== undefined ? arg2 : arg1;
    if (val === undefined || val === null) return { ok: true, detail: '' };
    if (val === true) return { ok: true, detail: '' };
    if (val === false) return { ok: false, detail: 'abgelehnt' };
    if (typeof val === 'object') {
        if (val.error) return { ok: false, detail: formatNachrichtenAntwort(val.error) };
        const msg = val.result || val.message || val.response || val.text;
        if (msg && /error|fehlgeschlagen|failed/i.test(String(msg))) {
            return { ok: false, detail: String(msg) };
        }
        if (msg) return { ok: true, detail: 'OK' };
        return { ok: true, detail: '' };
    }
    const s = formatNachrichtenAntwort(val).trim();
    if (!s || s === '0') return { ok: true, detail: '' };
    if (/error|fehlgeschlagen|failed/i.test(s)) return { ok: false, detail: s };
    return { ok: false, detail: s };
}

function werteAdapterErfolgObjekt(kanal, val) {
    if (kanal === 'E-Mail') return werteEmailVersandObjekt(val);
    if (kanal === 'WhatsApp') return werteWhatsAppVersandObjekt(val);
    return null;
}

function werteNachrichtenVersandErgebnis(kanal, arg1, arg2) {
    if (kanal === 'Telegram') return werteTelegramVersandErgebnis(arg1, arg2);
    if (kanal === 'WhatsApp' || kanal === 'E-Mail') return werteKanalVersandErgebnis(kanal, arg1, arg2);
    let err = arg1;
    let res = arg2;
    if (arg2 === undefined && arg1 && typeof arg1 === 'object' && !Array.isArray(arg1)) {
        const adapterErgebnis = werteAdapterErfolgObjekt(kanal, arg1);
        if (adapterErgebnis) return adapterErgebnis;
        if (!arg1.error) {
            err = null;
            res = arg1;
        }
    }
    if (err !== undefined && err !== null && err !== false && err !== 0 && err !== '0') {
        const detail = formatNachrichtenAntwort(err);
        return { ok: false, detail: detail || 'unbekannter Fehler' };
    }
    const val = res !== undefined ? res : err;
    if (val === undefined || val === null) return { ok: true, detail: '' };
    if (typeof val === 'number') {
        if (kanal === 'Telegram') {
            if (val === 0) return { ok: true, detail: '' };
            if (val > 0) return { ok: true, detail: `${val} Empfänger` };
            return { ok: false, detail: `Fehlercode ${val}` };
        }
        return { ok: val === 0, detail: String(val) };
    }
    if (val === true) return { ok: true, detail: '' };
    if (val === false) return { ok: false, detail: 'abgelehnt' };
    if (typeof val === 'object') {
        const adapterErgebnis = werteAdapterErfolgObjekt(kanal, val);
        if (adapterErgebnis) return adapterErgebnis;
        if (val.error) return { ok: false, detail: formatNachrichtenAntwort(val.error) };
        const msg = val.result || val.message || val.response || val.text;
        if (msg && /error|fehlgeschlagen|failed/i.test(String(msg))) {
            return { ok: false, detail: String(msg) };
        }
        if (msg) return { ok: true, detail: 'OK' };
        return { ok: true, detail: '' };
    }
    const s = formatNachrichtenAntwort(val).trim();
    if (!s || s === '0') return { ok: kanal === 'Telegram', detail: s || '0' };
    if (kanal === 'E-Mail' && istSmtpErfolg(s)) return { ok: true, detail: 'OK' };
    return { ok: false, detail: s };
}

function meldeNachrichtenVersand(kanal, instanz, test, ergebnis) {
    const info = test ? `${kanal} Test` : kanal;
    const status = ergebnis.ok
        ? `${info} gesendet (${instanz}${ergebnis.detail ? ', ' + ergebnis.detail : ''})`
        : `${info} Fehler (${instanz}): ${ergebnis.detail || 'unbekannt'}`;
    setIntern(DP.nachrichtenAnzStatus, status);
    if (ergebnis.ok) logInfo(`Nachrichten: ${status}`);
    else logWarn(`Nachrichten: ${status}`);
}

function leseTelegramUserMap(instanz) {
    const usersId = `${instanz}.communicate.users`;
    if (!existsState(usersId)) return {};
    let val = getVal(usersId, '');
    if (typeof val === 'string' && val.trim()) {
        try {
            val = JSON.parse(val);
        } catch (e) {
            return {};
        }
    }
    if (Array.isArray(val)) {
        const map = {};
        for (let i = 0; i < val.length; i++) {
            const eintrag = String(val[i] || '').trim();
            if (eintrag) map[eintrag] = { userName: eintrag };
        }
        return map;
    }
    if (val && typeof val === 'object') return val;
    return {};
}

function leseTelegramAuthentifizierteUser(instanz) {
    const map = leseTelegramUserMap(instanz);
    const namen = [];
    for (const chatId in map) {
        if (!Object.prototype.hasOwnProperty.call(map, chatId)) continue;
        const u = map[chatId];
        if (u && typeof u === 'object') {
            namen.push(u.userName || u.firstName || chatId);
        } else {
            namen.push(String(u || chatId));
        }
    }
    return namen;
}

function leseTelegramAuthEintraege(instanz) {
    const map = leseTelegramUserMap(instanz);
    const eintraege = [];
    for (const chatId in map) {
        if (!Object.prototype.hasOwnProperty.call(map, chatId)) continue;
        const u = map[chatId];
        const name = (u && typeof u === 'object') ? (u.userName || u.firstName || chatId) : String(u || chatId);
        eintraege.push(`${name} (${chatId})`);
    }
    return eintraege;
}

function baueTelegramSendPayload(text, instanz) {
    const payload = { text };
    const chatIdCfg = String(getVal(DP.nachrichtenTelegramChatId, '') || '').trim();
    const userCfg = String(getVal(DP.nachrichtenTelegramUser, '') || '').trim();
    if (chatIdCfg) {
        payload.chatId = chatIdCfg;
        return payload;
    }
    if (userCfg) {
        payload.user = userCfg.replace(/^@/, '');
        return payload;
    }
    const map = leseTelegramUserMap(instanz);
    const chatIds = Object.keys(map);
    if (chatIds.length === 1) {
        const chatId = chatIds[0];
        const u = map[chatId];
        payload.chatId = chatId;
        if (u?.userName) payload.user = u.userName;
    }
    return payload;
}

function aktualisiereTelegramAuthInfo(instanz) {
    const eintraege = leseTelegramAuthEintraege(instanz);
    const chatIdCfg = String(getVal(DP.nachrichtenTelegramChatId, '') || '').trim();
    const requestChatId = String(getVal(`${instanz}.communicate.requestChatId`, '') || '').trim();
    let info;
    if (eintraege.length) {
        info = `Auth OK: ${eintraege.join(', ')}`;
    } else if (chatIdCfg) {
        info = `Kein User in Liste – sende an Chat-ID ${chatIdCfg}`;
    } else if (requestChatId) {
        info = `Nicht authentifiziert – chatId ${requestChatId} in Telegram_ChatId eintragen oder /password senden`;
    } else {
        info = 'Kein User authentifiziert – Bot: /password DEIN_PASSWORT (nicht nur /start)';
    }
    setIntern(DP.nachrichtenTelegramAuthInfo, info);
    return eintraege.length > 0 || !!chatIdCfg;
}

function sendeTelegramNachricht(text, test) {
    const instanz = String(getVal(DP.nachrichtenTelegramInstanz, '') || '').trim();
    if (!instanz) {
        setIntern(DP.nachrichtenAnzStatus, 'Telegram: keine Instanz gewählt');
        logWarn('Nachrichten: Telegram – keine Instanz konfiguriert');
        return;
    }
    const bereit = aktualisiereTelegramAuthInfo(instanz);
    const payload = baueTelegramSendPayload(text, instanz);
    if (!bereit && !payload.chatId && !payload.user) {
        const msg = 'Telegram: kein Empfänger – zuerst /password PASSWORT an Bot senden';
        setIntern(DP.nachrichtenAnzStatus, msg);
        logWarn(`Nachrichten: ${msg}`);
        return;
    }
    const nachVersand = (arg1, arg2) => {
        meldeNachrichtenVersand('Telegram', instanz, test, werteNachrichtenVersandErgebnis('Telegram', arg1, arg2));
    };
    try {
        sendTo(instanz, 'send', payload, nachVersand);
    } catch (e) {
        setIntern(DP.nachrichtenAnzStatus, `Telegram Fehler: ${e}`);
        logWarn(`Nachrichten: Telegram ${e}`);
    }
}

function sendeWhatsAppNachricht(text, test) {
    const instanz = String(getVal(DP.nachrichtenWhatsAppInstanz, '') || '').trim();
    if (!instanz) {
        setIntern(DP.nachrichtenAnzStatus, 'WhatsApp: keine Instanz gewählt');
        logWarn('Nachrichten: WhatsApp – keine Instanz konfiguriert');
        return;
    }
    const nachVersand = (arg1, arg2) => {
        const ergebnis = werteNachrichtenVersandErgebnis('WhatsApp', arg1, arg2);
        meldeNachrichtenVersand('WhatsApp', instanz, test, ergebnis);
    };
    try {
        sendTo(instanz, 'send', { text }, nachVersand);
    } catch (e) {
        setIntern(DP.nachrichtenAnzStatus, `WhatsApp Fehler: ${e}`);
        logWarn(`Nachrichten: WhatsApp ${e}`);
    }
}

function sendeEmailNachricht(text, test) {
    const adresse = String(getVal(DP.nachrichtenEmailAdresse, '') || '').trim();
    if (!adresse) {
        setIntern(DP.nachrichtenAnzStatus, 'E-Mail: keine Adresse eingetragen');
        if (test) logInfo('Nachrichten: E-Mail Test – bitte Email_Adresse eintragen');
        else logWarn('Nachrichten: E-Mail – keine Adresse konfiguriert');
        return;
    }
    const betreff = test ? 'Beregnungswerk – Testnachricht' : 'Beregnungswerk – Start';
    const nachVersand = (arg1, arg2) => {
        const ergebnis = werteNachrichtenVersandErgebnis('E-Mail', arg1, arg2);
        meldeNachrichtenVersand('E-Mail', adresse, test, ergebnis);
    };
    try {
        sendTo('email', {
            to: adresse,
            subject: betreff,
            text,
        }, nachVersand);
    } catch (e) {
        setIntern(DP.nachrichtenAnzStatus, `E-Mail Fehler: ${e}`);
        logWarn(`Nachrichten: E-Mail ${e}`);
    }
}

function versendeNachrichten(text, test) {
    const kanaele = [];
    setIntern(DP.nachrichtenAnzLetzte, text);

    if (alsBool(getVal(DP.nachrichtenWhatsAppAktiv, false), false)) {
        sendeWhatsAppNachricht(text, test);
        kanaele.push('WhatsApp');
    }
    if (alsBool(getVal(DP.nachrichtenTelegramAktiv, false), false)) {
        sendeTelegramNachricht(text, test);
        kanaele.push('Telegram');
    }
    if (alsBool(getVal(DP.nachrichtenEmailAktiv, false), false)) {
        sendeEmailNachricht(text, test);
        kanaele.push('E-Mail');
    }

    if (!kanaele.length) {
        setIntern(DP.nachrichtenAnzStatus, test ? 'Test: kein Kanal aktiv' : 'Kein Kanal aktiv');
        return;
    }
    setIntern(DP.nachrichtenAnzVersand, `${formatZeitstempelNachricht()} – ${kanaele.join(', ')}`);
}

function sendeBewaesserungStartNachricht(grund, kontext) {
    if (!sollNachrichtBeiStart(grund)) return;
    if (!istNachrichtenKanalAktiv()) return;
    const text = baueBewaesserungNachricht(grund, kontext, 'Start');
    versendeNachrichten(text, false);
    logInfo(`Nachrichten: Bewässerungsstart (${grund})`);
}

function sendeBewaesserungEndeNachricht(grund, kontext, einzelVentil) {
    if (!sollNachrichtBeiEnde(grund)) return;
    if (!istNachrichtenKanalAktiv()) return;
    const text = baueBewaesserungNachricht(grund, kontext, 'Ende', einzelVentil);
    versendeNachrichten(text, false);
    logInfo(`Nachrichten: Bewässerungsende (${grund})`);
}

function baueNachrichtenTestText(kanal) {
    return `Beregnungswerk – Testnachricht (${kanal})\n\nDies ist eine Test-Nachricht vom Beregnungswerk-Skript.`;
}

function startNachrichtenEvents() {
    on({ id: DP.nachrichtenWhatsAppTest, change: 'any' }, (obj) => {
        if (!obj?.state || obj.state.ack !== false || !obj.state.val) return;
        setState(DP.nachrichtenWhatsAppTest, false, true);
        setIntern(DP.nachrichtenAnzLetzte, baueNachrichtenTestText('WhatsApp'));
        sendeWhatsAppNachricht(baueNachrichtenTestText('WhatsApp'), true);
    });
    on({ id: DP.nachrichtenTelegramTest, change: 'any' }, (obj) => {
        if (!obj?.state || obj.state.ack !== false || !obj.state.val) return;
        setState(DP.nachrichtenTelegramTest, false, true);
        setIntern(DP.nachrichtenAnzLetzte, baueNachrichtenTestText('Telegram'));
        sendeTelegramNachricht(baueNachrichtenTestText('Telegram'), true);
    });
    on({ id: DP.nachrichtenEmailTest, change: 'any' }, (obj) => {
        if (!obj?.state || obj.state.ack !== false || !obj.state.val) return;
        setState(DP.nachrichtenEmailTest, false, true);
        setIntern(DP.nachrichtenAnzLetzte, baueNachrichtenTestText('E-Mail'));
        sendeEmailNachricht(baueNachrichtenTestText('E-Mail'), true);
    });
}

function initNachrichtenSteuerung() {
    migriereNachrichtenKonfigPfade();
    for (const s of NACHRICHTEN_STATES_LIST) {
        erstelleDatenpunktWennFehlt(s);
    }
    pruefeNachrichtenKonfigVollstaendig();
    aktualisiereNachrichtenInstanzListen();
    aktualisiereTelegramAuthInfo(String(getVal(DP.nachrichtenTelegramInstanz, TELEGRAM_INSTANZ_DEFAULT) || TELEGRAM_INSTANZ_DEFAULT).trim());
    setIntern(DP.nachrichtenAnzTankstand, leseTankstandFuerNachricht());
    startNachrichtenEvents();
    logInfo('Nachrichten-Modul gestartet');
}


// ─── VENTIL-STEUERUNG (pro Ventil) ───────────────────────────────────────────

function findeVentilZuDp(id) {
    if (!id || typeof id !== 'string') return null;
    for (const v of VENTILE) {
        if (id.startsWith(`${v.base}.`)) return v;
    }
    return null;
}

function behandleVentilKonfigAenderung(v, obj) {
    if (!obj?.id) return;
    const id = obj.id;
    if (id === v.dp.aktiviert) {
        return;
    }
    if (id === v.dp.feuchtSensor || id === v.dp.tempSensor) {
        startFeuchtigkeitSensor(v);
        startTemperaturSensor(v);
        return;
    }
    if (id === v.dp.ausgang) {
        bindePumpeVisSteuerungQuellen();
        return;
    }
    if (id === v.dp.dauer || id === v.dp.wiederholungen) {
        if (!istVentilAktiv(v)) setRestzeitZyklus(v, 0);
        aktualisiereRestzeitAnzeige(v);
        aktualisiereSchleifenGesamtzeitUeberwachung();
    }
}

function startGlobaleVentilKonfigEvents() {
    on({ id: `${DP_BASE}.Ventil*.Konfig.*`, change: 'any' }, (obj) => {
        const v = findeVentilZuDp(obj.id);
        if (v) behandleVentilKonfigAenderung(v, obj);
    });
}

function startGlobaleVentilRestzeitEvents() {
    on({ id: `${DP_BASE}.Ventil*.Steuerung.WiederholungenAktuel`, change: 'any' }, (obj) => {
        const v = findeVentilZuDp(obj.id);
        if (v) aktualisiereRestzeitAnzeige(v);
    });
}

function behandleVentilSchwelleAenderung(v) {
    aktualisiereSchwellePruefung(v);
    pruefeSchwelleVentilStarts();
}

function startGlobaleSchwelleEvents() {
    for (let i = 0; i < VENTILE.length; i++) {
        const v = VENTILE[i];
        const ids = [
            v.dp.shwFeuchtAktiv,
            v.dp.shwFeuchtWert,
            v.dp.shwTempAktiv,
            v.dp.shwTempWert,
            v.dp.shwVergleich,
        ];
        on({ id: ids, change: 'ne' }, () => behandleVentilSchwelleAenderung(v));
    }
}

function leseCountdownSek(v) {
    return leseBewaesserungsdauerMin(v) * 60;
}

function formatRestzeitAnzeige(gesamtRestSek) {
    return String(Math.max(0, parseInt(gesamtRestSek, 10) || 0));
}

function berechneRestzeitAnzeigeSek(v) {
    if (!leseVentilAusAnSchalter(v)) return 0;
    const wieder = parseInt(getVal(v.dp.wiederholungenAktuel, 0), 10) || 0;
    return Math.max(0, wieder * leseCountdownSek(v));
}

function leseRestzeitAnzeigeSek(v) {
    return Math.max(0, parseInt(String(getVal(v.dp.restzeitAnzeige, '0')), 10) || 0);
}

function istVentilBewaesserungLaeuft(v) {
    return leseRestzeitAnzeigeSek(v) > 0 || istVentilAktiv(v);
}

function aktualisiereRestzeitAnzeige(v) {
    setRestzeitAnzeigeGesamt(v, berechneRestzeitAnzeigeSek(v));
}

function setRestzeitZyklus(v, restSek) {
    const sek = Math.max(0, parseInt(restSek, 10) || 0);
    setIntern(v.dp.restzeit, sek);
}

function setRestzeitAnzeigeGesamt(v, restSek) {
    setIntern(v.dp.restzeitAnzeige, formatRestzeitAnzeige(restSek));
}

function setRestzeitIdle(v) {
    setRestzeitZyklus(v, 0);
    setRestzeitAnzeigeGesamt(v, 0);
}

function leseVentilAusAnSchalter(v) {
    if (existsState(v.dp.ausAn)) return alsBool(getVal(v.dp.ausAn, false), false);
    if (v.nr === 1 && existsState(V1_MANUELL_ALT)) return alsBool(getVal(V1_MANUELL_ALT, false), false);
    return false;
}

function leseHardwareZiel(v) {
    const hw = String(getVal(v.dp.ausgang, v.zielDefault) || '').trim();
    return hw || v.zielDefault;
}

function istVentilFrei(v) {
    return alsBool(getVal(v.dp.aktiviert, true), true);
}

function istVentilPausiert(v) {
    return getVal(v.dp.pause, false) === true;
}

function istZustandPause(v) {
    return parseInt(getVal(v.dp.zustand, ZUSTAND.BEREIT), 10) === ZUSTAND.PAUSE;
}

function istZustandBereit(v) {
    return parseInt(getVal(v.dp.zustand, ZUSTAND.BEREIT), 10) === ZUSTAND.BEREIT;
}

function pruefeLaufBeendet(v) {
    const wieder = parseInt(getVal(v.dp.wiederholungenAktuel, 0), 10) || 0;
    if (wieder === 0 && istZustandPause(v)) {
        if (istSchleifeLaeuft() && schleifeLauf.ausAnEin.has(v.nr) && !schleifeLauf.ignoriert.has(v.nr)) {
            return;
        }
        setVentilAusAnSchalter(v, false, true);
        setIntern(v.dp.pause, false);
        logInfo(`Ventil ${v.nr}: WiederholungenAktuel=0 + Zustand=Pause → Aus/An=false, Pause=false`);
    }
}

function setWiederholungenAktuelSchleife(v, n) {
    const wert = Math.max(0, parseInt(n, 10) || 0);
    v.lauf.wiederholungAktuell = wert;
    setIntern(v.dp.wiederholungenAktuel, wert);
    aktualisiereRestzeitAnzeige(v);
}

function setWiederholungenAktuel(v, n) {
    const wert = Math.max(0, parseInt(n, 10) || 0);
    setIntern(v.dp.wiederholungenAktuel, wert);
    aktualisiereRestzeitAnzeige(v);
    pruefeLaufBeendet(v);
}

function resetWiederholungenLauf(v) {
    v.lauf.wiederholungAktuell = 0;
    setWiederholungenAktuel(v, 0);
}

function startWiederholungenLauf(v) {
    v.lauf.wiederholungAktuell = leseWiederholungen(v);
    setWiederholungenAktuel(v, v.lauf.wiederholungAktuell);
}

function leseWiederholungen(v) {
    const w = parseInt(getVal(v.dp.wiederholungen, KONFIG_WIEDERHOLUNGEN_DEFAULT), 10);
    return Math.max(1, Math.min(99, isNaN(w) ? KONFIG_WIEDERHOLUNGEN_DEFAULT : w));
}

function leseBewaesserungsdauerMin(v) {
    const d = parseInt(getVal(v.dp.dauer, KONFIG_DAUER_DEFAULT), 10);
    return Math.max(1, Math.min(120, isNaN(d) ? KONFIG_DAUER_DEFAULT : d));
}

function leseGesamtzeitMin(v) {
    return leseBewaesserungsdauerMin(v) * leseWiederholungen(v);
}

function leseGesamtzeitSek(v) {
    return leseGesamtzeitMin(v) * 60;
}

function istVentilAktiv(v) {
    return getVal(v.dp.aktiv, false) === true;
}

function setzeZustandBewaesserung(v) {
    const kurz = formatDatumKurzDe(Date.now());
    setIntern(v.dp.zustand, ZUSTAND.BEWAESSERUNG);
    setIntern(v.dp.letzteBewaesserung, kurz);
    aktualisiereStatusNaechsteBewaesserung();
}

function speichereLaufzustand(v) {
    const l = v.lauf;
    if (l.gesamtEndeMs) {
        l.gesamtRestBeiPause = Math.max(0, l.gesamtEndeMs - Date.now());
    }
    if (l.laufEndeMs) {
        l.zyklusRestBeiPause = Math.max(0, l.laufEndeMs - Date.now());
    }
    l.pauseGespeichert = l.gesamtRestBeiPause > 0 || l.zyklusRestBeiPause > 0 || l.wiederholungAktuell > 0;
}

function loescheLaufzustand(v) {
    const l = v.lauf;
    l.pauseGespeichert = false;
    l.gesamtRestBeiPause = 0;
    l.zyklusRestBeiPause = 0;
}

function wiederherstelleGesamtEnde(v) {
    const l = v.lauf;
    if (l.gesamtRestBeiPause > 0) {
        l.gesamtEndeMs = Date.now() + l.gesamtRestBeiPause;
    }
}

function stoppeLaufTimerOhneReset(v) {
    const l = v.lauf;
    if (l.endeTimer) {
        clearTimeout(l.endeTimer);
        l.endeTimer = null;
    }
    if (l.restzeitTicker) {
        clearInterval(l.restzeitTicker);
        l.restzeitTicker = null;
    }
    l.gesamtEndeMs = 0;
    l.laufEndeMs = 0;
}

function aktualisiereGesamtRestzeit(v) {
    const l = v.lauf;
    if (!l.gesamtEndeMs) return;
    const restMs = Math.max(0, l.gesamtEndeMs - Date.now());
    if (restMs <= 0) l.gesamtRestBeiPause = 0;
}

function aktualisiereZyklusRestzeit(v) {
    const l = v.lauf;
    if (!l.laufEndeMs) return;
    const restMs = Math.max(0, l.laufEndeMs - Date.now());
    const restSek = Math.ceil(restMs / 1000);
    setRestzeitZyklus(v, restSek);
    if (restMs <= 0) {
        ventilZyklusBeendet(v, 'Countdown beendet');
    }
}

function tickRestzeiten(v) {
    aktualisiereGesamtRestzeit(v);
    aktualisiereZyklusRestzeit(v);
}

function starteRestzeitTicker(v) {
    const l = v.lauf;
    if (l.restzeitTicker) return;
    tickRestzeiten(v);
    l.restzeitTicker = setInterval(() => tickRestzeiten(v), 1000);
}

function starteCountdown(v, grund) {
    const l = v.lauf;
    if (l.endeTimer) {
        clearTimeout(l.endeTimer);
        l.endeTimer = null;
    }
    l.laufEndeMs = 0;
    wiederherstelleGesamtEnde(v);
    const dauerMin = leseBewaesserungsdauerMin(v);
    const zyklusMs = l.zyklusRestBeiPause > 0 ? l.zyklusRestBeiPause : leseCountdownSek(v) * 1000;
    const dauerSek = Math.ceil(zyklusMs / 1000);
    l.zyklusRestBeiPause = 0;
    l.laufEndeMs = Date.now() + zyklusMs;
    tickRestzeiten(v);
    starteRestzeitTicker(v);
    l.endeTimer = setTimeout(
        () => ventilZyklusBeendet(v, `Timer (${dauerSek} s, ${grund})`),
        zyklusMs
    );
    logInfo(`Ventil ${v.nr}: Countdown ${dauerSek} s (${dauerMin} min, ${grund})`);
}

function stoppeZyklusCountdown(v) {
    const l = v.lauf;
    if (l.endeTimer) {
        clearTimeout(l.endeTimer);
        l.endeTimer = null;
    }
    l.laufEndeMs = 0;
}

function stoppeCountdown(v) {
    stoppeLaufTimerOhneReset(v);
    loescheLaufzustand(v);
}

function fortsetzenNachPause(v) {
    const l = v.lauf;
    if (!l.pauseGespeichert) return false;
    l.zyklusBeendetLaeuft = false;
    const hw = leseHardwareZiel(v);
    const hatZyklus = l.zyklusRestBeiPause > 0;
    const hatWiederholungen = l.wiederholungAktuell > 0;
    if (hatZyklus || hatWiederholungen) {
        if (existsState(hw)) setHardware(hw, ZIEL_WERT_EIN);
        setIntern(v.dp.aktiv, true);
        setzeZustandBewaesserung(v);
        l.pauseGespeichert = false;
        starteCountdown(v, 'Fortsetzen');
        logInfo(`Ventil ${v.nr} fortgesetzt – Anzeige ${getVal(v.dp.restzeitAnzeige)}, Wiederholungen ${l.wiederholungAktuell}`);
        return true;
    }
    if (l.gesamtRestBeiPause > 0) {
        wiederherstelleGesamtEnde(v);
        starteRestzeitTicker(v);
        l.pauseGespeichert = false;
        logInfo(`Ventil ${v.nr} fortgesetzt – Summen-Countdown (${getVal(v.dp.restzeitAnzeige)} s)`);
        return true;
    }
    l.pauseGespeichert = false;
    return false;
}

// ─── WETTERDATEN ─────────────────────────────────────────────────────────────
// Konfig.Quellpfad_* → Messwerte.* (Live-Abo + Sync alle 5 min)

function leseWetterdatenVal(id, fallback) {
    if (!existsState(id)) return fallback;
    const s = getState(id);
    return s && s.val !== null && s.val !== undefined ? s.val : fallback;
}

function leseWetterdatenBool(id, fallback) {
    return alsBool(leseWetterdatenVal(id, fallback), fallback);
}

function leseWetterAnbieter() {
    return String(leseWetterdatenVal(`${WETTERDATEN_KONFIG}.Wetter_Anbieter`, WETTER_ANBIETER_DEFAULT) || WETTER_ANBIETER_DEFAULT).trim();
}

function leseAnbieterSpeicher() {
    const roh = leseWetterdatenVal(ANBIETER_SPEICHER_ID, '{}');
    if (roh && typeof roh === 'object') return roh;
    try {
        return JSON.parse(String(roh || '{}'));
    } catch (e) {
        return {};
    }
}

function schreibeAnbieterSpeicher(speicher) {
    setIntern(ANBIETER_SPEICHER_ID, JSON.stringify(speicher));
}

function sammleAktuelleAnbieterKonfig() {
    const cfg = {};
    for (let i = 0; i < WETTERDATEN_TYPEN.length; i++) {
        const typ = WETTERDATEN_TYPEN[i];
        cfg[`Quellpfad_${typ}`] = leseWetterdatenQuellpfad(typ);
    }
    cfg.OpenMeteoOrt = String(leseWetterdatenVal(`${WETTERDATEN_KONFIG}.OpenMeteoOrt`, '') || '').trim();
    return cfg;
}

function hatGespeicherteAnbieterKonfig(konfig) {
    if (!konfig || typeof konfig !== 'object') return false;
    for (let i = 0; i < WETTERDATEN_TYPEN.length; i++) {
        if (String(konfig[`Quellpfad_${WETTERDATEN_TYPEN[i]}`] || '').trim()) return true;
    }
    return false;
}

function speichereAnbieterKonfig(anbieter) {
    const key = String(anbieter || '').trim();
    if (!key) return;
    const speicher = leseAnbieterSpeicher();
    speicher[key] = sammleAktuelleAnbieterKonfig();
    schreibeAnbieterSpeicher(speicher);
}

function wendeAnbieterKonfig(anbieter, konfig) {
    const key = String(anbieter || '').trim();
    if (!key || key === 'Eigene Daten') {
        if (!hatGespeicherteAnbieterKonfig(konfig)) return false;
    }

    let openMeteoOrt = '';
    let quellpfade = null;

    if (hatGespeicherteAnbieterKonfig(konfig)) {
        quellpfade = {};
        for (let i = 0; i < WETTERDATEN_TYPEN.length; i++) {
            const typ = WETTERDATEN_TYPEN[i];
            quellpfade[typ] = String(konfig[`Quellpfad_${typ}`] || '').trim();
        }
        openMeteoOrt = String(konfig.OpenMeteoOrt || '').trim();
    } else if (key !== 'Eigene Daten') {
        openMeteoOrt = (key === 'open-meteo-weather.0' && istGueltigerOpenMeteoOrt(konfig?.OpenMeteoOrt))
            ? konfig.OpenMeteoOrt
            : leseOpenMeteoOrt();
        quellpfade = baueWetterQuellpfade(key, openMeteoOrt);
    }

    if (!quellpfade) return false;

    if (key === 'open-meteo-weather.0') {
        if (istGueltigerOpenMeteoOrt(openMeteoOrt)) {
            setIntern(`${WETTERDATEN_KONFIG}.OpenMeteoOrt`, openMeteoOrt);
        } else {
            bereinigeOpenMeteoOrtSpeicher();
        }
    }

    for (let i = 0; i < WETTERDATEN_TYPEN.length; i++) {
        const typ = WETTERDATEN_TYPEN[i];
        setIntern(`${WETTERDATEN_KONFIG}.Quellpfad_${typ}`, quellpfade[typ] || '');
    }
    return true;
}

/** Nur Ortsname für Open-Meteo (z. B. Neu_Wulmstorf) – keine State-IDs, keine Adapter-Pfade */
function istGueltigerOpenMeteoOrt(ort) {
    const s = String(ort || '').trim();
    if (!s) return false;
    if (s === `${WETTERDATEN_KONFIG}.OpenMeteoOrt`) return false;
    if (s.includes('0_userdata.') || s.includes('beregnungswerk.') || s.includes('Beregnungswerk') || s.includes('MeineBewaesserung')) return false;
    if (/\.0\./.test(s) || s.indexOf('.') !== -1) return false;
    return /^[A-Za-z0-9_-]+$/.test(s);
}

function leseOpenMeteoOrt() {
    const roh = String(leseWetterdatenVal(`${WETTERDATEN_KONFIG}.OpenMeteoOrt`, '') || '').trim();
    if (istGueltigerOpenMeteoOrt(roh)) return roh;
    const standortPfad = leseWetterdatenQuellpfad('Standort');
    if (standortPfad && istStandortInstanzPfad(standortPfad)) {
        const ort = standortPfad.split('.').pop();
        if (istGueltigerOpenMeteoOrt(ort)) return ort;
    }
    return OPEN_METEO_ORT_DEFAULT;
}

function bereinigeOpenMeteoOrtSpeicher() {
    const id = `${WETTERDATEN_KONFIG}.OpenMeteoOrt`;
    const roh = String(leseWetterdatenVal(id, '') || '').trim();
    const neu = leseOpenMeteoOrt();
    if (roh !== neu) {
        setIntern(id, neu);
        if (roh) logInfo(`OpenMeteoOrt bereinigt: „${roh}“ → „${neu}“`);
    }
    return neu;
}

function istKaputterOpenMeteoQuellpfad(pfad) {
    const p = String(pfad || '').trim();
    if (!p.startsWith('open-meteo-weather.0.')) return false;
    if (istStandortInstanzPfad(p)) {
        return !istGueltigerOpenMeteoOrt(p.split('.').pop());
    }
    const m = p.match(/^open-meteo-weather\.0\.(.+?)\.weather\./);
    if (!m) return true;
    return !istGueltigerOpenMeteoOrt(m[1]);
}

function istStandortInstanzPfad(quellPfad) {
    return quellPfad.indexOf('open-meteo-weather.0.') !== -1 && quellPfad.indexOf('.weather.') === -1;
}

function leseStandortAnzeige(quellPfad) {
    if (istStandortInstanzPfad(quellPfad)) {
        return quellPfad.split('.').pop().replace(/_/g, ' ') || 'Keine Daten';
    }
    if (existsState(quellPfad)) {
        const val = getState(quellPfad).val;
        if (val !== null && val !== undefined && val !== '') return val;
    }
    return 'Keine Daten';
}

function baueWetterQuellpfade(anbieter, ort) {
    const ortName = String(ort || OPEN_METEO_ORT_DEFAULT).trim() || OPEN_METEO_ORT_DEFAULT;
    if (anbieter === 'open-meteo-weather.0') {
        return {
            Standort: `open-meteo-weather.0.${ortName}`,
            Niederschlag_Heute: `open-meteo-weather.0.${ortName}.weather.current.precipitation`,
            Niederschlag_Morgen: `open-meteo-weather.0.${ortName}.weather.forecast.day1.precipitation_sum`,
            Temperatur: `open-meteo-weather.0.${ortName}.weather.current.temperature_2m`,
            Luftfeuchtigkeit: `open-meteo-weather.0.${ortName}.weather.current.relative_humidity_2m`,
        };
    }
    if (anbieter === 'daswetter.0') {
        return {
            Standort: 'daswetter.0.NextHours.Location',
            Niederschlag_Heute: 'daswetter.0.NextHours.Rain',
            Niederschlag_Morgen: 'daswetter.0.Forecast.Day2.Rain',
            Temperatur: 'daswetter.0.NextHours.Temperature',
            Luftfeuchtigkeit: 'daswetter.0.NextHours.Humidity',
        };
    }
    if (anbieter === 'weatherunderground.0') {
        return {
            Standort: 'weatherunderground.0.forecast.current.displayLocationFull',
            Niederschlag_Heute: 'weatherunderground.0.forecast.current.precipitationDay',
            Niederschlag_Morgen: 'weatherunderground.0.forecast.1d.precipitationAllDay',
            Temperatur: 'weatherunderground.0.forecast.current.temp',
            Luftfeuchtigkeit: 'weatherunderground.0.forecast.current.relativeHumidity',
        };
    }
    if (anbieter === 'Eigene Daten') {
        return {
            Standort: '',
            Niederschlag_Heute: '',
            Niederschlag_Morgen: '',
            Temperatur: '',
            Luftfeuchtigkeit: '',
        };
    }
    return null;
}

/** Alte (falsche) WU-Vorlagen – werden beim Start auf aktuelle Adapter-IDs umgestellt */
const WU_LEGACY_QUELLPFADE = {
    'weatherunderground.0.forecast.current.precipitation': 'Niederschlag_Heute',
    'weatherunderground.0.forecast.day1.precipitation': 'Niederschlag_Morgen',
    'weatherunderground.0.forecast.current.temperature': 'Temperatur',
};

/** true = leer oder exakte Adapter-Vorlage (darf bei Anbieter-Wechsel ersetzt werden) */
function istAutomatischerWetterQuellpfad(pfad) {
    const p = String(pfad || '').trim();
    if (!p) return true;
    if (istKaputterOpenMeteoQuellpfad(p)) return true;
    if (WU_LEGACY_QUELLPFADE[p]) return true;

    if (p.startsWith('daswetter.0.')) {
        const tpl = baueWetterQuellpfade('daswetter.0', '');
        return WETTERDATEN_TYPEN.some((typ) => p === tpl[typ]);
    }
    if (p.startsWith('weatherunderground.0.')) {
        const tpl = baueWetterQuellpfade('weatherunderground.0', '');
        return WETTERDATEN_TYPEN.some((typ) => p === tpl[typ]);
    }
    if (p.startsWith('open-meteo-weather.0.')) {
        const ortMatch = p.match(/^open-meteo-weather\.0\.([^.]+)/);
        if (!ortMatch) return false;
        const tpl = baueWetterQuellpfade('open-meteo-weather.0', ortMatch[1]);
        return WETTERDATEN_TYPEN.some((typ) => p === tpl[typ]);
    }
    return false;
}

function sindAlleWetterQuellpfadeLeer() {
    for (let i = 0; i < WETTERDATEN_TYPEN.length; i++) {
        if (leseWetterdatenQuellpfad(WETTERDATEN_TYPEN[i])) return false;
    }
    return true;
}

function migriereWeatherUndergroundQuellpfade() {
    if (leseWetterAnbieter() !== 'weatherunderground.0') return;
    const tpl = baueWetterQuellpfade('weatherunderground.0', '');
    if (!tpl) return;

    for (const altPfad in WU_LEGACY_QUELLPFADE) {
        const typ = WU_LEGACY_QUELLPFADE[altPfad];
        const zielId = `${WETTERDATEN_KONFIG}.Quellpfad_${typ}`;
        const aktuell = leseWetterdatenQuellpfad(typ);
        const neu = tpl[typ] || '';
        if (aktuell === altPfad && neu && neu !== altPfad) {
            setIntern(zielId, neu);
            logInfo(`Weather Underground Quellpfad ${typ}: ${altPfad} → ${neu}`);
        }
    }
}

function autoPfadeBefuellen() {
    const anbieter = leseWetterAnbieter();
    if (!anbieter || anbieter === 'Eigene Daten') {
        planeSyncWetterdaten(300);
        return;
    }
    const ppfade = baueWetterQuellpfade(anbieter, leseOpenMeteoOrt());
    if (!ppfade) {
        planeSyncWetterdaten(300);
        return;
    }
    let gesetzt = 0;
    for (let i = 0; i < WETTERDATEN_TYPEN.length; i++) {
        const typ = WETTERDATEN_TYPEN[i];
        const zielId = `${WETTERDATEN_KONFIG}.Quellpfad_${typ}`;
        const aktuell = leseWetterdatenQuellpfad(typ);
        const neu = ppfade[typ] || '';
        if (aktuell === neu) continue;
        setIntern(zielId, neu);
        gesetzt++;
    }
    if (gesetzt) logInfo(`Wetterdaten-Quellpfade für ${anbieter}: ${gesetzt} Vorlage zugeordnet`);
    speichereAnbieterKonfig(anbieter);
    planeSyncWetterdaten(500);
}

function behandleWetterAnbieterWechsel(obj) {
    const altAnbieter = String(obj?.oldState?.val || '').trim();
    const neuAnbieter = String(obj?.state?.val || leseWetterAnbieter()).trim();

    if (altAnbieter && altAnbieter !== neuAnbieter) {
        speichereAnbieterKonfig(altAnbieter);
    }

    if (neuAnbieter === 'Eigene Daten') {
        const gespeichert = leseAnbieterSpeicher()[neuAnbieter];
        if (hatGespeicherteAnbieterKonfig(gespeichert)) {
            wendeAnbieterKonfig(neuAnbieter, gespeichert);
            logInfo('Wetter-Anbieter „Eigene Daten“: gespeicherte Quellpfade wiederhergestellt');
        }
        planeSyncWetterdaten(500);
        return;
    }

    const gespeichert = leseAnbieterSpeicher()[neuAnbieter];
    if (hatGespeicherteAnbieterKonfig(gespeichert)) {
        wendeAnbieterKonfig(neuAnbieter, gespeichert);
        logInfo(`Wetter-Anbieter ${neuAnbieter}: gespeicherte Quellpfade wiederhergestellt`);
        planeSyncWetterdaten(500);
        return;
    }

    if (neuAnbieter === 'open-meteo-weather.0') {
        bereinigeOpenMeteoOrtSpeicher();
    } else {
        const id = `${WETTERDATEN_KONFIG}.OpenMeteoOrt`;
        const roh = String(leseWetterdatenVal(id, '') || '').trim();
        if (roh && !istGueltigerOpenMeteoOrt(roh)) {
            setIntern(id, OPEN_METEO_ORT_DEFAULT);
            logInfo(`OpenMeteoOrt zurückgesetzt: „${roh}“ → „${OPEN_METEO_ORT_DEFAULT}“`);
        }
    }
    autoPfadeBefuellen();
}

function behandleOpenMeteoOrtAenderung(obj) {
    if (leseWetterAnbieter() !== 'open-meteo-weather.0') {
        planeSyncWetterdaten(300);
        return;
    }
    const val = String(obj?.state?.val || '').trim();
    if (!istGueltigerOpenMeteoOrt(val)) {
        const fallback = leseOpenMeteoOrt();
        setState(obj.id, fallback, true);
        logWarn(`OpenMeteoOrt ungültig „${val}“ – verwende „${fallback}“`);
    }
    autoPfadeBefuellen();
}

function sammleWetterQuellStateIds() {
    const ids = [];
    for (let i = 0; i < WETTERDATEN_TYPEN.length; i++) {
        const typ = WETTERDATEN_TYPEN[i];
        const quellPfad = leseWetterdatenQuellpfad(typ);
        if (!quellPfad) continue;
        if (typ === 'Standort' && istStandortInstanzPfad(quellPfad)) continue;
        ids.push(quellPfad);
    }
    return ids;
}

function planeSyncWetterdaten(delayMs) {
    if (wetterdatenSyncTimer) clearTimeout(wetterdatenSyncTimer);
    wetterdatenSyncTimer = setTimeout(() => {
        wetterdatenSyncTimer = null;
        bindeWetterdatenQuellen();
        syncWetterdaten();
        for (const v of VENTILE) {
            startFeuchtigkeitSensor(v);
            startTemperaturSensor(v);
        }
    }, delayMs == null ? 200 : delayMs);
}

function bindeWetterdatenQuellen() {
    const ids = sammleWetterQuellStateIds();
    const key = ids.join('|');
    if (key === wetterdatenQuellCache.key) return;

    for (let i = 0; i < wetterdatenQuellCache.subs.length; i++) {
        if (wetterdatenQuellCache.subs[i]) unsubscribe(wetterdatenQuellCache.subs[i]);
    }
    wetterdatenQuellCache = { key, subs: [] };

    for (let i = 0; i < ids.length; i++) {
        const quellId = ids[i];
        wetterdatenQuellCache.subs.push(on({ id: quellId, change: 'any' }, () => planeSyncWetterdaten(150)));
        if (!existsState(quellId)) {
            logWarn(`Wetterdaten-Quelle noch nicht vorhanden – Abo aktiv: ${quellId}`);
        }
    }
    if (ids.length) logInfo(`Wetterdaten-Quellen verbunden: ${ids.join(', ')}`);
}

function syncWetterdatenTyp(typ) {
    const quellPfad = leseWetterdatenQuellpfad(typ);
    const zielId = `${WETTERDATEN_MESSWERTE}.${typ}`;

    if (!quellPfad) {
        setIntern(zielId, 'Keine Daten');
        return;
    }

    if (typ === 'Standort') {
        setIntern(zielId, leseStandortAnzeige(quellPfad));
        return;
    }

    if (existsState(quellPfad)) {
        const stateObj = getState(quellPfad);
        if (stateObj && stateObj.val !== null && stateObj.val !== undefined && stateObj.val !== '') {
            setIntern(zielId, stateObj.val);
            return;
        }
        setIntern(zielId, 'Keine Daten');
        return;
    }

    setIntern(zielId, 'Keine Daten');
    logWarn(`Wetterdaten ${typ}: Quelle nicht gefunden: ${quellPfad}`);
}

function syncWetterdaten() {
    for (let i = 0; i < WETTERDATEN_TYPEN.length; i++) {
        syncWetterdatenTyp(WETTERDATEN_TYPEN[i]);
    }

    berechneWetterdatenSchwellenwert();
    aktualisiereAlleVentilSensoren(true);
}

function berechneWetterdatenSchwellenwert() {
    const fAktiv = leseWetterdatenBool(`${WETTERDATEN_SCHWELLE}.FeuchtigkeitAktiv`, false);
    const fSchwellwert = parseFloat(leseWetterdatenVal(`${WETTERDATEN_SCHWELLE}.FeuchtigkeitWert`, 40));
    const tAktiv = leseWetterdatenBool(`${WETTERDATEN_SCHWELLE}.TemperaturAktiv`, false);
    const tSchwellwert = parseFloat(leseWetterdatenVal(`${WETTERDATEN_SCHWELLE}.TemperaturWert`, 25));
    const rHeuteAktiv = leseWetterdatenBool(`${WETTERDATEN_SCHWELLE}.NiederschlagHeuteAktiv`, false);
    const rHeuteSchwellwert = parseFloat(leseWetterdatenVal(`${WETTERDATEN_SCHWELLE}.NiederschlagHeuteWert`, 5));
    const rMorgenAktiv = leseWetterdatenBool(`${WETTERDATEN_SCHWELLE}.NiederschlagMorgenAktiv`, false);
    const rMorgenSchwellwert = parseFloat(leseWetterdatenVal(`${WETTERDATEN_SCHWELLE}.NiederschlagMorgenWert`, 5));
    const richtungOben = parseVergleichObereSchwelle(
        leseWetterdatenVal(`${WETTERDATEN_SCHWELLE}.Vergleich`, true),
        true
    );

    const liveFeuchte = parseFloat(leseWetterdatenVal(`${WETTERDATEN_MESSWERTE}.Luftfeuchtigkeit`, ''));
    const liveTemp = parseFloat(leseWetterdatenVal(`${WETTERDATEN_MESSWERTE}.Temperatur`, ''));
    const liveRegenHeute = parseFloat(leseWetterdatenVal(`${WETTERDATEN_MESSWERTE}.Niederschlag_Heute`, ''));
    const liveRegenMorgen = parseFloat(leseWetterdatenVal(`${WETTERDATEN_MESSWERTE}.Niederschlag_Morgen`, ''));

    let fUeberschritten = false;
    let tUeberschritten = false;
    let rHeuteUeberschritten = false;
    let rMorgenUeberschritten = false;

    if (fAktiv && !isNaN(liveFeuchte)) {
        fUeberschritten = richtungOben ? liveFeuchte > fSchwellwert : liveFeuchte < fSchwellwert;
    }
    if (tAktiv && !isNaN(liveTemp)) {
        tUeberschritten = richtungOben ? liveTemp > tSchwellwert : liveTemp < tSchwellwert;
    }
    if (rHeuteAktiv && !isNaN(liveRegenHeute)) {
        rHeuteUeberschritten = richtungOben ? liveRegenHeute > rHeuteSchwellwert : liveRegenHeute < rHeuteSchwellwert;
    }
    if (rMorgenAktiv && !isNaN(liveRegenMorgen)) {
        rMorgenUeberschritten = richtungOben ? liveRegenMorgen > rMorgenSchwellwert : liveRegenMorgen < rMorgenSchwellwert;
    }

    const schwellenStatus = [];
    if (fAktiv) schwellenStatus.push(fUeberschritten);
    if (tAktiv) schwellenStatus.push(tUeberschritten);
    if (rHeuteAktiv) schwellenStatus.push(rHeuteUeberschritten);
    if (rMorgenAktiv) schwellenStatus.push(rMorgenUeberschritten);

    let gesamtErgebnis = false;
    if (schwellenStatus.length > 0) {
        gesamtErgebnis = schwellenStatus.includes(true);
    }

    setIntern(DP.wetterdatenSchwelleUeberschritten, gesamtErgebnis);
    aktualisiereWetterdatenSchwelleSperre();
}

function setAutomatikSchalterIntern(ein) {
    setSchleifenAutomatikIntern(!!ein, { beiAus: false, grund: 'Wettersperre' });
}

function aktualisiereWetterdatenAutomatikSperre() {
    const ueberschritten = istWetterSchwelleSperreAktiv();

    for (const v of VENTILE) {
        aktualisiereSchwellePruefung(v);
    }

    if (ueberschritten) {
        if (!wetterAutomatikSperre.blockiert) {
            wetterAutomatikSperre.regelAktivVorher = alsBool(getVal(DP.schleifeAktiv, false), false);
            wetterAutomatikSperre.schleifeAktivVorher = wetterAutomatikSperre.regelAktivVorher;
            wetterAutomatikSperre.blockiert = true;
        }
        const schleifeAn = alsBool(getVal(DP.schleifeAktiv, false), false);
        if (schleifeAn) {
            setAutomatikSchalterIntern(false);
            logInfo('Wetterschwelle überschritten – SchleifenSteuerung.Aktiv/RegelAktiv aus');
        }
        if (istSchleifeLaeuft() && !schleifeLauf.manuellGestartet) {
            stopSchleifeMitVentilen('Wetterschwelle überschritten');
            schleifeSetzeAlleVentileZurueck('Wetterschwelle überschritten');
        }
        return;
    }

    if (wetterAutomatikSperre.blockiert) {
        setAutomatikSchalterIntern(wetterAutomatikSperre.regelAktivVorher);
        wetterAutomatikSperre.blockiert = false;
        logInfo('Wetterschwelle OK – SchleifenSteuerung.Aktiv/RegelAktiv wieder frei');
    }
}

function aktualisiereWetterdatenSchwelleSperre() {
    aktualisiereWetterdatenAutomatikSperre();
}

function leseWetterdatenQuellpfad(typ) {
    return String(leseWetterdatenVal(`${WETTERDATEN_KONFIG}.Quellpfad_${typ}`, '') || '').trim();
}

const WETTER_SCHWELLE_TRIGGER_IDS = [
    `${WETTERDATEN_SCHWELLE}.FeuchtigkeitAktiv`,
    `${WETTERDATEN_SCHWELLE}.FeuchtigkeitWert`,
    `${WETTERDATEN_SCHWELLE}.TemperaturAktiv`,
    `${WETTERDATEN_SCHWELLE}.TemperaturWert`,
    `${WETTERDATEN_SCHWELLE}.NiederschlagHeuteAktiv`,
    `${WETTERDATEN_SCHWELLE}.NiederschlagHeuteWert`,
    `${WETTERDATEN_SCHWELLE}.NiederschlagMorgenAktiv`,
    `${WETTERDATEN_SCHWELLE}.NiederschlagMorgenWert`,
    `${WETTERDATEN_SCHWELLE}.Vergleich`,
].concat(WETTERDATEN_TYPEN.map((typ) => `${WETTERDATEN_MESSWERTE}.${typ}`));

function initWetterdatenSteuerung() {
    for (const s of WETTERDATEN_STATES_LIST) {
        if (!existsState(s.id)) {
            createStateBw(s.id, s.val, s.common);
            logDpAngelegt(s.id);
        }
    }

    const quellpfadIds = WETTERDATEN_TYPEN.map((typ) => `${WETTERDATEN_KONFIG}.Quellpfad_${typ}`);
    on({ id: `${WETTERDATEN_KONFIG}.Wetter_Anbieter`, change: 'ne' }, behandleWetterAnbieterWechsel);
    on({ id: `${WETTERDATEN_KONFIG}.OpenMeteoOrt`, change: 'ne' }, behandleOpenMeteoOrtAenderung);
    on({ id: quellpfadIds, change: 'ne' }, () => {
        speichereAnbieterKonfig(leseWetterAnbieter());
        planeSyncWetterdaten(300);
    });

    on({ id: WETTER_SCHWELLE_TRIGGER_IDS, change: 'ne' }, berechneWetterdatenSchwellenwert);

    migriereWetterdatenSchwelleBools();

    migriereWeatherUndergroundQuellpfade();

    if (leseWetterAnbieter() === 'open-meteo-weather.0') {
        bereinigeOpenMeteoOrtSpeicher();
    }

    on({ id: DP.wetterdatenSchwelleUeberschritten, change: 'any' }, aktualisiereWetterdatenSchwelleSperre);

    const anbieter = leseWetterAnbieter();
    const gespeichert = leseAnbieterSpeicher()[anbieter];

    if (hatGespeicherteAnbieterKonfig(gespeichert)) {
        setTimeout(() => {
            wendeAnbieterKonfig(anbieter, gespeichert);
            planeSyncWetterdaten(300);
        }, 500);
    } else if (!sindAlleWetterQuellpfadeLeer()) {
        speichereAnbieterKonfig(anbieter);
        planeSyncWetterdaten(300);
    } else if (anbieter !== 'Eigene Daten') {
        setTimeout(autoPfadeBefuellen, 500);
    } else {
        planeSyncWetterdaten(300);
    }
    logInfo('Wetterdaten-Modul gestartet');
}


// ─── VENTIL-SENSOREN ─────────────────────────────────────────────────────────

function leseFeuchtigkeitSensorId(v) {
    if (v.nr === 1) {
        const ausWetter = leseWetterdatenQuellpfad('Luftfeuchtigkeit');
        if (ausWetter) return ausWetter;
    }
    return String(getVal(v.dp.feuchtSensor, FEUCHT_SENSOR_DEFAULT) || FEUCHT_SENSOR_DEFAULT).trim();
}

function hatFeuchtigkeitssensor(v) {
    const id = leseFeuchtigkeitSensorId(v);
    return !!(id && existsState(id));
}

function leseTemperaturSensorId(v) {
    if (v.nr === 1) {
        const ausWetter = leseWetterdatenQuellpfad('Temperatur');
        if (ausWetter) return ausWetter;
    }
    return String(getVal(v.dp.tempSensor, TEMP_SENSOR_DEFAULT) || TEMP_SENSOR_DEFAULT).trim();
}

function leseTriggerId(v) {
    return leseFeuchtigkeitSensorId(v);
}

function formatFeuchtigkeitProzent(wert) {
    if (wert === null || wert === undefined || wert === '') return '– %';
    const n = parseFloat(wert);
    if (isNaN(n)) return '– %';
    return `${Math.round(n * 10) / 10} %`;
}

function leseSensorFeuchtigkeit(sensorId) {
    if (!sensorId || !existsState(sensorId)) return null;
    const val = getState(sensorId).val;
    if (val === null || val === undefined || val === '') return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
}

function pruefeSchwelleVentilStarts() {
    for (const v of VENTILE) {
        if (!istVentilFrei(v) || istVentilPausiert(v)) continue;
        if (!hatAktiveSchwellePruefung(v)) continue;
        const ventilErgebnis = aktualisiereSchwellePruefung(v);
        if (istSchwelleSperreAktiv(v) || !ventilErgebnis || istVentilAktiv(v)) continue;
        if (istSchwelleObereGrenze(v)) continue;
        setzeVentil(v, true, 'Schwelle überschritten');
    }
}

function aktualisiereFeuchtigkeit(v) {
    const feuchte = leseSensorFeuchtigkeit(leseFeuchtigkeitSensorId(v));
    setIntern(v.dp.feuchtAnzeige, formatFeuchtigkeitProzent(feuchte));
    aktualisiereSchwellePruefung(v);
}

function bindeFeuchtigkeitSensor(v) {
    const sensorId = leseFeuchtigkeitSensorId(v);
    if (sensorId === v.lauf.feuchtigkeitSensorAbo) return;
    if (v.lauf.feuchtigkeitSensorSub) {
        unsubscribe(v.lauf.feuchtigkeitSensorSub);
        v.lauf.feuchtigkeitSensorSub = null;
    }
    v.lauf.feuchtigkeitSensorAbo = sensorId;
    if (!sensorId) {
        aktualisiereFeuchtigkeit(v);
        return;
    }
    if (!existsState(sensorId)) {
        logWarn(`Ventil ${v.nr}: Feuchtigkeitssensor nicht gefunden: ${sensorId}`);
        setIntern(v.dp.feuchtAnzeige, '– %');
        return;
    }
    v.lauf.feuchtigkeitSensorSub = on({ id: sensorId, change: 'any' }, () => {
        aktualisiereFeuchtigkeit(v);
        pruefeSchwelleVentilStarts();
    });
    aktualisiereFeuchtigkeit(v);
    logInfo(`Ventil ${v.nr}: Feuchtigkeitssensor verbunden: ${sensorId}`);
}

function startFeuchtigkeitSensor(v) {
    const sensorId = leseFeuchtigkeitSensorId(v);
    if (!sensorId) return;
    if (!existsState(sensorId)) {
        setIntern(v.dp.feuchtAnzeige, '– %');
        return;
    }
    bindeFeuchtigkeitSensor(v);
}

function formatExternTempAnzeige(wert) {
    if (wert === null || wert === undefined || wert === '') return '– °C';
    const n = parseFloat(wert);
    if (!isNaN(n)) return `${Math.round(n * 10) / 10} °C`;
    return `${wert} °C`;
}

function leseSensorWert(sensorId) {
    if (!sensorId || !existsState(sensorId)) return null;
    const val = getState(sensorId).val;
    if (val === null || val === undefined || val === '') return null;
    const n = parseFloat(val);
    return isNaN(n) ? val : n;
}

function aktualisiereTemperatur(v) {
    const wert = leseSensorWert(leseTemperaturSensorId(v));
    setIntern(v.dp.externTempAnzeige, formatExternTempAnzeige(wert));
    aktualisiereSchwellePruefung(v);
}

function bindeTemperaturSensor(v) {
    const sensorId = leseTemperaturSensorId(v);
    if (sensorId === v.lauf.temperaturSensorAbo) return;
    if (v.lauf.temperaturSensorSub) {
        unsubscribe(v.lauf.temperaturSensorSub);
        v.lauf.temperaturSensorSub = null;
    }
    v.lauf.temperaturSensorAbo = sensorId;
    if (!sensorId) {
        setIntern(v.dp.externTempAnzeige, '– °C');
        return;
    }
    if (!existsState(sensorId)) {
        logWarn(`Ventil ${v.nr}: Temperatursensor nicht gefunden: ${sensorId}`);
        setIntern(v.dp.externTempAnzeige, '– °C');
        return;
    }
    v.lauf.temperaturSensorSub = on({ id: sensorId, change: 'any' }, () => {
        aktualisiereTemperatur(v);
        pruefeSchwelleVentilStarts();
    });
    aktualisiereTemperatur(v);
    logInfo(`Ventil ${v.nr}: Temperatursensor verbunden: ${sensorId}`);
}

function startTemperaturSensor(v) {
    const sensorId = leseTemperaturSensorId(v);
    if (!sensorId) {
        setIntern(v.dp.externTempAnzeige, '– °C');
        return;
    }
    if (!existsState(sensorId)) {
        setIntern(v.dp.externTempAnzeige, '– °C');
        return;
    }
    bindeTemperaturSensor(v);
}

function startTrigger(v) {
    const triggerId = leseTriggerId(v);
    if (!triggerId || !existsState(triggerId)) return;
    if (v.lauf.automatikTriggerAbo === triggerId) return;
    v.lauf.automatikTriggerAbo = triggerId;
    logInfo(`Ventil ${v.nr}: Schwelle-Trigger aktiv: ${triggerId}`);
}

function aktualisiereAlleVentilSensoren(mitSchwellenStart) {
    for (const v of VENTILE) {
        aktualisiereFeuchtigkeit(v);
        aktualisiereTemperatur(v);
    }
    if (mitSchwellenStart) pruefeSchwelleVentilStarts();
}

function istSchwelleSperreAktiv(v) {
    return alsBool(getVal(v.dp.schwelleSperre, false), false);
}

function sollSchwelleSperreDurchsetzen() {
    return true;
}

function schleifeDarfAusAnEinschalten(v) {
    return istSchleifeLaeuft() && !schleifeLauf.stopAngefordert && !schleifeLauf.ausAnEin.has(v.nr);
}

function schleifeMarkiereAusAnGesendet(v) {
    if (!schleifeLauf.ausAnEin.has(v.nr)) {
        schleifeLauf.ausAnEin.add(v.nr);
    }
}

function setVentilAusAnSchalter(v, an, nurIntern) {
    let val = alsBool(an, false);

    if (val && istSchleifeLaeuft() && !schleifeLauf.stopAngefordert) {
        if (schleifeLauf.ausAnEin.has(v.nr)) {
            if (!leseVentilAusAnSchalter(v)) {
                logInfo(`Schleife: Ventil ${v.nr} Ventil${v.nr}_AusAn=true blockiert (nur erster Schleifen-Durchlauf)`);
            }
            return;
        }
        schleifeMarkiereAusAnGesendet(v);
    }

    if (!val && istSchleifeLaeuft() && !schleifeLauf.stopAngefordert) {
        if (schleifeLauf.ausAnEin.has(v.nr) && !schleifeLauf.ignoriert.has(v.nr)) {
            logInfo(`Schleife: Ventil ${v.nr} Ventil${v.nr}_AusAn=false blockiert (Schleife läuft)`);
            return;
        }
    }

    if (val && istSchwelleSperreAktiv(v) && sollSchwelleSperreDurchsetzen()) val = false;

    if (existsState(v.dp.ausAn)) setState(v.dp.ausAn, val, nurIntern === true);
    if (v.nr === 1 && existsState(V1_MANUELL_ALT)) setState(V1_MANUELL_ALT, val, nurIntern === true);
    aktualisiereRestzeitAnzeige(v);
}

function behandleVentilAusAnWechsel(v, obj) {
    if (!istNutzerEingabe(obj)) return;
    const quelleId = obj.id;
    const manuellAn = alsBool(obj.state.val, false);
    if (manuellAn && istSchwelleSperreAktiv(v)) {
        setVentilAusAnSchalter(v, false, true);
        logWarn(`Ventil ${v.nr}: Aus/An blockiert – SchwelleSPERRE aktiv.`);
        return;
    }
    if (manuellAn && istSchleifeLaeuft() && schleifeLauf.ausAnEin.has(v.nr)) {
        logWarn(`Ventil ${v.nr}: AusAn manuell blockiert – bereits im ersten Schleifen-Durchlauf gesetzt`);
        const aktuell = leseVentilAusAnSchalter(v);
        if (existsState(v.dp.ausAn)) setState(v.dp.ausAn, aktuell, true);
        if (v.nr === 1 && existsState(V1_MANUELL_ALT)) setState(V1_MANUELL_ALT, aktuell, true);
        return;
    }
    if (!istVentilFrei(v)) {
        setVentilAusAnSchalter(v, false, true);
        logWarn(`Ventil ${v.nr}: Aus/An blockiert – deaktiviert (Reparatur).`);
        return;
    }
    const warAn = obj.oldState?.val === true || obj.oldState?.val === 1 || obj.oldState?.val === '1';
    if (!manuellAn && warAn && istVentilPausiert(v)) {
        setVentilAusAnSchalter(v, false, true);
        beendeManuellUndPause(v);
        return;
    }
    if (manuellAn && istVentilPausiert(v)) {
        setVentilAusAnSchalter(v, false, true);
        logWarn(`Ventil ${v.nr}: Aus/An blockiert – Pause aktiv.`);
        return;
    }
    setVentilAusAnSchalter(v, manuellAn, true);
    if (v.nr === 1) {
        if (quelleId === V1_MANUELL_ALT && existsState(v.dp.ausAn)) {
            setState(v.dp.ausAn, manuellAn, true);
        } else if (quelleId === v.dp.ausAn && existsState(V1_MANUELL_ALT)) {
            setState(V1_MANUELL_ALT, manuellAn, true);
        }
    }
    setzeVentil(v, manuellAn, `Ventil${v.nr} Aus/An`);
}

function sperreSteuerungWennDeaktiviert(v) {
    if (istVentilFrei(v)) return;
    if (istVentilAktiv(v)) ventilBeenden(v, 'Deaktiviert');
    setVentilAusAnSchalter(v, false, true);
    setIntern(v.dp.pause, false);
    logInfo(`Ventil ${v.nr} deaktiviert – Aus/An und Pause gesperrt`);
}

function setPauseAnzeige(v, pause) {
    if (!!pause && !istVentilFrei(v)) {
        setIntern(v.dp.pause, false);
        return;
    }
    setIntern(v.dp.pause, !!pause);
}

function ventilPauseAktivieren(v) {
    if (!istVentilAktiv(v)) {
        setIntern(v.dp.zustand, ZUSTAND.PAUSE);
        logInfo(`Ventil ${v.nr} PAUSE (bereit)`);
        return;
    }
    v.lauf.zyklusBeendetLaeuft = false;
    speichereLaufzustand(v);
    stoppeLaufTimerOhneReset(v);
    const hw = leseHardwareZiel(v);
    if (!setHardware(hw, ZIEL_WERT_AUS)) {
        logWarn(`Ventil ${v.nr}: Pause – Ausgang nicht gesetzt (${hw || 'leer'})`);
    }
    setIntern(v.dp.zustand, ZUSTAND.PAUSE);
    logInfo(`Ventil ${v.nr} PAUSE – Anzeige=${getVal(v.dp.restzeitAnzeige)}, Wiederholungen=${v.lauf.wiederholungAktuell}`);
}

function ventilPauseDeaktivieren(v) {
    if (fortsetzenNachPause(v)) return;
    setIntern(v.dp.zustand, ZUSTAND.BEREIT);
    logInfo(`Ventil ${v.nr} Pause aus`);
}

function ventilZyklusBeendet(v, grund) {
    const l = v.lauf;
    if (!istVentilAktiv(v) || l.zyklusBeendetLaeuft) return;
    l.zyklusBeendetLaeuft = true;
    speichereLaufzustand(v);
    stoppeZyklusCountdown(v);
    if (l.restzeitTicker) {
        clearInterval(l.restzeitTicker);
        l.restzeitTicker = null;
    }
    l.gesamtEndeMs = 0;
    setRestzeitZyklus(v, 0);
    l.wiederholungAktuell = Math.max(0, l.wiederholungAktuell - 1);
    logInfo(`Ventil ${v.nr}: Restzeit 0 → WiederholungenAktuel=${l.wiederholungAktuell} (${grund})`);
    setPauseAnzeige(v, true);
    setHardware(leseHardwareZiel(v), ZIEL_WERT_AUS);
    l.zyklusRestBeiPause = 0;
    l.pauseGespeichert = false;
    setIntern(v.dp.aktiv, false);
    setIntern(v.dp.zustand, ZUSTAND.PAUSE);
    l.zyklusBeendetLaeuft = false;

    if (istSchleifeLaeuft() && leseSchleifeAktuellesVentilNr() === v.nr) {
        setWiederholungenAktuelSchleife(v, l.wiederholungAktuell);
        behandleSchleifeNachVentilZyklus(v);
        return;
    }

    setWiederholungenAktuel(v, l.wiederholungAktuell);
    if (l.wiederholungAktuell > 0) {
        l.pauseGespeichert = true;
        logInfo(`Ventil ${v.nr}: Pause – noch ${l.wiederholungAktuell} Wiederholung(en)`);
        return;
    }
    ventilBeenden(v, grund);
}

function beendeManuellUndPause(v) {
    stoppeCountdown(v);
    v.lauf.zyklusBeendetLaeuft = false;
    v.lauf.wiederholungAktuell = 0;
    setHardware(leseHardwareZiel(v), ZIEL_WERT_AUS);
    setIntern(v.dp.aktiv, false);
    setVentilAusAnSchalter(v, false, true);
    setIntern(v.dp.pause, false);
    setIntern(v.dp.zustand, ZUSTAND.BEREIT);
    setRestzeitIdle(v);
    setWiederholungenAktuel(v, 0);
    logInfo(`Ventil ${v.nr}: Aus/An=false bei Pause → Reset`);
}

function ventilBeenden(v, grund) {
    if (istSchleifeLaeuft() && leseSchleifeAktuellesVentilNr() === v.nr && !schleifeLauf.stopAngefordert) {
        const normalEnde =
            grund === 'SchleifenSteuerung' ||
            String(grund).includes('Timer') ||
            String(grund).includes('Countdown');
        const schleifeWeiter =
            grund === 'Deaktiviert' ||
            String(grund).includes('Schleife Aktiviert') ||
            String(grund).includes('Schleife SchwelleSperre');
        const manuellAbbruch = !normalEnde && !schleifeWeiter;
        if (manuellAbbruch) {
            stopSchleifeMitVentilen(`Ventil ${v.nr}: ${grund}`);
            return;
        }
    }
    stoppeCountdown(v);
    v.lauf.zyklusBeendetLaeuft = false;
    resetWiederholungenLauf(v);
    setHardware(leseHardwareZiel(v), ZIEL_WERT_AUS);
    setIntern(v.dp.aktiv, false);
    setIntern(v.dp.zustand, ZUSTAND.BEREIT);
    setRestzeitIdle(v);
    setVentilAusAnSchalter(v, false, true);
    logInfo(`Ventil ${v.nr} AUS (${grund}) → ${leseHardwareZiel(v)}`);
    if (!schleifeLauf.stopAngefordert && !istSchleifeLaeuft()) {
        const endGrund = v.lauf.startGrund || (istManuellerGrund(v, grund) ? grund : grund);
        sendeBewaesserungEndeNachricht(endGrund, 'Einzel', v);
    }
    v.lauf.startGrund = '';
}

function istManuellerGrund(v, grund) {
    return grund === `Ventil${v.nr} Aus/An` || (v.nr === 1 && grund === 'ManuellEin');
}

function setzeVentil(v, ein, grund) {
    if (!istVentilFrei(v)) {
        logWarn(`Ventil ${v.nr} deaktiviert (Reparatur).`);
        return;
    }
    const an = ein === true;
    if (an && istSchwelleSperreAktiv(v)) {
        logWarn(`Ventil ${v.nr}: EIN blockiert – SchwelleSPERRE aktiv (${grund}).`);
        return;
    }
    if (an && istVentilPausiert(v) && grund !== 'SchleifenSteuerung') {
        logWarn(`Ventil ${v.nr} pausiert – kein Start.`);
        return;
    }
    if (!an) {
        ventilBeenden(v, grund);
        return;
    }
    if (istVentilAktiv(v)) return;
    const hw = leseHardwareZiel(v);
    if (!existsState(hw)) {
        logWarn(`Ventil ${v.nr}: Ausgang existiert nicht: ${hw} – Countdown startet trotzdem`);
    } else {
        setHardware(hw, ZIEL_WERT_EIN);
    }
    const dauerSek = leseCountdownSek(v);
    const wieder = leseWiederholungen(v);
    const gesamtSek = leseGesamtzeitSek(v);
    loescheLaufzustand(v);
    v.lauf.startGrund = grund;
    if (grund === 'SchleifenSteuerung') {
        const wiederDp = parseInt(getVal(v.dp.wiederholungenAktuel, 0), 10) || 0;
        if (wiederDp > 0) {
            v.lauf.wiederholungAktuell = wiederDp;
        } else {
            startWiederholungenLauf(v);
        }
    } else {
        startWiederholungenLauf(v);
    }
    v.lauf.gesamtEndeMs = Date.now() + gesamtSek * 1000;
    setPauseAnzeige(v, false);
    starteRestzeitTicker(v);
    setIntern(v.dp.aktiv, true);
    setzeZustandBewaesserung(v);
    starteCountdown(v, grund);
    if (an && istManuellerGrund(v, grund)) {
        setVentilAusAnSchalter(v, true, true);
    }
    logInfo(`Ventil ${v.nr} EIN (${grund}) → ${hw}, Zyklus ${dauerSek} s, Summe ${gesamtSek} s, ${wieder} Wiederholung(en)`);
    if (istManuellerGrund(v, grund) && !istSchleifeLaeuft()) {
        sendeBewaesserungStartNachricht(grund, 'Einzel');
    }
}

function parseAnzeigeZahl(anzeige) {
    const s = String(anzeige ?? '').trim();
    const m = s.match(/-?\d+(?:[.,]\d+)?/);
    if (!m) return null;
    const n = parseFloat(m[0].replace(',', '.'));
    return isNaN(n) ? null : n;
}

function istSchwelleObereGrenze(v) {
    return parseVergleichObereSchwelle(getVal(v.dp.shwVergleich, true), true);
}

function istEinzelSchwelleErfuellt(v, wert, grenze) {
    if (wert === null || wert === undefined) return false;
    const g = parseFloat(grenze);
    if (isNaN(g)) return false;
    return istSchwelleObereGrenze(v) ? wert > g : wert < g;
}

function istSchwelleFeuchtigkeitAktiv(v) {
    return alsBool(getVal(v.dp.shwFeuchtAktiv, false), false);
}

function istSchwelleTemperaturAktiv(v) {
    return alsBool(getVal(v.dp.shwTempAktiv, false), false);
}

function hatAktiveSchwellePruefung(v) {
    return istSchwelleFeuchtigkeitAktiv(v) || istSchwelleTemperaturAktiv(v);
}

function berechneSchwelleUeberschritten(v) {
    const feuchtAktiv = istSchwelleFeuchtigkeitAktiv(v);
    const tempAktiv = istSchwelleTemperaturAktiv(v);
    if (!feuchtAktiv && !tempAktiv) return false;
    let ergebnis = true;
    if (feuchtAktiv) {
        const feucht = parseAnzeigeZahl(getVal(v.dp.feuchtAnzeige, ''));
        ergebnis = ergebnis && istEinzelSchwelleErfuellt(v, feucht, getVal(v.dp.shwFeuchtWert, 40));
    }
    if (tempAktiv) {
        const temp = parseAnzeigeZahl(getVal(v.dp.externTempAnzeige, ''));
        ergebnis = ergebnis && istEinzelSchwelleErfuellt(v, temp, getVal(v.dp.shwTempWert, 25));
    }
    return ergebnis;
}

function istWetterSchwelleSperreAktiv() {
    return alsBool(getVal(DP.wetterdatenSchwelleUeberschritten, false), false);
}

/** SchwelleSperre folgt Ueberschritten (V1 zusätzlich Wetter), nicht während laufender Bewässerung. */
function berechneVentilSchwelleSperre(v) {
    if (istVentilBewaesserungLaeuft(v)) return false;
    const ventilErgebnis = berechneSchwelleUeberschritten(v);
    if (v.nr === 1) return istWetterSchwelleSperreAktiv() || ventilErgebnis;
    if (!hatAktiveSchwellePruefung(v)) return false;
    return ventilErgebnis;
}

const schwellePruefungInProgress = new Set();

function durchsetzeSchwelleSperre(v) {
    if (istVentilBewaesserungLaeuft(v)) return;
    if (!istSchwelleSperreAktiv(v) || !sollSchwelleSperreDurchsetzen()) return;

    if (leseVentilAusAnSchalter(v)) {
        setVentilAusAnSchalter(v, false, true);
        logInfo(`Ventil ${v.nr}: SchwelleSPERRE aktiv – Aus/An auf Aus`);
    }

    if (istVentilAktiv(v)) {
        const inSchleifeAktiv = istSchleifeLaeuft() && leseSchleifeAktuellesVentilNr() === v.nr;
        if (inSchleifeAktiv) {
            ventilBeenden(v, 'Schleife SchwelleSperre');
            logInfo(`Schleife: Ventil ${v.nr} SchwelleSperre → beendet, nächstes Ventil`);
            plankeNaechstesSchleifenVentil('SchwelleSperre');
        } else {
            ventilBeenden(v, 'SchwelleSPERRE');
            logInfo(`Ventil ${v.nr}: SchwelleSPERRE → AUS (Aktiv=false, Hardware Aus)`);
        }
        return;
    }

    setHardware(leseHardwareZiel(v), ZIEL_WERT_AUS);
}

function aktualisiereSchwellePruefung(v) {
    if (schwellePruefungInProgress.has(v.nr)) {
        return berechneSchwelleUeberschritten(v);
    }
    schwellePruefungInProgress.add(v.nr);
    try {
        const ventilErgebnis = berechneSchwelleUeberschritten(v);
        const ueberschrittenAnzeige = v.nr === 1
            ? (ventilErgebnis || istWetterSchwelleSperreAktiv())
            : ventilErgebnis;
        setIntern(v.dp.shwUeberschritten, ueberschrittenAnzeige);
        setIntern(v.dp.schwelleSperre, berechneVentilSchwelleSperre(v));
        durchsetzeSchwelleSperre(v);
        return ventilErgebnis;
    } finally {
        schwellePruefungInProgress.delete(v.nr);
    }
}

function pruefeSchwelle(v) {
    return aktualisiereSchwellePruefung(v);
}

function migriereVentilAktiviertBool(v) {
    if (!existsState(v.dp.aktiviert)) return;
    const obj = typeof getObject === 'function' ? getObject(v.dp.aktiviert) : null;
    const rolle = obj?.common?.role;
    const schreibbar = obj?.common?.write !== false;
    const hatSchalterStates = !!(obj?.common?.states && typeof obj.common.states === 'object');
    const hatMaterialize = !!(obj?.common?.custom?.materialize);
    if (rolle === 'indicator' && !schreibbar && !hatSchalterStates && !hatMaterialize) return;

    const wert = alsBool(getVal(v.dp.aktiviert, true), true);
    const common = {
        name: `Ventil ${v.nr} freigeben`,
        desc: 'Nur Wert true/false (Anzeige) – bedienen über SchleifenSteuerung.VentilN',
        type: 'boolean',
        role: 'indicator',
        read: true,
        write: false,
        def: true,
    };
    try {
        deleteState(v.dp.aktiviert);
    } catch (e) {
        logWarn(`deleteState ${v.dp.aktiviert}: ${e}`);
        return;
    }
    createStateBw(v.dp.aktiviert, wert, common);
    logInfo(`Ventil ${v.nr}: Konfig.Aktiviert → Anzeige true/false (kein Schalter)`);
}

function migriereKonfigDefaults(v) {
    const feucht = String(getVal(v.dp.feuchtSensor, '') || '').trim();
    if (!feucht) {
        setIntern(v.dp.feuchtSensor, FEUCHT_SENSOR_DEFAULT);
        logInfo(`Ventil ${v.nr}: FeuchtigkeitSensor → ${FEUCHT_SENSOR_DEFAULT}`);
    }
    const temp = String(getVal(v.dp.tempSensor, '') || '').trim();
    if (!temp) {
        setIntern(v.dp.tempSensor, TEMP_SENSOR_DEFAULT);
        logInfo(`Ventil ${v.nr}: Temperatursensor → ${TEMP_SENSOR_DEFAULT}`);
    }
    const aus = String(getVal(v.dp.ausgang, '') || '').trim();
    if (!aus) {
        setIntern(v.dp.ausgang, v.zielDefault);
        logInfo(`Ventil ${v.nr}: Ventil${v.nr}Ausgang → ${v.zielDefault}`);
    }
}

function migriereVentilAusgang(v) {
    if (!existsState(v.dp.ausgang)) return;
    const aktuell = String(getVal(v.dp.ausgang, '') || '').trim();
    const alteDefaults = ['mqtt.0.Ventil1.set', 'mqtt.0.Ventil2.set', 'mqtt.0.Ventil3.set', 'mqtt.0.Ventil4.set', ''];
    if (aktuell && !alteDefaults.includes(aktuell) && aktuell !== v.zielDefault) return;
    const quellen = [v.zielDefault];
    if (v.nr === 1) {
        quellen.push(
            '0_userdata.0.Beregnungswerk.Ventil1.Konfig.HardwareAusgang',
            '0_userdata.0.Bewaesserung.Ventil1.Konfig.HardwareAusgang'
        );
    }
    for (const q of quellen) {
        if (!q) continue;
        if (q !== v.zielDefault && !existsState(q)) continue;
        setIntern(v.dp.ausgang, q);
        logInfo(`Ventil ${v.nr}: Ventil${v.nr}Ausgang → ${q}`);
        return;
    }
}

function migriereLetzteBewaesserung(v) {
    if (!existsState(v.dp.letzteBewaesserung)) return;
    const val = getVal(v.dp.letzteBewaesserung, '');
    const n = parseInt(val, 10);
    if (n > 1000000000000) {
        setIntern(v.dp.letzteBewaesserung, formatDatumKurzDe(n));
        logInfo(`Ventil ${v.nr}: LetzteBewaesserung migriert → ${getVal(v.dp.letzteBewaesserung)}`);
    }
}

function migriereWetterdatenSchwelleBools() {
    const boolDefs = [
        [`${WETTERDATEN_SCHWELLE}.FeuchtigkeitAktiv`, false],
        [`${WETTERDATEN_SCHWELLE}.TemperaturAktiv`, false],
        [`${WETTERDATEN_SCHWELLE}.NiederschlagHeuteAktiv`, false],
        [`${WETTERDATEN_SCHWELLE}.NiederschlagMorgenAktiv`, false],
    ];
    for (const [id, fallback] of boolDefs) {
        if (!existsState(id)) continue;
        const wert = alsBool(getVal(id, fallback), fallback);
        if (getVal(id, fallback) !== wert) {
            setIntern(id, wert);
            logInfo(`Wetterdaten-Schwelle normalisiert: ${id} → ${wert}`);
        }
    }
    const vergleichId = `${WETTERDATEN_SCHWELLE}.Vergleich`;
    if (existsState(vergleichId)) {
        const wert = parseVergleichObereSchwelle(getVal(vergleichId, true), true);
        if (getVal(vergleichId, true) !== wert) {
            setIntern(vergleichId, wert);
            logInfo(`Wetterdaten-Schwelle normalisiert: ${vergleichId} → ${wert}`);
        }
    }
}

function migriereSchwelleVergleich(v) {
    const boolDefs = [
        [v.dp.shwFeuchtAktiv, false],
        [v.dp.shwTempAktiv, false],
    ];
    for (const [id, fallback] of boolDefs) {
        if (!existsState(id)) continue;
        const wert = alsBool(getVal(id, fallback), fallback);
        if (getVal(id, fallback) !== wert) {
            setIntern(id, wert);
            logInfo(`Ventil ${v.nr} Schwelle normalisiert: ${id} → ${wert}`);
        }
    }
    if (existsState(v.dp.shwVergleich)) {
        const wert = parseVergleichObereSchwelle(getVal(v.dp.shwVergleich, true), true);
        if (getVal(v.dp.shwVergleich, true) !== wert) {
            setIntern(v.dp.shwVergleich, wert);
            logInfo(`Ventil ${v.nr} Schwelle normalisiert: ${v.dp.shwVergleich} → ${wert} (${wert ? 'obere' : 'untere'} Schwelle)`);
        }
    }
}

function migriereSchwelleAlt() {
    const altAktiv = `${V1}.Schwelle.Aktiv`;
    const altWert = `${V1}.Schwelle.Wert`;
    if (!existsState(altAktiv)) return;
    const v = VENTILE[0];
    const warAktiv = alsBool(getVal(altAktiv, false), false);
    if (warAktiv) {
        setIntern(v.dp.shwFeuchtAktiv, true);
        setIntern(v.dp.shwTempAktiv, true);
        if (existsState(altWert)) {
            const w = parseInt(getVal(altWert, 40), 10) || 40;
            setIntern(v.dp.shwFeuchtWert, w);
        }
        logInfo('Ventil 1: Schwelle.Aktiv=true → FeuchtigkeitAktiv + TemperaturAktiv ein');
    } else {
        setIntern(v.dp.shwFeuchtAktiv, false);
        setIntern(v.dp.shwTempAktiv, false);
        logInfo('Ventil 1: Schwelle.Aktiv=false → FeuchtigkeitAktiv + TemperaturAktiv aus');
    }
}

function stelleDatenpunkteSicherVentil(v) {
    if (v.nr === 1) {
        const altManuell = V1_MANUELL_ALT;
        const neuVentil = v.dp.ausAn;
        const ventilCommon = {
            name: 'Ventil1 Aus/An',
            type: 'boolean',
            role: 'switch',
            read: true,
            write: true,
            def: false,
            states: { false: 'Aus', true: 'An' },
        };
        if (existsState(altManuell)) {
            const val = alsBool(getVal(altManuell, false), false);
            try {
                createStateBw(neuVentil, val, ventilCommon);
                logInfo(`Ventil 1: ManuellEin → ${neuVentil} übernommen (${val ? 'An' : 'Aus'})`);
            } catch (e) {
                if (existsState(neuVentil)) setVentilAusAnSchalter(v, val, true);
                logInfo(`Ventil 1: ManuellEin Wert → ${neuVentil}`);
            }
            try {
                createStateBw(altManuell, val, ventilCommon);
            } catch (e) {
                /* Alias ManuellEin bleibt als Spiegel */
            }
        } else if (existsState(neuVentil)) {
            try {
                createStateBw(neuVentil, getVal(neuVentil, false), ventilCommon);
            } catch (e) {
                logInfo(`Ventil 1: Ventil1_AusAn Metadaten: ${e}`);
            }
        }
    }

    for (const s of v.states) {
        if (!existsState(s.id)) {
            createStateBw(s.id, s.val, s.common);
            logDpAngelegt(s.id);
        }
    }
    setRestzeitZyklus(v, 0);
    setWiederholungenAktuel(v, 0);
    aktualisiereRestzeitAnzeige(v);
    sperreSteuerungWennDeaktiviert(v);
}

function istProduktivPfad(id) {
    return id === DP_BASE || (typeof id === 'string' && id.startsWith(`${DP_BASE}.`));
}

function sammleKanaeleAusPfad(id, prefix, ziel) {
    if (!id || !prefix || istProduktivPfad(id)) return;
    const parts = String(id).split('.');
    for (let i = parts.length; i >= 1; i--) {
        const ch = parts.slice(0, i).join('.');
        if (ch.length >= prefix.length && ch.startsWith(prefix) && !istProduktivPfad(ch)) {
            ziel.add(ch);
        }
    }
}

function loescheStateSicher(id) {
    if (!id || istProduktivPfad(id) || !existsState(id)) return false;
    try {
        deleteState(id);
        logInfo(`entfernt (State): ${id}`);
        return true;
    } catch (e) {
        logInfo(`Überspringe Löschen State: ${id}`);
        return false;
    }
}

function loescheKanalSicher(id) {
    if (!id || istProduktivPfad(id)) return false;
    let obj = null;
    try {
        if (typeof existsObject === 'function' && !existsObject(id)) return false;
        obj = typeof getObject === 'function' ? getObject(id) : null;
    } catch (e) {
        return false;
    }
    if (obj && obj.type && obj.type !== 'channel') return false;
    if (typeof deleteChannel !== 'function') return false;
    try {
        deleteChannel(id);
        logInfo(`entfernt (Kanal): ${id}`);
        return true;
    } catch (e) {
        logInfo(`Überspringe Löschen Kanal: ${id}`);
        return false;
    }
}

const MEINEBEWAESSERUNG_EXTRA_STATES = [
    'steuerung.wetterdaten.Konfig.Wetter_Anbieter',
    'steuerung.wetterdaten.Konfig.OpenMeteoOrt',
];

function sammleIdsUnterPrefix(prefix) {
    const stateIdSet = new Set();
    const channelIds = new Set();
    sammleKanaeleAusPfad(prefix, prefix, channelIds);

    const addState = (id) => {
        if (!id || istProduktivPfad(id)) return;
        stateIdSet.add(id);
        sammleKanaeleAusPfad(id, prefix, channelIds);
    };

    for (let i = 0; i < VERALTETE_STATES.length; i++) {
        const id = VERALTETE_STATES[i];
        if (id === prefix || id.startsWith(`${prefix}.`)) addState(id);
    }

    if (prefix === VERALTETES_DP_BASIS) {
        for (let i = 0; i < MEINEBEWAESSERUNG_EXTRA_STATES.length; i++) {
            addState(`${prefix}.${MEINEBEWAESSERUNG_EXTRA_STATES[i]}`);
        }
    }

    // getObjects gibt es im javascript.0-Skript oft nicht – nur nutzen wenn vorhanden
    if (typeof getObjects === 'function') {
        try {
            const escaped = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const result = getObjects(`^${escaped}(\\..+)?$`, null);
            if (result && typeof result === 'object') {
                const ids = Object.keys(result);
                for (let i = 0; i < ids.length; i++) {
                    const id = ids[i];
                    if (istProduktivPfad(id)) continue;
                    const typ = result[id]?.type;
                    if (typ === 'channel') {
                        channelIds.add(id);
                        sammleKanaeleAusPfad(id, prefix, channelIds);
                    } else if (typ === 'state' || existsState(id)) {
                        addState(id);
                    } else {
                        sammleKanaeleAusPfad(id, prefix, channelIds);
                    }
                }
            }
        } catch (e) {
            logWarn(`getObjects ${prefix}: ${e}`);
        }
    }

    return { stateIds: Array.from(stateIdSet), channelIds };
}

function loescheDatenpunktZweig(prefix) {
    if (!prefix || istProduktivPfad(prefix)) return;

    const gesammelt = sammleIdsUnterPrefix(prefix);
    const stateIds = gesammelt.stateIds.sort((a, b) => b.length - a.length);

    let geloeschtStates = 0;
    for (let i = 0; i < stateIds.length; i++) {
        if (loescheStateSicher(stateIds[i])) geloeschtStates++;
    }
    if (!stateIds.length && existsState(prefix) && loescheStateSicher(prefix)) {
        geloeschtStates++;
    }

    const kanaele = Array.from(gesammelt.channelIds).sort((a, b) => b.length - a.length);
    let geloeschtKanaele = 0;
    for (let i = 0; i < kanaele.length; i++) {
        if (loescheKanalSicher(kanaele[i])) geloeschtKanaele++;
    }

    if (geloeschtStates || geloeschtKanaele) {
        logInfo(`Datenpunkt-Zweig ${prefix}: ${geloeschtStates} States, ${geloeschtKanaele} Kanäle gelöscht`);
    } else {
        logInfo(`Datenpunkt-Zweig ${prefix}: bereits leer`);
    }
}

function loescheVeralteteDatenpunkte() {
    for (const id of VERALTETE_STATES) {
        if (istProduktivPfad(id)) continue;
        loescheStateSicher(id);
    }
    loescheDatenpunktZweig(VERALTETES_DP_BASIS);
    loescheDatenpunktZweig(LEGACY_DP_BASE);
    loescheDatenpunktZweig(ALT_DP_BASE);
}

function migriereWerteVonPrefix(altPrefix) {
    let kopiert = 0;
    for (let i = 0; i < EIGENE_STATES.length; i++) {
        const s = EIGENE_STATES[i];
        const altId = String(s.id || '').replace(DP_BASE, altPrefix);
        if (altId === s.id) continue;
        if (!existsState(altId)) continue;
        const altVal = getVal(altId, null);
        if (altVal === null || altVal === undefined) continue;

        if (!existsState(s.id)) {
            createStateBw(s.id, altVal, s.common);
            logInfo(`Namespace migriert: ${altId} → ${s.id}`);
            kopiert++;
            continue;
        }
        const neuVal = getVal(s.id, s.val);
        if (JSON.stringify(neuVal) === JSON.stringify(s.val) && JSON.stringify(altVal) !== JSON.stringify(s.val)) {
            setIntern(s.id, altVal);
            logInfo(`Namespace-Wert: ${altId} → ${s.id}`);
            kopiert++;
        }
    }
    return kopiert;
}

function migriereAlleLegacyNamespaces() {
    const vonUserdata = migriereWerteVonPrefix(LEGACY_DP_BASE);
    const vonMeineBw = migriereWerteVonPrefix(ALT_DP_BASE);
    if (vonUserdata > 0) {
        logInfo(`0_userdata → ${DP_BASE}: ${vonUserdata} Datenpunkte übernommen`);
    }
    if (vonMeineBw > 0) {
        logInfo(`MeineBewaesserung → ${DP_BASE}: ${vonMeineBw} Datenpunkte übernommen`);
    }
}

function altStateIdVonBeregnungswerk(neuId) {
    return String(neuId || '').replace(DP_BASE, ALT_DP_BASE);
}

/** @deprecated – nutze migriereAlleLegacyNamespaces */
function migriereVonMeineBewaesserung() {
    migriereAlleLegacyNamespaces();
}

function migriereTankWertAktuel() {
    if (!existsState(TANK_DP_PFAD_AUSWAHL_ISTWERT)) return;

    const obj = typeof getObject === 'function' ? getObject(TANK_DP_PFAD_AUSWAHL_ISTWERT) : null;
    const rolle = obj?.common?.role;
    const aliasId = obj?.common?.alias?.id;
    const hatFehlerAlias = !!(aliasId && typeof aliasId === 'object');
    const descOk = (obj?.common?.desc || '') === TANK_WERT_AKTUEL_BESCHREIBUNG;

    if (rolle === 'text' && !hatFehlerAlias && descOk) return;

    let wert = normalisiereStateId(String(getVal(TANK_DP_PFAD_AUSWAHL_ISTWERT, TANK_ISTWERT_SENSOR_DEFAULT) || '').trim());
    if (!siehtAusWieStateId(wert)) wert = TANK_ISTWERT_SENSOR_DEFAULT;

    const common = {
        name: 'Datenpfad für aktuellen Tank-Istwert',
        desc: TANK_WERT_AKTUEL_BESCHREIBUNG,
        type: 'string',
        role: 'text',
        read: true,
        write: true,
        def: TANK_ISTWERT_SENSOR_DEFAULT,
    };

    logInfo(`${TANK_DP_PFAD_AUSWAHL_ISTWERT}: Hinweis/Beschreibung aktualisiert`);
    try {
        deleteState(TANK_DP_PFAD_AUSWAHL_ISTWERT);
    } catch (e) {
        logWarn(`deleteState ${TANK_DP_PFAD_AUSWAHL_ISTWERT}: ${e}`);
        return;
    }
    createStateBw(TANK_DP_PFAD_AUSWAHL_ISTWERT, wert, common);
}

function migriereZeitsteuerungObjekt() {
    /* Metadaten nur über EIGENE_STATES/createState */
}

function migriereWetterdatenQuellpfade() {
    const quellMap = [
        [`${DP_BASE}.Konfig.EigeneFeuchtigkeit`, `${WETTERDATEN_KONFIG}.Quellpfad_Luftfeuchtigkeit`],
        [`${DP_BASE}.Konfig.EigeneTemperatur`, `${WETTERDATEN_KONFIG}.Quellpfad_Temperatur`],
        [`${DP_BASE}.Konfig.EigeneNiederschlag`, `${WETTERDATEN_KONFIG}.Quellpfad_Niederschlag_Heute`],
        [`${STEUERUNG_BASE}.Messwerte.Konfig.EigeneFeuchtigkeit`, `${WETTERDATEN_KONFIG}.Quellpfad_Luftfeuchtigkeit`],
        [`${STEUERUNG_BASE}.Messwerte.Konfig.EigeneTemperatur`, `${WETTERDATEN_KONFIG}.Quellpfad_Temperatur`],
        [`${STEUERUNG_BASE}.Messwerte.Konfig.EigeneNiederschlag`, `${WETTERDATEN_KONFIG}.Quellpfad_Niederschlag_Heute`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Standort', `${WETTERDATEN_KONFIG}.Quellpfad_Standort`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Niederschlag_Heute', `${WETTERDATEN_KONFIG}.Quellpfad_Niederschlag_Heute`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Niederschlag_Morgen', `${WETTERDATEN_KONFIG}.Quellpfad_Niederschlag_Morgen`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Temperatur', `${WETTERDATEN_KONFIG}.Quellpfad_Temperatur`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Quellpfad_Luftfeuchtigkeit', `${WETTERDATEN_KONFIG}.Quellpfad_Luftfeuchtigkeit`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.Wetter_Anbieter', `${WETTERDATEN_KONFIG}.Wetter_Anbieter`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Konfig.OpenMeteoOrt', `${WETTERDATEN_KONFIG}.OpenMeteoOrt`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Konfig.Quellpfad_Standort`, `${WETTERDATEN_KONFIG}.Quellpfad_Standort`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Konfig.Quellpfad_Niederschlag_Heute`, `${WETTERDATEN_KONFIG}.Quellpfad_Niederschlag_Heute`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Konfig.Quellpfad_Niederschlag_Morgen`, `${WETTERDATEN_KONFIG}.Quellpfad_Niederschlag_Morgen`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Konfig.Quellpfad_Temperatur`, `${WETTERDATEN_KONFIG}.Quellpfad_Temperatur`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Konfig.Quellpfad_Luftfeuchtigkeit`, `${WETTERDATEN_KONFIG}.Quellpfad_Luftfeuchtigkeit`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Konfig.Wetter_Anbieter`, `${WETTERDATEN_KONFIG}.Wetter_Anbieter`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Konfig.OpenMeteoOrt`, `${WETTERDATEN_KONFIG}.OpenMeteoOrt`],
    ];
    for (const [alt, neu] of quellMap) {
        if (!existsState(alt)) continue;
        const altVal = String(getVal(alt, '') || '').trim();
        if (!altVal) continue;
        const neuVal = String(getVal(neu, '') || '').trim();
        if (neuVal) continue;
        setIntern(neu, altVal);
        logInfo(`Wetterdaten migriert: ${alt} → ${neu}`);
    }

    const schwelleMap = [
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.FeuchtigkeitAktiv', `${WETTERDATEN_SCHWELLE}.FeuchtigkeitAktiv`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.FeuchtigkeitWert', `${WETTERDATEN_SCHWELLE}.FeuchtigkeitWert`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.TemperaturAktiv', `${WETTERDATEN_SCHWELLE}.TemperaturAktiv`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.TemperaturWert', `${WETTERDATEN_SCHWELLE}.TemperaturWert`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.NiederschlagHeuteAktiv', `${WETTERDATEN_SCHWELLE}.NiederschlagHeuteAktiv`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.NiederschlagHeuteWert', `${WETTERDATEN_SCHWELLE}.NiederschlagHeuteWert`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.NiederschlagMorgenAktiv', `${WETTERDATEN_SCHWELLE}.NiederschlagMorgenAktiv`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.NiederschlagMorgenWert', `${WETTERDATEN_SCHWELLE}.NiederschlagMorgenWert`],
        ['0_userdata.0.meinebewaesserung.steuerung.wetterdaten.Schwelle.Vergleich', `${WETTERDATEN_SCHWELLE}.Vergleich`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Schwelle.FeuchtigkeitAktiv`, `${WETTERDATEN_SCHWELLE}.FeuchtigkeitAktiv`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Schwelle.FeuchtigkeitWert`, `${WETTERDATEN_SCHWELLE}.FeuchtigkeitWert`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Schwelle.TemperaturAktiv`, `${WETTERDATEN_SCHWELLE}.TemperaturAktiv`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Schwelle.TemperaturWert`, `${WETTERDATEN_SCHWELLE}.TemperaturWert`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Schwelle.NiederschlagHeuteAktiv`, `${WETTERDATEN_SCHWELLE}.NiederschlagHeuteAktiv`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Schwelle.NiederschlagHeuteWert`, `${WETTERDATEN_SCHWELLE}.NiederschlagHeuteWert`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Schwelle.NiederschlagMorgenAktiv`, `${WETTERDATEN_SCHWELLE}.NiederschlagMorgenAktiv`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Schwelle.NiederschlagMorgenWert`, `${WETTERDATEN_SCHWELLE}.NiederschlagMorgenWert`],
        [`${ALT_DP_BASE}.Steuerung.Wetterdaten.Schwelle.Vergleich`, `${WETTERDATEN_SCHWELLE}.Vergleich`],
    ];
    for (const [alt, neu] of schwelleMap) {
        if (!existsState(alt) || !existsState(neu)) continue;
        const neuVal = getVal(neu, null);
        if (neuVal !== null && neuVal !== undefined && neuVal !== '' && neuVal !== false && neuVal !== 0) continue;
        const altVal = getVal(alt, null);
        if (altVal === null || altVal === undefined) continue;
        setIntern(neu, altVal);
        logInfo(`Wetterdaten-Schwelle migriert: ${alt} → ${neu}`);
    }
}

function stelleDatenpunkteSicherSchleife() {
    for (const s of SCHLEIFE_STATES_LIST) {
        if (!existsState(s.id) && !istBeregnungswerkState(s.id)) {
            createStateBw(s.id, s.val, s.common);
            logDpAngelegt(s.id);
        }
    }
}

function stelleDatenpunkteSicherTank() {
    for (const s of TANK_STATES_LIST) {
        if (!existsState(s.id) && !istBeregnungswerkState(s.id)) {
            createStateBw(s.id, s.val, s.common);
            logDpAngelegt(s.id);
        }
    }
}

function stelleDatenpunkteSicherGartenpumpe() {
    for (const s of GARTEN_STATES_LIST) {
        if (!existsState(s.id) && !istBeregnungswerkState(s.id)) {
            createStateBw(s.id, s.val, s.common);
            logDpAngelegt(s.id);
        }
    }
}

const NACHRICHTEN_PFAD_MIGRATION = [
    [`${NACHRICHTEN_KONFIG}.WhatsApp.Aktiv`, `${NACHRICHTEN_KONFIG}.WhatsApp_Aktiv`],
    [`${NACHRICHTEN_KONFIG}.WhatsApp.Instanz`, `${NACHRICHTEN_KONFIG}.WhatsApp_Instanz`],
    [`${NACHRICHTEN_KONFIG}.WhatsApp.TestSenden`, `${NACHRICHTEN_KONFIG}.WhatsApp_TestSenden`],
    [`${NACHRICHTEN_KONFIG}.Telegram.Aktiv`, `${NACHRICHTEN_KONFIG}.Telegram_Aktiv`],
    [`${NACHRICHTEN_KONFIG}.Telegram.Instanz`, `${NACHRICHTEN_KONFIG}.Telegram_Instanz`],
    [`${NACHRICHTEN_KONFIG}.Telegram.User`, `${NACHRICHTEN_KONFIG}.Telegram_User`],
    [`${NACHRICHTEN_KONFIG}.Telegram.ChatId`, `${NACHRICHTEN_KONFIG}.Telegram_ChatId`],
    [`${NACHRICHTEN_KONFIG}.Telegram.TestSenden`, `${NACHRICHTEN_KONFIG}.Telegram_TestSenden`],
    [`${NACHRICHTEN_KONFIG}.Email.Aktiv`, `${NACHRICHTEN_KONFIG}.Email_Aktiv`],
    [`${NACHRICHTEN_KONFIG}.Email.Adresse`, `${NACHRICHTEN_KONFIG}.Email_Adresse`],
    [`${NACHRICHTEN_KONFIG}.Email.TestSenden`, `${NACHRICHTEN_KONFIG}.Email_TestSenden`],
];

function migriereNachrichtenKonfigPfade() {
    for (let i = 0; i < NACHRICHTEN_PFAD_MIGRATION.length; i++) {
        const alt = NACHRICHTEN_PFAD_MIGRATION[i][0];
        const neu = NACHRICHTEN_PFAD_MIGRATION[i][1];
        if (!existsState(alt) || existsState(neu)) continue;
        const def = NACHRICHTEN_STATES_LIST.find((x) => x.id === neu);
        if (!def) continue;
        const wert = getVal(alt, def.val);
        if (!erstelleDatenpunktWennFehlt({ id: neu, val: wert, common: def.common })) continue;
        if (wert !== def.val) setIntern(neu, wert);
        logInfo(`Nachrichten migriert: ${alt} → ${neu}`);
    }
}

function pruefeNachrichtenKonfigVollstaendig() {
    const pflicht = [
        `${NACHRICHTEN_KONFIG}.WhatsApp_Aktiv`,
        `${NACHRICHTEN_KONFIG}.WhatsApp_Instanz`,
        `${NACHRICHTEN_KONFIG}.WhatsApp_TestSenden`,
        `${NACHRICHTEN_KONFIG}.Telegram_Aktiv`,
        `${NACHRICHTEN_KONFIG}.Telegram_Instanz`,
        `${NACHRICHTEN_KONFIG}.Telegram_TestSenden`,
        `${NACHRICHTEN_KONFIG}.Email_Aktiv`,
        `${NACHRICHTEN_KONFIG}.Email_Adresse`,
        `${NACHRICHTEN_KONFIG}.Email_TestSenden`,
    ];
    const fehlend = [];
    for (let i = 0; i < pflicht.length; i++) {
        if (!existsState(pflicht[i])) fehlend.push(pflicht[i]);
    }
    if (fehlend.length) {
        if (!existsState(`${DP_BASE}.Steuerung.Status`)) {
            return false;
        }
        logWarn(`${fehlend.length} Nachrichten-DPs fehlen`);
        return false;
    }
    logInfo('Nachrichten.Konfig: WhatsApp, Telegram und E-Mail vollständig angelegt');
    return true;
}

function stelleDatenpunkteSicherNachrichten() {
    migriereNachrichtenKonfigPfade();
    for (const s of NACHRICHTEN_STATES_LIST) {
        erstelleDatenpunktWennFehlt(s);
    }
    pruefeNachrichtenKonfigVollstaendig();
}

function stelleDatenpunkteSicher() {
    for (const s of GLOBAL_STATES_LIST) {
        if (!existsState(s.id)) {
            if (istBeregnungswerkState(s.id)) continue;
            if (createStateBw(s.id, s.val, s.common)) logDpAngelegt(s.id);
        }
    }
    stelleDatenpunkteSicherSchleife();
    stelleDatenpunkteSicherTank();
    stelleDatenpunkteSicherGartenpumpe();
    stelleDatenpunkteSicherNachrichten();
    for (const v of VENTILE) {
        stelleDatenpunkteSicherVentil(v);
    }
    aktualisiereStatusNaechsteBewaesserung();
    aktualisiereSchaltzeitAnzeigen();
    pruefeAdapterDatenpunkte();
}

function startVentilEvents(v) {
    on({ id: v.dp.pause, change: 'any' }, (obj) => {
        if (!istNutzerEingabe(obj)) return;
        const pause = !!obj.state.val;
        const vorher = obj.oldState ? !!obj.oldState.val : !pause;
        if (vorher === pause) return;
        if (!istVentilFrei(v)) {
            setState(v.dp.pause, false, true);
            logWarn(`Ventil ${v.nr}: Pause blockiert – deaktiviert.`);
            return;
        }
        setState(v.dp.pause, pause, true);
        if (pause) ventilPauseAktivieren(v);
        else ventilPauseDeaktivieren(v);
    });

    const ausAnIds = [v.dp.ausAn];
    if (v.nr === 1 && existsState(V1_MANUELL_ALT)) ausAnIds.push(V1_MANUELL_ALT);

    on({ id: ausAnIds, change: 'any' }, (obj) => behandleVentilAusAnWechsel(v, obj));
}

const ZS_READONLY_DPS = new Set([DP.zsZeit1Anzeige, DP.zsZeit2Anzeige]);

function startZeitschaltuhrEvents() {
    on({ id: DP.zeitsteuerung, change: 'any' }, (obj) => {
        if (!obj?.state || obj.state.ack !== false) return;
        const schleife = alsBool(getVal(DP.schleifeAktiv, false), false);
        const ein = alsBool(obj.state.val, false);
        if (ein !== schleife) {
            setState(DP.zeitsteuerung, schleife, true);
            logWarn('RegelAktiv ist Nur-Status – bitte SchleifenSteuerung.Aktiv verwenden');
        }
    });

    on({ id: `${DP_BASE}.Steuerung.Zeitschaltuhr.*`, change: 'any' }, (obj) => {
        const id = obj.id;
        if (ZS_READONLY_DPS.has(id)) return;
        if (obj?.state && obj.state.ack === false) {
            const istZeit = id === DP.zsZeit1 || id === DP.zsZeit2;
            const istOffset = id === DP.zsZeit1AstroOffset || id === DP.zsZeit2AstroOffset;
            const istAstroTyp = id === DP.zsZeit1AstroTyp || id === DP.zsZeit2AstroTyp;
            let val = obj.state.val;
            if (istOffset) {
                val = parseInt(obj.state.val, 10) || 0;
            } else if (!istZeit && !istAstroTyp) {
                val = alsBool(obj.state.val, true);
            }
            if (istZeit) {
                const nr = id === DP.zsZeit1 ? 1 : 2;
                if (blockiereFesteZeitWennAstro(nr, id, obj.state.val)) {
                    zeitschaltuhrZuletzt = '';
                    aktualisiereSchaltzeitAnzeigen();
                    aktualisiereStatusNaechsteBewaesserung();
                    return;
                }
            }
            setState(id, val, true);
        }
        zeitschaltuhrZuletzt = '';
        aktualisiereSchaltzeitAnzeigen();
        aktualisiereStatusNaechsteBewaesserung();
    });
}

function startScheduler() {
    if (schedulerGestartet) return;
    schedulerGestartet = true;
    schedule('* * * * *', () => {
        pruefeZeitschaltuhr();
        steuereGartenpumpe('Minuten-Scheduler');
    });
    schedule('*/5 * * * *', () => {
        syncWetterdaten();
        for (const v of VENTILE) {
            if (leseFeuchtigkeitSensorId(v)) {
                startFeuchtigkeitSensor(v);
            }
            startTemperaturSensor(v);
            if (v.nr !== 1) {
                aktualisiereSchwellePruefung(v);
            }
        }
        pruefeSchwelleVentilStarts();
    });
}

function registriereEventHandler() {
    startGlobaleVentilKonfigEvents();
    startGlobaleVentilRestzeitEvents();
    startGlobaleSchwelleEvents();
    for (const v of VENTILE) {
        startVentilEvents(v);
        startFeuchtigkeitSensor(v);
        startTemperaturSensor(v);
        startTrigger(v);
    }
    startZeitschaltuhrEvents();
    startSchleifenEvents();
    startGartenpumpeEvents();
    startPumpeVisSteuerungEvents();
    startScheduler();
    aktualisiereSchleifenModusHinweis();
    logInfo('Event-Handler aktiv (Schleife, Ventile, Zeitschaltuhr)');
}

function initScript() {
    try {
        logInfo(`=== Beregnungswerk gestartet (${DP_BASE}) ===`);
        registriereEventHandler();

        migriereAlleLegacyNamespaces();
        stelleDatenpunkteSicher();
        migriereSchleifeAktivLabels();
        migriereZeitsteuerungObjekt();
        for (const v of VENTILE) {
            migriereLetzteBewaesserung(v);
            migriereVentilAktiviertBool(v);
            migriereKonfigDefaults(v);
            migriereVentilAusgang(v);
            migriereSchwelleVergleich(v);
        }
        migriereSchwelleAlt();
        migriereWetterdatenQuellpfade();
        migriereWetterdatenSchwelleBools();
        migriereNachtruheZeitformat();
        migriereTankWertAktuel();
        stelleTankHardwareTestDatenpunkteSicher();
        bereinigeAlleTankKonfigPfade();
        loescheVeralteteDatenpunkte();
        setzeSchleifenUndVentileStartwerte();
        syncAlleVentilAktiviertParallel();
        aktualisiereSchleifenGesamtzeitUeberwachung({ initial: true });

        initWassertankSteuerung();
        initNachrichtenSteuerung();
        initWetterdatenSteuerung();

        for (const v of VENTILE) {
            aktualisiereSchwellePruefung(v);
            const sensorId = leseFeuchtigkeitSensorId(v);
            if (!sensorId) {
                logInfo(`Ventil ${v.nr}: kein Feuchtigkeitssensor – Aus/An und Countdown funktionieren trotzdem.`);
            } else if (!hatFeuchtigkeitssensor(v)) {
                logInfo(`Ventil ${v.nr}: warte auf Feuchtigkeitssensor: ${sensorId}`);
            } else {
                logInfo(`Ventil ${v.nr}: Feuchtigkeitssensor aktiv: ${sensorId}`);
            }
            const tempSensorId = leseTemperaturSensorId(v);
            if (!tempSensorId) {
                logInfo(`Ventil ${v.nr}: kein Temperatursensor konfiguriert.`);
            } else if (!existsState(tempSensorId)) {
                logInfo(`Ventil ${v.nr}: warte auf Temperatursensor: ${tempSensorId}`);
            } else {
                logInfo(`Ventil ${v.nr}: Temperatursensor aktiv: ${tempSensorId}`);
            }
        }

        aktualisiereStatusNaechsteBewaesserung();
        const schleifeInit = alsBool(getVal(DP.schleifeAktiv, false), false);
        if (existsState(DP.zeitsteuerung)) {
            const regelInit = alsBool(getVal(DP.zeitsteuerung, false), false);
            if (regelInit !== schleifeInit) {
                setState(DP.zeitsteuerung, schleifeInit, true);
                logInfo(`RegelAktiv Status → ${schleifeInit ? 'Ein' : 'Aus'} (Spiegel SchleifenSteuerung.Aktiv)`);
            }
        }
        pruefeZeitschaltuhr();
        steuereGartenpumpe('Init');
        logInfo(`Astro-Koordinaten: ${leseAstroKoordinatenInfo()}`);
        logInfo(`Struktur: Steuerung.Wetterdaten + SchleifenSteuerung + WassertankSteuerung + GartenpumpeSteuerung + Nachrichten + Ventil1..${VENTIL_ANZAHL}`);
    } catch (err) {
        log(`[Beregnungswerk] Init-Fehler: ${err}`, 'error');
    }
}

    return { initScript };
};
