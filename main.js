'use strict';

// ─── ERFORDERLICHE MODULE LADEN ──────────────────────────────────────────────
const utils = require('@iobroker/adapter-core');
const { holeAlleDatenpunkte } = require('./def-objects'); // Lädt Ihre Blaupause

// ─── IHRE GLOBALEN KONFIGURATIONSVARIABLEN ───────────────────────────────────
const WETTERDATEN_TYPEN = ['Standort', 'Niederschlag_Heute', 'Niederschlag_Morgen', 'Temperatur', 'Luftfeuchtigkeit'];
const WETTER_ANBIETER_DEFAULT = 'open-meteo-weather.0';
const OPEN_METEO_ORT_DEFAULT = 'Neu_Wulmstorf';
const VENTIL_ANZAHL = 4;
const NACHTRUHE_VON_DEFAULT = '22:00 Uhr';
const NACHTRUHE_BIS_DEFAULT = '07:00 Uhr';
const KONFIG_DAUER_DEFAULT = 1;
const KONFIG_WIEDERHOLUNGEN_DEFAULT = 2;
const ZUSTAND = { PAUSE: 0, BEREIT: 1, BEWAESSERUNG: 2 };
const ZIEL_WERT_EIN = true;
const ZIEL_WERT_AUS = false;

// ─── ADAPTER KLASSE DEFINIEREN ───────────────────────────────────────────────
class Beregnungswerk extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: 'beregnungswerk', // Name des Adapters
        });
        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
        
        // Platzhalter für Timer/Intervalle, damit sie global in der Klasse verfügbar sind
        this.wetterTimer = null;
    }

    /**
     * Wird aufgerufen, sobald der Adapter startet und mit der ioBroker-Datenbank verbunden ist.
     */
    async onReady() {
        this.log.info('Beregnungswerk gestartet. Abgleich der Datenpunkte beginnt...');

        // 1. Alle Definitionen (ca. 6.000 Stück) aus der def-objects.js holen
        const alleObjekte = holeAlleDatenpunkte();
        const keys = Object.keys(alleObjekte);

        this.log.info(`Gefunden: ${keys.length} Datenpunkte. Erstellung/Prüfung läuft im Hintergrund...`);

        // 2. Datenpunkte nacheinander datenbanksicher prüfen und anlegen
        for (const id of keys) {
            // ioBroker macht aus z.B. "Nachrichten.Konfig.Email_Adresse" 
            // automatisch "beregnungswerk.0.Nachrichten.Konfig.Email_Adresse"
            await this.setObjectNotExistsAsync(id, alleObjekte[id]);
        }

        this.log.info('Alle Datenpunkte erfolgreich initialisiert und geprüft!');

        // 3. Eigene Zustände abonnieren, um Änderungen (z.B. Eingaben im VIS oder Admin) zu empfangen
        this.subscribeStates('*');

        // 4. Haupt-Beregnungslogik starten
        await this.startBeregnungWerk();
    }

    /**
     * Das Gehirn Ihres Adapters. Hier startet Ihre eigentliche Steuerungs-Logik.
     */
    async startBeregnungWerk() {
        this.log.info('Die Steuerungs-Logik des Beregnungswerks ist jetzt aktiv.');

        // Beispiel: Auslesen des relativen Datenpunkts (ack = true wird im Log ausgegeben)
        try {
            const emailState = await this.getStateAsync('Nachrichten.Konfig.Email_Adresse');
            
            if (emailState && emailState.val) {
                this.log.info(`Benachrichtigungen werden an folgende Adresse gesendet: ${emailState.val}`);
            } else {
                this.log.warn('Es wurde noch keine E-Mail-Adresse im System hinterlegt!');
            }
        } catch (err) {
            this.log.error('Fehler beim Abfragen der E-Mail-Adresse: ' + err);
        }

        // Intervall starten: Alle 60 Sekunden das Wetter prüfen / Berechnungen ausführen
        this.wetterTimer = this.setInterval(() => {
            this.pruefeWetterUndSensoren();
        }, 60000);
    }

    /**
     * Hilfsfunktion für regelmäßige Prüfungen (wird über das Intervall aufgerufen)
     */
    async pruefeWetterUndSensoren() {
        this.log.debug('Automatischer Wetter- und Sensor-Check wird ausgeführt...');
        // Hier können Sie später Berechnungen wie INLINE_SUNCALC einbinden
    }

    /**
     * Wird aufgerufen, wenn sich ein abonnierter Zustand ändert (z.B. durch Klick im VIS)
     */
    async onStateChange(id, state) {
        if (!state) {
            // Der Datenpunkt wurde gelöscht – wir brechen ab
            return;
        }

        // Logge die Änderung im Debug-Modus
        this.log.debug(`State geändert: ${id} = ${state.val} (Bestätigt / ack = ${state.ack})`);

        // Nur reagieren, wenn die Änderung vom Benutzer kommt (ack = false)
        if (state.ack === false) {
            
            // Beispiel-Abfrage für Steuerungsklicks
            if (id.endsWith('Nachrichten.Konfig.Email_Adresse')) {
                this.log.info(`E-Mail-Adresse wurde vom Benutzer geändert auf: ${state.val}`);
                
                // WICHTIG: Den Wert im ioBroker als "bestätigt" markieren (ack = true)
                await this.setStateAsync(id, state.val, true);
            }

            if (id.endsWith('Ventil1.Automatik')) {
                this.log.info(`Automatik für Ventil 1 wurde auf ${state.val} gesetzt.`);
                // Hier Ihre Ventil-Schaltlogik triggern
                await this.setStateAsync(id, state.val, true);
            }
        }
    }

    /**
     * Wird aufgerufen, wenn der Adapter gestoppt oder neu gestartet wird.
     * Hier MÜSSEN alle Timer und Intervalle gelöscht werden!
     */
    onUnload(callback) {
        try {
            // Das Wetter-Intervall löschen, damit Node.js sauber beendet wird
            if (this.wetterTimer) {
                this.clearInterval(this.wetterTimer);
                this.log.info('Wetter-Intervall erfolgreich gestoppt.');
            }
            
            this.log.info('Beregnungswerk-Adapter wurde erfolgreich und sauber beendet.');
            callback();
        } catch (e) {
            callback();
        }
    }
}

// ─── STARTPROZESS FÜR IOBROKER ────────────────────────────────────────────────
if (require.main !== module) {
    // Wird als Modul geladen (Normalfall in ioBroker)
    module.exports = (options) => new Beregnungswerk(options);
} else {
    // Wird direkt gestartet (Testmodus/Konsole)
    new Beregnungswerk();
}
