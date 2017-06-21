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
var assert = require('assert');
var EE = require('events').EventEmitter;
var Parser = require('./parse');
var fs = require('fs');
var path = require('path');
var mkdir = require('./mkdir');
var mkdirSync = mkdir.sync;
var wc = require('./winchars');
var ONENTRY = Symbol('onEntry');
var CHECKFS = Symbol('checkFs');
var MAKEFS = Symbol('makeFs');
var FILE = Symbol('file');
var DIRECTORY = Symbol('directory');
var LINK = Symbol('link');
var SYMLINK = Symbol('symlink');
var HARDLINK = Symbol('hardlink');
var UNSUPPORTED = Symbol('unsupported');
var UNKNOWN = Symbol('unknown');
var CHECKPATH = Symbol('checkPath');
var MKDIR = Symbol('mkdir');
var ONERROR = Symbol('onError');
var PENDING = Symbol('pending');
var PEND = Symbol('pend');
var UNPEND = Symbol('unpend');
var ENDED = Symbol('ended');
var MAYBECLOSE = Symbol('maybeClose');
var SKIP = Symbol('skip');
var Unpack = (function (_super) {
    __extends(Unpack, _super);
    function Unpack(opt) {
        var _this = _super.call(this, opt) || this;
        if (!opt)
            opt = {};
        _this[PENDING] = 0;
        _this[ENDED] = false;
        _this.on('end', function (_) {
            _this[ENDED] = true;
            _this[MAYBECLOSE]();
        });
        _this.dirCache = opt.dirCache || new Map();
        if (opt.preserveOwner === undefined)
            _this.preserveOwner = process.getuid && process.getuid() === 0;
        else
            _this.preserveOwner = !!opt.preserveOwner;
        // turn ><?| in filenames into 0xf000-higher encoded forms
        _this.win32 = !!opt.win32 || process.platform === 'win32';
        // do not unpack over files that are newer than what's in the archive
        _this.newer = !!opt.newer;
        // do not unpack over ANY files
        _this.keep = !!opt.keep;
        // do not set mtime/atime of extracted entries
        _this.noMtime = !!opt.noMtime;
        // allow .., absolute path entries, and unpacking through symlinks
        // without this, warn and skip .., relativize absolutes, and error
        // on symlinks in extraction path
        _this.preservePaths = !!opt.preservePaths;
        // unlink files and links before writing. This breaks existing hard
        // links, and removes symlink directories rather than erroring
        _this.unlink = !!opt.unlink;
        _this.cwd = path.resolve(opt.cwd || process.cwd());
        _this.strip = +opt.strip || 0;
        _this.umask = typeof opt.umask === 'number' ? opt.umask : process.umask();
        // default mode for dirs created as parents
        _this.dmode = opt.dmode || (511 & (~_this.umask));
        _this.fmode = opt.fmode || (438 & (~_this.umask));
        _this.on('entry', function (entry) { return _this[ONENTRY](entry); });
        return _this;
    }
    Unpack.prototype[MAYBECLOSE] = function () {
        if (this[ENDED] && this[PENDING] === 0)
            this.emit('close');
    };
    Unpack.prototype[CHECKPATH] = function (entry) {
        if (this.strip) {
            var parts = entry.path.split(/\/|\\/);
            if (parts.length < this.strip)
                return false;
            entry.path = parts.slice(this.strip).join('/');
        }
        if (!this.preservePaths) {
            var p = entry.path;
            if (p.match(/(^|\/|\\)\.\.(\\|\/|$)/)) {
                this.warn('path contains \'..\'', p);
                return false;
            }
            // absolutes on posix are also absolutes on win32
            // so we only need to test this one to get both
            if (path.win32.isAbsolute(p)) {
                var parsed = path.win32.parse(p);
                this.warn('stripping ' + parsed.root + ' from absolute path', p);
                entry.path = p.substr(parsed.root.length);
            }
        }
        // only encode : chars that aren't drive letter indicators
        if (this.win32) {
            var parsed = path.win32.parse(entry.path);
            entry.path = parsed.root === '' ? wc.encode(entry.path)
                : parsed.root + wc.encode(entry.path.substr(parsed.root.length));
        }
        if (path.isAbsolute(entry.path))
            entry.absolute = entry.path;
        else
            entry.absolute = path.resolve(this.cwd, entry.path);
        return true;
    };
    Unpack.prototype[ONENTRY] = function (entry) {
        if (!this[CHECKPATH](entry))
            return entry.resume();
        assert.equal(typeof entry.absolute, 'string');
        switch (entry.type) {
            case 'Directory':
            case 'GNUDumpDir':
                if (entry.mode)
                    entry.mode = entry.mode | 448;
            case 'File':
            case 'OldFile':
            case 'ContiguousFile':
            case 'Link':
            case 'SymbolicLink':
                return this[CHECKFS](entry);
            case 'CharacterDevice':
            case 'BlockDevice':
            case 'FIFO':
                return this[UNSUPPORTED](entry);
        }
    };
    Unpack.prototype[ONERROR] = function (er, entry) {
        this.warn(er.message, er);
        this[UNPEND]();
        entry.resume();
    };
    Unpack.prototype[MKDIR] = function (dir, mode, cb) {
        mkdir(dir, {
            preserve: this.preservePaths,
            unlink: this.unlink,
            cache: this.dirCache,
            cwd: this.cwd,
            mode: mode
        }, cb);
    };
    Unpack.prototype[FILE] = function (entry) {
        var _this = this;
        var mode = entry.mode & 4095 || this.fmode;
        var stream = fs.createWriteStream(entry.absolute, { mode: mode });
        stream.on('error', function (er) { return _this[ONERROR](er, entry); });
        stream.on('close', function (_) {
            if (entry.mtime && !_this.noMtime)
                fs.utimes(entry.absolute, entry.atime || new Date(), entry.mtime, function (_) { return _; });
            if (entry.uid && _this.preserveOwner)
                fs.chown(entry.absolute, entry.uid, entry.gid || process.getgid(), function (_) { return _; });
            _this[UNPEND]();
        });
        entry.pipe(stream);
    };
    Unpack.prototype[DIRECTORY] = function (entry) {
        var _this = this;
        var mode = entry.mode & 4095 || this.dmode;
        this[MKDIR](entry.absolute, mode, function (er) {
            if (er)
                return _this[ONERROR](er, entry);
            if (entry.mtime && !_this.noMtime)
                fs.utimes(entry.absolute, entry.atime || new Date(), entry.mtime, function (_) { return _; });
            if (entry.uid && _this.preserveOwner)
                fs.chown(entry.absolute, entry.uid, entry.gid || process.getgid(), function (_) { return _; });
            _this[UNPEND]();
            entry.resume();
        });
    };
    Unpack.prototype[UNSUPPORTED] = function (entry) {
        this.warn('unsupported entry type: ' + entry.type, entry);
        entry.resume();
    };
    Unpack.prototype[SYMLINK] = function (entry) {
        this[LINK](entry, entry.linkpath, 'symlink');
    };
    Unpack.prototype[HARDLINK] = function (entry) {
        this[LINK](entry, path.resolve(this.cwd, entry.linkpath), 'link');
    };
    Unpack.prototype[PEND] = function () {
        this[PENDING]++;
    };
    Unpack.prototype[UNPEND] = function () {
        this[PENDING]--;
        this[MAYBECLOSE]();
    };
    Unpack.prototype[SKIP] = function (entry) {
        this[UNPEND]();
        entry.resume();
    };
    // check if a thing is there, and if so, try to clobber it
    Unpack.prototype[CHECKFS] = function (entry) {
        var _this = this;
        this[PEND]();
        this[MKDIR](path.dirname(entry.absolute), this.dmode, function (er) {
            if (er)
                return _this[ONERROR](er, entry);
            fs.lstat(entry.absolute, function (er, st) {
                if (st && (_this.keep || _this.newer && st.mtime > entry.mtime))
                    _this[SKIP](entry);
                else if (er || (entry.type === 'File' && !_this.unlink && st.isFile()))
                    _this[MAKEFS](null, entry);
                else if (st.isDirectory()) {
                    if (entry.type === 'Directory') {
                        if (!entry.mode || (st.mode & 4095) === entry.mode)
                            _this[MAKEFS](null, entry);
                        else
                            fs.chmod(entry.absolute, entry.mode, function (er) { return _this[MAKEFS](er, entry); });
                    }
                    else
                        fs.rmdir(entry.absolute, function (er) { return _this[MAKEFS](er, entry); });
                }
                else
                    fs.unlink(entry.absolute, function (er) { return _this[MAKEFS](er, entry); });
            });
        });
    };
    Unpack.prototype[MAKEFS] = function (er, entry) {
        if (er)
            return this[ONERROR](er, entry);
        switch (entry.type) {
            case 'File':
            case 'OldFile':
            case 'ContiguousFile':
                return this[FILE](entry);
            case 'Link':
                return this[HARDLINK](entry);
            case 'SymbolicLink':
                return this[SYMLINK](entry);
            case 'Directory':
            case 'GNUDumpDir':
                return this[DIRECTORY](entry);
        }
    };
    Unpack.prototype[LINK] = function (entry, linkpath, link) {
        var _this = this;
        // XXX: get the type ('file' or 'dir') for windows
        fs[link](linkpath, entry.absolute, function (er) {
            if (er)
                return _this[ONERROR](er, entry);
            _this[UNPEND]();
            entry.resume();
        });
    };
    return Unpack;
}(Parser));
var UnpackSync = (function (_super) {
    __extends(UnpackSync, _super);
    function UnpackSync(opt) {
        return _super.call(this, opt) || this;
    }
    UnpackSync.prototype[CHECKFS] = function (entry) {
        var er = this[MKDIR](path.dirname(entry.absolute), this.dmode);
        if (er)
            return this[ONERROR](er, entry);
        try {
            var st = fs.lstatSync(entry.absolute);
            if (this.keep || this.newer && st.mtime > entry.mtime)
                return this[SKIP](entry);
            else if (entry.type === 'File' && !this.unlink && st.isFile())
                return this[MAKEFS](null, entry);
            else {
                try {
                    if (st.isDirectory()) {
                        if (entry.type === 'Directory') {
                            if (entry.mode && (st.mode & 4095) !== entry.mode)
                                fs.chmodSync(entry.absolute, entry.mode);
                        }
                        else
                            fs.rmdirSync(entry.absolute);
                    }
                    else
                        fs.unlinkSync(entry.absolute);
                    return this[MAKEFS](null, entry);
                }
                catch (er) {
                    return this[ONERROR](er, entry);
                }
            }
        }
        catch (er) {
            return this[MAKEFS](null, entry);
        }
    };
    UnpackSync.prototype[FILE] = function (entry) {
        var _this = this;
        var mode = entry.mode & 4095 || this.fmode;
        try {
            var fd_1 = fs.openSync(entry.absolute, 'w', mode);
            entry.on('data', function (buf) { return fs.writeSync(fd_1, buf, 0, buf.length, null); });
            entry.on('end', function (_) {
                if (entry.mtime && !_this.noMtime) {
                    try {
                        fs.futimesSync(fd_1, entry.atime || new Date(), entry.mtime);
                    }
                    catch (er) { }
                }
                if (entry.uid && _this.preserveOwner) {
                    try {
                        fs.fchownSync(fd_1, entry.uid, entry.gid || process.getgid());
                    }
                    catch (er) { }
                }
                try {
                    fs.closeSync(fd_1);
                }
                catch (er) {
                    _this[ONERROR](er, entry);
                }
            });
        }
        catch (er) {
            this[ONERROR](er, entry);
        }
    };
    UnpackSync.prototype[DIRECTORY] = function (entry) {
        var mode = entry.mode & 4095 || this.dmode;
        var er = this[MKDIR](entry.absolute, mode);
        if (er)
            return this[ONERROR](er, entry);
        if (entry.mtime && !this.noMtime) {
            try {
                fs.utimesSync(entry.absolute, entry.atime || new Date(), entry.mtime);
            }
            catch (er) { }
        }
        if (entry.uid && this.preserveOwner) {
            try {
                fs.chownSync(entry.absolute, entry.uid, entry.gid || process.getgid());
            }
            catch (er) { }
        }
        entry.resume();
    };
    UnpackSync.prototype[MKDIR] = function (dir, mode) {
        try {
            return mkdir.sync(dir, {
                preserve: this.preservePaths,
                unlink: this.unlink,
                cache: this.dirCache,
                cwd: this.cwd,
                mode: mode
            });
        }
        catch (er) {
            return er;
        }
    };
    UnpackSync.prototype[LINK] = function (entry, linkpath, link) {
        try {
            fs[link + 'Sync'](linkpath, entry.absolute);
            entry.resume();
        }
        catch (er) {
            return this[ONERROR](er, entry);
        }
    };
    return UnpackSync;
}(Unpack));
Unpack.Sync = UnpackSync;
module.exports = Unpack;
