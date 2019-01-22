import '@babel/polyfill';

const pull = require('pull-stream');
const { radarIcon,
        phoneIos,
        phoneAndroid,
        relayIcon1,
        relayIcon2,
        videoIcon1,
        videoIcon2,
        videoIcon3 } = require("./icons");
const DIAL_TERMINATED = "dialTerminate";

const peerMarkerMap = {};
const peerRouteMap = {};
window.peerMarkerMap = peerMarkerMap;
window.peerRouteMap = peerRouteMap;
const addMarkerMap  = (peerId, obj, latitude, longitude) =>{
  if(!peerMarkerMap[peerId]) peerMarkerMap[peerId] = {};
  peerMarkerMap[peerId].marker = obj;
  peerMarkerMap[peerId].latitude = latitude;
  peerMarkerMap[peerId].longitude = longitude;
}
const addRouteMap = (fromId, toId, obj)=>{
      peerRouteMap[fromId+"|"+toId] = obj;
  // if(peerMarkerMap[fromId] && peerMarkerMap[toId] &&
  //   peerMarkerMap[fromId].latitude && peerMarkerMap[fromId].longitude &&
  //   peerMarkerMap[toId].latitude && peerMarkerMap[toId].longitude){}
}

const removeRoute  = (peerId) =>{
  let filtered = Object.entries(peerRouteMap).filter(arr => arr[0].indexOf(peerId) > -1);
  filtered.forEach(o=> o[1].remove());
  filtered.forEach(o=> delete peerRouteMap[o[0]]);

}

const addPeerMarker = ({peerId, map, latitude, longitude, name, type = "d"}) => {
  if((!latitude && latitude !== 0) ||
     (!longitude && longitude !== 0)){
    return;
  }
  let marker = L.marker([latitude, longitude], {
    title: name,
    icon: type === "p" ? relayIcon1  :
          type === "f" ? videoIcon1 :
          type === "w" ? phoneIos   : radarIcon
  }).addTo(map);
  addMarkerMap(peerId, marker, latitude, longitude);
  return marker;
}
const addPeerRoutes = ({fromId, toId, map, latitude, longitude, coords}) => {
  if(!coords ||
    (!latitude && latitude !== 0) ||
    (!longitude && longitude !== 0) ||
    (!coords.latitude && coords.latitude !== 0) ||
    (!coords.longitude && coords.longitude !== 0)){
    return;
  }
  let route = L.curve(
    [
      "M",
      [+latitude, +longitude],
      "Q",
      [
        +latitude + Math.abs(longitude - coords.longitude) * 0.7,
        +longitude - (longitude - coords.longitude) * 0.2
      ],
      [+coords.latitude, +coords.longitude],
    ],
    {
      color: "#ea8080"
    }
  ).addTo(map);
  addRouteMap(fromId, toId, route);
  return route;
}

const addRoute = (fromId, toId, prismId, map)=>{
  let from = peerMarkerMap[fromId];
  let to = peerMarkerMap[toId];
  let result = addPeerRoutes({fromId, toId, map, latitude: from.latitude, longitude: from.longitude, coords:{
    latitude: to.latitude,
    longitude: to.longitude
  }});
  if(toId === prismId){
    result._path.classList.add('flows');
  }
}
/* for Debug */
window.addPeerMarker = addPeerMarker;
window.addPeerRoutes = addPeerRoutes;

const setupNode = async ({node, serviceId}) => {
  let peers = {};
  const map = L.map("mapid", {renderer: L.svg()}).setView(
    [0, 180],
    3
  );
  window.map = map;
  const dialToPrism = peerInfo =>
    node.dialProtocol(peerInfo, `/prism/${serviceId}/info`, async (err, conn) => {
      if (err) {
        return
      }
      const idStr = peerInfo.id.toB58String();
      peers[idStr].isDialed = true;
      console.log(`[PRISM] ${idStr} is dialed`);
      pull(
        conn,
        pull.map(o => JSON.parse(o.toString())),
        pull.take(o => o.topic !== DIAL_TERMINATED),
        pull.drain(event => {
          const events = {
            'initPrismInfo': async ({data: {coords, flows, waves}}) => {
              if(!coords) return;
              // add a marker of prism
              addPeerMarker({peerId: idStr, map, latitude: coords.latitude, longitude: coords.longitude, name: "prism", type:"p"});
              // add markers of flows
              flows && Object.entries(flows).filter(([id, obj])=>obj.coords)
                .forEach(([id, {coords: {latitude: flowLatitude, longitude: flowLongitude}, waves: waveIds}])=> {
                  addPeerMarker({peerId: id, map, latitude: flowLatitude, longitude: flowLongitude, name: id ,type:"f"});
                  addPeerRoutes({fromId: id, toId: idStr, map, latitude: flowLatitude, longitude: flowLongitude, coords})._path.classList.add('flows');
                  waveIds && Object.entries(waveIds).map(([id])=>({id, waveCoords: waves[id].coords}))
                    .forEach(({id, waveCoords}) => addPeerRoutes({fromId: idStr, toId: id, map, latitude: coords.latitude, longitude: coords.longitude, coords: waveCoords}));
                }
              );
              waves && Object.entries(waves).filter(([id, obj])=> obj.coords && obj.coords.latitude !== undefined && obj.coords.longitude !== undefined)
                .forEach(([id, {coords: {latitude: waveLatitude, longitude: waveLongitude}}])=> {
                  addPeerMarker({peerId: id, map, latitude: waveLatitude, longitude: waveLongitude, name: id, type:"w"})
                })
            },
            'addPeerMarker': ({peerId, coords, type = "d"})=>{
              addPeerMarker({peerId, map, latitude: coords.latitude, longitude: coords.longitude, name: peerId, type });

            },
            'addRoute': ({fromId, toId})=>{
              addRoute(fromId, toId, idStr, map);
            },
            'removeRoute': ({peerId})=>{
              removeRoute(peerId);
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
    });

  node.on('peer:discovery', peerInfo => {
    const idStr = peerInfo.id.toB58String();
    if (!peers[idStr]) {
      peers[idStr] = {
        isDiscovered: true,
        discoveredAt: Date.now()
      }
    }
    !peers[idStr].isDialed && dialToPrism(peerInfo);
  });
  node.on('peer:connect', peerInfo => {
  });
  node.on('peer:disconnect', peerInfo => {
    console.log('[CONTROLLER] peer disconnected:', peerInfo.id.toB58String())
    const disconnPeerId = peerInfo.id.toB58String();
    if (disconnPeerId && peers[disconnPeerId]) {
      peers[disconnPeerId].isDialed = false;
    }
    if(peerMarkerMap[disconnPeerId]){
      peerMarkerMap[disconnPeerId].marker.remove();
      delete peerMarkerMap[disconnPeerId];
      removeRoute(disconnPeerId);
    }
  });
  node.start(err => {
    if (err) {
      console.error(err);
      return
    }
    console.log('>> ',
      node.peerInfo.multiaddrs.toArray().map(o => o.toString()))
  });
  initMap({map});
};

let paths = [];
const initMap = async ({map}) => {
  L.tileLayer(
    "https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw",
    {
      minZoom: 2,
      maxZoom: 13,
      attribution: "ocean by CASTO",
      id: "mapbox.streets"
    }
  ).addTo(map);
};
module.exports = setupNode;