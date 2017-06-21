'use strict';
// tar -x
var hlo = require('./high-level-opt');
var Unpack = require('./unpack');
var fs = require('fs');
var path = require('path');
var x = module.exports = function (opt_, files, cb) {
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
    return opt.file && opt.sync ? extractFileSync(opt)
        : opt.file ? extractFile(opt, cb)
            : opt.sync ? extractSync(opt)
                : extract(opt);
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
var extractFileSync = function (opt) {
    var u = new Unpack.Sync(opt);
    var file = opt.file;
    var threw = true;
    var fd;
    try {
        var stat = fs.statSync(file);
        var readSize = opt.maxReadSize || 16 * 1024 * 1024;
        if (stat.size < readSize)
            u.end(fs.readFileSync(file));
        else {
            var pos = 0;
            var buf = Buffer.allocUnsafe(readSize);
            fd = fs.openSync(file, 'r');
            while (pos < stat.size) {
                var bytesRead = fs.readSync(fd, buf, 0, readSize, pos);
                pos += bytesRead;
                u.write(buf.slice(0, bytesRead));
            }
            u.end();
            fs.closeSync(fd);
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
var extractFile = function (opt, cb) {
    var u = new Unpack(opt);
    var readSize = opt.maxReadSize || 16 * 1024 * 1024;
    var file = opt.file;
    var p = new Promise(function (resolve, reject) {
        u.on('error', reject);
        u.on('close', resolve);
        fs.stat(file, function (er, stat) {
            if (er)
                reject(er);
            else if (stat.size < readSize)
                fs.readFile(file, function (er, data) {
                    if (er)
                        return reject(er);
                    u.end(data);
                });
            else {
                var stream = fs.createReadStream(file, {
                    highWaterMark: readSize
                });
                stream.on('error', reject);
                stream.pipe(u);
            }
        });
    });
    return cb ? p.then(cb, cb) : p;
};
var extractSync = function (opt) {
    return new Unpack.Sync(opt);
};
var extract = function (opt) {
    return new Unpack(opt);
};
