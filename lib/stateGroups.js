'use strict';

function buildStateGroups(states, P) {
    const starts = (id, prefix) => id.startsWith(prefix);
    const GLOBAL_STATES_LIST = states.filter(
        (s) => starts(s.id, P.STEUERUNG_BASE) && !starts(s.id, P.WETTERDATEN_BASE),
    );
    const WETTERDATEN_STATES_LIST = states.filter((s) => starts(s.id, P.WETTERDATEN_BASE));
    const SCHLEIFE_STATES_LIST = states.filter((s) => starts(s.id, P.SCHLEIFE_BASE));
    const TANK_STATES_LIST = states.filter((s) => starts(s.id, P.TANK_BASE));
    const GARTEN_STATES_LIST = states.filter((s) => starts(s.id, P.GARTEN_BASE));
    const NACHRICHTEN_STATES_LIST = states.filter((s) => starts(s.id, P.NACHRICHTEN_BASE));
    return {
        GLOBAL_STATES_LIST,
        WETTERDATEN_STATES_LIST,
        SCHLEIFE_STATES_LIST,
        TANK_STATES_LIST,
        GARTEN_STATES_LIST,
        NACHRICHTEN_STATES_LIST,
    };
}

module.exports = { buildStateGroups };
