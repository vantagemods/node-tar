'use strict';
// turn tar(1) style args like `C` into the more verbose things like `cwd`
var argmap = new Map([
    ['C', 'cwd'],
    ['f', 'file'],
    ['z', 'gzip'],
    ['P', 'preservePaths'],
    ['U', 'unlink'],
    ['strip-components', 'strip'],
    ['stripComponents', 'strip'],
    ['keep-newer', 'newer'],
    ['keepNewer', 'newer'],
    ['keep-newer-files', 'newer'],
    ['keepNewerFiles', 'newer'],
    ['k', 'keep'],
    ['keep-existing', 'keep'],
    ['keepExisting', 'keep'],
    ['m', 'noMtime'],
    ['no-mtime', 'noMtime'],
    ['p', 'preserveOwner'],
    ['L', 'follow'],
    ['h', 'follow']
]);
var parse = module.exports = function (opt) { return opt ? Object.keys(opt).map(function (k) { return [
    argmap.has(k) ? argmap.get(k) : k, opt[k]
]; }).reduce(function (set, kv) { return (set[kv[0]] = kv[1], set); }, Object.create(null)) : {}; };
