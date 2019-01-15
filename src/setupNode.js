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

const clearPc = (peerConnection) => {
  peerConnection && peerConnection.close();
  // if(peerConnection){
  //   //peerConnection.getTransceivers().forEach(transceiver => transceiver.direction = 'inactive');
  //  // && peerConnection.iceConnectionState !== "closed"
  //
  //   peerConnection = null;
  // }
  return null;
}
const setupNode = async ({node, serviceId}) => {
  let flows = {};
  let waves = {};
  const broadcastToChannel = Notify();
  document.getElementById("myPeerId").textContent = `current My PeerId : ${node.peerInfo.id.toB58String()}`;

  const getPrismInfoForMonitoring = async () => {
    let processedFlows = Object.keys(flows).reduce((acc, key) => {
      acc[key] = {
        waves: flows[key].waves,
        geoInfo: flows[key].geoInfo
      };
      return acc;
    }, {});
    let processedWaves = Object.keys(waves).reduce((acc, key) => {
      acc[key] = {
        geoInfo: waves[key].geoInfo
      };
      return acc;
    }, {});
    let geoPosition = await new Promise((resolve, reject)=>{
      navigator.geolocation.getCurrentPosition(resolve, reject);
    });
    return {
      flows: processedFlows,
      waves: processedWaves,
      geoInfo: {
        latitude: geoPosition.coords.latitude,
        longitude: geoPosition.coords.longitude
      }
    }
  };

  node.handle(`/prism/${serviceId}/info`, (protocol, conn) => {
    const sendToMonitor = Pushable();
    pull(
      sendToMonitor,
      stringify(),
      conn,
      pull.map(o => JSON.parse(o.toString())),
      tap(console.log),
      pull.drain( event => {
        const events = {
          "prismInfo": async o => {
            sendToMonitor({
              topic: "prismInfo",
              data: await getPrismInfoForMonitoring()
            })
          }
        };
        if (events[event.topic]) return events[event.topic](event);
        else {
          return new Promise((resolve, reject) => {
            reject("No processEvent", event.topic);
          });
        }
      })
    );
    sendToMonitor.push({
      topic: "prismInfo",
      data: getPrismInfoForMonitoring()
    });

  });
  node.handle(`/controller/${serviceId}`, (protocol, conn) => {
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
            //when pc is existed, pc must closed;
            if(waves[wavePeerId].pc){
              console.log("a previous Pc exists.");
              let closedPc = waves[wavePeerId].pc;
              clearPc(closedPc);
            }
            const newPeerConnection = new RTCPeerConnection( configuration );

            newPeerConnection.onicecandidate = event =>
              event.candidate && sendToWave.push({
                topic: "sendTrickleCandidate",
                ice: event.candidate
              });
            newPeerConnection.oniceconnectionstatechange = (e)=> {
              console.log(`WAVE ${wavePeerId.substr(0,5)} : status : ${newPeerConnection.iceConnectionState}`);
              if(newPeerConnection.iceConnectionState === "connected"){
                console.log("waves pc connected ", wavePeerId);
                // 연결된 경우 flows에서 시청자 정보를 업데이트하고,
                (!flows[peerId].waves) && (flows[peerId].waves = {});
                flows[peerId].waves[wavePeerId] = true;
                // waves에서 해당 waves가 어떤 flow를 보고 있는지 업데이트 한다,
                waves[wavePeerId].currentFlowPeerId = peerId;
                // 이후 등록된 피어정보를 flows/waves전원에게 전파한다.
                flows[peerId].pushable.push({
                  topic: "updateWaves",
                  waves: flows[peerId].waves
                });
                Object.keys(flows[peerId].waves).forEach(key =>{
                  waves[key].pushable.push({
                    topic: "updateWaves",
                    waves: flows[peerId].waves
                  })
                })
              }else if(newPeerConnection.iceConnectionState === "disconnected"){
                console.log("waves pc disconnected ", wavePeerId);
                //newPeerConnection 에 대해서 tranceiver inactivate 처리
                clearPc(newPeerConnection);
                // waves[wavePeerId].pc = null;
                // 단절된 경우 flows에서 시청자 정보를 삭제하고,
                delete flows[waves[wavePeerId].currentFlowPeerId].waves[wavePeerId];
                // waves에서 해당 waves가 보고 있는 정보를 삭제한다,
                waves[wavePeerId].currentFlowPeerId = null;
                // 이후 삭제된 피어정보를 flows/waves전원에게 전파한다.
                flows[peerId].pushable.push({
                  topic: "updateWaves",
                  waves: flows[peerId].waves
                });
                Object.keys(flows[peerId].waves).forEach(key =>{
                  waves[key].pushable.push({
                    topic: "updateWaves",
                    waves: flows[peerId].waves
                  })
                })
                // peer:disconnect에서도 동일하게 처리되어야 한다.

              }
            };
            newPeerConnection.onerror = e=>{console.log(e)};
            /* connect peer Connections flow to wave */
            flows[peerId] && flows[peerId].pc &&
            flows[peerId].pc.getTransceivers()
              .forEach(transceiver=>newPeerConnection.addTrack(transceiver.receiver.track));
            await newPeerConnection.setRemoteDescription(sdp);
            await newPeerConnection.setLocalDescription(await newPeerConnection.createAnswer());
            sendToWave.push({
              topic: 'sendCreatedAnswer',
              sdp: newPeerConnection.localDescription
            });
            waves[wavePeerId].pc  = newPeerConnection;
          },
          'registerWaveInfo': ({peerId, geoInfo}) => {
            wavePeerId = peerId;
            waves[wavePeerId] = {
              connectedAt: Date.now(),
              pushable : sendToWave,
              geoInfo
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
        if (events[event.topic]) return events[event.topic](event);
        else {
          return new Promise((resolve, reject) => {
            reject("No processEvent", event.topic);
          });
        }

      }),
    );
  })
  let connectedFlowPeerId;
  const dialToFlow = peerInfo =>
    node.dialProtocol(peerInfo, `/streamer/${serviceId}/unified-plan`, async (err, conn) => {
      if (err) {
        // console.error("Failed to dial:", err);
        return
      }
      if (connectedFlowPeerId) {
        return
      }
      const idStr = peerInfo.id.toB58String();
      flows[idStr].isDialed = true;
      console.log(`[STREAMER] ${idStr} is dialed`);
      let sendToFlow = Pushable();
      // request creator information
      flows[idStr].pushable = sendToFlow;
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
              await flows[idStr].pc.setRemoteDescription(sdp);
              await flows[idStr].pc.setLocalDescription(await flows[idStr].pc.createAnswer());
              sendToFlow.push({
                topic: 'sendCreatedAnswer',
                sdp: flows[idStr].pc.localDescription
              })
            },
            'sendTrickleCandidate': async ({candidate}) => {
              console.log('[CONTROLLER] addIceCandidate', candidate);
              flows[idStr].pc.addIceCandidate(candidate);
            },
            'updateStreamerInfo': (options) => {
              console.log(`[CONTROLLER] updateStreamerInfo from ${idStr}`);
              flows[idStr] = {...flows[idStr], ...options };
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
                document.getElementById("currentConnectedFlowPeerId").textContent = `current Flow PeerId : ${connectedFlowPeerId}`;
              }
            }

          }
          if (events[event.topic]) return events[event.topic](event);
          else {
            return new Promise((resolve, reject) => {
              reject("No processEvent", event.topic);
            });
          }

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
    // console.log('[CONTROLLER] peer connected:', peerInfo.id.toB58String())
  })
  node.on('peer:disconnect', peerInfo => {
    console.log('[CONTROLLER] peer disconnected:', peerInfo.id.toB58String())
    const disconnPeerId = peerInfo.id.toB58String();
    if (disconnPeerId && flows[disconnPeerId]) {
      flows[disconnPeerId].isDialed = false;
      if(flows[disconnPeerId].pc && flows[disconnPeerId].pc.iceConnectionState !== "closed"){
        flows[disconnPeerId].pc.getTransceivers().forEach(transceiver => transceiver.direction = 'inactive');
        flows[disconnPeerId].pc.close();
      }
      if(connectedFlowPeerId === disconnPeerId){
        connectedFlowPeerId = null;
        document.getElementById("currentConnectedFlowPeerId").textContent = "";
      }
    }else if(disconnPeerId && waves[disconnPeerId]){
      //wave가 끊어진경우
      delete flows[waves[disconnPeerId].currentFlowPeerId].waves[disconnPeerId];
      //waves[wavePeerId].pc 에 대해서 tranceiver inactivate 처리
      //waves[wavePeerId].pc.getTransceivers().forEach(transceiver => transceiver.direction = 'inactive');
      waves[wavePeerId].pc.close();
      // waves에서 해당 waves가 보고 있는 정보를 삭제한다,
      waves[disconnPeerId].currentFlowPeerId = null;
      // 이후 삭제된 피어정보를 flows/waves전원에게 전파한다.
      flows[peerId].pushable.push({
        topic: "updateWaves",
        waves: flows[peerId].waves
      });
      Object.keys(flows[peerId].waves).forEach(key =>{
        waves[key].pushable.push({
          topic: "updateWaves",
          waves: flows[peerId].waves
        })
      })
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