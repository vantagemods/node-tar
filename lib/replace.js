'use strict';
// tar -r
var hlo = require('./high-level-opt');
var Pack = require('./pack');
var Parse = require('./parse');
var fs = require('fs');
var t = require('./list');
var path = require('path');
// starting at the head of the file, read a Header
// If the checksum is invalid, that's our position to start writing
// If it is, jump forward by the specified size (round up to 512)
// and try again.
// Write the new Pack stream starting there.
var Header = require('./header');
var r = module.exports = function (opt_, files, cb) {
    var opt = hlo(opt_);
    if (!opt.file)
        throw new TypeError('file is required');
    if (opt.gzip)
        throw new TypeError('cannot append to compressed archives');
    if (!files || !Array.isArray(files) || !files.length)
        throw new TypeError('no files or directories specified');
    return opt.sync ? replaceSync(opt, files)
        : replace(opt, files, cb);
};
var replaceSync = function (opt, files) {
    var p = new Pack.Sync(opt);
    var threw = true;
    var fd;
    try {
        try {
            fd = fs.openSync(opt.file, 'r+');
        }
        catch (er) {
            if (er.code === 'ENOENT')
                fd = fs.openSync(opt.file, 'w+');
            else
                throw er;
        }
        var st = fs.fstatSync(fd);
        var headBuf = Buffer.alloc(512);
        var position_1;
        POSITION: for (position_1 = 0; position_1 < st.size; position_1 += 512) {
            for (var bufPos = 0, bytes = 0; bufPos < 512; bufPos += bytes) {
                bytes = fs.readSync(fd, headBuf, bufPos, headBuf.length - bufPos, position_1 + bufPos);
                if (position_1 === 0 && headBuf[0] === 0x1f && headBuf[1] === 0x8b)
                    throw new Error('cannot append to compressed archives');
                if (!bytes)
                    break POSITION;
            }
            var h = new Header(headBuf);
            if (!h.cksumValid)
                break;
            var entryBlockSize = 512 * Math.ceil(h.size / 512);
            if (position_1 + entryBlockSize + 512 > st.size)
                break;
            // the 512 for the header we just parsed will be added as well
            // also jump ahead all the blocks for the body
            position_1 += entryBlockSize;
            if (opt.mtimeCache)
                opt.mtimeCache.set(h.path, h.mtime);
        }
        p.on('data', function (c) {
            fs.writeSync(fd, c, 0, c.length, position_1);
            position_1 += c.length;
        });
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
var replace = function (opt, files, cb) {
    var p = new Pack(opt);
    var getPos = function (fd, size, cb_) {
        var cb = function (er, pos) {
            if (er)
                fs.close(fd, function (_) { return cb_(er); });
            else
                cb_(null, pos);
        };
        var position = 0;
        if (size === 0)
            return cb(null, 0);
        var bufPos = 0;
        var headBuf = Buffer.alloc(512);
        var onread = function (er, bytes) {
            if (er)
                return cb(er);
            bufPos += bytes;
            if (bufPos < 512 && bytes)
                return fs.read(fd, headBuf, bufPos, headBuf.length - bufPos, position + bufPos, onread);
            if (position === 0 && headBuf[0] === 0x1f && headBuf[1] === 0x8b)
                return cb(new Error('cannot append to compressed archives'));
            // truncated header
            if (bufPos < 512)
                return cb(null, position);
            var h = new Header(headBuf);
            if (!h.cksumValid)
                return cb(null, position);
            var entryBlockSize = 512 * Math.ceil(h.size / 512);
            if (position + entryBlockSize + 512 > size)
                return cb(null, position);
            position += entryBlockSize + 512;
            if (position >= size)
                return cb(null, position);
            if (opt.mtimeCache)
                opt.mtimeCache.set(h.path, h.mtime);
            bufPos = 0;
            fs.read(fd, headBuf, 0, 512, position, onread);
        };
        fs.read(fd, headBuf, 0, 512, position, onread);
    };
    var promise = new Promise(function (resolve, reject) {
        p.on('error', reject);
        var onopen = function (er, fd) {
            if (er) {
                if (er.code === 'ENOENT')
                    return fs.open(opt.file, 'w+', onopen);
                return reject(er);
            }
            fs.fstat(fd, function (er, st) {
                if (er)
                    return reject(er);
                getPos(fd, st.size, function (er, position) {
                    if (er)
                        return reject(er);
                    var stream = fs.createWriteStream(opt.file, {
                        fd: fd,
                        flags: 'r+',
                        start: position
                    });
                    p.pipe(stream);
                    stream.on('error', reject);
                    stream.on('close', resolve);
                    addFilesAsync(p, files);
                });
            });
        };
        fs.open(opt.file, 'r+', onopen);
    });
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
