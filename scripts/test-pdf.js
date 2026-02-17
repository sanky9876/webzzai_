
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

console.log('Type of pdf:', typeof pdf);
console.log('PDF value:', pdf);

async function test() {
    try {
        // Create a dummy PDF buffer (this won't work for actual parsing if it's not a real PDF, 
        // but we just want to see if the function runs and throws a "bad pdf" error rather than "not a function")
        // Better: Use a real dummy PDF if possible, or just check the function export.

        if (typeof pdf === 'function') {
            console.log('SUCCESS: pdf-parse is a function.');
        } else {
            console.error('FAILURE: pdf-parse is NOT a function.');
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

test();
