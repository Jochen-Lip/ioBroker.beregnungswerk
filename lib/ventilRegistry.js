'use strict';

const C = require('./constants');

function erzeugeVentilDP(P, nr) {
    const base = P.ventilBase(nr);
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

function buildVentile(P, eigeneStates) {
    const ventile = [];
    for (let nr = 1; nr <= C.VENTIL_ANZAHL; nr++) {
        const base = P.ventilBase(nr);
        const states = eigeneStates.filter((s) => s.id.startsWith(`${base}.`));
        ventile.push({
            nr,
            name: `Ventil ${nr}`,
            base,
            manuellAlt: nr === 1 ? `${base}.Steuerung.ManuellEin` : null,
            zielDefault: P.ventilZielDefault(nr),
            states,
            dp: erzeugeVentilDP(P, nr),
            lauf: erzeugeVentilLaufzustand(),
        });
    }
    return ventile;
}

module.exports = { buildVentile, erzeugeVentilDP };
