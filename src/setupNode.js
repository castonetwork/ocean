import '@babel/polyfill';

const pull = require('pull-stream');

const DIAL_TERMINATED = "dialTerminate";

const radarIcon = L.icon({
  iconUrl: "./images/icons/radar.svg",
  iconSize: [24, 24],
  iconAnchor: [12, 0],
  popupAnchor: [-3, -14]
});

const addPeerMarker = ({map, latitude, longitude, name}) =>
  L.marker([latitude, longitude], {
    title: name,
    icon: radarIcon
  }).addTo(map);
const addPeerRoutes = ({map, latitude, longitude, coords}) =>
  L.curve(
    [
      "M",
      [latitude, longitude],
      "Q",
      [
        latitude + latitude * 1.1,
        longitude - (longitude - coords.longitude) * 0.2
      ],
      [coords.latitude, coords.longitude],
    ],
    {
      color: "#ea8080"
    }
  ).addTo(map);
/* for Debug */
window.addPeerMarker = addPeerMarker;
window.addPeerRoutes = addPeerRoutes;

const setupNode = async ({node, serviceId}) => {
  let peers = {};
  const {coords} = await new Promise((r, e) =>
    navigator.geolocation.getCurrentPosition(p => r(p), err => e(err))
  );
  const map = L.map("mapid", {renderer: L.svg()}).setView(
    [coords.latitude, coords.longitude],
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
            'prismInfo': async ({data: {coords, flows, waves}}) => {
              // add a marker of prism
              addPeerMarker({map, latitude: coords.latitude, longitude: coords.longitude, name: "prism"});
              // add markers of flows
              Object.entries(flows).filter(([id, obj])=>obj.coords)
                .forEach(([id, {coords: {latitude: flowLatitude, longitude: flowLongitude}, waves: waveIds}])=> {
                  addPeerMarker({map, latitude: flowLatitude, longitude: flowLongitude, name: id });
                  addPeerRoutes({map, latitude: flowLatitude, longitude: flowLongitude, coords});
                  Object.entries(waveIds).map(([id])=>waves[id].coords)
                    .forEach(waveCoords => addPeerRoutes({map, latitude: coords.latitude, longitude: coords.longitude, coords: waveCoords}));
                }
              );
              Object.entries(waves).filter(([id, obj])=> obj.coords && obj.coords.latitude && obj.coords.longitude)
                .forEach(([id, {coords: {latitude: waveLatitude, longitude: waveLongitude}}])=> {
                  addPeerMarker({map, latitude: waveLatitude, longitude: waveLongitude, name: id})
                })
            },
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
  });
  node.start(err => {
    if (err) {
      console.error(err);
      return
    }
    console.log('>> ',
      node.peerInfo.multiaddrs.toArray().map(o => o.toString()))
  });
  initMap({map, coords});
};

let paths = [];
const initMap = async ({map, coords}) => {
  L.tileLayer(
    "https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token=pk.eyJ1IjoibWFwYm94IiwiYSI6ImNpejY4NXVycTA2emYycXBndHRqcmZ3N3gifQ.rJcFIG214AriISLbB6B5aw",
    {
      minZoom: 2,
      maxZoom: 13,
      attribution: "ocean by CASTO",
      id: "mapbox.streets"
    }
  ).addTo(map);
  L.marker([coords.latitude, coords.longitude], {
    title: "home",
    icon: radarIcon
  }).addTo(map);
};
module.exports = setupNode;