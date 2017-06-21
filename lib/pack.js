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
// A readable tar stream creator
// Technically, this is a transform stream that you write paths into,
// and tar format comes out of.
// The `add()` method is like `write()` but returns this,
// and end() return `this` as well, so you can
// do `new Pack(opt).add('files').add('dir').end().pipe(output)
// You could also do something like:
// streamOfPaths().pipe(new Pack()).pipe(new fs.WriteStream('out.tar'))
var PackJob = (function () {
    function PackJob(path, absolute) {
        this.path = path || './';
        this.absolute = absolute;
        this.entry = null;
        this.stat = null;
        this.readdir = null;
        this.pending = false;
        this.ignore = false;
        this.piped = false;
    }
    return PackJob;
}());
var MiniPass = require('minipass');
var zlib = require('minizlib');
var ReadEntry = require('./read-entry');
var WriteEntry = require('./write-entry');
var WriteEntrySync = WriteEntry.Sync;
var WriteEntryTar = WriteEntry.Tar;
var Yallist = require('yallist');
var EOF = Buffer.alloc(1024);
var ONSTAT = Symbol('onStat');
var ENDED = Symbol('ended');
var QUEUE = Symbol('queue');
var CURRENT = Symbol('current');
var PROCESS = Symbol('process');
var PROCESSING = Symbol('processing');
var PROCESSJOB = Symbol('processJob');
var JOBS = Symbol('jobs');
var JOBDONE = Symbol('jobDone');
var ADDFSENTRY = Symbol('addFSEntry');
var ADDTARENTRY = Symbol('addTarEntry');
var STAT = Symbol('stat');
var READDIR = Symbol('readdir');
var ONREADDIR = Symbol('onreaddir');
var PIPE = Symbol('pipe');
var ENTRY = Symbol('entry');
var ENTRYOPT = Symbol('entryOpt');
var WRITEENTRYCLASS = Symbol('writeEntryClass');
var WRITE = Symbol('write');
var ONDRAIN = Symbol('ondrain');
var fs = require('fs');
var path = require('path');
var warner = require('./warn-mixin');
var Pack = warner((function (_super) {
    __extends(Pack, _super);
    function Pack(opt) {
        var _this = _super.call(this, opt) || this;
        opt = opt || Object.create(null);
        _this.opt = opt;
        _this.cwd = opt.cwd || process.cwd();
        _this.maxReadSize = opt.maxReadSize;
        _this.preservePaths = !!opt.preservePaths;
        _this.strict = !!opt.strict;
        _this.noPax = !!opt.noPax;
        _this.prefix = (opt.prefix || '').replace(/(\\|\/)+$/, '');
        _this.linkCache = opt.linkCache || new Map();
        _this.statCache = opt.statCache || new Map();
        _this.readdirCache = opt.readdirCache || new Map();
        _this[WRITEENTRYCLASS] = WriteEntry;
        if (typeof opt.onwarn === 'function')
            _this.on('warn', opt.onwarn);
        _this.zip = null;
        if (opt.gzip) {
            if (typeof opt.gzip !== 'object')
                opt.gzip = {};
            _this.zip = new zlib.Gzip(opt.gzip);
            _this.zip.on('data', function (chunk) { return _super.prototype.write.call(_this, chunk); });
            _this.zip.on('end', function (_) { return _super.prototype.end.call(_this); });
            _this.zip.on('drain', function (_) { return _this[ONDRAIN](); });
            _this.on('resume', function (_) { return _this.zip.resume(); });
        }
        else
            _this.on('drain', _this[ONDRAIN]);
        _this.portable = !!opt.portable;
        _this.noDirRecurse = !!opt.noDirRecurse;
        _this.follow = !!opt.follow;
        _this.filter = typeof opt.filter === 'function' ? opt.filter : function (_) { return true; };
        _this[QUEUE] = new Yallist;
        _this[JOBS] = 0;
        _this.jobs = +opt.jobs || 4;
        _this[PROCESSING] = false;
        _this[ENDED] = false;
        return _this;
    }
    Pack.prototype[WRITE] = function (chunk) {
        return _super.prototype.write.call(this, chunk);
    };
    Pack.prototype.add = function (path) {
        this.write(path);
        return this;
    };
    Pack.prototype.end = function (path) {
        if (path)
            this.write(path);
        this[ENDED] = true;
        this[PROCESS]();
        return this;
    };
    Pack.prototype.write = function (path) {
        if (this[ENDED])
            throw new Error('write after end');
        if (path instanceof ReadEntry)
            this[ADDTARENTRY](path);
        else
            this[ADDFSENTRY](path);
        return this.flowing;
    };
    Pack.prototype[ADDTARENTRY] = function (p) {
        var _this = this;
        var absolute = path.resolve(this.cwd, p.path);
        if (this.prefix)
            p.path = this.prefix + '/' + p.path;
        // in this case, we don't have to wait for the stat
        if (!this.filter(p.path, p))
            p.resume();
        else {
            var job_1 = new PackJob(p.path, absolute, false);
            job_1.entry = new WriteEntryTar(p, this[ENTRYOPT](job_1));
            job_1.entry.on('end', function (_) { return _this[JOBDONE](job_1); });
            this[JOBS] += 1;
            this[QUEUE].push(job_1);
        }
        this[PROCESS]();
    };
    Pack.prototype[ADDFSENTRY] = function (p) {
        var absolute = path.resolve(this.cwd, p);
        if (this.prefix)
            p = this.prefix + '/' + p;
        this[QUEUE].push(new PackJob(p, absolute));
        this[PROCESS]();
    };
    Pack.prototype[STAT] = function (job) {
        var _this = this;
        job.pending = true;
        this[JOBS] += 1;
        var stat = this.follow ? 'stat' : 'lstat';
        fs[stat](job.absolute, function (er, stat) {
            job.pending = false;
            _this[JOBS] -= 1;
            if (er)
                _this.emit('error', er);
            else
                _this[ONSTAT](job, stat);
        });
    };
    Pack.prototype[ONSTAT] = function (job, stat) {
        this.statCache.set(job.absolute, stat);
        job.stat = stat;
        // now we have the stat, we can filter it.
        if (!this.filter(job.path, stat))
            job.ignore = true;
        this[PROCESS]();
    };
    Pack.prototype[READDIR] = function (job) {
        var _this = this;
        job.pending = true;
        this[JOBS] += 1;
        fs.readdir(job.absolute, function (er, entries) {
            job.pending = false;
            _this[JOBS] -= 1;
            if (er)
                return _this.emit('error', er);
            _this[ONREADDIR](job, entries);
        });
    };
    Pack.prototype[ONREADDIR] = function (job, entries) {
        this.readdirCache.set(job.absolute, entries);
        job.readdir = entries;
        this[PROCESS]();
    };
    Pack.prototype[PROCESS] = function () {
        if (this[PROCESSING])
            return;
        this[PROCESSING] = true;
        for (var w = this[QUEUE].head; w !== null && this[JOBS] < this.jobs; w = w.next) {
            this[PROCESSJOB](w.value);
            if (w.value.ignore) {
                var p = w.next;
                this[QUEUE].removeNode(w);
                w.next = p;
            }
        }
        this[PROCESSING] = false;
        if (this[ENDED] && !this[QUEUE].length && this[JOBS] === 0) {
            if (this.zip)
                this.zip.end(EOF);
            else {
                _super.prototype.write.call(this, EOF);
                _super.prototype.end.call(this);
            }
        }
    };
    Object.defineProperty(Pack.prototype, CURRENT, {
        get: function () {
            return this[QUEUE] && this[QUEUE].head && this[QUEUE].head.value;
        },
        enumerable: true,
        configurable: true
    });
    Pack.prototype[JOBDONE] = function (job) {
        this[QUEUE].shift();
        this[JOBS] -= 1;
        this[PROCESS]();
    };
    Pack.prototype[PROCESSJOB] = function (job) {
        if (job.pending)
            return;
        if (job.entry) {
            if (job === this[CURRENT] && !job.piped)
                this[PIPE](job);
            return;
        }
        if (!job.stat) {
            if (this.statCache.has(job.absolute))
                this[ONSTAT](job, this.statCache.get(job.absolute));
            else
                this[STAT](job);
        }
        if (!job.stat)
            return;
        // filtered out!
        if (job.ignore)
            return;
        if (!this.noDirRecurse && job.stat.isDirectory() && !job.readdir) {
            if (this.readdirCache.has(job.absolute))
                this[ONREADDIR](job, this.readdirCache.get(job.absolute));
            else
                this[READDIR](job);
            if (!job.readdir)
                return;
        }
        // we know it doesn't have an entry, because that got checked above
        job.entry = this[ENTRY](job);
        if (!job.entry) {
            job.ignore = true;
            return;
        }
        if (job === this[CURRENT] && !job.piped)
            this[PIPE](job);
    };
    Pack.prototype[ENTRYOPT] = function (job) {
        var _this = this;
        return {
            onwarn: function (msg, data) {
                _this.warn(msg, data);
            },
            noPax: this.noPax,
            cwd: this.cwd,
            absolute: job.absolute,
            preservePaths: this.preservePaths,
            maxReadSize: this.maxReadSize,
            strict: this.strict,
            portable: this.portable,
            linkCache: this.linkCache,
            statCache: this.statCache
        };
    };
    Pack.prototype[ENTRY] = function (job) {
        var _this = this;
        this[JOBS] += 1;
        try {
            return new this[WRITEENTRYCLASS](job.path, this[ENTRYOPT](job)).on('end', function (_) {
                _this[JOBDONE](job);
            }).on('error', function (er) { return _this.emit('error', er); });
        }
        catch (er) {
            this.emit('error', er);
        }
    };
    Pack.prototype[ONDRAIN] = function () {
        if (this[CURRENT] && this[CURRENT].entry)
            this[CURRENT].entry.resume();
    };
    // like .pipe() but using super, because our write() is special
    Pack.prototype[PIPE] = function (job) {
        var _this = this;
        job.piped = true;
        if (job.readdir)
            job.readdir.forEach(function (entry) {
                var base = job.path === './' ? '' : job.path.replace(/\/*$/, '/');
                _this[ADDFSENTRY](base + entry);
            });
        var source = job.entry;
        var zip = this.zip;
        if (zip)
            source.on('data', function (chunk) {
                if (!zip.write(chunk))
                    source.pause();
            });
        else
            source.on('data', function (chunk) {
                if (!_super.prototype.write.call(_this, chunk))
                    source.pause();
            });
    };
    Pack.prototype.pause = function () {
        if (this.zip)
            this.zip.pause();
        return _super.prototype.pause.call(this);
    };
    return Pack;
}(MiniPass)));
var PackSync = (function (_super) {
    __extends(PackSync, _super);
    function PackSync(opt) {
        var _this = _super.call(this, opt) || this;
        _this[WRITEENTRYCLASS] = WriteEntrySync;
        return _this;
    }
    // pause/resume are no-ops in sync streams.
    PackSync.prototype.pause = function () { };
    PackSync.prototype.resume = function () { };
    PackSync.prototype[STAT] = function (job) {
        var stat = this.follow ? 'statSync' : 'lstatSync';
        this[ONSTAT](job, fs[stat](job.absolute));
    };
    PackSync.prototype[READDIR] = function (job, stat) {
        this[ONREADDIR](job, fs.readdirSync(job.absolute));
    };
    // gotta get it all in this tick
    PackSync.prototype[PIPE] = function (job) {
        var _this = this;
        var source = job.entry;
        var zip = this.zip;
        if (job.readdir)
            job.readdir.forEach(function (entry) {
                _this[ADDFSENTRY](job.path + '/' + entry);
            });
        if (zip)
            source.on('data', function (chunk) {
                zip.write(chunk);
            });
        else
            source.on('data', function (chunk) {
                _super.prototype[WRITE].call(_this, chunk);
            });
    };
    return PackSync;
}(Pack));
Pack.Sync = PackSync;
module.exports = Pack;
