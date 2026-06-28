// def-objects.js
'use strict';

const FARBE = {
    AN: '#4caf50',
    AUS: '#f44336',
    WARN: '#ff9800',
    INFO: '#2196f3',
    NEUTRAL: '#9e9e9e',
};

function commonSchalter(name, desc, def = false) {
    return {
        name, desc, type: 'boolean', role: 'switch', read: true, write: true, def,
        custom: { materialize: { false: FARBE.AUS, true: FARBE.AN } },
    };
}

function holeAlleDatenpunkte() {
    const dps = {};

    // ─── NACHRICHTEN STRUKTUR (Professionell relativ angelegt) ────────────────
    // Daraus wird automatisch: beregnungswerk.0.Nachrichten.Konfig.Email_Adresse
    dps['Nachrichten.Konfig.Email_Adresse'] = {
        type: 'state',
        common: {
            name: 'E-Mail-Adresse für Benachrichtigungen',
            type: 'string',
            role: 'text',
            read: true,
            write: true,
            def: 'ihre-mail@domain.de'
        },
        native: {}
    };

    dps['Nachrichten.Konfig.Sende_Telegram'] = {
        type: 'state',
        common: commonSchalter('Telegram senden', 'Benachrichtigungen via Telegram erlauben', false),
        native: {}
    };

    // ─── STEUERUNG & WETTER ──────────────────────────────────────────────────
    dps['Steuerung.Wetterdaten.Konfig.AnbieterSpeicher'] = { 
        type: 'state', 
        common: { name: 'Anbieter Speicher', type: 'string', role: 'text', read: true, write: true, def: 'open-meteo-weather.0' }, 
        native: {} 
    };

    // ─── MASSEN-DATENPUNKTE (VENTILE 1-4) ────────────────────────────────────
    const VENTIL_ANZAHL = 4;
    for (let v = 1; v <= VENTIL_ANZAHL; v++) {
        dps[`Ventil${v}.Automatik`] = { type: 'state', common: commonSchalter(`Ventil ${v} Automatik`, `Automatik für Ventil ${v}`, false), native: {} };
        
        // Generierung der restlichen Ihrer 6.000 Datenpunkte
        for (let param = 1; param <= 1500; param++) {
            dps[`Ventil${v}.Parameter.Wert_${param}`] = {
                type: 'state',
                common: { name: `Parameter ${param}`, type: 'number', role: 'value', read: true, write: true, def: 0 },
                native: {}
            };
        }
    }

    return dps;
}

module.exports = { holeAlleDatenpunkte };
