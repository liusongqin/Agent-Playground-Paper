import { useState, useRef, useEffect, useCallback, createContext, useContext, useMemo } from 'react';
import { sendChatRequest } from '../services/openai';
import { loadSettings } from '../utils/storage';

/* ================================================================
   Context
   ================================================================ */
const FlowchartContext = createContext(null);
function useFlowchart() { return useContext(FlowchartContext); }

/* ================================================================
   Constants
   ================================================================ */
const NODE_TYPES = {
  start:     { label: '开始',   color: '#4caf50', icon: '▶' },
  process:   { label: '处理',   color: '#2196f3', icon: '⚙' },
  decision:  { label: '判断',   color: '#ff9800', icon: '◆' },
  io:        { label: '输入/输出', color: '#9c27b0', icon: '▱' },
  end:       { label: '结束',   color: '#f44336', icon: '⏹' },
};

const NODE_W = 160;
const NODE_H = 64;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.1;

const STORAGE_KEY = 'agent-flowchart-data';

/* ================================================================
   Helpers
   ================================================================ */
function uid() { return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

function saveFlowchart(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { void e; }
}
function loadFlowchart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { void e; }
  return null;
}

function defaultChart() {
  const startId = uid();
  const endId = uid();
  return {
    nodes: [
      { id: startId, type: 'start', label: '开始', x: 300, y: 60 },
      { id: endId, type: 'end', label: '结束', x: 300, y: 300 },
    ],
    edges: [{ id: uid(), from: startId, to: endId, label: '' }],
  };
}

/* ================================================================
   LLM prompt
   ================================================================ */
const LLM_SYSTEM_PROMPT = `你是一个流程图设计助手。根据用户的描述，生成流程图的节点和连接。

请严格按照以下JSON格式输出，不要输出其他内容：
{
  "nodes": [
    { "id": "唯一ID", "type": "start|process|decision|io|end", "label": "节点文本" }
  ],
  "edges": [
    { "from": "源节点ID", "to": "目标节点ID", "label": "可选的连接文字，判断分支用是/否" }
  ]
}

节点类型说明:
- start: 流程开始，每个流程图有且仅有一个
- process: 处理/操作步骤
- decision: 判断/条件分支，通常有两个出边(是/否)
- io: 输入或输出操作
- end: 流程结束，可以有多个

注意：
1. 节点ID使用简短英文如 n1, n2, n3
2. 确保所有edge的from和to都引用了存在的节点ID
3. 确保流程图是连通的
4. 只输出JSON，不要有其他文字`;

/* auto-layout: simple top→bottom BFS */
function autoLayout(nodes, edges) {
  if (!nodes.length) return nodes;
  const adj = {};
  nodes.forEach(function (n) { adj[n.id] = []; });
  edges.forEach(function (e) { if (adj[e.from]) adj[e.from].push(e.to); });

  const startNode = nodes.find(function (n) { return n.type === 'start'; }) || nodes[0];
  const visited = new Set();
  const levels = {};
  const queue = [{ id: startNode.id, level: 0 }];
  visited.add(startNode.id);

  while (queue.length) {
    const cur = queue.shift();
    if (!levels[cur.level]) levels[cur.level] = [];
    levels[cur.level].push(cur.id);
    (adj[cur.id] || []).forEach(function (next) {
      if (!visited.has(next)) { visited.add(next); queue.push({ id: next, level: cur.level + 1 }); }
    });
  }
  // place un-visited nodes
  nodes.forEach(function (n) {
    if (!visited.has(n.id)) {
      const lv = Object.keys(levels).length;
      if (!levels[lv]) levels[lv] = [];
      levels[lv].push(n.id);
    }
  });

  const posMap = {};
  const gapY = 120;
  const gapX = 200;
  Object.keys(levels).sort(function (a, b) { return a - b; }).forEach(function (lv) {
    const ids = levels[lv];
    const totalW = ids.length * gapX;
    ids.forEach(function (id, i) {
      posMap[id] = { x: 300 + i * gapX - totalW / 2 + gapX / 2, y: 60 + Number(lv) * gapY };
    });
  });

  return nodes.map(function (n) { return { ...n, x: posMap[n.id] ? posMap[n.id].x : n.x, y: posMap[n.id] ? posMap[n.id].y : n.y }; });
}

/* ================================================================
   Provider
   ================================================================ */
function FlowchartProvider({ children }) {
  const [chart, setChart] = useState(function () { return loadFlowchart() || defaultChart(); });
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);

  // persist
  useEffect(function () { saveFlowchart(chart); }, [chart]);

  /* CRUD -------------------------------------------------------- */
  const addNode = useCallback(function (type, x, y) {
    const id = uid();
    const label = NODE_TYPES[type] ? NODE_TYPES[type].label : type;
    setChart(function (prev) {
      return { ...prev, nodes: [...prev.nodes, { id: id, type: type, label: label, x: x || 400, y: y || 200 }] };
    });
    return id;
  }, []);

  const updateNode = useCallback(function (id, patch) {
    setChart(function (prev) {
      return { ...prev, nodes: prev.nodes.map(function (n) { return n.id === id ? { ...n, ...patch } : n; }) };
    });
  }, []);

  const removeNode = useCallback(function (id) {
    setChart(function (prev) {
      return {
        nodes: prev.nodes.filter(function (n) { return n.id !== id; }),
        edges: prev.edges.filter(function (e) { return e.from !== id && e.to !== id; }),
      };
    });
    setSelectedNode(function (s) { return s === id ? null : s; });
  }, []);

  const addEdge = useCallback(function (from, to, label) {
    const id = uid();
    setChart(function (prev) {
      const exists = prev.edges.some(function (e) { return e.from === from && e.to === to; });
      if (exists) return prev;
      return { ...prev, edges: [...prev.edges, { id: id, from: from, to: to, label: label || '' }] };
    });
    return id;
  }, []);

  const updateEdge = useCallback(function (id, patch) {
    setChart(function (prev) {
      return { ...prev, edges: prev.edges.map(function (e) { return e.id === id ? { ...e, ...patch } : e; }) };
    });
  }, []);

  const removeEdge = useCallback(function (id) {
    setChart(function (prev) {
      return { ...prev, edges: prev.edges.filter(function (e) { return e.id !== id; }) };
    });
    setSelectedEdge(function (s) { return s === id ? null : s; });
  }, []);

  const resetChart = useCallback(function () {
    const d = defaultChart();
    setChart(d);
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const loadFromLLM = useCallback(function (parsed) {
    // parsed = { nodes: [...], edges: [...] }
    const laid = autoLayout(parsed.nodes, parsed.edges);
    setChart({ nodes: laid, edges: parsed.edges.map(function (e) { return { ...e, id: e.id || uid() }; }) });
    setSelectedNode(null);
    setSelectedEdge(null);
  }, []);

  const doAutoLayout = useCallback(function () {
    setChart(function (prev) {
      return { ...prev, nodes: autoLayout(prev.nodes, prev.edges) };
    });
  }, []);

  const ctx = useMemo(function () {
    return {
      chart: chart, setChart: setChart,
      selectedNode: selectedNode, setSelectedNode: setSelectedNode,
      selectedEdge: selectedEdge, setSelectedEdge: setSelectedEdge,
      addNode: addNode, updateNode: updateNode, removeNode: removeNode,
      addEdge: addEdge, updateEdge: updateEdge, removeEdge: removeEdge,
      resetChart: resetChart, loadFromLLM: loadFromLLM, doAutoLayout: doAutoLayout,
    };
  }, [chart, selectedNode, selectedEdge, addNode, updateNode, removeNode, addEdge, updateEdge, removeEdge, resetChart, loadFromLLM, doAutoLayout]);

  return <FlowchartContext.Provider value={ctx}>{children}</FlowchartContext.Provider>;
}

/* ================================================================
   Canvas
   ================================================================ */
function FlowchartCanvas() {
  const { chart, setSelectedNode, setSelectedEdge, selectedNode, selectedEdge, updateNode, addEdge } = useFlowchart();
  const canvasRef = useRef(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const dragging = useRef(null);   // { type:'node'|'pan'|'connect', ... }
  const lastMouse = useRef({ x: 0, y: 0 });
  const connectLine = useRef(null); // {fromId, x, y}
  const [, forceRender] = useState(0);

  /* coordinate helpers */
  const toWorld = useCallback(function (cx, cy) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: (cx - rect.left - pan.x) / zoom, y: (cy - rect.top - pan.y) / zoom };
  }, [pan, zoom]);

  /* draw -------------------------------------------------------- */
  useEffect(function () {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // bg grid
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    const gridSize = 40;
    ctx.strokeStyle = '#2a2d35';
    ctx.lineWidth = 0.5 / zoom;
    const startX = Math.floor(-pan.x / zoom / gridSize) * gridSize - gridSize;
    const startY = Math.floor(-pan.y / zoom / gridSize) * gridSize - gridSize;
    const endX = startX + rect.width / zoom + gridSize * 2;
    const endY = startY + rect.height / zoom + gridSize * 2;
    for (let gx = startX; gx < endX; gx += gridSize) {
      ctx.beginPath(); ctx.moveTo(gx, startY); ctx.lineTo(gx, endY); ctx.stroke();
    }
    for (let gy = startY; gy < endY; gy += gridSize) {
      ctx.beginPath(); ctx.moveTo(startX, gy); ctx.lineTo(endX, gy); ctx.stroke();
    }

    /* edges */
    chart.edges.forEach(function (e) {
      const fromNode = chart.nodes.find(function (n) { return n.id === e.from; });
      const toNode = chart.nodes.find(function (n) { return n.id === e.to; });
      if (!fromNode || !toNode) return;
      const sx = fromNode.x + NODE_W / 2;
      const sy = fromNode.y + NODE_H;
      const ex = toNode.x + NODE_W / 2;
      const ey = toNode.y;

      const isSelected = selectedEdge === e.id;
      ctx.strokeStyle = isSelected ? '#ffd740' : '#8892a0';
      ctx.lineWidth = isSelected ? 2.5 / zoom : 1.5 / zoom;
      ctx.beginPath();
      const midY = (sy + ey) / 2;
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, midY, ex, midY, ex, ey);
      ctx.stroke();

      // arrow
      const t = 0.85;
      const ax = (1 - t) * (1 - t) * (1 - t) * sx + 3 * (1 - t) * (1 - t) * t * sx + 3 * (1 - t) * t * t * ex + t * t * t * ex;
      const ay = (1 - t) * (1 - t) * (1 - t) * sy + 3 * (1 - t) * (1 - t) * t * midY + 3 * (1 - t) * t * t * midY + t * t * t * ey;
      const dt = 0.01;
      const t2 = t + dt;
      const bx = (1 - t2) * (1 - t2) * (1 - t2) * sx + 3 * (1 - t2) * (1 - t2) * t2 * sx + 3 * (1 - t2) * t2 * t2 * ex + t2 * t2 * t2 * ex;
      const by = (1 - t2) * (1 - t2) * (1 - t2) * sy + 3 * (1 - t2) * (1 - t2) * t2 * midY + 3 * (1 - t2) * t2 * t2 * midY + t2 * t2 * t2 * ey;
      const angle = Math.atan2(by - ay, bx - ax);
      const arrowLen = 10 / zoom;
      ctx.fillStyle = isSelected ? '#ffd740' : '#8892a0';
      ctx.beginPath();
      ctx.moveTo(ax + arrowLen * Math.cos(angle), ay + arrowLen * Math.sin(angle));
      ctx.lineTo(ax + arrowLen * Math.cos(angle + 2.5), ay + arrowLen * Math.sin(angle + 2.5));
      ctx.lineTo(ax + arrowLen * Math.cos(angle - 2.5), ay + arrowLen * Math.sin(angle - 2.5));
      ctx.closePath();
      ctx.fill();

      // label
      if (e.label) {
        ctx.fillStyle = '#c0c4cc';
        ctx.font = (12 / zoom) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.label, (sx + ex) / 2, midY - 4 / zoom);
      }
    });

    /* connect line in progress */
    if (connectLine.current) {
      ctx.strokeStyle = '#4fc3f7';
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      const fromNode = chart.nodes.find(function (n) { return n.id === connectLine.current.fromId; });
      if (fromNode) {
        ctx.beginPath();
        ctx.moveTo(fromNode.x + NODE_W / 2, fromNode.y + NODE_H);
        ctx.lineTo(connectLine.current.x, connectLine.current.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    /* nodes */
    chart.nodes.forEach(function (node) {
      const nt = NODE_TYPES[node.type] || NODE_TYPES.process;
      const isSelected = selectedNode === node.id;
      const x = node.x;
      const y = node.y;

      // shadow
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 8 / zoom;
      ctx.shadowOffsetY = 2 / zoom;

      if (node.type === 'decision') {
        // diamond shape
        ctx.fillStyle = isSelected ? '#5c4b1f' : '#2a2d35';
        ctx.strokeStyle = isSelected ? '#ffd740' : nt.color;
        ctx.lineWidth = isSelected ? 2.5 / zoom : 1.5 / zoom;
        ctx.beginPath();
        ctx.moveTo(x + NODE_W / 2, y);
        ctx.lineTo(x + NODE_W, y + NODE_H / 2);
        ctx.lineTo(x + NODE_W / 2, y + NODE_H);
        ctx.lineTo(x, y + NODE_H / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        // rounded rect
        const r = node.type === 'start' || node.type === 'end' ? NODE_H / 2 : 8;
        ctx.fillStyle = isSelected ? '#2a3a4f' : '#1e2128';
        ctx.strokeStyle = isSelected ? '#ffd740' : nt.color;
        ctx.lineWidth = isSelected ? 2.5 / zoom : 1.5 / zoom;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + NODE_W - r, y);
        ctx.quadraticCurveTo(x + NODE_W, y, x + NODE_W, y + r);
        ctx.lineTo(x + NODE_W, y + NODE_H - r);
        ctx.quadraticCurveTo(x + NODE_W, y + NODE_H, x + NODE_W - r, y + NODE_H);
        ctx.lineTo(x + r, y + NODE_H);
        ctx.quadraticCurveTo(x, y + NODE_H, x, y + NODE_H - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // icon + label
      ctx.fillStyle = '#e0e0e0';
      ctx.font = 'bold ' + (13 / zoom) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(nt.icon + ' ' + (node.label || ''), x + NODE_W / 2, y + NODE_H / 2);

      // connection handle
      ctx.fillStyle = isSelected ? '#4fc3f7' : '#555';
      ctx.beginPath();
      ctx.arc(x + NODE_W / 2, y + NODE_H + 6 / zoom, 5 / zoom, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }, [chart, pan, zoom, selectedNode, selectedEdge]);

  /* event handlers ---------------------------------------------- */
  const handleMouseDown = useCallback(function (e) {
    if (e.button === 2) { e.preventDefault(); return; }
    const w = toWorld(e.clientX, e.clientY);
    lastMouse.current = { x: e.clientX, y: e.clientY };

    // check connection handle click
    for (let i = chart.nodes.length - 1; i >= 0; i--) {
      const n = chart.nodes[i];
      const hx = n.x + NODE_W / 2;
      const hy = n.y + NODE_H + 6;
      if (Math.abs(w.x - hx) < 10 && Math.abs(w.y - hy) < 10) {
        dragging.current = { type: 'connect', fromId: n.id };
        connectLine.current = { fromId: n.id, x: w.x, y: w.y };
        forceRender(function (c) { return c + 1; });
        return;
      }
    }

    // check node click
    for (let j = chart.nodes.length - 1; j >= 0; j--) {
      const nd = chart.nodes[j];
      if (w.x >= nd.x && w.x <= nd.x + NODE_W && w.y >= nd.y && w.y <= nd.y + NODE_H) {
        dragging.current = { type: 'node', id: nd.id, startX: nd.x, startY: nd.y, mouseX: e.clientX, mouseY: e.clientY };
        setSelectedNode(nd.id);
        setSelectedEdge(null);
        return;
      }
    }

    // check edge click (simplified: midpoint area)
    for (let k = 0; k < chart.edges.length; k++) {
      const edge = chart.edges[k];
      const fromN = chart.nodes.find(function (nn) { return nn.id === edge.from; });
      const toN = chart.nodes.find(function (nn) { return nn.id === edge.to; });
      if (fromN && toN) {
        const mx = (fromN.x + toN.x + NODE_W) / 2;
        const my = (fromN.y + NODE_H + toN.y) / 2;
        if (Math.abs(w.x - mx) < 20 && Math.abs(w.y - my) < 20) {
          setSelectedEdge(edge.id);
          setSelectedNode(null);
          return;
        }
      }
    }

    // pan
    dragging.current = { type: 'pan' };
    setSelectedNode(null);
    setSelectedEdge(null);
  }, [chart, toWorld, setSelectedNode, setSelectedEdge]);

  const handleMouseMove = useCallback(function (e) {
    if (!dragging.current) return;
    if (dragging.current.type === 'pan') {
      setPan(function (p) {
        return { x: p.x + e.clientX - lastMouse.current.x, y: p.y + e.clientY - lastMouse.current.y };
      });
      lastMouse.current = { x: e.clientX, y: e.clientY };
    } else if (dragging.current.type === 'node') {
      const dx = (e.clientX - dragging.current.mouseX) / zoom;
      const dy = (e.clientY - dragging.current.mouseY) / zoom;
      updateNode(dragging.current.id, { x: dragging.current.startX + dx, y: dragging.current.startY + dy });
    } else if (dragging.current.type === 'connect') {
      const w = toWorld(e.clientX, e.clientY);
      connectLine.current = { fromId: dragging.current.fromId, x: w.x, y: w.y };
      forceRender(function (c) { return c + 1; });
    }
  }, [zoom, updateNode, toWorld]);

  const handleMouseUp = useCallback(function (e) {
    if (dragging.current && dragging.current.type === 'connect') {
      const w = toWorld(e.clientX, e.clientY);
      for (let i = chart.nodes.length - 1; i >= 0; i--) {
        const n = chart.nodes[i];
        if (n.id !== dragging.current.fromId && w.x >= n.x && w.x <= n.x + NODE_W && w.y >= n.y && w.y <= n.y + NODE_H) {
          addEdge(dragging.current.fromId, n.id, '');
          break;
        }
      }
      connectLine.current = null;
      forceRender(function (c) { return c + 1; });
    }
    dragging.current = null;
  }, [chart, toWorld, addEdge]);

  const handleWheel = useCallback(function (e) {
    e.preventDefault();
    setZoom(function (z) {
      const next = z + (e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
      return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    });
  }, []);

  /* context menu ------------------------------------------------ */
  const [ctxMenu, setCtxMenu] = useState(null);
  const handleContextMenu = useCallback(function (e) {
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    setCtxMenu({ screenX: e.clientX, screenY: e.clientY, worldX: w.x, worldY: w.y });
  }, [toWorld]);

  const closeCtx = useCallback(function () { setCtxMenu(null); }, []);

  /* resize observer */
  useEffect(function () {
    let timer;
    function onResize() { clearTimeout(timer); timer = setTimeout(function () { forceRender(function (c) { return c + 1; }); }, 100); }
    window.addEventListener('resize', onResize);
    return function () { window.removeEventListener('resize', onResize); clearTimeout(timer); };
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#1a1d23', overflow: 'hidden' }}
      onContextMenu={handleContextMenu}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: dragging.current ? 'grabbing' : 'default' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />
      {/* Zoom indicator */}
      <div style={{ position: 'absolute', bottom: 8, right: 8, color: '#666', fontSize: 12, pointerEvents: 'none' }}>
        {Math.round(zoom * 100)}%
      </div>
      {/* Context menu */}
      {ctxMenu && <CtxMenuOverlay ctxMenu={ctxMenu} onClose={closeCtx} />}
    </div>
  );
}

/* Separate context menu component to access useFlowchart hook */
function CtxMenuOverlay({ ctxMenu, onClose }) {
  const { addNode } = useFlowchart();
  if (!ctxMenu) return null;
  return (
    <div style={{ position: 'fixed', left: ctxMenu.screenX, top: ctxMenu.screenY, background: '#2a2d35', border: '1px solid #444', borderRadius: 6, padding: 4, zIndex: 1000, minWidth: 160, boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
      {Object.keys(NODE_TYPES).map(function (t) {
        return (
          <div key={t}
            style={{ padding: '6px 12px', cursor: 'pointer', color: '#ddd', fontSize: 13, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6 }}
            onMouseEnter={function (ev) { ev.currentTarget.style.background = '#3a3d45'; }}
            onMouseLeave={function (ev) { ev.currentTarget.style.background = 'transparent'; }}
            onClick={function () { addNode(t, ctxMenu.worldX, ctxMenu.worldY); onClose(); }}
          >
            <span style={{ color: NODE_TYPES[t].color }}>{NODE_TYPES[t].icon}</span> 添加{NODE_TYPES[t].label}节点
          </div>
        );
      })}
    </div>
  );
}

/* ================================================================
   Info Panel (right side)
   ================================================================ */
function FlowchartInfo() {
  const {
    chart, selectedNode, selectedEdge, setSelectedNode, setSelectedEdge,
    addNode, updateNode, removeNode, updateEdge, removeEdge,
    resetChart, loadFromLLM, doAutoLayout,
  } = useFlowchart();

  const [llmPrompt, setLlmPrompt] = useState('');
  const [llmLoading, setLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState('');
  const [expanded, setExpanded] = useState({ llm: true, props: true, list: true });

  const toggleSec = useCallback(function (k) {
    setExpanded(function (p) { return { ...p, [k]: !p[k] }; });
  }, []);

  const selNode = selectedNode ? chart.nodes.find(function (n) { return n.id === selectedNode; }) : null;
  const selEdge = selectedEdge ? chart.edges.find(function (e) { return e.id === selectedEdge; }) : null;

  /* LLM generation */
  const handleLLMGenerate = useCallback(async function () {
    if (!llmPrompt.trim() || llmLoading) return;
    setLlmLoading(true);
    setLlmError('');
    try {
      const settings = loadSettings();
      if (!settings || !settings.apiKey) {
        setLlmError('请先在设置中配置API Key');
        setLlmLoading(false);
        return;
      }
      const messages = [
        { role: 'system', content: LLM_SYSTEM_PROMPT },
        { role: 'user', content: llmPrompt.trim() },
      ];
      const reqSettings = { ...settings, stream: true };
      let streamedContent = '';
      const result = await sendChatRequest(messages, reqSettings, function(chunk, isDone) {
        if (!isDone && chunk) streamedContent += chunk;
      });
      const content = result.content || streamedContent;
      // extract JSON
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('LLM返回格式错误，未找到JSON');
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.nodes || !parsed.edges) throw new Error('JSON缺少nodes或edges字段');
      loadFromLLM(parsed);
    } catch (err) {
      setLlmError(err.message || '生成失败');
    }
    setLlmLoading(false);
  }, [llmPrompt, llmLoading, loadFromLLM]);

  /* styles */
  const sectionStyle = { marginBottom: 12 };
  const headerStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 8px', background: '#2a2d35', borderRadius: 4, cursor: 'pointer', fontSize: 13, color: '#ddd', userSelect: 'none' };
  const bodyStyle = { padding: '8px 6px' };
  const btnStyle = { padding: '6px 12px', background: '#2196f3', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12, width: '100%' };
  const btnDanger = { ...btnStyle, background: '#f44336' };
  const inputStyle = { width: '100%', padding: '6px 8px', background: '#1e2128', border: '1px solid #444', borderRadius: 4, color: '#ddd', fontSize: 12, boxSizing: 'border-box' };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 8, fontSize: 13, color: '#ccc' }}>
      {/* LLM Generation */}
      <div style={sectionStyle}>
        <div style={headerStyle} onClick={function () { toggleSec('llm'); }}>
          <span>🤖 AI 生成流程图</span>
          <span>{expanded.llm ? '▼' : '▶'}</span>
        </div>
        {expanded.llm && (
          <div style={bodyStyle}>
            <textarea
              value={llmPrompt}
              onChange={function (e) { setLlmPrompt(e.target.value); }}
              placeholder="描述你想要的流程图，如：用户登录注册流程"
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
            <button
              style={{ ...btnStyle, marginTop: 6, background: llmLoading ? '#555' : '#2196f3' }}
              onClick={handleLLMGenerate}
              disabled={llmLoading}
            >
              {llmLoading ? '⏳ 生成中...' : '✨ AI 生成'}
            </button>
            {llmError && <div style={{ color: '#f44336', fontSize: 11, marginTop: 4 }}>❌ {llmError}</div>}
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        <button style={{ ...btnStyle, width: 'auto', flex: 1, background: '#4caf50' }} onClick={function () { addNode('process', 200 + Math.random() * 200, 200 + Math.random() * 100); }}>＋ 节点</button>
        <button style={{ ...btnStyle, width: 'auto', flex: 1, background: '#607d8b' }} onClick={doAutoLayout}>📐 排列</button>
        <button style={{ ...btnDanger, width: 'auto', flex: 1 }} onClick={resetChart}>🗑 重置</button>
      </div>

      {/* Properties Panel */}
      <div style={sectionStyle}>
        <div style={headerStyle} onClick={function () { toggleSec('props'); }}>
          <span>📋 属性</span>
          <span>{expanded.props ? '▼' : '▶'}</span>
        </div>
        {expanded.props && (
          <div style={bodyStyle}>
            {selNode ? (
              <div>
                <div style={{ marginBottom: 6 }}>
                  <label style={{ fontSize: 11, color: '#888' }}>类型</label>
                  <select value={selNode.type} onChange={function (e) { updateNode(selNode.id, { type: e.target.value }); }}
                    style={{ ...inputStyle, marginTop: 2 }}>
                    {Object.keys(NODE_TYPES).map(function (t) {
                      return <option key={t} value={t}>{NODE_TYPES[t].icon} {NODE_TYPES[t].label}</option>;
                    })}
                  </select>
                </div>
                <div style={{ marginBottom: 6 }}>
                  <label style={{ fontSize: 11, color: '#888' }}>标签</label>
                  <input value={selNode.label || ''} onChange={function (e) { updateNode(selNode.id, { label: e.target.value }); }}
                    style={{ ...inputStyle, marginTop: 2 }} />
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button style={{ ...btnDanger, flex: 1 }} onClick={function () { removeNode(selNode.id); }}>🗑 删除节点</button>
                </div>
              </div>
            ) : selEdge ? (
              <div>
                <div style={{ marginBottom: 6 }}>
                  <label style={{ fontSize: 11, color: '#888' }}>连线标签</label>
                  <input value={selEdge.label || ''} onChange={function (e) { updateEdge(selEdge.id, { label: e.target.value }); }}
                    style={{ ...inputStyle, marginTop: 2 }} />
                </div>
                <button style={btnDanger} onClick={function () { removeEdge(selEdge.id); }}>🗑 删除连线</button>
              </div>
            ) : (
              <div style={{ color: '#666', fontSize: 12, textAlign: 'center', padding: 16 }}>
                点击节点或连线查看属性<br />
                <span style={{ fontSize: 11 }}>右键画布可添加节点<br />拖拽节点底部圆点可连线</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Node list */}
      <div style={sectionStyle}>
        <div style={headerStyle} onClick={function () { toggleSec('list'); }}>
          <span>📑 节点列表 ({chart.nodes.length})</span>
          <span>{expanded.list ? '▼' : '▶'}</span>
        </div>
        {expanded.list && (
          <div style={bodyStyle}>
            {chart.nodes.map(function (n) {
              const nt = NODE_TYPES[n.type] || NODE_TYPES.process;
              const isSel = selectedNode === n.id;
              return (
                <div key={n.id}
                  onClick={function () { setSelectedNode(n.id); setSelectedEdge(null); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                    background: isSel ? '#2a3a4f' : 'transparent', border: isSel ? '1px solid #4fc3f7' : '1px solid transparent',
                    marginBottom: 2,
                  }}>
                  <span style={{ color: nt.color }}>{nt.icon}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label || '(无标签)'}</span>
                </div>
              );
            })}
            {chart.edges.length > 0 && (
              <div style={{ marginTop: 8, borderTop: '1px solid #333', paddingTop: 6 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>连线 ({chart.edges.length})</div>
                {chart.edges.map(function (e) {
                  const fromN = chart.nodes.find(function (n) { return n.id === e.from; });
                  const toN = chart.nodes.find(function (n) { return n.id === e.to; });
                  const isSel = selectedEdge === e.id;
                  return (
                    <div key={e.id}
                      onClick={function () { setSelectedEdge(e.id); setSelectedNode(null); }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                        background: isSel ? '#2a3a4f' : 'transparent', border: isSel ? '1px solid #ffd740' : '1px solid transparent',
                        marginBottom: 2, color: '#aaa',
                      }}>
                      <span>{fromN ? fromN.label : '?'}</span>
                      <span style={{ color: '#666' }}>→</span>
                      <span>{toN ? toN.label : '?'}</span>
                      {e.label && <span style={{ color: '#888', marginLeft: 'auto' }}>({e.label})</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Help */}
      <div style={{ fontSize: 11, color: '#555', padding: '8px 4px', borderTop: '1px solid #333' }}>
        💡 操作提示：<br />
        • 右键画布 → 添加节点<br />
        • 拖拽节点底部圆点 → 连线<br />
        • 滚轮 → 缩放<br />
        • 拖拽空白区域 → 平移<br />
        • 点击节点/连线 → 选中编辑
      </div>
    </div>
  );
}

/* ================================================================
   Exports
   ================================================================ */
export { FlowchartProvider, FlowchartCanvas, FlowchartInfo, FlowchartContext };
export default function FlowchartDesigner() {
  return (
    <FlowchartProvider>
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <FlowchartCanvas />
        </div>
      </div>
    </FlowchartProvider>
  );
}
