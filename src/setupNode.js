const pull = require('pull-stream')
const stringify = require('pull-stringify')
const Pushable = require('pull-pushable')
const {tap} = require('pull-tap')
const Many = require('pull-many')
const Websocket = require('ws')
const wsSource = require('pull-ws/source')
const wsSink = require('pull-ws')
const {sendStream, recvNotify, broadcastToChannel} = require('./pushnNotify')
const {keepAlive, createSession, attach, createRoom, joinRoom, configure, addIceCandidate, subscribe, start} = require(
  './socketStream')
const crypto = require('crypto');

const configuration = {
  iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
  sdpSemantics: 'unified-plan'
};


const socketSingleTon = (() => {
  let socket
  let intervalIds = [];
  return {
    getSocket: (wsUrl, protocol) => {
      if (!socket) {
        socket = new Websocket(wsUrl, protocol)
        socket.on('close', () => intervalIds.map(clearInterval));
      }
      return socket
    },
    getIntervalIds : () => intervalIds
  }
})()

const setupJanusWebSocket = async ({wsUrl, protocol = 'janus-protocol'}) =>
  new Promise(async (resolve, reject) => {
    const socket = socketSingleTon.getSocket(wsUrl, protocol)
    pull(
      sendStream,
      pull.map(JSON.stringify),
      // tap(o => console.log('[SENT]', o)),
      wsSink(socket),
    )
    pull(
      wsSource(socket),
      pull.map(o => JSON.parse(o)),
      pull.drain(o => {
        recvNotify(o)
      }),
    )
    
    /* mediaServer initialize Sequence */
    const sessionId = await createSession()
    resolve({
      sessionId
    })
  })

const getEndpoint = async ({sessionId}) =>{
  const intervalIds = socketSingleTon.getIntervalIds();
  const handleId = await attach(sessionId)
  /* generate keepalive */
  const timerHandler = setInterval(() => keepAlive({sessionId, handleId}),
    30000)
  intervalIds.push(timerHandler);
  return {
    sessionId,
    /* TODO : TIME Handler clear 처리 */
    handleId
  }
}
const getRoomInput = async (endpoint)=>{
  const { sessionId, handleId } = endpoint;
  const roomId = await createRoom({sessionId, handleId})
  console.log(`[CONTROLLER] roomId: ${roomId}`)
  const joinedRoomInfo = await joinRoom({sessionId,handleId,roomId})
  console.log('[CONTROLLER] joining room')
  //peers[idStr].roomInfo.publisherId = joinedRoomInfo.plugindata.data.id
  const publisherId = joinedRoomInfo.plugindata.data.id
  return {
    ...endpoint,
    roomId,
    publisherId
  }
}

const getRoomOutput = async (outputEndpoint)=>{
  const roomOutput = await subscribe(outputEndpoint)
  console.log('[CONTROLLER] subscribin room');
  return {
    ...outputEndpoint,
    jsep: roomOutput.jsep
  }
}
/* setup Node */
const setupNode = async ({node}) => {
  let flows = {};
  let waves = {};
  node.handle('/controller', (protocol, conn) => {
    let roomOutputInfo;
    const sendToWave = Pushable();
    pull(
      Many([sendToWave, broadcastToChannel.listen()]),
      stringify(),
      conn,
      pull.map(o => JSON.parse(o.toString())),
      tap(console.log),
      pull.drain(event => {
        const events = {
          'sendCreateOffer': async ({sdp, peerId}) => {
            const castPc = new RTCPeerConnection( configuration );
            castPc.onicecandidate = event =>
              event.candidate && sendToWave.push({
                topic: "sendTrickleCandidate",
                ice: event.candidate
              });
            castPc.oniceconnectionstatechange = ()=> {
            };
            /* connect peer Connections flow to wave */
            flows[peerId] && flows[peerId].pc &&
            flows[peerId].pc.getTransceivers()
              .forEach(tranceiver=>castPc.addTrack(tranceiver.receiver.track));
          },
          'registerWaveInfo': ({peerId}) => {
            waves[peerId] = {
              connectedAt: Date.now()
            };
            let channels = Object.keys(flows).reduce((acc, key)=>{
              if(flows[key].title){
                acc[key] = flows[key];
              }
              return acc;
            },{});
            sendToWave.push({
              topic: 'sendChannelsList',
              channels
            })
          },
          'requestOfferSDP': async o => {
            let roomInfo = flows[o.streamerId].roomInfo;
            let subscribeEndpoint = await getEndpoint(roomInfo)
            roomOutputInfo = await getRoomOutput({
              ...roomInfo,
              handleId: subscribeEndpoint.handleId
            });
            sendToWave.push({
              topic: "responseOfferSDP",
              jsep: roomOutputInfo.jsep,
            })
          },
          'sendTrickleCandidate': async ({candidate}) => {
            console.log('[CONTROLLER] addIceCandidate', candidate)
            await addIceCandidate({
              candidate,
              ...roomOutputInfo,
            })
          },
          'sendCreateAnswer': async ({jsep}) => {
            //getOutput Info를 가져와야함
            //let roomInfo = flows[o.streamerId].roomInfo;
            await start({...roomOutputInfo, jsep})
          }
        }
        events[event.topic] && events[event.topic](event)
      }),
    );
  })
  node.on('peer:discovery', peerInfo => {
    const idStr = peerInfo.id.toB58String()
    if (!flows[idStr]) {
      flows[idStr] = {
        isDiscovered: true,
        discoveredAt: Date.now()
      }
    }
    !flows[idStr].isDialed &&
    node.dialProtocol(peerInfo, '/streamer/unified-plan', async (err, conn) => {
      if (err) {
        // console.error("Failed to dial:", err);
        return
      }
      flows[idStr].isDialed = true
      console.log(`[STREAMER] ${idStr} is dialed`)
      let sendToFlow = Pushable()
      // request creator information
      sendToFlow.push({
        topic: 'requestStreamerInfo',
        peerId: idStr,
      })
      pull(
        sendToFlow,
        stringify(),
        // tap(o => console.log('[CONTROLLER]', o)),
        conn,
        pull.map(o => JSON.parse(o.toString())),
        pull.drain(event => {
          const events = {
            'sendCreateOffer': async ({sdp}) => {
              flows[idStr].pc = new RTCPeerConnection( configuration );
              flows[idStr].pc.onicecandidate = event =>
                event.candidate && sendToFlow.push({
                  topic: "sendTrickleCandidate",
                  ice: event.candidate
                });
              flows[idStr].pc.oniceconnectionstatechange = ()=> {
              };
              await Promise.all([
                flows[idStr].pc.setRemoteDescription(sdp),
                flows[idStr].pc.setLocalDescription(await flows[idStr].pc.createAnswer())
              ]);
              sendToFlow.push({
                topic: 'sendCreatedAnswer',
                sdp: flows[idStr].pc.localDescription
              })
            },
            'sendTrickleCandidate': async ({candidate}) => {
              console.log('[CONTROLLER] addIceCandidate')
              await addIceCandidate({
                candidate,
                ...roomInfo,
              })
            },
            'updateStreamerInfo': ({profile, title=""}) => {
              console.log(`[CONTROLLER] updateStreamerInfo from ${idStr}`);
              flows[idStr] = {...flows[idStr], profile, title};
              broadcastToChannel({
                topic: "updateChannelInfo",
                peerId: idStr,
                info: flows[idStr]
              });
            },
            'updateStreamerSnapshot': ({snapshot}) => {
              // console.log(`[CONTROLLER] updateStreamerSnapshot from ${idStr}`);
              flows[idStr] = {...flows[idStr], snapshot};
              broadcastToChannel({
                topic: "updateChannelSnapshot",
                peerId: idStr,
                snapshot
              });
            },
          }
          events[event.request] && events[event.request](event)
          // sendJanusStream.push
        }),
      )
    })
  })
  node.on('peer:connect', peerInfo => {
    console.log('[CONTROLLER] peer connected:', peerInfo.id.toB58String())
  })
  node.on('peer:disconnect', peerInfo => {
    console.log('[CONTROLLER] peer disconnected:', peerInfo.id.toB58String())
    const idStr = peerInfo.id.toB58String()
    if (idStr && flows[idStr]) {
      flows[idStr].isDialed = false;
    }
  })
  node.start(err => {
    if (err) {
      console.error(err)
      return
    }
    console.log('>> ',
      node.peerInfo.multiaddrs.toArray().map(o => o.toString()))
  })
}

module.exports = setupNode