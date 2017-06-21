'use strict';
// parse a 512-byte header block to a data object, or vice-versa
// encode returns `true` if a pax extended header is needed, because
// the data could not be faithfully encoded in a simple header.
// (Also, check header.needPax to see if it needs a pax header.)
var types = require('./types');
var pathModule = require('path');
var large = require('./large-numbers');
var TYPE = Symbol('type');
var Header = (function () {
    function Header(data, off) {
        this.cksumValid = false;
        this.needPax = false;
        this.nullBlock = false;
        this.block = null;
        this.path = null;
        this.mode = null;
        this.uid = null;
        this.gid = null;
        this.size = null;
        this.mtime = null;
        this.cksum = null;
        this[TYPE] = '0';
        this.linkpath = null;
        this.uname = null;
        this.gname = null;
        this.devmaj = 0;
        this.devmin = 0;
        this.atime = null;
        this.ctime = null;
        if (Buffer.isBuffer(data)) {
            this.decode(data, off || 0);
        }
        else if (data)
            this.set(data);
    }
    Header.prototype.decode = function (buf, off) {
        if (!off)
            off = 0;
        if (!buf || !(buf.length >= off + 512))
            throw new Error('need 512 bytes for header');
        this.path = decString(buf, off, 100);
        this.mode = decNumber(buf, off + 100, 8);
        this.uid = decNumber(buf, off + 108, 8);
        this.gid = decNumber(buf, off + 116, 8);
        this.size = decNumber(buf, off + 124, 12);
        this.mtime = decDate(buf, off + 136, 12);
        this.cksum = decNumber(buf, off + 148, 12);
        // old tar versions marked dirs as a file with a trailing /
        this[TYPE] = decString(buf, off + 156, 1);
        if (this[TYPE] === '')
            this[TYPE] = '0';
        if (this[TYPE] === '0' && this.path.substr(-1) === '/')
            this[TYPE] = '5';
        // tar implementations sometimes incorrectly put the stat(dir).size
        // as the size in the tarball, even though Directory entries are
        // not able to have any body at all.  In the very rare chance that
        // it actually DOES have a body, we weren't going to do anything with
        // it anyway, and it'll just be a warning about an invalid header.
        if (this[TYPE] === '5')
            this.size = 0;
        this.linkpath = decString(buf, off + 157, 100);
        if (buf.slice(off + 257, off + 265).toString() === 'ustar\u000000') {
            this.uname = decString(buf, off + 265, 32);
            this.gname = decString(buf, off + 297, 32);
            this.devmaj = decNumber(buf, off + 329, 8);
            this.devmin = decNumber(buf, off + 337, 8);
            if (buf[off + 475] !== 0) {
                // definitely a prefix, definitely >130 chars.
                var prefix = decString(buf, off + 345, 155);
                this.path = prefix + '/' + this.path;
            }
            else {
                var prefix = decString(buf, off + 345, 130);
                if (prefix)
                    this.path = prefix + '/' + this.path;
                this.atime = decDate(buf, off + 476, 12);
                this.ctime = decDate(buf, off + 488, 12);
            }
        }
        var sum = 8 * 0x20;
        for (var i = off; i < off + 148; i++) {
            sum += buf[i];
        }
        for (var i = off + 156; i < off + 512; i++) {
            sum += buf[i];
        }
        this.cksumValid = sum === this.cksum;
        if (this.cksum === null && sum === 8 * 0x20)
            this.nullBlock = true;
    };
    Header.prototype.encode = function (buf, off) {
        if (!buf) {
            buf = this.block = Buffer.alloc(512);
            off = 0;
        }
        if (!off)
            off = 0;
        if (!(buf.length >= off + 512))
            throw new Error('need 512 bytes for header');
        var prefixSize = this.ctime || this.atime ? 130 : 155;
        var split = splitPrefix(this.path || '', prefixSize);
        var path = split[0];
        var prefix = split[1];
        this.needPax = split[2];
        this.needPax = encString(buf, off, 100, path) || this.needPax;
        this.needPax = encNumber(buf, off + 100, 8, this.mode) || this.needPax;
        this.needPax = encNumber(buf, off + 108, 8, this.uid) || this.needPax;
        this.needPax = encNumber(buf, off + 116, 8, this.gid) || this.needPax;
        this.needPax = encNumber(buf, off + 124, 12, this.size) || this.needPax;
        this.needPax = encDate(buf, off + 136, 12, this.mtime) || this.needPax;
        buf[off + 156] = this[TYPE].charCodeAt(0);
        this.needPax = encString(buf, off + 157, 100, this.linkpath) || this.needPax;
        buf.write('ustar\u000000', off + 257, 8);
        this.needPax = encString(buf, off + 265, 32, this.uname) || this.needPax;
        this.needPax = encString(buf, off + 297, 32, this.gname) || this.needPax;
        this.needPax = encNumber(buf, off + 329, 8, this.devmaj) || this.needPax;
        this.needPax = encNumber(buf, off + 337, 8, this.devmin) || this.needPax;
        this.needPax = encString(buf, off + 345, prefixSize, prefix) || this.needPax;
        if (buf[off + 475] !== 0)
            this.needPax = encString(buf, off + 345, 155, prefix) || this.needPax;
        else {
            this.needPax = encString(buf, off + 345, 130, prefix) || this.needPax;
            this.needPax = encDate(buf, off + 476, 12, this.atime) || this.needPax;
            this.needPax = encDate(buf, off + 488, 12, this.ctime) || this.needPax;
        }
        var sum = 8 * 0x20;
        for (var i = off; i < off + 148; i++) {
            sum += buf[i];
        }
        for (var i = off + 156; i < off + 512; i++) {
            sum += buf[i];
        }
        this.cksum = sum;
        encNumber(buf, off + 148, 8, this.cksum);
        this.cksumValid = true;
        return this.needPax;
    };
    Header.prototype.set = function (data) {
        for (var i in data) {
            if (data[i] !== null && data[i] !== undefined)
                this[i] = data[i];
        }
    };
    Object.defineProperty(Header.prototype, "type", {
        get: function () {
            return types.name.get(this[TYPE]) || this[TYPE];
        },
        set: function (type) {
            if (types.code.has(type))
                this[TYPE] = types.code.get(type);
            else
                this[TYPE] = type;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Header.prototype, "typeKey", {
        get: function () {
            return this[TYPE];
        },
        enumerable: true,
        configurable: true
    });
    return Header;
}());
var splitPrefix = function (p, prefixSize) {
    var pathSize = 100;
    var pp = p;
    var prefix = '';
    var ret;
    var root = pathModule.parse(p).root || '.';
    if (Buffer.byteLength(pp) < pathSize)
        ret = [pp, prefix, false];
    else {
        // first set prefix to the dir, and path to the base
        prefix = pathModule.dirname(pp);
        pp = pathModule.basename(pp);
        do {
            // both fit!
            if (Buffer.byteLength(pp) <= pathSize &&
                Buffer.byteLength(prefix) <= prefixSize)
                ret = [pp, prefix, false];
            else if (Buffer.byteLength(pp) > pathSize &&
                Buffer.byteLength(prefix) <= prefixSize)
                ret = [pp.substr(0, pathSize - 1), prefix, true];
            else {
                // make path take a bit from prefix
                pp = pathModule.join(pathModule.basename(prefix), pp);
                prefix = pathModule.dirname(prefix);
            }
        } while (prefix !== root && !ret);
        // at this point, found no resolution, just truncate
        if (!ret)
            ret = [p.substr(0, pathSize - 1), '', true];
    }
    return ret;
};
var decString = function (buf, off, size) {
    return buf.slice(off, off + size).toString('utf8').replace(/\0.*/, '');
};
var decDate = function (buf, off, size) {
    return numToDate(decNumber(buf, off, size));
};
var numToDate = function (num) { return num === null ? null : new Date(num * 1000); };
var decNumber = function (buf, off, size) {
    return buf[off] & 0x80 ? large.parse(buf.slice(off, off + size))
        : decSmallNumber(buf, off, size);
};
var nanNull = function (value) { return isNaN(value) ? null : value; };
var decSmallNumber = function (buf, off, size) {
    return nanNull(parseInt(buf.slice(off, off + size)
        .toString('utf8').replace(/\0.*$/, '').trim(), 8));
};
// the maximum encodable as a null-terminated octal, by field size
var MAXNUM = {
    12: 8589934591,
    8: 2097151
};
var encNumber = function (buf, off, size, number) {
    return number === null ? false :
        number > MAXNUM[size] || number < 0
            ? (large.encode(number, buf.slice(off, off + size)), true)
            : (encSmallNumber(buf, off, size, number), false);
};
var encSmallNumber = function (buf, off, size, number) {
    return buf.write(octalString(number, size), off, size, 'ascii');
};
var octalString = function (number, size) {
    return padOctal(Math.floor(number).toString(8), size);
};
var padOctal = function (string, size) {
    return (string.length === size - 1 ? string
        : new Array(size - string.length - 1).join('0') + string + ' ') + '\0';
};
var encDate = function (buf, off, size, date) {
    return date === null ? false :
        encNumber(buf, off, size, date.getTime() / 1000);
};
// enough to fill the longest string we've got
var NULLS = new Array(156).join('\0');
// pad with nulls, return true if it's longer or non-ascii
var encString = function (buf, off, size, string) {
    return string === null ? false :
        (buf.write(string + NULLS, off, size, 'utf8'),
            string.length !== Buffer.byteLength(string) || string.length > size);
};
module.exports = Header;
