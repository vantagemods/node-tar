// a stream that outputs tar bytes from entries getting added
// Pipe to a fstream.FileWriter or fs.WriteStream
//
// When something gets piped into it, it's added as an entry.
// This creates an EntryWriter object, and then pipes to the
// EntryWriter.  Adding entries to the EntryWriter will proxy
// to adding them to the Pack object, so recursive Dir-walking
// add() calls will function properly.

module.exports = Pack

var stream = require("stream")
  , Stream = stream.Stream
  , BlockStream = require("block-stream")
  , TarHeader = require("./header.js")
  , EntryWriter = require("./entry-writer.js")
  , GlobalHeaderWriter = require("./global-header-writer.js")
  , assert = require("assert").ok
  , inherits = require("inherits")
  , fstream = require("fstream")
  , collect = fstream.collect
  , path = require("path")
  , eof

inherits(Pack, Stream)

function Pack (props) {
  var me = this
  if (!(me instanceof Pack)) return new Pack(props)

  // don't apply the fstream ctor
  // we just want it for the .pipe() method
  Stream.apply(me)

  me.writable = true
  me.readable = true
  me._needDrain = false
  me._currentEntry = null
  me._processing = false
  me._buffer = []

  if (props) {
    // header writers are sync.
    // need to nextTick this so that the data doesn't
    // emit before the listeners are set up.
    me._processing = true
    process.nextTick(function () {
      me.addGlobal(props)
      me._processing = false
      me._process()
    })
  }

  // handle piping any fstream reader, even files and such
  me._pipeInRoot = null
  me.on("pipe", function (src) {
    // XXX fs.ReadStream support.

    // if it's a descendent of the fstream src that was originally piped,
    // then there's no need to add it.
    //
    // but, if it's the first thing we're seeing,
    // then we need to add this one.
    if (src.root && src.root === me._pipeInRoot) {
      console.error("\033[42m\t\t\talready got this fstream src!\033[m")
      return
    }

    if (!me._pipeInRoot && (src instanceof fstream.Reader)) {
      console.error("\033[42m\t\t\tnew pipeInRoot %s\033[m", src.path)
      me._pipeInRoot = src
      src.on("close", function () {
        me._pipeInRoot = null
      })
    }

    console.error("!!! add from TP pipe")
    me.add(src)
  })
}

Pack.prototype.addGlobal = function (props) {
  // HeaderWriters are sync.
  var me = this
  GlobalHeaderWriter(props)
    .on("data", function (c) {
      console.error("global data %d %j", c.length, c.toString().replace(/\0/g, "."))
      me.emit("data", c)
    })
    .on("end", function () {
      console.error("global end")
      me._process()
    })
    .end()
}

Pack.prototype.pause = function () {
  var me = this
  console.error(">>> Pack pause", me.path)
  if (me._currentEntry) me._currentEntry.pause()
  me._paused = true
}

Pack.prototype.resume = function () {
  var me = this
  console.error("<<< Pack resume", me.path)
  if (me._currentEntry) {
    me._currentEntry.resume()
  }
  me._paused = false
  me._process()
}

Pack.prototype.add = function (entry) {
  if (this._ended) this.emit("error", new Error("add after end"))
  console.error("\033[44mTP add %s!\033[m", entry.path, new Error().stack)

  var me = this
  collect(entry)
  me._buffer.push(entry)
  me._process()
  me._needDrain = me._buffer.length > 0
  return !me._needDrain
}

// no-op.  use .add(entry)
Pack.prototype.write = function () {}
Pack.prototype.destroy = function () {}

Pack.prototype.end = function () {
  console.error("\033[42m\n\nTP End\n\033[m")
  // console.error(new Error("trace").stack)

  if (this._ended) return
  this._ended = true

  if (!eof) {
    eof = new Buffer(1024)
    for (var i = 0; i < 1024; i ++) eof[i] = 0
  }
  this._buffer.push(eof)
  this._process()
}

Pack.prototype._process = function () {
  console.error("Pack process, currentEntry?", this._currentEntry && this._currentEntry.path)
  var me = this

  if (me._processing || me._currentEntry || me._paused) {
    return
  }

  var entry = me._buffer.shift()

  if (!entry) {
    console.error("Pack drain")
    if (me._needDrain) me.emit("drain")
    return true
  }

  if (entry === eof) {
    console.error("Pack eof")
    this.emit("data", eof)
    this.emit("end")
    this.emit("close")
    return
  }

  // Change the path to be relative to the root dir that was
  // added to the tarball.
  var root = path.dirname((entry.root || entry).path)
  var wprops = {}
  Object.keys(entry.props).forEach(function (k) {
    wprops[k] = entry.props[k]
  })
  wprops.path = path.relative(root, entry.path)
  if (entry.type === "Directory") {
    wprops.path += "/"
  }

  console.error("Pack adding entry", root, wprops.path)
  // throw "break"

  // pack a tar header out of the entry.props
  // if it's a dir, then listen to it for "child" events.
  var writer = me._currentEntry = new EntryWriter(wprops)
  writer.parent = me

  console.error("___ Pack Writer", writer.path)
  console.error("___ Pack Entry", entry.path)

  writer.on("data", function (c) {
    console.error("pack writer !data "+c.length, writer.path)
    console.error("  !data", c.slice(0, 100).toString())
    me.emit("data", c)
  })

  writer.on("end", function () {
    console.error("Pack writer !end", writer.path)
  })

  writer.on("pause", function () {
    console.error("pack writer !pause", writer.path)
  })

  writer.on("resume", function () {
    console.error("pack writer !resume", writer.path)
  })

  writer.on("close", function () {
    console.error("\033[42m\n\n\nPack Writer close %s\033[m", writer.path)
    me._currentEntry = null
    me._process()
  })

  console.error("___ attached event handlers", writer.path)

  // The entry has been collected, so it needs to be piped
  // so that it can be released.
  if (entry !== me._pipeInRoot) {
    console.error("___ pipe to writer, not the root", writer.path)
    entry.pipe(writer)
    entry.resume()
  } else {
    console.error("___ is the root, .pipe() to open", writer.path, entry._collected)
    if (entry._collected) entry.pipe()
    else entry.resume()
    writer.parent = null
  }

  if (entry.type === "Directory") {
    writer.end()
  }

  return me._buffer.length === 0
}
