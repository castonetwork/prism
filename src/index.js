import '@babel/polyfill'
const createNode = require("./create-node");
const setupNode = require("./setupNode");

// initialize a controller node
const initNode = async () => {
  console.log(">> janusInstance instantiated");
  console.log(">> init controller Node");
  let node = await createNode();
  console.log(">> node created");
  console.log(">> node is ready", node.peerInfo.id.toB58String());
  // setup a libp2p node
  setupNode({ node });
};

// initialize app
const initApp = async () => {
  initNode();
};

initApp();