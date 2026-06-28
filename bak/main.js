'use strict';

const utils = require('@iobroker/adapter-core');
const { getStateDefinitions } = require('./lib/stateDefinitions');
const { startEngine } = require('./lib/engine');

const adapterName = require('./package.json').name.split('.').pop();

class Beregnungswerk extends utils.Adapter {
    constructor(options) {
        super(options);
        this.on('ready', () => {
            this.main().catch((e) => this.log.error(`Startfehler: ${e}`));
        });
    }

    async main() {
        this.log.info(`Beregnungswerk startet – Namespace: ${this.namespace}`);

        const states = getStateDefinitions(this.namespace);
        for (const s of states) {
            await this.setObjectNotExistsAsync(s.id, {
                type: 'state',
                common: s.common,
                native: {},
            });
            await this.setStateAsync(s.id, s.val, true);
        }

        this.log.info(`${states.length} Datenpunkte unter ${this.namespace} bereit`);

        await startEngine(this);
    }
}

function startAdapter(options) {
    options = options || {};
    Object.assign(options, { name: adapterName });
    return new Beregnungswerk(options);
}

if (require.main !== module) {
    module.exports = startAdapter;
} else {
    startAdapter();
}
