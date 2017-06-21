'use strict';
// tar -c
var hlo = require('./high-level-opt');
var Pack = require('./pack');
var fs = require('fs');
var t = require('./list');
var path = require('path');
var c = module.exports = function (opt_, files, cb) {
    if (typeof files === 'function')
        cb = files;
    if (Array.isArray(opt_))
        files = opt_, opt_ = {};
    if (!files || !Array.isArray(files) || !files.length)
        throw new TypeError('no files or directories specified');
    var opt = hlo(opt_);
    if (opt.sync && typeof cb === 'function')
        throw new TypeError('callback not supported for sync tar functions');
    if (!opt.file && typeof cb === 'function')
        throw new TypeError('callback only supported with file option');
    return opt.file && opt.sync ? createFileSync(opt, files)
        : opt.file ? createFile(opt, files, cb)
            : opt.sync ? createSync(opt, files)
                : create(opt, files);
};
var createFileSync = function (opt, files) {
    var p = new Pack.Sync(opt);
    var threw = true;
    var fd;
    try {
        fd = fs.openSync(opt.file, 'w', opt.mode || 438);
        p.on('data', function (chunk) { return fs.writeSync(fd, chunk, 0, chunk.length); });
        p.on('end', function (_) { return fs.closeSync(fd); });
        addFilesSync(p, files);
        threw = false;
    }
    finally {
        if (threw)
            try {
                fs.closeSync(fd);
            }
            catch (er) { }
    }
};
var createFile = function (opt, files, cb) {
    var p = new Pack(opt);
    var stream = fs.createWriteStream(opt.file, { mode: opt.mode || 438 });
    p.pipe(stream);
    var promise = new Promise(function (res, rej) {
        stream.on('error', rej);
        stream.on('close', res);
        p.on('error', rej);
    });
    addFilesAsync(p, files);
    return cb ? promise.then(cb, cb) : promise;
};
var addFilesSync = function (p, files) {
    files.forEach(function (file) {
        if (file.charAt(0) === '@')
            t({
                file: path.resolve(p.cwd, file.substr(1)),
                sync: true,
                noResume: true,
                onentry: function (entry) { return p.add(entry); }
            });
        else
            p.add(file);
    });
    p.end();
};
var addFilesAsync = function (p, files) {
    while (files.length) {
        var file = files.shift();
        if (file.charAt(0) === '@')
            return t({
                file: path.resolve(p.cwd, file.substr(1)),
                noResume: true,
                onentry: function (entry) { return p.add(entry); }
            }).then(function (_) { return addFilesAsync(p, files); });
        else
            p.add(file);
    }
    p.end();
};
var createSync = function (opt, files) {
    var p = new Pack.Sync(opt);
    addFilesSync(p, files);
    return p;
};
var create = function (opt, files) {
    var p = new Pack(opt);
    addFilesAsync(p, files);
    return p;
};
