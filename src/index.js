import '@babel/polyfill'
const createNode = require("./create-node");
const setupNode = require("./setupNode");

let serviceId;
let longitude;
let latitude;
// initialize a controller node
const initNode = async () => {
  console.log(">> init controller Node");
  let node = await createNode();
  console.log(">> node created");
  console.log(">> node is ready", node.peerInfo.id.toB58String());
  // setup a libp2p node
  serviceId = new URL(location.href).searchParams.get('serviceId');
  longitude = parseFloat(new URL(location.href).searchParams.get('lng'));
  latitude = parseFloat(new URL(location.href).searchParams.get('lat'));

  let coords = !isNaN(latitude) && !isNaN(longitude) && {longitude, latitude} || undefined;
  setupNode({ node, serviceId, coords});
};

// initialize app
const initApp = async () => {
  initNode();
};

initApp();