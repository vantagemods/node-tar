module.exports = EntryWriter

var tar = require("../tar.js")
  , TarHeader = require("./header.js")
  , Entry = require("./entry.js")
  , inherits = require("inherits")
  , BlockStream = require("block-stream")
  , ExtendedHeaderWriter = require("./extended-header-writer.js")
  , Stream = require("stream").Stream
  , EOF = {}

inherits(EntryWriter, Stream)

function EntryWriter (props) {
  var me = this

  if (!(me instanceof EntryWriter)) {
    return new EntryWriter(props)
  }

  Stream.apply(this)

  me.writable = true
  me.readable = true

  me._needDrain = false
  me._stream = new BlockStream(512)

  me._stream.on("data", function (c) {
    console.error(".. << ew emitting data")
    me.emit("data", c)
  })

  me._stream.on("drain", function () {
    console.error(".. .. ew stream drain")
    me.emit("drain")
    me._needDrain = false
    me._process()
  })

  me._stream.on("end", function () {
    console.error(".. .. ew stream end")
    if (me._needDrain) me.emit("drain")
    me.emit("end")
    me.emit("close")
  })

  me.props = props
  me.path = props.path

  me._buffer = []

  process.nextTick(function () {
    console.error("\t\tcalling ew process", me.path)
    me._process()
  })
}

EntryWriter.prototype.write = function (c) {
  console.error(".. ew write", c && c.length, this.path)
  var me = this

  if (me._ended) {
    me.error("write after end")
    return false
  }

  me._buffer.push(c)
  me._process()
  me._needDrain = me._buffer.length !== 0
  console.error(".. ew write, after _process, needDrain?", me._needDrain)
  console.error(".. ew write return", !me._needDrain)
  console.error(".. ew write paused=%j", me._paused)
  return !me._needDrain
}

EntryWriter.prototype.end = function (c) {
  console.error("... EW end", this.path)
  var me = this
  me._needDrain = me._buffer.length !== 0
  if (c) me._buffer.push(c)
  me._buffer.push(EOF)
  me._ended = true
  me._process()
  return !me._needDrain
}

EntryWriter.prototype.pause = function () {
  console.error(".. ew pause", this.path)
  var me = this
  me._needDrain = true
  me._paused = true
  me._stream.pause()
  me.emit("pause")
  me._needDrain = true
}

EntryWriter.prototype.resume = function () {
  var me = this
  console.error(".. ew resume", this.path, me._needDrain)
  me._paused = false
  me._stream.resume()
  me._process()
  console.error(".. ew resume after process")
  me._needDrain = false
  me.emit("drain")
  me.emit("resume")
  console.error(".. ew resume emitted drain and resume evs")
}

EntryWriter.prototype._process = function () {
  var me = this
  console.error(".. EW _process", me._buffer.length, me._processing, this.path)
  if (me._processing || me._paused) {
    console.error(".. processing=%s paused=%s", me._processing, me._paused, this.path)
    if (me._paused) me._needDrain = true
    return
  }

  if (!me._ready) {
    console.error(".. not ready, write props first", this.path)
    me._writeProps()
    console.error(".. wrote props, emitting ready", this.path)
    me.emit("ready")
  }

  me._processing = true
  var buf = me._buffer
  for (var i = 0; i < buf.length; i ++) {
    console.error(".. .. ew process", i, this.path)
    var c = buf[i]
    if (c === EOF) me._stream.end()
    else me._stream.write(c)

    if (me._paused) {
      console.error(".. .. ew paused in process")
      me._needDrain = true
      me._buffer = buf.slice(i)
      return
    }
  }
  me._buffer.length = 0
  me._processing = false
  console.error(".. .. ew done processing.  drain=", me._needDrain)
  if (me._needDrain !== false) {
    me.emit("drain")
    me._needDrain = false
  }
}

EntryWriter.prototype.add = function (entry) {
  console.error("... EW add %s -> %s", entry.path, this.path, this.path)
  if (!this.parent) this.emit("error", new Error(
    "not a part of a tarball, can't add children"))

  var ret = this.parent.add(entry)
  if (!this._ended) this.end()
  this._ended = true
  return ret
}

EntryWriter.prototype._writeProps = function () {
  var me = this

  me._headerBlock = TarHeader.encode(me.props)

  if (me._loadingExtended) return

  if (me.props.needExtended && !me._extended) {
    console.error("need extended props for", me.props.path)
    return me._writeExtended()
  }

  me._stream.write(me._headerBlock)
  me._ready = true
}

EntryWriter.prototype._writeExtended = function () {
  var me = this
  me._loadingExtended = true
  var extended = new ExtendedHeaderWriter(me.props)
  extended.on("data", function (c) {
    me._stream.write(c)
  })
  extended.on("end", function () {
    me._stream.flush()
    me._extended = extended
    me._loadingExtended = false
    me._writeProps()
  })
}

EntryWriter.prototype.destroy = function () {}
