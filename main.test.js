'use strict';

/**
 * This is a dummy test file using chai and mocha.
 */

const chai = require('chai');
const { expect } = chai;

// Aktiviert die .should-Syntax für Prototypen
chai.should(); 

// import { functiontotest } from "./moduletotest";

describe('module to test => function to test', () => {
    const expected = 5;

    it(`should return ${expected}`, () => {
        const result = 5; // Hier functiontotest() aufrufen
        
        // Option 1: Expect-Syntax (Funktioniert immer)
        expect(result).to.equal(expected);
        
        // Option 2: Should-Syntax (Funktioniert jetzt durch chai.should())
        result.should.equal(expected);
    });
});
