import '@babel/polyfill';

const pull = require('pull-stream');

const DIAL_TERMINATED = "dialTerminate";

const radarIcon = L.icon({
  iconUrl: "./images/icons/radar.svg",
  iconSize: [24, 24],
  iconAnchor: [12, 0],
  popupAnchor: [-3, -14]
});

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

const removeRouter  = (peerId) =>{
  let filtered = Object.entries(peerRouteMap).filter(arr => arr[0].indexOf(peerId) > -1);
  filtered.forEach(o=> o[1].remove());
  filtered.forEach(o=> delete peerRouteMap[o[0]]);

}

const addPeerMarker = ({peerId, map, latitude, longitude, name}) =>{
  if(!latitude || !longitude){
    return;
  }
  let marker = L.marker([latitude, longitude], {
    title: name,
    icon: radarIcon
  }).addTo(map);
  addMarkerMap(peerId, marker, latitude, longitude);
  return marker;
}
const addPeerRoutes = ({fromId, toId, map, latitude, longitude, coords}) => {
  if(!coords || !latitude || !longitude || !coords.latitude || !coords.longitude){
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

const addRouter = (fromId, toId, map)=>{
  let from = peerMarkerMap[fromId];
  let to = peerMarkerMap[toId];
  addPeerRoutes({fromId, toId, map, latitude: from.latitude, longitude: from.longitude, coords:{
    latitude: to.latitude,
    longitude: to.longitude
  }})

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
              addPeerMarker({peerId: idStr, map, latitude: coords.latitude, longitude: coords.longitude, name: "prism"});
              // add markers of flows
              flows && Object.entries(flows).filter(([id, obj])=>obj.coords)
                .forEach(([id, {coords: {latitude: flowLatitude, longitude: flowLongitude}, waves: waveIds}])=> {
                  addPeerMarker({peerId: id, map, latitude: flowLatitude, longitude: flowLongitude, name: id });
                  addPeerRoutes({fromId: id, toId: idStr, map, latitude: flowLatitude, longitude: flowLongitude, coords})
                    ._path.classList.add('flows');
                  waveIds && Object.entries(waveIds).map(([id])=>({id, waveCoords: waves[id].coords}))
                    .forEach(({id, waveCoords}) => addPeerRoutes({fromId: idStr, toId: id, map, latitude: coords.latitude, longitude: coords.longitude, coords: waveCoords}));
                }
              );
              waves && Object.entries(waves).filter(([id, obj])=> obj.coords && obj.coords.latitude && obj.coords.longitude)
                .forEach(([id, {coords: {latitude: waveLatitude, longitude: waveLongitude}}])=> {
                  addPeerMarker({peerId: id, map, latitude: waveLatitude, longitude: waveLongitude, name: id})
                })
            },
            'addPeerMarker': ({peerId, coords})=>{
              addPeerMarker({peerId, map, latitude: coords.latitude, longitude: coords.latitude, name: peerId });

            },
            'addRouter': ({fromId, toId})=>{
              addRouter(fromId, toId, map);

            },
            'removeRouter': ({peerId})=>{
              removeRouter(peerId);
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
      removeRouter(disconnPeerId);
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