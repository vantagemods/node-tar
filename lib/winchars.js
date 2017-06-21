'use strict';
// When writing files on Windows, translate the characters to their
// 0xf000 higher-encoded versions.
var raw = [
    '|',
    '<',
    '>',
    '?',
    ':'
];
var win = raw.map(function (char) {
    return String.fromCharCode(0xf000 + char.charCodeAt(0));
});
var toWin = new Map(raw.map(function (char, i) { return [char, win[i]]; }));
var toRaw = new Map(win.map(function (char, i) { return [char, raw[i]]; }));
module.exports = {
    encode: function (s) { return raw.reduce(function (s, c) { return s.split(c).join(toWin.get(c)); }, s); },
    decode: function (s) { return win.reduce(function (s, c) { return s.split(c).join(toRaw.get(c)); }, s); }
};
