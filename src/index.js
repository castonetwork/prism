//const babel =  '@babel/polyfill'
const isBrowser = typeof window !== 'undefined';
isBrowser && require('@babel/polyfill');
const createNode = require("./create-node");
const setupNode = require("./setupNode");

let serviceId;
// initialize a controller node
const initNode = async () => {
  console.log(">> init controller Node");
  let node = await createNode();
  console.log(">> node created");
  console.log(">> node is ready", node.peerInfo.id.toB58String());
  // setup a libp2p node
  serviceId = isBrowser ? new URL(location.href).searchParams.get('serviceId') : process.argv[2];
  let geoPosition = await ((await fetch("https://extreme-ip-lookup.com/json/")).json());
  let longitude = parseFloat(geoPosition.lon);
  let latitude = parseFloat(geoPosition.lat);
  let coords = !isNaN(latitude) && !isNaN(longitude) && {longitude, latitude} || undefined;
  setupNode({ node, serviceId, coords});
};

// initialize app
const initApp = async () => {
  initNode();
};

initApp();