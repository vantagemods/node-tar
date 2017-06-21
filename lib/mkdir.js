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
// wrapper around mkdirp for tar's needs.
var mkdirp = require('mkdirp');
var fs = require('fs');
var path = require('path');
var SymlinkError = (function (_super) {
    __extends(SymlinkError, _super);
    function SymlinkError(symlink, path) {
        var _this = _super.call(this, 'Cannot extract through symbolic link') || this;
        _this.path = path;
        _this.symlink = symlink;
        return _this;
    }
    Object.defineProperty(SymlinkError.prototype, "name", {
        get: function () {
            return 'SylinkError';
        },
        enumerable: true,
        configurable: true
    });
    return SymlinkError;
}(Error));
var mkdir = module.exports = function (dir, opt, cb) {
    var mode = opt.mode | 448;
    var preserve = opt.preserve;
    var unlink = opt.unlink;
    var cache = opt.cache;
    var cwd = opt.cwd;
    var done = function (er) {
        if (!er)
            cache.set(dir, true);
        cb(er);
    };
    if (cache && cache.get(dir) === true || dir === cwd)
        return cb();
    if (preserve)
        return mkdirp(dir, mode, done);
    var sub = path.relative(cwd, dir);
    var parts = sub.split(/\/|\\/);
    mkdir_(cwd, parts, mode, cache, unlink, done);
};
var mkdir_ = function (base, parts, mode, cache, unlink, cb) {
    if (!parts.length)
        return cb();
    var p = parts.shift();
    var part = base + '/' + p;
    if (cache.get(part))
        return mkdir_(part, parts, mode, cache, unlink, cb);
    fs.mkdir(part, mode, onmkdir(part, parts, mode, cache, unlink, cb));
};
var onmkdir = function (part, parts, mode, cache, unlink, cb) { return function (er) {
    if (er) {
        fs.lstat(part, function (statEr, st) {
            if (statEr)
                cb(statEr);
            else if (st.isDirectory())
                mkdir_(part, parts, mode, cache, unlink, cb);
            else if (unlink)
                fs.unlink(part, function (er) {
                    if (er)
                        return cb(er);
                    fs.mkdir(part, mode, onmkdir(part, parts, mode, cache, unlink, cb));
                });
            else if (st.isSymbolicLink())
                return cb(new SymlinkError(part, part + '/' + parts.join('/')));
            else
                cb(er);
        });
    }
    else
        mkdir_(part, parts, mode, cache, unlink, cb);
}; };
var mkdirSync = module.exports.sync = function (dir, opt) {
    var mode = opt.mode | 448;
    var preserve = opt.preserve;
    var unlink = opt.unlink;
    var cache = opt.cache;
    var cwd = opt.cwd;
    if (cache && cache.get(dir) === true || dir === cwd)
        return;
    if (preserve) {
        mkdirp.sync(dir, mode);
        cache.set(dir, true);
        return;
    }
    var sub = path.relative(cwd, dir);
    var parts = sub.split(/\/|\\/);
    for (var p = parts.shift(), part = cwd; p && (part += '/' + p); p = parts.shift()) {
        if (cache.get(part))
            continue;
        try {
            fs.mkdirSync(part, mode);
            cache.set(part, true);
        }
        catch (er) {
            var st = fs.lstatSync(part);
            if (st.isDirectory()) {
                cache.set(part, true);
                continue;
            }
            else if (unlink) {
                fs.unlinkSync(part);
                fs.mkdirSync(part, mode);
                cache.set(part, true);
                continue;
            }
            else if (st.isSymbolicLink())
                return new SymlinkError(part, part + '/' + parts.join('/'));
        }
    }
    cache.set(dir, true);
};
