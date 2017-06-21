'use strict';
// XXX: This shares a lot in common with extract.js
// maybe some DRY opportunity here?
// tar -t
var hlo = require('./high-level-opt');
var Parser = require('./parse');
var fs = require('fs');
var path = require('path');
var t = module.exports = function (opt_, files, cb) {
    if (typeof opt_ === 'function')
        cb = opt_, files = [], opt_ = {};
    else if (Array.isArray(opt_))
        files = opt_, opt_ = {};
    if (typeof files === 'function')
        cb = files, files = [];
    if (!files)
        files = [];
    var opt = hlo(opt_);
    if (opt.sync && typeof cb === 'function')
        throw new TypeError('callback not supported for sync tar functions');
    if (!opt.file && typeof cb === 'function')
        throw new TypeError('callback only supported with file option');
    if (files.length)
        filesFilter(opt, files);
    if (!opt.noResume)
        onentryFunction(opt);
    return opt.file && opt.sync ? listFileSync(opt)
        : opt.file ? listFile(opt, cb)
            : list(opt);
};
var onentryFunction = function (opt) {
    var onentry = opt.onentry;
    opt.onentry = onentry ? function (e) {
        onentry(e);
        e.resume();
    } : function (e) { return e.resume(); };
};
// construct a filter that limits the file entries listed
// include child entries if a dir is included
var filesFilter = function (opt, files) {
    var map = new Map(files.map(function (f) { return [f.replace(/\/+$/, ''), true]; }));
    var filter = opt.filter;
    var mapHas = function (file, r) {
        var root = r || path.parse(file).root || '.';
        var ret = file === root ? false
            : map.has(file) ? map.get(file)
                : mapHas(path.dirname(file), root);
        map.set(file, ret);
        return ret;
    };
    opt.filter = filter
        ? function (file, entry) { return filter(file, entry) && mapHas(file.replace(/\/+$/, '')); }
        : function (file) { return mapHas(file.replace(/\/+$/, '')); };
};
var listFileSync = function (opt) {
    var p = list(opt);
    var file = opt.file;
    var threw = true;
    var fd;
    try {
        var stat = fs.statSync(file);
        var readSize = opt.maxReadSize || 16 * 1024 * 1024;
        if (stat.size < readSize) {
            p.end(fs.readFileSync(file));
        }
        else {
            var pos = 0;
            var buf = Buffer.allocUnsafe(readSize);
            fd = fs.openSync(file, 'r');
            while (pos < stat.size) {
                var bytesRead = fs.readSync(fd, buf, 0, readSize, pos);
                pos += bytesRead;
                p.write(buf.slice(0, bytesRead));
            }
            p.end();
        }
        threw = false;
    }
    finally {
        if (threw && fd)
            try {
                fs.closeSync(fd);
            }
            catch (er) { }
    }
};
var listFile = function (opt, cb) {
    var parse = new Parser(opt);
    var readSize = opt.maxReadSize || 16 * 1024 * 1024;
    var file = opt.file;
    var p = new Promise(function (resolve, reject) {
        parse.on('error', reject);
        parse.on('end', resolve);
        fs.stat(file, function (er, stat) {
            if (er)
                reject(er);
            else if (stat.size < readSize)
                fs.readFile(file, function (er, data) {
                    if (er)
                        return reject(er);
                    parse.end(data);
                });
            else {
                var stream = fs.createReadStream(file, {
                    highWaterMark: readSize
                });
                stream.on('error', reject);
                stream.pipe(parse);
            }
        });
    });
    return cb ? p.then(cb, cb) : p;
};
var list = function (opt) { return new Parser(opt); };
