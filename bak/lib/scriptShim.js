'use strict';

const scheduleLib = require('node-schedule');

function patternToRegex(pattern) {
    const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
}

function normalizePatternIds(pattern) {
    const id = pattern.id;
    if (Array.isArray(id)) return id.map(String);
    return [String(id)];
}

async function createScriptShim(adapter) {
    const ownNs = adapter.namespace;
    const adapterFrom = `system.adapter.${adapter.name}.${adapter.instance}`;
    const stateCache = new Map();
    const objectCache = new Map();
    const subscriptions = [];
    const subscribedPatterns = new Set();
    const adapterInstances = {};

    function cacheState(id, state) {
        if (!id || !state) return;
        stateCache.set(id, { val: state.val, ack: state.ack, from: state.from, ts: state.ts });
    }

    async function hydrateStates() {
        try {
            const own = await adapter.getStatesAsync(`${ownNs}.*`);
            if (own) {
                for (const [id, st] of Object.entries(own)) cacheState(id, st);
            }
        } catch (e) {
            adapter.log.warn(`State-Cache: ${e}`);
        }
    }

    async function hydrateObjects(ids) {
        for (const id of ids || []) {
            if (!id || objectCache.has(id)) continue;
            try {
                const isOwn = id.startsWith(`${ownNs}.`) || id === ownNs;
                const obj = isOwn
                    ? await adapter.getObjectAsync(id)
                    : await adapter.getForeignObjectAsync(id);
                if (obj) objectCache.set(id, obj);
            } catch (_) { /* optional */ }
        }
    }

    async function loadAdapterInstances() {
        try {
            const objs = await adapter.getForeignObjectsAsync('system.adapter.', { type: 'instance' });
            if (!objs) return;
            for (const [id] of Object.entries(objs)) {
                const m = id.match(/^system\.adapter\.([^.]+)\.(\d+)$/);
                if (!m) continue;
                const name = m[1];
                if (!adapterInstances[name]) adapterInstances[name] = [];
                adapterInstances[name].push(`${name}.${m[2]}`);
            }
        } catch (e) {
            adapter.log.debug(`Adapter-Instanzen: ${e}`);
        }
    }

    function existsState(id) {
        return stateCache.has(id);
    }

    function getState(id) {
        const c = stateCache.get(id);
        return c ? { val: c.val, ack: c.ack, from: c.from } : null;
    }

    function getVal(id, fallback) {
        const s = getState(id);
        return s?.val !== null && s?.val !== undefined ? s.val : fallback;
    }

    async function setStateAsync(id, val, ack) {
        const isOwn = id.startsWith(`${ownNs}.`) || id === ownNs;
        if (isOwn) await adapter.setStateAsync(id, val, !!ack);
        else await adapter.setForeignStateAsync(id, val, !!ack);
        cacheState(id, { val, ack: !!ack, from: adapterFrom });
    }

    function setState(id, val, ack) {
        setStateAsync(id, val, ack).catch((e) => adapter.log.error(`setState ${id}: ${e}`));
    }

    function setIntern(id, val) {
        setState(id, val, true);
    }

    function ensureSubscription(pattern) {
        for (const id of normalizePatternIds(pattern)) {
            if (!id.includes('*')) {
                if (!id.startsWith(`${ownNs}.`) && id !== ownNs) {
                    adapter.subscribeForeignStates(id).catch(() => {});
                }
                continue;
            }
            if (subscribedPatterns.has(id)) continue;
            subscribedPatterns.add(id);
            if (id.startsWith(`${ownNs}.`)) adapter.subscribeStates(id).catch(() => {});
            else adapter.subscribeForeignStates(id).catch(() => {});
        }
    }

    function matchesAny(id, patterns) {
        return patterns.some((p) => patternToRegex(p).test(id));
    }

    function unsubscribe(sub) {
        if (!sub) return;
        const idx = subscriptions.indexOf(sub);
        if (idx >= 0) subscriptions.splice(idx, 1);
    }

    function dispatchStateChange(id, state, oldState) {
        if (!state) return;
        for (const sub of subscriptions) {
            if (!matchesAny(id, sub.patterns)) continue;
            if (sub.change === 'ne' && oldState && oldState.val === state.val && state.ack) continue;
            try {
                sub.cb({
                    id,
                    state: { val: state.val, ack: state.ack, from: state.from },
                    oldState: oldState ? { val: oldState.val, ack: oldState.ack } : null,
                });
            } catch (e) {
                adapter.log.error(`on-Handler ${id}: ${e}`);
            }
        }
    }

    adapter.on('stateChange', (id, state) => {
        const old = stateCache.get(id);
        cacheState(id, state);
        dispatchStateChange(id, state, old);
    });

    function on(pattern, cb) {
        const patterns = normalizePatternIds(pattern);
        ensureSubscription(pattern);
        const sub = { patterns, change: pattern.change || 'any', cb };
        subscriptions.push(sub);
        return sub;
    }

    function schedule(cronExpr, fn) {
        return scheduleLib.scheduleJob(cronExpr, fn);
    }

    function log(msg, level) {
        const text = String(msg).replace(/^\[Beregnungswerk\]\s*/, '');
        if (level === 'error') adapter.log.error(text);
        else if (level === 'warn') adapter.log.warn(text);
        else adapter.log.info(text);
    }

    function sendTo(instance, command, message, callback) {
        adapter.sendTo(instance, command, message, (res) => {
            if (typeof callback === 'function') callback(res);
        });
    }

    function getObject(id) {
        return objectCache.get(id) || null;
    }

    function existsObject(id) {
        return objectCache.has(id);
    }

    async function createStateInner(id, val, common) {
        await adapter.setObjectNotExistsAsync(id, { type: 'state', common: common || {}, native: {} });
        await adapter.setStateAsync(id, val, true);
        cacheState(id, { val, ack: true, from: adapterFrom });
        objectCache.set(id, { type: 'state', common: common || {} });
    }

    function createState(id, val, common) {
        createStateInner(id, val, common).catch((e) => adapter.log.warn(`createState ${id}: ${e}`));
    }

    function createStateSafe(id, val, common) {
        if (existsState(id)) return true;
        createState(id, val, common);
        return existsState(id);
    }

    function createStateBw(id, val, common) {
        if (existsState(id)) return true;
        return createStateSafe(id, val, common);
    }

    function getInstancesOfAdapter(adapterName) {
        return adapterInstances[adapterName] ? [...adapterInstances[adapterName]] : [];
    }

    function getObjects() {
        return {};
    }

    function deleteState(id) {
        stateCache.delete(id);
        const isOwn = id.startsWith(`${ownNs}.`) || id === ownNs;
        if (isOwn) adapter.delStateAsync(id).catch(() => {});
        else adapter.delForeignStateAsync(id).catch(() => {});
    }

    function deleteChannel(id) {
        adapter.delObjectAsync(id).catch(() => {});
    }

    function extendObject() {}

    function getAstroDate() {
        return undefined;
    }

    await hydrateStates();
    await loadAdapterInstances();
    adapter.subscribeStates(`${ownNs}.*`).catch((e) => adapter.log.warn(`subscribeStates: ${e}`));

    return {
        hydrateObjects, on, unsubscribe, schedule, log, getVal, getState, setState, setIntern,
        existsState, getObject, existsObject, createState, createStateSafe, createStateBw,
        sendTo, getInstancesOfAdapter, getAstroDate, getObjects, deleteState, deleteChannel, extendObject,
    };
}

module.exports = { createScriptShim };
