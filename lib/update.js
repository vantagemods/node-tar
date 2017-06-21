'use strict';
// tar -u
var hlo = require('./high-level-opt');
var r = require('./replace');
// just call tar.r with the filter and mtimeCache
var u = module.exports = function (opt_, files, cb) {
    var opt = hlo(opt_);
    if (!opt.file)
        throw new TypeError('file is required');
    if (opt.gzip)
        throw new TypeError('cannot append to compressed archives');
    if (!files || !Array.isArray(files) || !files.length)
        throw new TypeError('no files or directories specified');
    mtimeFilter(opt);
    return r(opt, files, cb);
};
var mtimeFilter = function (opt) {
    var filter = opt.filter;
    if (!opt.mtimeCache)
        opt.mtimeCache = new Map();
    opt.filter = filter ? function (path, stat) {
        return filter(path, stat) && !(opt.mtimeCache.get(path) > stat.mtime);
    }
        : function (path, stat) { return !(opt.mtimeCache.get(path) > stat.mtime); };
};
