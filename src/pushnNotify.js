const Pushable = require("pull-pushable");
const Notify = require("pull-notify");

/* janus websocket Interface */
const sendStream = Pushable();
const recvNotify = Notify();
const broadcastToChannel = Notify();

module.exports = {
  sendStream,
  recvNotify,
  broadcastToChannel
};