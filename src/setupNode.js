const pull = require('pull-stream')
const stringify = require('pull-stringify')
const Pushable = require('pull-pushable')
const {tap} = require('pull-tap')
const Many = require('pull-many')
const Notify = require('pull-notify')

const configuration = {
  iceServers: [{urls: 'stun:stun.l.google.com:19302'}],
  sdpSemantics: 'unified-plan'
};

const DIAL_TERMINATED = "dialTerminate";
/* setup Node */
const setupNode = async ({node}) => {
  let flows = {};
  let waves = {};
  const broadcastToChannel = Notify();
  node.handle('/controller', (protocol, conn) => {
    let wavePeerId;
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
            waves[wavePeerId].pc = new RTCPeerConnection( configuration );
            waves[wavePeerId].pc.onicecandidate = event =>
              event.candidate && sendToWave.push({
                topic: "sendTrickleCandidate",
                ice: event.candidate
              });
            waves[wavePeerId].pc.oniceconnectionstatechange = (e)=> {
              console.log(`WAVE ${wavePeerId.substr(0,5)} : status : ${e.toString()}`);
            };
            waves[wavePeerId].pc.onerror = e=>{console.log(e)};
            /* connect peer Connections flow to wave */
            flows[peerId] && flows[peerId].pc &&
            flows[peerId].pc.getTransceivers()
              .forEach(transceiver=>waves[wavePeerId].pc.addTrack(transceiver.receiver.track));
            await Promise.all([
              waves[wavePeerId].pc.setRemoteDescription(sdp),
              waves[wavePeerId].pc.setLocalDescription(await waves[wavePeerId].pc.createAnswer())
            ]);
            sendToWave.push({
              topic: 'sendCreatedAnswer',
              sdp: waves[wavePeerId].pc.localDescription
            })
          },
          'registerWaveInfo': ({peerId}) => {
            wavePeerId = peerId;
            waves[wavePeerId] = {
              connectedAt: Date.now()
            };
            let channels = Object.keys(flows).reduce((acc, key)=>{
              if(flows[key].isDialed){
                acc[key] = flows[key];
              }
              return acc;
            },{});
            sendToWave.push({
              topic: 'sendChannelsList',
              channels
            })
          },
          'sendTrickleCandidate': async ({candidate}) => {
            console.log('[CONTROLLER] addIceCandidate', candidate)
            await waves[wavePeerId].pc.addIceCandidate(candidate);
          }
        };
        events[event.topic] && events[event.topic](event)
      }),
    );
  })
  let connectedFlowPeerId;
  const dialToFlow = peerInfo =>
    node.dialProtocol(peerInfo, '/streamer/unified-plan', async (err, conn) => {
      if (err) {
        // console.error("Failed to dial:", err);
        return
      }
      if (connectedFlowPeerId) {
        return
      }
      const idStr = peerInfo.id.toB58String();
      flows[idStr].isDialed = true
      console.log(`[STREAMER] ${idStr} is dialed`)
      let sendToFlow = Pushable()
      // request creator information

      pull(
        sendToFlow,
        stringify(),
        // tap(o => console.log('[CONTROLLER]', o)),
        conn,
        pull.map(o => JSON.parse(o.toString())),
        pull.take(o => o.topic !== DIAL_TERMINATED),
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
              flows[idStr].pc.addIceCandidate(candidate);
            },
            'updateStreamerInfo': (options) => {
              console.log(`[CONTROLLER] updateStreamerInfo from ${idStr}`);
              flows[idStr] = {...flows[idStr], ...options};
              broadcastToChannel({
                topic: "updateChannelInfo",
                type: "added",
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
            'deniedStreamInfo': ()=>{
              node.hangUp(peerInfo, ()=>{
                console.log(`deniedStreamInfo : ${idStr} is denied`);
              })
              //TODO: pull.end
            },
            'setupStreamInfo': ()=>{
              if(connectedFlowPeerId){
                sendToFlow.push({
                  topic: "deniedSetupStreamInfo",
                });
                node.hangUp(peerInfo, ()=>{
                  console.log(`deniedStreamInfo : ${idStr} is denied`);
                })
                //TODO: pull.end
              }else{
                connectedFlowPeerId = idStr;
                sendToFlow.push({
                  topic: "readyToCast",
                });
                console.log("readyToCast ", connectedFlowPeerId);
              }
            }

          }
          events[event.topic] && events[event.topic](event)
        }),
      )
      sendToFlow.push({
        topic: 'requestStreamerInfo',
        peerId: node.peerInfo.id.toB58String()
      })
    })

  node.on('peer:discovery', peerInfo => {
    const idStr = peerInfo.id.toB58String();
    if (!flows[idStr]) {
      flows[idStr] = {
        isDiscovered: true,
        discoveredAt: Date.now()
      }
    }
    !flows[idStr].isDialed && dialToFlow(peerInfo);
  })
  node.on('peer:connect', peerInfo => {
    console.log('[CONTROLLER] peer connected:', peerInfo.id.toB58String())
  })
  node.on('peer:disconnect', peerInfo => {
    console.log('[CONTROLLER] peer disconnected:', peerInfo.id.toB58String())
    const idStr = peerInfo.id.toB58String();
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
};

module.exports = setupNode;