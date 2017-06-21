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
// this[BUFFER] is the remainder of a chunk if we're waiting for
// the full 512 bytes of a header to come in.  We will Buffer.concat()
// it to the next write(), which is a mem copy, but a small one.
//
// this[QUEUE] is a Yallist of entries that haven't been emitted
// yet this can only get filled up if the user keeps write()ing after
// a write() returns false, or does a write() with more than one entry
//
// We don't buffer chunks, we always parse them and either create an
// entry, or push it into the active entry.  The ReadEntry class knows
// to throw data away if .ignore=true
//
// Shift entry off the buffer when it emits 'end', and emit 'entry' for
// the next one in the list.
//
// At any time, we're pushing body chunks into the entry at WRITEENTRY,
// and waiting for 'end' on the entry at READENTRY
//
// ignored entries get .resume() called on them straight away
var warner = require('./warn-mixin');
var path = require('path');
var Header = require('./header');
var EE = require('events');
var Yallist = require('yallist');
var maxMetaEntrySize = 1024 * 1024;
var Entry = require('./read-entry');
var Pax = require('./pax');
var zlib = require('minizlib');
var gzipHeader = new Buffer([0x1f, 0x8b]);
var STATE = Symbol('state');
var WRITEENTRY = Symbol('writeEntry');
var READENTRY = Symbol('readEntry');
var NEXTENTRY = Symbol('nextEntry');
var PROCESSENTRY = Symbol('processEntry');
var EX = Symbol('extendedHeader');
var GEX = Symbol('globalExtendedHeader');
var META = Symbol('meta');
var EMITMETA = Symbol('emitMeta');
var BUFFER = Symbol('buffer');
var QUEUE = Symbol('queue');
var ENDED = Symbol('ended');
var EMITTEDEND = Symbol('emittedEnd');
var EMIT = Symbol('emit');
var UNZIP = Symbol('unzip');
var CONSUMECHUNK = Symbol('consumeChunk');
var CONSUMECHUNKSUB = Symbol('consumeChunkSub');
var CONSUMEBODY = Symbol('consumeBody');
var CONSUMEMETA = Symbol('consumeMeta');
var CONSUMEHEADER = Symbol('consumeHeader');
var CONSUMING = Symbol('consuming');
var BUFFERCONCAT = Symbol('bufferConcat');
var MAYBEEND = Symbol('maybeEnd');
var WRITING = Symbol('writing');
var ABORTED = Symbol('aborted');
function noop() { return true; }
module.exports = warner((function (_super) {
    __extends(Parser, _super);
    function Parser(opt) {
        var _this = this;
        var start = process.hrtime();
        opt = opt || {};
        _this = _super.call(this, opt) || this;
        _this.strict = !!opt.strict;
        _this.maxMetaEntrySize = opt.maxMetaEntrySize || maxMetaEntrySize;
        _this.filter = typeof opt.filter === 'function' ? opt.filter : noop;
        _this[QUEUE] = new Yallist();
        _this[BUFFER] = null;
        _this[READENTRY] = null;
        _this[WRITEENTRY] = null;
        _this[STATE] = 'begin';
        _this[META] = '';
        _this[EX] = null;
        _this[GEX] = null;
        _this[ENDED] = false;
        _this[UNZIP] = null;
        _this[ABORTED] = false;
        if (typeof opt.onwarn === 'function')
            _this.on('warn', opt.onwarn);
        if (typeof opt.onentry === 'function')
            _this.on('entry', opt.onentry);
        return _this;
    }
    Parser.prototype[CONSUMEHEADER] = function (chunk, position) {
        var _this = this;
        var header = new Header(chunk, position);
        if (header.nullBlock)
            this[EMIT]('nullBlock');
        else if (!header.cksumValid)
            this.warn('invalid entry', header);
        else if (!header.path)
            this.warn('invalid: path is required', header);
        else {
            var type = header.type;
            if (/^(Symbolic)?Link$/.test(type) && !header.linkpath)
                this.warn('invalid: linkpath required', header);
            else if (!/^(Symbolic)?Link$/.test(type) && header.linkpath)
                this.warn('invalid: linkpath forbidden', header);
            else {
                var entry = this[WRITEENTRY] = new Entry(header, this[EX], this[GEX]);
                if (entry.meta) {
                    if (entry.size > this.maxMetaEntrySize) {
                        entry.ignore = true;
                        this[EMIT]('ignoredEntry', entry);
                        this[STATE] = 'ignore';
                    }
                    else if (entry.size > 0) {
                        this[META] = '';
                        entry.on('data', function (c) { return _this[META] += c; });
                        this[STATE] = 'meta';
                    }
                }
                else {
                    this[EX] = null;
                    entry.ignore = entry.ignore || !this.filter(entry.path, entry);
                    if (entry.ignore) {
                        this[EMIT]('ignoredEntry', entry);
                        this[STATE] = entry.remain ? 'ignore' : 'begin';
                    }
                    else {
                        if (entry.remain)
                            this[STATE] = 'body';
                        else {
                            this[STATE] = 'begin';
                            entry.end();
                        }
                        if (!this[READENTRY]) {
                            this[QUEUE].push(entry);
                            this[NEXTENTRY]();
                        }
                        else
                            this[QUEUE].push(entry);
                    }
                }
            }
        }
    };
    Parser.prototype[PROCESSENTRY] = function (entry) {
        var _this = this;
        var go = true;
        if (!entry) {
            this[READENTRY] = null;
            go = false;
        }
        else if (Array.isArray(entry))
            this.emit.apply(this, entry);
        else {
            this[READENTRY] = entry;
            this.emit('entry', entry);
            if (!entry.emittedEnd) {
                entry.on('end', function (_) { return _this[NEXTENTRY](); });
                go = false;
            }
        }
        return go;
    };
    Parser.prototype[NEXTENTRY] = function () {
        var _this = this;
        do { } while (this[PROCESSENTRY](this[QUEUE].shift()));
        if (!this[QUEUE].length) {
            // At this point, there's nothing in the queue, but we may have an
            // entry which is being consumed (readEntry).
            // If we don't, then we definitely can handle more data.
            // If we do, and either it's flowing, or it has never had any data
            // written to it, then it needs more.
            // The only other possibility is that it has returned false from a
            // write() call, so we wait for the next drain to continue.
            var re = this[READENTRY];
            var drainNow = !re || re.flowing || re.size === re.remain;
            if (drainNow) {
                if (!this[WRITING])
                    this.emit('drain');
            }
            else
                re.once('drain', function (_) { return _this.emit('drain'); });
        }
    };
    Parser.prototype[CONSUMEBODY] = function (chunk, position) {
        // write up to but no  more than writeEntry.blockRemain
        var entry = this[WRITEENTRY];
        var br = entry.blockRemain;
        var c = (br >= chunk.length && position === 0) ? chunk
            : chunk.slice(position, position + br);
        entry.write(c);
        if (!entry.blockRemain) {
            this[STATE] = 'begin';
            this[WRITEENTRY] = null;
            entry.end();
        }
        return c.length;
    };
    Parser.prototype[CONSUMEMETA] = function (chunk, position) {
        var entry = this[WRITEENTRY];
        var ret = this[CONSUMEBODY](chunk, position);
        // if we finished, then the entry is reset
        if (!this[WRITEENTRY])
            this[EMITMETA](entry);
        return ret;
    };
    Parser.prototype[EMIT] = function (ev, data, extra) {
        if (!this[QUEUE].length && !this[READENTRY])
            this.emit(ev, data, extra);
        else
            this[QUEUE].push([ev, data, extra]);
    };
    Parser.prototype[EMITMETA] = function (entry) {
        this[EMIT]('meta', this[META]);
        switch (entry.type) {
            case 'ExtendedHeader':
            case 'OldExtendedHeader':
                this[EX] = Pax.parse(this[META], this[EX], false);
                break;
            case 'GlobalExtendedHeader':
                this[GEX] = Pax.parse(this[META], this[GEX], true);
                break;
            case 'NextFileHasLongPath':
            case 'OldGnuLongPath':
                this[EX] = this[EX] || Object.create(null);
                this[EX].path = this[META];
                break;
            case 'NextFileHasLongLinkpath':
                this[EX] = this[EX] || Object.create(null);
                this[EX].linkpath = this[META];
                break;
            /* istanbul ignore next */
            default: throw new Error('unknown meta: ' + entry.type);
        }
    };
    Parser.prototype.abort = function (msg, error) {
        this[ABORTED] = true;
        this.warn(msg, error);
        this.emit('abort');
    };
    Parser.prototype.write = function (chunk) {
        var _this = this;
        if (this[ABORTED])
            return;
        // first write, might be gzipped
        if (this[UNZIP] === null && chunk) {
            if (this[BUFFER]) {
                chunk = Buffer.concat([this[BUFFER], chunk]);
                this[BUFFER] = null;
            }
            if (chunk.length < gzipHeader.length) {
                this[BUFFER] = chunk;
                return true;
            }
            for (var i = 0; this[UNZIP] === null && i < gzipHeader.length; i++) {
                if (chunk[i] !== gzipHeader[i])
                    this[UNZIP] = false;
            }
            if (this[UNZIP] === null) {
                var ended = this[ENDED];
                this[ENDED] = false;
                this[UNZIP] = new zlib.Unzip();
                this[UNZIP].on('data', function (chunk) { return _this[CONSUMECHUNK](chunk); });
                this[UNZIP].on('error', function (er) {
                    return _this.abort('zlib error: ' + er.message, er);
                });
                this[UNZIP].on('end', function (_) {
                    _this[ENDED] = true;
                    _this[CONSUMECHUNK]();
                });
                return ended ? this[UNZIP].end(chunk) : this[UNZIP].write(chunk);
            }
        }
        this[WRITING] = true;
        if (this[UNZIP])
            this[UNZIP].write(chunk);
        else
            this[CONSUMECHUNK](chunk);
        this[WRITING] = false;
        // return false if there's a queue, or if the current entry isn't flowing
        var ret = this[QUEUE].length ? false :
            this[READENTRY] ? this[READENTRY].flowing :
                true;
        // if we have no queue, then that means a clogged READENTRY
        if (!ret && !this[QUEUE].length)
            this[READENTRY].once('drain', function (_) { return _this.emit('drain'); });
        return ret;
    };
    Parser.prototype[BUFFERCONCAT] = function (c) {
        if (c && !this[ABORTED])
            this[BUFFER] = this[BUFFER] ? Buffer.concat([this[BUFFER], c]) : c;
    };
    Parser.prototype[MAYBEEND] = function () {
        if (this[ENDED] && !this[EMITTEDEND] && !this[ABORTED]) {
            this[EMITTEDEND] = true;
            var entry = this[WRITEENTRY];
            if (entry && entry.blockRemain) {
                var have = this[BUFFER] ? this[BUFFER].length : 0;
                this.warn('Truncated input (needed ' + entry.blockRemain +
                    ' more bytes, only ' + have + ' available)', entry);
                if (this[BUFFER])
                    entry.write(this[BUFFER]);
                entry.end();
            }
            this[EMIT]('end');
        }
    };
    Parser.prototype[CONSUMECHUNK] = function (chunk) {
        if (this[CONSUMING]) {
            this[BUFFERCONCAT](chunk);
        }
        else if (!chunk && !this[BUFFER]) {
            this[MAYBEEND]();
        }
        else {
            this[CONSUMING] = true;
            if (this[BUFFER]) {
                this[BUFFERCONCAT](chunk);
                var c = this[BUFFER];
                this[BUFFER] = null;
                this[CONSUMECHUNKSUB](c);
            }
            else {
                this[CONSUMECHUNKSUB](chunk);
            }
            while (this[BUFFER] && this[BUFFER].length >= 512 && !this[ABORTED]) {
                var c = this[BUFFER];
                this[BUFFER] = null;
                this[CONSUMECHUNKSUB](c);
            }
            this[CONSUMING] = false;
        }
        if (!this[BUFFER] || this[ENDED])
            this[MAYBEEND]();
    };
    Parser.prototype[CONSUMECHUNKSUB] = function (chunk) {
        // we know that we are in CONSUMING mode, so anything written goes into
        // the buffer.  Advance the position and put any remainder in the buffer.
        var position = 0;
        var length = chunk.length;
        while (position + 512 <= length && !this[ABORTED]) {
            switch (this[STATE]) {
                case 'begin':
                    this[CONSUMEHEADER](chunk, position);
                    position += 512;
                    break;
                case 'ignore':
                case 'body':
                    position += this[CONSUMEBODY](chunk, position);
                    break;
                case 'meta':
                    position += this[CONSUMEMETA](chunk, position);
                    break;
                /* istanbul ignore next */
                default:
                    throw new Error('invalid state: ' + this[STATE]);
            }
        }
        if (position < length) {
            if (this[BUFFER])
                this[BUFFER] = Buffer.concat([chunk.slice(position), this[BUFFER]]);
            else
                this[BUFFER] = chunk.slice(position);
        }
    };
    Parser.prototype.end = function (chunk) {
        if (!this[ABORTED]) {
            if (this[UNZIP])
                this[UNZIP].end(chunk);
            else {
                this[ENDED] = true;
                this.write(chunk);
            }
        }
    };
    return Parser;
}(EE)));
