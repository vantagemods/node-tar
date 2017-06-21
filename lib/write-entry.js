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
var MiniPass = require('minipass');
var Pax = require('./pax');
var Header = require('./header');
var ReadEntry = require('./read-entry');
var fs = require('fs');
var path = require('path');
var types = require('./types');
var maxReadSize = 16 * 1024 * 1024;
var PROCESS = Symbol('process');
var FILE = Symbol('file');
var DIRECTORY = Symbol('directory');
var SYMLINK = Symbol('symlink');
var HARDLINK = Symbol('hardlink');
var HEADER = Symbol('header');
var READ = Symbol('read');
var LSTAT = Symbol('lstat');
var ONLSTAT = Symbol('onlstat');
var ONREAD = Symbol('onread');
var ONREADLINK = Symbol('onreadlink');
var OPENFILE = Symbol('openfile');
var ONOPENFILE = Symbol('onopenfile');
var CLOSE = Symbol('close');
var warner = require('./warn-mixin');
var winchars = require('./winchars');
var WriteEntry = warner((function (_super) {
    __extends(WriteEntry, _super);
    function WriteEntry(p, opt) {
        var _this = this;
        opt = opt || {};
        _this = _super.call(this, opt) || this;
        if (typeof p !== 'string')
            throw new TypeError('path is required');
        _this.path = p;
        // suppress atime, ctime, uid, gid, uname, gname
        _this.portable = !!opt.portable;
        // until node has builtin pwnam functions, this'll have to do
        _this.myuid = process.getuid && process.getuid();
        _this.myuser = process.env.USER || '';
        _this.maxReadSize = opt.maxReadSize || maxReadSize;
        _this.linkCache = opt.linkCache || new Map();
        _this.statCache = opt.statCache || new Map();
        _this.preservePaths = !!opt.preservePaths;
        _this.cwd = opt.cwd || process.cwd();
        _this.strict = !!opt.strict;
        _this.noPax = !!opt.noPax;
        if (typeof opt.onwarn === 'function')
            _this.on('warn', opt.onwarn);
        if (!_this.preservePaths && path.win32.isAbsolute(p)) {
            // absolutes on posix are also absolutes on win32
            // so we only need to test this one to get both
            var parsed = path.win32.parse(p);
            _this.warn('stripping ' + parsed.root + ' from absolute path', p);
            _this.path = p.substr(parsed.root.length);
        }
        _this.win32 = !!opt.win32 || process.platform === 'win32';
        if (_this.win32) {
            _this.path = winchars.decode(_this.path.replace(/\\/g, '/'));
            p = p.replace(/\\/g, '/');
        }
        _this.absolute = opt.absolute || path.resolve(_this.cwd, p);
        if (_this.path === '')
            _this.path = './';
        if (_this.statCache.has(_this.absolute))
            _this[ONLSTAT](_this.statCache.get(_this.absolute));
        else
            _this[LSTAT]();
        return _this;
    }
    WriteEntry.prototype[LSTAT] = function () {
        var _this = this;
        fs.lstat(this.absolute, function (er, stat) {
            if (er)
                return _this.emit('error', er);
            _this[ONLSTAT](stat);
        });
    };
    WriteEntry.prototype[ONLSTAT] = function (stat) {
        this.statCache.set(this.absolute, stat);
        this.stat = stat;
        if (!stat.isFile())
            stat.size = 0;
        this.type = getType(stat);
        this.emit('stat', stat);
        this[PROCESS]();
    };
    WriteEntry.prototype[PROCESS] = function () {
        switch (this.type) {
            case 'File': return this[FILE]();
            case 'Directory': return this[DIRECTORY]();
            case 'SymbolicLink': return this[SYMLINK]();
            // unsupported types are ignored.
            default: return this.end();
        }
    };
    WriteEntry.prototype[HEADER] = function () {
        this.header = new Header({
            path: this.path,
            linkpath: this.linkpath,
            // only the permissions and setuid/setgid/sticky bitflags
            // not the higher-order bits that specify file type
            mode: this.stat.mode & 4095,
            uid: this.portable ? null : this.stat.uid,
            gid: this.portable ? null : this.stat.gid,
            size: this.stat.size,
            mtime: this.type === 'Directory' && this.portable
                ? null : this.stat.mtime,
            type: this.type,
            uname: this.portable ? null :
                this.stat.uid === this.myuid ? this.myuser : '',
            atime: this.portable ? null : this.stat.atime,
            ctime: this.portable ? null : this.stat.ctime
        });
        if (this.header.encode() && !this.noPax)
            this.write(new Pax({
                atime: this.portable ? null : this.header.atime,
                ctime: this.portable ? null : this.header.ctime,
                gid: this.portable ? null : this.header.gid,
                mtime: this.header.mtime,
                path: this.path,
                linkpath: this.linkpath,
                size: this.size,
                uid: this.portable ? null : this.header.uid,
                uname: this.portable ? null : this.header.uname,
                dev: this.portable ? null : this.stat.dev,
                ino: this.portable ? null : this.stat.ino,
                nlink: this.portable ? null : this.stat.nlink
            }).encode());
        this.write(this.header.block);
    };
    WriteEntry.prototype[DIRECTORY] = function () {
        if (this.path.substr(-1) !== '/')
            this.path += '/';
        this.stat.size = 0;
        this[HEADER]();
        this.end();
    };
    WriteEntry.prototype[SYMLINK] = function () {
        var _this = this;
        fs.readlink(this.absolute, function (er, linkpath) {
            if (er)
                return _this.emit('error', er);
            _this[ONREADLINK](linkpath);
        });
    };
    WriteEntry.prototype[ONREADLINK] = function (linkpath) {
        this.linkpath = linkpath;
        this[HEADER]();
        this.end();
    };
    WriteEntry.prototype[HARDLINK] = function (linkpath) {
        this.type = 'Link';
        this.linkpath = path.relative(this.cwd, linkpath);
        this.stat.size = 0;
        this[HEADER]();
        this.end();
    };
    WriteEntry.prototype[FILE] = function () {
        if (this.stat.nlink > 1) {
            var linkKey = this.stat.dev + ':' + this.stat.ino;
            if (this.linkCache.has(linkKey)) {
                var linkpath = this.linkCache.get(linkKey);
                if (linkpath.indexOf(this.cwd) === 0)
                    return this[HARDLINK](linkpath);
            }
            this.linkCache.set(linkKey, this.absolute);
        }
        this[HEADER]();
        if (this.stat.size === 0)
            return this.end();
        this[OPENFILE]();
    };
    WriteEntry.prototype[OPENFILE] = function () {
        var _this = this;
        fs.open(this.absolute, 'r', function (er, fd) {
            if (er)
                return _this.emit('error', er);
            _this[ONOPENFILE](fd);
        });
    };
    WriteEntry.prototype[ONOPENFILE] = function (fd) {
        var blockLen = 512 * Math.ceil(this.stat.size / 512);
        var bufLen = Math.min(blockLen, this.maxReadSize);
        var buf = Buffer.allocUnsafe(bufLen);
        this[READ](fd, buf, 0, buf.length, 0, this.stat.size, blockLen);
    };
    WriteEntry.prototype[READ] = function (fd, buf, offset, length, pos, remain, blockRemain) {
        var _this = this;
        fs.read(fd, buf, offset, length, pos, function (er, bytesRead) {
            if (er)
                return _this[CLOSE](fd, function (_) { return _this.emit('error', er); });
            _this[ONREAD](fd, buf, offset, length, pos, remain, blockRemain, bytesRead);
        });
    };
    WriteEntry.prototype[CLOSE] = function (fd, cb) {
        fs.close(fd, cb);
    };
    WriteEntry.prototype[ONREAD] = function (fd, buf, offset, length, pos, remain, blockRemain, bytesRead) {
        if (bytesRead <= 0 && remain > 0) {
            var er = new Error('unexpected EOF');
            er.path = this.absolute;
            er.syscall = 'read';
            er.code = 'EOF';
            this.emit('error', er);
        }
        // null out the rest of the buffer, if we could fit the block padding
        if (bytesRead === remain) {
            for (var i = bytesRead; i < length && bytesRead < blockRemain; i++) {
                buf[i + offset] = 0;
                bytesRead++;
                remain++;
            }
        }
        var writeBuf = offset === 0 && bytesRead === buf.length ?
            buf : buf.slice(offset, offset + bytesRead);
        remain -= bytesRead;
        blockRemain -= bytesRead;
        pos += bytesRead;
        offset += bytesRead;
        this.write(writeBuf);
        if (!remain) {
            if (blockRemain)
                this.write(Buffer.alloc(blockRemain));
            this.end();
            this[CLOSE](fd, function (_) { return _; });
            return;
        }
        if (offset >= length) {
            buf = Buffer.allocUnsafe(length);
            offset = 0;
        }
        length = buf.length - offset;
        this[READ](fd, buf, offset, length, pos, remain, blockRemain);
    };
    return WriteEntry;
}(MiniPass)));
var WriteEntrySync = (function (_super) {
    __extends(WriteEntrySync, _super);
    function WriteEntrySync(path, opt) {
        return _super.call(this, path, opt) || this;
    }
    WriteEntrySync.prototype[LSTAT] = function () {
        this[ONLSTAT](fs.lstatSync(this.absolute));
    };
    WriteEntrySync.prototype[SYMLINK] = function () {
        this[ONREADLINK](fs.readlinkSync(this.absolute));
    };
    WriteEntrySync.prototype[OPENFILE] = function () {
        this[ONOPENFILE](fs.openSync(this.absolute, 'r'));
    };
    WriteEntrySync.prototype[READ] = function (fd, buf, offset, length, pos, remain, blockRemain) {
        var threw = true;
        try {
            var bytesRead = fs.readSync(fd, buf, offset, length, pos);
            this[ONREAD](fd, buf, offset, length, pos, remain, blockRemain, bytesRead);
            threw = false;
        }
        finally {
            if (threw)
                try {
                    this[CLOSE](fd);
                }
                catch (er) { }
        }
    };
    WriteEntrySync.prototype[CLOSE] = function (fd) {
        fs.closeSync(fd);
    };
    return WriteEntrySync;
}(WriteEntry));
var WriteEntryTar = warner((function (_super) {
    __extends(WriteEntryTar, _super);
    function WriteEntryTar(readEntry, opt) {
        var _this = this;
        opt = opt || {};
        _this = _super.call(this, opt) || this;
        _this.readEntry = readEntry;
        _this.path = readEntry.path;
        _this.mode = readEntry.mode;
        if (_this.mode)
            _this.mode = _this.mode & 4095;
        _this.uid = readEntry.uid;
        _this.gid = readEntry.gid;
        _this.uname = readEntry.uname;
        _this.gname = readEntry.gname;
        _this.size = readEntry.size;
        _this.mtime = readEntry.mtime;
        _this.atime = readEntry.atime;
        _this.ctime = readEntry.ctime;
        _this.linkpath = readEntry.linkpath;
        _this.uname = readEntry.uname;
        _this.gname = readEntry.gname;
        _this.preservePaths = !!opt.preservePaths;
        _this.portable = !!opt.portable;
        _this.strict = !!opt.strict;
        _this.noPax = !!opt.noPax;
        if (typeof opt.onwarn === 'function')
            _this.on('warn', opt.onwarn);
        if (path.isAbsolute(_this.path) && !_this.preservePaths) {
            var parsed = path.parse(_this.path);
            _this.warn('stripping ' + parsed.root + ' from absolute path', _this.path);
            _this.path = _this.path.substr(parsed.root.length);
        }
        _this.remain = readEntry.size;
        _this.blockRemain = readEntry.blockRemain;
        _this.header = new Header({
            path: _this.path,
            linkpath: _this.linkpath,
            // only the permissions and setuid/setgid/sticky bitflags
            // not the higher-order bits that specify file type
            mode: _this.mode,
            uid: _this.portable ? null : _this.uid,
            gid: _this.portable ? null : _this.gid,
            size: _this.size,
            mtime: _this.mtime,
            type: _this.type,
            uname: _this.portable ? null : _this.uname,
            atime: _this.portable ? null : _this.atime,
            ctime: _this.portable ? null : _this.ctime
        });
        if (_this.header.encode() && !_this.noPax)
            _super.prototype.write.call(_this, new Pax({
                atime: _this.portable ? null : _this.atime,
                ctime: _this.portable ? null : _this.ctime,
                gid: _this.portable ? null : _this.gid,
                mtime: _this.mtime,
                path: _this.path,
                linkpath: _this.linkpath,
                size: _this.size,
                uid: _this.portable ? null : _this.uid,
                uname: _this.portable ? null : _this.uname,
                dev: _this.portable ? null : _this.readEntry.dev,
                ino: _this.portable ? null : _this.readEntry.ino,
                nlink: _this.portable ? null : _this.readEntry.nlink
            }).encode());
        _super.prototype.write.call(_this, _this.header.block);
        readEntry.pipe(_this);
        return _this;
    }
    WriteEntryTar.prototype.write = function (data) {
        var writeLen = data.length;
        if (writeLen > this.blockRemain)
            throw new Error('writing more to entry than is appropriate');
        this.blockRemain -= writeLen;
        return _super.prototype.write.call(this, data);
    };
    WriteEntryTar.prototype.end = function () {
        if (this.blockRemain)
            this.write(Buffer.alloc(this.blockRemain));
        return _super.prototype.end.call(this);
    };
    return WriteEntryTar;
}(MiniPass)));
WriteEntry.Sync = WriteEntrySync;
WriteEntry.Tar = WriteEntryTar;
var getType = function (stat) {
    return stat.isFile() ? 'File'
        : stat.isDirectory() ? 'Directory'
            : stat.isSymbolicLink() ? 'SymbolicLink'
                : 'Unsupported';
};
module.exports = WriteEntry;
