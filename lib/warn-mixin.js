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
module.exports = function (Base) { return (function (_super) {
    __extends(class_1, _super);
    function class_1() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    class_1.prototype.warn = function (msg, data) {
        if (!this.strict)
            this.emit('warn', msg, data);
        else if (data instanceof Error)
            this.emit('error', data);
        else {
            var er = new Error(msg);
            er.data = data;
            this.emit('error', er);
        }
    };
    return class_1;
}(Base)); };
