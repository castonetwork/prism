const pull = require("pull-stream");
const chance = require("chance").Chance();
const { sendStream, recvNotify } = require("./pushnNotify");

const sendSocketStream = (obj, resultHandler) =>
  new Promise((resolve, reject) => {
    const transaction = chance.guid();
    sendStream.push({ ...obj, transaction });
    pull(
      recvNotify.listen(),
      pull.filter(o => o.transaction === transaction && o.janus !== "ack"),
      pull.drain(obj => {
        resolve((resultHandler && resultHandler(obj)) || obj);
      })
    );
    /* TODO: success, failure */
  });

const keepAlive = async ({ sessionId, handleId }) =>
  await sendSocketStream(
    {
      janus: "keepalive",
      session_id: sessionId,
      handle_id: handleId
    },
    o => {}
  );

const createSession = async () =>
  await sendSocketStream(
    {
      janus: "create"
    },
    o => o && o.data && o.data.id
  );

const attach = async sessionId =>
  await sendSocketStream(
    {
      janus: "attach",
      session_id: sessionId,
      plugin: "janus.plugin.videoroom"
    },
    o => o && o.data && o.data.id
  );

const createRoom = async ({ sessionId, handleId }) =>
  await sendSocketStream(
    {
      janus: "message",
      session_id: sessionId,
      handle_id: handleId,
      body: {
        request: "create",
        description: "remon",
        bitrate: 102400,
        publishers: 1,
        fir_freq: 1,
        is_private: false,
        audiocodec: "opus",
        videocodec: "H264",
        video: true,
        audio: true,
        notify_joining: true,
        playoutdelay_ext: false,
        videoorient_ext: false
      }
    },
    o => o && o.plugindata && o.plugindata.data && o.plugindata.data.room
  );

const joinRoom = async ({ sessionId, handleId, roomId }) =>
  await sendSocketStream(
    {
      janus: "message",
      session_id: sessionId,
      handle_id: handleId,
      body: {
        request: "join",
        room: roomId,
        ptype: "publisher",
        video: true,
        audio: true
      }
    },
    o => console.log("joinRoom response", JSON.stringify(o)) || o
  );

const subscribe = async ({ sessionId, handleId, roomId, publisherId }) =>
  await sendSocketStream(
    {
      janus: "message",
      session_id: sessionId,
      handle_id: handleId,
      body: {
        request: "join",
        room: roomId,
        feed: publisherId,
        ptype: "subscriber",
        video: true,
        audio: true
      }
    },
    o => console.log("subscribeRoom response", JSON.stringify(o)) || o
  );

const start = async ({ sessionId, handleId, roomId, jsep }) =>
  await sendSocketStream(
    {
      janus: "message",
      session_id: sessionId,
      handle_id: handleId,
      body: {
        request: "start",
        room: roomId
      },
      jsep
    },
    o => console.log("startSubscribing response", JSON.stringify(o)) || o
  );

const configure = async ({ jsep }) =>
  await sendSocketStream(
    {
      janus: "message",
      session_id: sessionId,
      handle_id: handleId,
      body: {
        request: "configure",
        room: roomId,
        ptype: "publisher",
        video: true,
        audio: true
      },
      jsep: jsep
    },
    o => o.jsep
  );

const addIceCandidate = async ({ sessionId, handleId, candidate }) =>
  await sendSocketStream(
    {
      janus: "trickle",
      session_id: sessionId,
      handle_id: handleId,
      candidate
    },
    o => {
      /* ack only */
    }
  );

module.exports = {
  recvNotify,
  sendStream,
  keepAlive,
  createSession,
  attach,
  createRoom,
  joinRoom,
  configure,
  addIceCandidate,
  subscribe,
  start
};
