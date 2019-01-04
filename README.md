# Prism
webRTC multiplexer

## API
### DialProtocol
flows streamer와 자료교환

dialProtocol명: "/streamer/unified-plan":
#### Send
* sendTrickleCandidate
* sendCreatedAnswer
* updateChannelInfo
* updateChannelSnapshot

#### Recv
* sendCreateOffer
* sendTrickleCandidate
* updateStreamerInfo
* updateStreamerSnapshot

### Handler
#### waves client들과 자료교환 순서
* handle protocol router naming rule: "/controller/(uplan|planB)"
sdpSemantics 종류에 따라 구별한다.
  * ```uplan```: unified plan일 경우
  * ```planB```: plan B일 경우
 
  
* waves 수신자와 handle을 통해 dialProtocol이 연결되면
해당 waves 수신자의 peerId를 peers의 key로 등록한다. 
#### Send
* sendCreatedAnswer
* sendChannelsList
#### Recv
* sendCreateOffer
* registerWaveInfo: 
  waves 수신자로부터 peerInfo를 받아서 기록하고 
  수신자에게 flows 방송자 목록을 전달할 수 있도록 sendChannelList를 실행
* sendTrickleCandidate

#### receive
* registerWaveInfo: 
* sendTrickleCandidate:
* updateStreamerInfo
* updateStreamerSnapshot

* requestStreamerInfo: 
* requestOfferSDP
* sendTrickleCandidate
* sendCreateAnswer
