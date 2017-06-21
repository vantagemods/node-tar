'use strict';
var Header = require('./header');
var path = require('path');
var Pax = (function () {
    function Pax(obj, global) {
        this.atime = obj.atime || null;
        this.charset = obj.charset || null;
        this.comment = obj.comment || null;
        this.ctime = obj.ctime || null;
        this.gid = obj.gid || null;
        this.gname = obj.gname || null;
        this.linkpath = obj.linkpath || null;
        this.mtime = obj.mtime || null;
        this.path = obj.path || null;
        this.size = obj.size || null;
        this.uid = obj.uid || null;
        this.uname = obj.uname || null;
        this.dev = obj.dev || null;
        this.ino = obj.ino || null;
        this.nlink = obj.nlink || null;
        this.global = global || false;
    }
    Pax.prototype.encode = function () {
        var body = this.encodeBody();
        if (body === '')
            return null;
        var bodyLen = Buffer.byteLength(body);
        // round up to 512 bytes
        // add 512 for header
        var bufLen = 512 * Math.ceil(1 + bodyLen / 512);
        var buf = Buffer.allocUnsafe(bufLen);
        // 0-fill the header section, it might not hit every field
        for (var i = 0; i < 512; i++) {
            buf[i] = 0;
        }
        new Header({
            // XXX split the path
            // then the path should be PaxHeader + basename, but less than 99,
            // prepend with the dirname
            path: ('PaxHeader/' + path.basename(this.path)).slice(0, 99),
            mode: this.mode || 420,
            uid: this.uid || null,
            gid: this.gid || null,
            size: bodyLen,
            mtime: this.mtime || null,
            type: this.global ? 'GlobalExtendedHeader' : 'ExtendedHeader',
            linkpath: '',
            uname: this.uname || '',
            gname: this.gname || '',
            devmaj: 0,
            devmin: 0,
            atime: this.atime || null,
            ctime: this.ctime || null
        }).encode(buf);
        buf.write(body, 512, bodyLen, 'utf8');
        // null pad after the body
        for (var i = bodyLen + 512; i < buf.length; i++) {
            buf[i] = 0;
        }
        return buf;
    };
    Pax.prototype.encodeBody = function () {
        return (this.encodeField('path') +
            this.encodeField('ctime') +
            this.encodeField('atime') +
            this.encodeField('dev') +
            this.encodeField('ino') +
            this.encodeField('nlink') +
            this.encodeField('charset') +
            this.encodeField('comment') +
            this.encodeField('gid') +
            this.encodeField('gname') +
            this.encodeField('linkpath') +
            this.encodeField('mtime') +
            this.encodeField('size') +
            this.encodeField('uid') +
            this.encodeField('uname'));
    };
    Pax.prototype.encodeField = function (field) {
        if (this[field] === null || this[field] === undefined)
            return '';
        var v = this[field] instanceof Date ? this[field].getTime() / 1000
            : this[field];
        var s = ' ' +
            (field === 'dev' || field === 'ino' || field === 'nlink'
                ? 'SCHILY.' : '') +
            field + '=' + v + '\n';
        var byteLen = Buffer.byteLength(s);
        // the digits includes the length of the digits in ascii base-10
        // so if it's 9 characters, then adding 1 for the 9 makes it 10
        // which makes it 11 chars.
        var digits = Math.floor(Math.log(byteLen) / Math.log(10)) + 1;
        if (byteLen + digits >= Math.pow(10, digits))
            digits += 1;
        var len = digits + byteLen;
        return len + s;
    };
    return Pax;
}());
Pax.parse = function (string, ex, g) { return new Pax(merge(parseKV(string), ex), g); };
var merge = function (a, b) {
    return b ? Object.keys(a).reduce(function (s, k) { return (s[k] = a[k], s); }, b) : a;
};
var parseKV = function (string) {
    return string
        .replace(/\n$/, '')
        .split('\n')
        .reduce(parseKVLine, Object.create(null));
};
var parseKVLine = function (set, line) {
    var n = parseInt(line, 10);
    // XXX Values with \n in them will fail this.
    // Refactor to not be a naive line-by-line parse.
    if (n !== Buffer.byteLength(line) + 1)
        return set;
    line = line.substr((n + ' ').length);
    var kv = line.split('=');
    var k = kv.shift().replace(/^SCHILY\.(dev|ino|nlink)/, '$1');
    if (!k)
        return set;
    var v = kv.join('=');
    set[k] = /^([A-Z]+\.)?([mac]|birth|creation)time$/.test(k)
        ? new Date(v * 1000)
        : /^[0-9]+$/.test(v) ? +v
            : v;
    return set;
};
module.exports = Pax;
