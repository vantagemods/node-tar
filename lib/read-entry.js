'use strict';
var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
var types = require('./types');
var MiniPass = require('minipass');
var SLURP = Symbol('slurp');
module.exports = (function (_super) {
    __extends(ReadEntry, _super);
    function ReadEntry(header, ex, gex) {
        var _this = _super.call(this) || this;
        _this.extended = ex;
        _this.globalExtended = gex;
        _this.header = header;
        _this.blockRemain = 512 * Math.ceil(header.size / 512);
        _this.remain = header.size;
        _this.type = header.type;
        _this.meta = false;
        _this.ignore = false;
        switch (_this.type) {
            case 'File':
            case 'OldFile':
            case 'Link':
            case 'SymbolicLink':
            case 'CharacterDevice':
            case 'BlockDevice':
            case 'Directory':
            case 'FIFO':
            case 'ContiguousFile':
            case 'GNUDumpDir':
                break;
            case 'NextFileHasLongLinkpath':
            case 'NextFileHasLongPath':
            case 'OldGnuLongPath':
            case 'GlobalExtendedHeader':
            case 'ExtendedHeader':
            case 'OldExtendedHeader':
                _this.meta = true;
                break;
            // NOTE: gnutar and bsdtar treat unrecognized types as 'File'
            // it may be worth doing the same, but with a warning.
            default:
                _this.ignore = true;
        }
        _this.path = header.path;
        _this.mode = header.mode;
        if (_this.mode)
            _this.mode = _this.mode & 4095;
        _this.uid = header.uid;
        _this.gid = header.gid;
        _this.uname = header.uname;
        _this.gname = header.gname;
        _this.size = header.size;
        _this.mtime = header.mtime;
        _this.atime = header.atime;
        _this.ctime = header.ctime;
        _this.linkpath = header.linkpath;
        _this.uname = header.uname;
        _this.gname = header.gname;
        if (ex)
            _this[SLURP](ex);
        if (gex)
            _this[SLURP](gex, true);
        return _this;
    }
    ReadEntry.prototype.write = function (data) {
        var writeLen = data.length;
        if (writeLen > this.blockRemain)
            throw new Error('writing more to entry than is appropriate');
        var r = this.remain;
        var br = this.blockRemain;
        this.remain = Math.max(0, r - writeLen);
        this.blockRemain = Math.max(0, br - writeLen);
        if (this.ignore)
            return true;
        if (r >= writeLen)
            return _super.prototype.write.call(this, data);
        // r < writeLen
        return _super.prototype.write.call(this, data.slice(0, r));
    };
    ReadEntry.prototype[SLURP] = function (ex, global) {
        for (var k in ex) {
            // we slurp in everything except for the path attribute in
            // a global extended header, because that's weird.
            if (ex[k] !== null && ex[k] !== undefined &&
                !(global && k === 'path'))
                this[k] = ex[k];
        }
    };
    return ReadEntry;
}(MiniPass));
