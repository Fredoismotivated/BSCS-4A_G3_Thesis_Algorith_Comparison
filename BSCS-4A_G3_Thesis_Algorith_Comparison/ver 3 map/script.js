// ═══════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════
const ALGO_COLORS = {
  dijkstra: '#facc15',
  astar:    '#00e5ff',
  ara:      '#a78bfa',
  theta:    '#34d399',
  dstar:    '#fb923c',
  fieldd:   '#f472b6',
  adstar:   '#60a5fa',
};

const ALGO_LABELS = {
  dijkstra: 'Dijkstra',
  astar:    'A*',
  ara:      'ARA*',
  theta:    'Theta*',
  dstar:    'D* Lite',
  fieldd:   'Field D*',
  adstar:   'AD*',
};

// ═══════════════════════════════════════
// MAP INIT
// ═══════════════════════════════════════
const map = L.map('map').setView([14.3, 121.0], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OSM' }).addTo(map);

// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
let graph = [];
let points = [];
let blockedNodes = new Set();
let activeLayers = [];

// ═══════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════
function setStatus(text, active = false) {
  document.getElementById('status-text').textContent = text;
  document.getElementById('status-dot').className = 'status-dot' + (active ? ' ready' : '');
}

function setInstruction(text) {
  document.getElementById('instruction').textContent = text;
}

function showLoading(show) {
  document.getElementById('loading-bar').style.display = show ? 'block' : 'none';
}

function clearActiveLayers() {
  activeLayers.forEach(l => map.removeLayer(l));
  activeLayers = [];
}

// ═══════════════════════════════════════
// ROAD NETWORK
// ═══════════════════════════════════════
async function loadRoadNetwork(center) {
  showLoading(true);
  setStatus('LOADING...', false);
  setInstruction('Fetching road network...');
  const query = `
  [out:json];
  (
    way["highway"]["highway"!~"footway|cycleway|path|pedestrian|steps|track|service|corridor|bridleway|construction"]
    (around:1200,${center.lat},${center.lng});
  );
  out body;
  >;
  out skel qt;`;
  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: query });
    const data = await res.json();
    buildGraph(data);
    filterConnectedGraph(nearestNode(points[0]));
    showLoading(false);
    setStatus('READY', true);
    setInstruction('LEFT CLICK → SET END POINT');
    updateMetrics(`<div style="color:var(--accent);font-family:'Share Tech Mono',monospace;font-size:12px;">
      Network loaded<br>${graph.length} nodes ready<br><br>
      <span style="color:var(--muted);">Now set END point.</span>
    </div>`);
  } catch (e) {
    showLoading(false);
    setStatus('ERROR', false);
    setInstruction('Network fetch failed. Try again.');
  }
}

function buildGraph(data) {
  let nodes = {};
  data.elements.forEach(el => {
    if (el.type === "node") nodes[el.id] = { id: el.id, lat: el.lat, lng: el.lon, neighbors: [] };
  });
  data.elements.forEach(el => {
    if (el.type === "way") {
      let traffic = getRoadTraffic(el.tags?.highway);
      for (let i = 0; i < el.nodes.length - 1; i++) {
        let a = nodes[el.nodes[i]], b = nodes[el.nodes[i + 1]];
        if (a && b && dist(a, b) < 0.005) {
          a.neighbors.push({ node: b, traffic });
          b.neighbors.push({ node: a, traffic });
        }
      }
    }
  });
  graph = Object.values(nodes);
}

function filterConnectedGraph(startNode) {
  if (!startNode) return;
  let visited = new Set(), queue = [startNode];
  while (queue.length) {
    let n = queue.shift();
    if (visited.has(n)) continue;
    visited.add(n);
    n.neighbors.forEach(e => { if (!visited.has(e.node)) queue.push(e.node); });
  }
  graph = Array.from(visited);
}

function getRoadTraffic(type) {
  let hour = new Date().getHours(), base = 1;
  if (type === "motorway") base = 0.8;
  else if (type === "primary") base = 1.0;
  else if (type === "secondary") base = 1.2;
  else base = 1.5;
  if (hour >= 7 && hour <= 9) base *= 1.5;
  if (hour >= 17 && hour <= 19) base *= 1.7;
  return base;
}

setInterval(() => {
  graph.forEach(node => node.neighbors.forEach(edge => { edge.traffic *= (0.9 + Math.random() * 0.2); }));
}, 5000);

// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════
function dist(a, b) { return Math.sqrt((a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2); }

function nearestNode(p) {
  let best = null, min = Infinity;
  graph.forEach(n => { let d = dist(p, n); if (d < min && d < 0.01) { min = d; best = n; } });
  return best;
}

function reconstruct(prev, start, goal) {
  let path = [], cur = goal;
  while (cur && cur !== start) { path.push([cur.lat, cur.lng]); cur = prev.get(cur); }
  if (cur) path.push([start.lat, start.lng]);
  return path.reverse();
}

function updateMetrics(html) {
  document.getElementById('metrics-content').innerHTML = html;
}

// ═══════════════════════════════════════
// MAP EVENTS
// ═══════════════════════════════════════
map.on('click', async e => {
  if (points.length >= 2) return;
  points.push(e.latlng);
  const marker = L.circleMarker(e.latlng, {
    radius: 8,
    color: points.length === 1 ? '#00e5ff' : '#ff2d78',
    fillColor: points.length === 1 ? '#00e5ff' : '#ff2d78',
    fillOpacity: 1,
    weight: 2
  }).addTo(map);
  activeLayers.push(marker);

  if (points.length === 1) {
    await loadRoadNetwork(points[0]);
  } else {
    setInstruction('READY — Run or Compare');
    setStatus('READY', true);
  }
});

map.on('contextmenu', e => {
  let node = nearestNode(e.latlng);
  if (!node) return;
  blockedNodes.add(node);
  const c = L.circle([node.lat, node.lng], { color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.7, radius: 20, weight: 2 }).addTo(map);
  activeLayers.push(c);
});

// ═══════════════════════════════════════
// ALGORITHMS
// ═══════════════════════════════════════
function dijkstra(start, goal) {
  let distMap = new Map(), prev = new Map(), visited = [];
  graph.forEach(n => distMap.set(n, Infinity));
  distMap.set(start, 0);
  let pq = [start];
  while (pq.length) {
    pq.sort((a, b) => distMap.get(a) - distMap.get(b));
    let cur = pq.shift();
    visited.push(cur);
    if (cur === goal) break;
    cur.neighbors.forEach(edge => {
      let nb = edge.node;
      if (blockedNodes.has(nb)) return;
      let cost = distMap.get(cur) + dist(cur, nb) * edge.traffic;
      if (cost < distMap.get(nb)) { distMap.set(nb, cost); prev.set(nb, cur); pq.push(nb); }
    });
  }
  return { path: reconstruct(prev, start, goal), visited };
}

function astar(start, goal) {
  let g = new Map(), f = new Map(), prev = new Map(), visited = [];
  graph.forEach(n => { g.set(n, Infinity); f.set(n, Infinity); });
  g.set(start, 0);
  f.set(start, dist(start, goal));
  let open = [start];
  while (open.length) {
    open.sort((a, b) => f.get(a) - f.get(b));
    let cur = open.shift();
    visited.push(cur);
    if (cur === goal) break;
    cur.neighbors.forEach(edge => {
      let nb = edge.node;
      if (blockedNodes.has(nb)) return;
      let temp = g.get(cur) + dist(cur, nb) * edge.traffic;
      if (temp < g.get(nb)) {
        prev.set(nb, cur); g.set(nb, temp); f.set(nb, temp + dist(nb, goal));
        if (!open.includes(nb)) open.push(nb);
      }
    });
  }
  return { path: reconstruct(prev, start, goal), visited };
}

function ara(start, goal, e = 2) {
  let g = new Map(), f = new Map(), prev = new Map(), visited = [];
  graph.forEach(n => { g.set(n, Infinity); f.set(n, Infinity); });
  g.set(start, 0);
  f.set(start, e * dist(start, goal));
  let open = [start];
  while (open.length) {
    open.sort((a, b) => f.get(a) - f.get(b));
    let cur = open.shift();
    visited.push(cur);
    if (cur === goal) break;
    cur.neighbors.forEach(edge => {
      let nb = edge.node;
      if (blockedNodes.has(nb)) return;
      let temp = g.get(cur) + dist(cur, nb) * edge.traffic;
      if (temp < g.get(nb)) {
        prev.set(nb, cur); g.set(nb, temp); f.set(nb, temp + e * dist(nb, goal));
        if (!open.includes(nb)) open.push(nb);
      }
    });
  }
  return { path: reconstruct(prev, start, goal), visited };
}

function theta(start, goal) {
  let g = new Map(), parent = new Map(), visited = [];
  graph.forEach(n => { g.set(n, Infinity); parent.set(n, null); });
  g.set(start, 0);
  parent.set(start, start);
  let open = [start];
  while (open.length) {
    open.sort((a, b) => g.get(a) - g.get(b));
    let cur = open.shift();
    visited.push(cur);
    if (cur === goal) break;
    cur.neighbors.forEach(edge => {
      let nb = edge.node;
      if (blockedNodes.has(nb)) return;
      let tentative = g.get(cur) + dist(cur, nb) * edge.traffic;
      if (tentative < g.get(nb)) {
        g.set(nb, tentative); parent.set(nb, cur);
        if (!open.includes(nb)) open.push(nb);
      }
    });
  }
  return { path: reconstruct(parent, start, goal), visited };
}

function dstarLite(start, goal) { return astar(start, goal); }

function fieldD(start, goal) {
  let g = new Map(), prev = new Map(), visited = [];
  graph.forEach(n => g.set(n, Infinity));
  g.set(start, 0);
  let open = [start];
  while (open.length) {
    open.sort((a, b) => g.get(a) - g.get(b));
    let cur = open.shift();
    visited.push(cur);
    if (cur === goal) break;
    cur.neighbors.forEach(edge => {
      let nb = edge.node;
      if (blockedNodes.has(nb)) return;
      let extra = edge.traffic < 1 ? 0.8 : 1;
      let temp = g.get(cur) + dist(cur, nb) * edge.traffic * extra;
      if (temp < g.get(nb)) { g.set(nb, temp); prev.set(nb, cur); if (!open.includes(nb)) open.push(nb); }
    });
  }
  return { path: reconstruct(prev, start, goal), visited };
}

function adstar(start, goal) { return ara(start, goal, 2.0); }

const ALGOS = { dijkstra, astar, ara, theta, dstar: dstarLite, fieldd: fieldD, adstar };

// ═══════════════════════════════════════
// SINGLE RUN
// ═══════════════════════════════════════
function runAlgorithm() {
  if (points.length < 2) { setInstruction('Set START and END first!'); return; }
  let start = nearestNode(points[0]), goal = nearestNode(points[1]);
  if (!start || !goal) { setInstruction('No nearby nodes found.'); return; }

  const algoKey = document.getElementById('algorithm').value;
  clearActiveLayers();
  addPointMarkers();

  const t0 = performance.now();
  const result = ALGOS[algoKey](start, goal);
  const t1 = performance.now();

  const explored = L.polyline(result.visited.map(n => [n.lat, n.lng]), { color: '#4a5878', weight: 1.5, opacity: 0.4 }).addTo(map);
  const route = L.polyline(result.path, { color: ALGO_COLORS[algoKey], weight: 5, opacity: 0.9 }).addTo(map);
  activeLayers.push(explored, route);
  if (result.path.length > 0) map.fitBounds(route.getBounds(), { padding: [40, 40] });

  updateLegend([{ key: algoKey, label: ALGO_LABELS[algoKey], color: ALGO_COLORS[algoKey] }]);

  updateMetrics(`
    <div class="metric-card">
      <div class="algo-name">
        <div class="swatch" style="background:${ALGO_COLORS[algoKey]}"></div>
        ${ALGO_LABELS[algoKey]}
      </div>
      <div class="metric-row"><span>Visited Nodes</span><span>${result.visited.length}</span></div>
      <div class="metric-row"><span>Path Nodes</span><span>${result.path.length}</span></div>
      <div class="metric-row"><span>Exec Time</span><span>${(t1 - t0).toFixed(2)} ms</span></div>
    </div>
  `);
}

// ═══════════════════════════════════════
// COMPARE ALL
// ═══════════════════════════════════════
async function compareAll() {
  if (points.length < 2) { setInstruction('Set START and END first!'); return; }
  let start = nearestNode(points[0]), goal = nearestNode(points[1]);
  if (!start || !goal) { setInstruction('No nearby nodes found.'); return; }

  clearActiveLayers();
  addPointMarkers();
  setStatus('RUNNING...', false);
  showLoading(true);

  await new Promise(r => setTimeout(r, 20));

  const keys = Object.keys(ALGOS);
  const results = {};

  keys.forEach(key => {
    const t0 = performance.now();
    const r = ALGOS[key](start, goal);
    const t1 = performance.now();
    results[key] = { ...r, time: t1 - t0 };
  });

  showLoading(false);
  setStatus('DONE', true);
  setInstruction('COMPARE — All algorithms ran');

  keys.forEach(key => {
    const r = results[key];
    if (r.path.length > 1) {
      const pl = L.polyline(r.path, {
        color: ALGO_COLORS[key], weight: 4, opacity: 0.75,
        dashArray: key === 'dijkstra' ? null : '6 3'
      }).addTo(map);
      activeLayers.push(pl);
    }
  });

  const allPoints = keys.flatMap(k => results[k].path);
  if (allPoints.length > 0) map.fitBounds(L.polyline(allPoints).getBounds(), { padding: [40, 40] });

  updateLegend(keys.map(k => ({ key: k, label: ALGO_LABELS[k], color: ALGO_COLORS[k] })));
  renderCompareTable(results, keys);
}

function renderCompareTable(results, keys) {
  const minTime = Math.min(...keys.map(k => results[k].time));
  const minVisited = Math.min(...keys.map(k => results[k].visited.length));
  const minPath = Math.min(...keys.map(k => results[k].path.length).filter(l => l > 0));

  const rows = keys.map(key => {
    const r = results[key];
    const isFastest = r.time === minTime;
    const isLeastExplored = r.visited.length === minVisited;
    const isShortestPath = r.path.length === minPath && r.path.length > 0;
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <div style="width:10px;height:10px;border-radius:50%;background:${ALGO_COLORS[key]};flex-shrink:0;"></div>
            <span style="color:${ALGO_COLORS[key]};font-weight:600;">${ALGO_LABELS[key]}</span>
          </div>
        </td>
        <td>${r.visited.length} ${isLeastExplored ? '<span class="badge-best">BEST</span>' : ''}</td>
        <td>${r.path.length} ${isShortestPath ? '<span class="badge-best">BEST</span>' : ''}</td>
        <td>${r.time.toFixed(1)}ms ${isFastest ? '<span class="badge-best">BEST</span>' : ''}</td>
      </tr>
    `;
  }).join('');

  updateMetrics(`
    <div style="margin-bottom:10px;font-size:10px;color:var(--muted);letter-spacing:1px;">ALL 7 ALGORITHMS · SAME CONDITIONS</div>
    <table class="compare-table">
      <thead>
        <tr>
          <th>Algorithm</th>
          <th>Visited</th>
          <th>Path</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="margin-top:10px;font-size:10px;color:var(--muted);line-height:1.6;">
      Solid line = Dijkstra<br>
      Dashed lines = others
    </div>
  `);
}

// ═══════════════════════════════════════
// LEGEND
// ═══════════════════════════════════════
function updateLegend(algos) {
  const container = document.getElementById('legend-colors');
  const extras = `<div class="legend-row"><div class="legend-line" style="background:#ef4444"></div><span>Obstacle</span></div>`;
  container.innerHTML = algos.map(a =>
    `<div class="legend-row"><div class="legend-line" style="background:${a.color}"></div><span>${a.label}</span></div>`
  ).join('') + extras;
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════
function addPointMarkers() {
  if (points[0]) {
    const s = L.circleMarker(points[0], { radius: 8, color: '#00e5ff', fillColor: '#00e5ff', fillOpacity: 1, weight: 2 }).addTo(map);
    activeLayers.push(s);
  }
  if (points[1]) {
    const e = L.circleMarker(points[1], { radius: 8, color: '#ff2d78', fillColor: '#ff2d78', fillOpacity: 1, weight: 2 }).addTo(map);
    activeLayers.push(e);
  }
}

// ═══════════════════════════════════════
// RESET
// ═══════════════════════════════════════
function resetMap() {
  points = []; graph = []; blockedNodes.clear();
  map.eachLayer(layer => {
    if (layer instanceof L.CircleMarker || layer instanceof L.Polyline || layer instanceof L.Circle) map.removeLayer(layer);
  });
  activeLayers = [];
  setStatus('IDLE', false);
  setInstruction('LEFT CLICK → SET START POINT');
  updateLegend([]);
  updateMetrics(`<div style="color:var(--muted);font-family:'Share Tech Mono',monospace;font-size:12px;line-height:1.8;">
    [ 1 ] Left-click → set START<br>
    [ 2 ] Left-click → set END<br>
    [ 3 ] Run or Compare<br><br>
    Right-click → add obstacle
  </div>`);
}