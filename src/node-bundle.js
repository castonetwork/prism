"use strict";

const libp2p = require("libp2p");
const WSStar = require("libp2p-websocket-star");
const Mplex = require("libp2p-mplex");

class Node extends libp2p {
  constructor(_options) {
    const wsStar = new WSStar({id: _options.peerInfo.id});
    const defaults = {
      modules: {
        transport: [wsStar],
        streamMuxer: [Mplex],
        peerDiscovery: [wsStar.discovery]
      },
    };
    super({...defaults, ..._options});
  }
}

module.exports = Node;
