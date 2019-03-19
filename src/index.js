//const babel =  '@babel/polyfill'
const isBrowser = typeof window !== 'undefined';
isBrowser && require('@babel/polyfill');
let https;
if(!isBrowser){
  https = require("https");
}
const createNode = require("./create-node");
const setupNode = require("./setupNode");

const httpsGet = (url)=>{
  return new Promise((resolve, reject)=>{
    if(isBrowser){
      fetch(url).then(res => res.json())
        .then(data =>{
          resolve(data);
        }).catch(console.error);

    }else{
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve(JSON.parse(data));
        });
      }).on("error", (err) => {
        console.log("Error: " + err.message);
        reject(err.message);
      });
    }
  });
}


let serviceId;
// initialize a controller node
const initNode = async () => {
  console.log(">> init controller Node");
  let node = await createNode();
  console.log(">> node created");
  console.log(">> node is ready", node.peerInfo.id.toB58String());
  // setup a libp2p node
  serviceId = isBrowser ? new URL(location.href).searchParams.get('serviceId') : process.argv[2];
  let geoPosition = await httpsGet("https://extreme-ip-lookup.com/json/");
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
