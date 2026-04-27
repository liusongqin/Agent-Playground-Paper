import { useState, useRef, useCallback, useEffect, useMemo, useContext, createContext, memo } from 'react';
import { sendChatRequest } from '../services/openai';

/* ================================================================
   Constants & Configuration
   ================================================================ */

const MAX_EVENTS = 200;
const MAX_GRAPH_NODES = 200;
const CONTEXT_BATCH_SIZE = 10;
const LOCALSTORAGE_KEY = 'worldSimSaves';
const EDGE_HOVER_THRESHOLD = 8;
const SPIRAL_INNER_RADIUS = 120;
const ITEMS_PER_SPIRAL_TURN = 5;
const SPIRAL_RENDER_STEPS = 300;
const SPIRAL_ATTRACTION_STRENGTH = 0.05;
const INITIAL_POSITION_JITTER = 20;
const FORCE_LAYOUT_CONVERGENCE_THRESHOLD = 0.01;
const RING_MIN_SPACING_BASE = 90;
const RING_BASE_RADIUS = 120;
const RING_GAP_BASE = 100;
const RING_RADIAL_STRENGTH = 0.03;
const RING_REPULSION_FACTOR = 0.15;
const FORCE_DIRECTED_REPULSION = 8000;
const DEFAULT_RELATIONSHIP_TYPE = '中立';

/* Document chunking defaults */
const DOC_CHUNK_SIZE = 3000;
const DOC_CHUNK_OVERLAP = 500;
const DOC_CHUNK_SIZE_MIN = 500;
const DOC_CHUNK_SIZE_STEP = 100;
const DOC_CHUNK_OVERLAP_MAX = 2000;
const DOC_CHUNK_OVERLAP_STEP = 50;
const DOC_CHUNK_OVERLAP_RATIO = 0.5;
const DOC_CAUSAL_LOOKBACK = 10;

const INITIAL_WORLD_STATE = {
  weather: '晴朗',
  season: '春天',
  economy: '稳定',
  time_of_day: '白天',
  population_mood: '平和',
};

const INITIAL_EVENTS = [
  { id: 'e0', text: '清晨的阳光洒在小镇广场上', type: 'environment', character: null, location: '广场', impact: 'low', causes: [], effects: ['小镇开始新的一天'] },
  { id: 'e1', text: '面包师开始揉面准备今天的面包', type: 'character', character: '面包师', location: '面包店', impact: 'low', causes: ['e0'], effects: ['面包香气弥漫'] },
  { id: 'e2', text: '一位旅行者带着疲惫抵达小镇', type: 'character', character: '旅行者', location: '镇门口', impact: 'medium', causes: [], effects: ['引起居民好奇'] },
  { id: 'e3', text: '镇长在广场发布公告', type: 'social', character: '镇长', location: '广场', impact: 'medium', causes: ['e0'], effects: ['居民聚集讨论'] },
];

const INITIAL_CHARACTERS = [
  { name: '面包师', activity: '揉面团', mood: '愉快', emoji: '👨‍🍳', location: '面包店', relationships: { '镇长': '友好:老朋友', '铁匠': '友好:邻居' } },
  { name: '旅行者', activity: '观察小镇', mood: '好奇', emoji: '🧳', location: '镇门口', relationships: {} },
  { name: '镇长', activity: '发布公告', mood: '严肃', emoji: '👔', location: '广场', relationships: { '面包师': '友好:老朋友', '农夫': '同盟:合作伙伴' } },
  { name: '铁匠', activity: '锻造铁器', mood: '专注', emoji: '⚒️', location: '铁匠铺', relationships: { '面包师': '友好:邻居', '农夫': '贸易:客户' } },
  { name: '农夫', activity: '浇灌作物', mood: '平静', emoji: '🌾', location: '农田', relationships: { '铁匠': '贸易:工具供应商', '镇长': '同盟:合作伙伴' } },
];

// Random world generation templates
const RANDOM_WORLD_TEMPLATES = [
  {
    name: '海港城镇',
    summary: '繁忙的海港小镇，商人和水手们来来往往，港口充满了冒险的气息。',
    locations: ['港口', '市场', '酒馆', '灯塔', '造船厂', '鱼市'],
    characters: [
      { name: '船长', activity: '检查船只', mood: '警觉', emoji: '⚓', location: '港口' },
      { name: '商人', activity: '清点货物', mood: '精明', emoji: '💎', location: '市场' },
      { name: '酒馆老板', activity: '擦拭杯子', mood: '热情', emoji: '🍺', location: '酒馆' },
      { name: '渔夫', activity: '整理渔网', mood: '悠闲', emoji: '🎣', location: '港口' },
    ],
    events: [
      { text: '一艘满载货物的商船缓缓驶入港口', type: 'trade', location: '港口', impact: 'medium' },
      { text: '市场上传来阵阵叫卖声', type: 'social', location: '市场', impact: 'low' },
      { text: '酒馆里水手们在讲述海上的故事', type: 'social', location: '酒馆', impact: 'low' },
      { text: '灯塔守望者发现远方有暴风雨正在逼近', type: 'environment', location: '灯塔', impact: 'high' },
    ],
    weather: '多云', season: '夏天',
  },
  {
    name: '山间村落',
    summary: '宁静的山间村落，四周被茂密的森林和高山环绕，村民们过着自给自足的生活。',
    locations: ['村口', '矿洞', '药草园', '祠堂', '山顶', '溪边'],
    characters: [
      { name: '猎人', activity: '磨箭头', mood: '沉稳', emoji: '🏹', location: '村口' },
      { name: '药师', activity: '采集草药', mood: '专注', emoji: '🌿', location: '药草园' },
      { name: '矿工', activity: '开采矿石', mood: '疲惫', emoji: '⛏️', location: '矿洞' },
      { name: '长老', activity: '祈祷', mood: '安详', emoji: '🧙', location: '祠堂' },
    ],
    events: [
      { text: '晨雾笼罩着整个山谷', type: 'environment', location: '村口', impact: 'low' },
      { text: '猎人在森林边缘发现了奇怪的足迹', type: 'discovery', location: '村口', impact: 'medium' },
      { text: '矿洞深处传来奇怪的回响', type: 'discovery', location: '矿洞', impact: 'high' },
      { text: '药师配制出了新的草药配方', type: 'character', location: '药草园', impact: 'medium' },
    ],
    weather: '薄雾', season: '秋天',
  },
  {
    name: '沙漠绿洲',
    summary: '沙漠中的绿洲城市，商队在这里休息补给，各种文化在此交汇。',
    locations: ['绿洲', '集市', '帐篷区', '古井', '沙丘', '商队营地'],
    characters: [
      { name: '商队队长', activity: '查看地图', mood: '谨慎', emoji: '🐪', location: '商队营地' },
      { name: '占星师', activity: '观测星象', mood: '神秘', emoji: '🔮', location: '沙丘' },
      { name: '泉水守护者', activity: '维护水源', mood: '虔诚', emoji: '💧', location: '古井' },
      { name: '舞者', activity: '练习舞步', mood: '欢快', emoji: '💃', location: '集市' },
    ],
    events: [
      { text: '烈日照耀着沙漠中的绿洲', type: 'environment', location: '绿洲', impact: 'low' },
      { text: '远方商队的驼铃声由远及近', type: 'trade', location: '沙丘', impact: 'medium' },
      { text: '集市上来自异域的香料引起了轰动', type: 'trade', location: '集市', impact: 'medium' },
      { text: '占星师预言了一场即将到来的沙暴', type: 'discovery', location: '沙丘', impact: 'high' },
    ],
    weather: '炎热', season: '夏天',
  },
  {
    name: '皇城宫廷',
    summary: '庄严的皇城，权力的中心，各派势力在此暗流涌动。',
    locations: ['大殿', '御花园', '书房', '城门', '后宫', '密室'],
    characters: [
      { name: '丞相', activity: '批阅奏折', mood: '忧虑', emoji: '📜', location: '书房' },
      { name: '将军', activity: '巡视城防', mood: '威严', emoji: '⚔️', location: '城门' },
      { name: '宫女', activity: '整理花圃', mood: '谨慎', emoji: '🌸', location: '御花园' },
      { name: '刺客', activity: '潜伏观察', mood: '冷静', emoji: '🗡️', location: '密室' },
    ],
    events: [
      { text: '朝会上大臣们激烈争论边疆策略', type: 'conflict', location: '大殿', impact: 'high' },
      { text: '御花园中传来悠扬的琴声', type: 'social', location: '御花园', impact: 'low' },
      { text: '一封密信从边关送达', type: 'discovery', location: '书房', impact: 'high' },
      { text: '将军在城门处加强了守卫', type: 'character', location: '城门', impact: 'medium' },
    ],
    weather: '阴天', season: '冬天',
  },
  {
    name: '魔法学院',
    summary: '一座充满魔力的学院，学徒们在这里学习各种法术和知识。',
    locations: ['大厅', '图书馆', '炼金室', '训练场', '天文台', '禁区'],
    characters: [
      { name: '大法师', activity: '研究咒语', mood: '深沉', emoji: '🧙‍♂️', location: '图书馆' },
      { name: '学徒', activity: '练习火球术', mood: '兴奋', emoji: '🔥', location: '训练场' },
      { name: '炼金术士', activity: '调配药剂', mood: '专注', emoji: '⚗️', location: '炼金室' },
      { name: '守卫', activity: '巡逻走廊', mood: '警惕', emoji: '🛡️', location: '禁区' },
    ],
    events: [
      { text: '学院上空浮现出奇异的魔法光环', type: 'environment', location: '大厅', impact: 'medium' },
      { text: '学徒意外引发了一次小型爆炸', type: 'conflict', location: '训练场', impact: 'medium' },
      { text: '图书馆中一本古书自行翻开', type: 'discovery', location: '图书馆', impact: 'high' },
      { text: '炼金术士成功炼制出稀有药剂', type: 'trade', location: '炼金室', impact: 'medium' },
    ],
    weather: '魔力充沛', season: '春天',
  },
];



const EVENT_COLORS = {
  environment: '#4CAF50',
  character: '#2196F3',
  social: '#FF9800',
  conflict: '#f44336',
  discovery: '#9C27B0',
  trade: '#00BCD4',
};

const EDGE_STYLES = {
  time: { color: '#888', width: 1, dash: [], label: '时间线', desc: '按时间顺序连接前后事件' },
  character: { color: '#FF9800', width: 1.5, dash: [6, 4], label: '同一角色', desc: '同一角色参与的连续事件' },
  causes: { color: '#f44336', width: 2.5, dash: [], label: '因果', desc: '直接因果关系：前事件导致后事件发生' },
  relates_to: { color: '#4CAF50', width: 1, dash: [2, 3], label: '同地事件', desc: '发生在同一地点的不同事件（无直接因果）' },
  emotion: { color: '#E91E63', width: 1.5, dash: [4, 2], label: '情感', desc: '连续社交事件之间的情感联系' },
  conflict: { color: '#FF5722', width: 2, dash: [8, 3], label: '冲突', desc: '连续冲突事件之间的对抗关系' },
  cooperation: { color: '#00BCD4', width: 1.5, dash: [5, 3], label: '合作', desc: '连续贸易事件之间的合作关系' },
};

const DEFAULT_EDGE_VISIBILITY = {
  time: true,
  character: true,
  causes: true,
  relates_to: true,
  emotion: true,
  conflict: true,
  cooperation: true,
};

const TIME_RING_COLORS = { '清晨': '#a09070', '白天': '#8a9a78', '夜晚': '#6878a0' };

// Standardized character relationship categories
const RELATIONSHIP_TYPES = {
  友好: { color: '#4CAF50', icon: '💚' },
  敌对: { color: '#f44336', icon: '💔' },
  中立: { color: '#9E9E9E', icon: '🤝' },
  亲属: { color: '#E91E63', icon: '👨‍👩‍👧‍👦' },
  贸易: { color: '#00BCD4', icon: '💰' },
  师徒: { color: '#9C27B0', icon: '📚' },
  同盟: { color: '#2196F3', icon: '🤜🤛' },
  竞争: { color: '#FF9800', icon: '⚔️' },
};

const NEW_CHARACTER_EMOJIS = ['🧑', '👩', '👨', '🧓', '👧', '🧔', '🤵', '👷', '💂', '🕵️', '👸', '🤴'];

/* Strip model thinking content — extract only the portion after the last </think> tag */
function stripThinkTags(text) {
  if (!text) return text;
  const lower = text.toLowerCase();
  const closeTag = '</think>';
  const closeIdx = lower.lastIndexOf(closeTag);
  if (closeIdx !== -1) return text.substring(closeIdx + closeTag.length).trim();
  const openIdx = lower.indexOf('<think>');
  if (openIdx !== -1) return text.substring(0, openIdx).trim();
  return text.trim();
}

/* Generate NPC-persona-based loading tip during character chat */
function generateChatBufferTip(character) {
  if (!character) return '正在思考...';
  const name = character.name;
  const baseTips = [
    `${name}正在思考你说的话...`,
    `${name}沉吟片刻...`,
    `${name}若有所思地看着你...`,
  ];
  const activityTips = character.activity ? [
    `${name}放下手中的事，认真想了想...`,
    `${name}一边${character.activity}一边思考...`,
  ] : [];
  const moodMap = {
    '愉快': [`${name}笑了笑，正组织语言...`, `${name}开心地想着怎么回答...`],
    '严肃': [`${name}皱眉沉思着...`, `${name}认真地斟酌用词...`],
    '好奇': [`${name}眼睛一亮，正在想...`, `${name}饶有兴趣地思考着...`],
    '专注': [`${name}抬起头来思考...`, `${name}暂停手头工作，认真想...`],
    '平静': [`${name}平静地想了想...`, `${name}不紧不慢地思考着...`],
    '警觉': [`${name}警惕地环顾四周后思考...`],
    '热情': [`${name}热情地想着怎么回复你...`],
    '悠闲': [`${name}悠闲地想了想...`],
    '疲惫': [`${name}揉了揉眼睛，努力思考...`],
    '忧虑': [`${name}叹了口气，想着怎么说...`],
  };
  const moodTips = moodMap[character.mood] || [];
  const all = [...baseTips, ...activityTips, ...moodTips];
  return all[Math.floor(Math.random() * all.length)];
}

/* ================================================================
   Document Chunking for Long Document Processing
   ================================================================ */

function splitDocIntoChunks(text, chunkSize = DOC_CHUNK_SIZE, overlap = DOC_CHUNK_OVERLAP) {
  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const paragraphs = text.split(/\n+/).filter(p => p.trim());
  const chunks = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length + 1 > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      const sentences = currentChunk.split(/(?<=[。！？；.!?\n])/);
      let overlapBuf = sentences.slice(-3).join('');
      if (overlapBuf.length > overlap) overlapBuf = overlapBuf.slice(-overlap);
      currentChunk = overlapBuf + '\n' + trimmed;
    } else {
      currentChunk = currentChunk ? currentChunk + '\n' + trimmed : trimmed;
    }

    if (currentChunk.length > chunkSize * 1.5) {
      const sentences = currentChunk.split(/(?<=[。！？；.!?])/);
      let buf = '';
      for (const s of sentences) {
        if (buf.length + s.length > chunkSize && buf.length > 0) {
          chunks.push(buf);
          const tailSentences = buf.split(/(?<=[。！？；.!?\n])/);
          let overlapBuf = tailSentences.slice(-3).join('');
          if (overlapBuf.length > overlap) overlapBuf = overlapBuf.slice(-overlap);
          buf = overlapBuf + s;
        } else {
          buf += s;
        }
      }
      currentChunk = buf;
    }
  }
  if (currentChunk.trim()) chunks.push(currentChunk);
  return chunks;
}

/* ================================================================
   Adaptive Ring Spacing
   ================================================================ */

function computeAdaptiveRingParams(nodeCount) {
  // Adaptively scale ring gap and spacing based on node count
  // More nodes → larger gap and spacing to prevent crowding
  if (nodeCount <= 6) return { ringGap: RING_GAP_BASE, ringMinSpacing: RING_MIN_SPACING_BASE };
  if (nodeCount <= 15) return { ringGap: RING_GAP_BASE + 10, ringMinSpacing: RING_MIN_SPACING_BASE + 5 };
  if (nodeCount <= 30) return { ringGap: RING_GAP_BASE + 20, ringMinSpacing: RING_MIN_SPACING_BASE + 10 };
  if (nodeCount <= 60) return { ringGap: RING_GAP_BASE + 30, ringMinSpacing: RING_MIN_SPACING_BASE + 15 };
  // Large graphs: scale linearly
  const extra = Math.min(60, Math.floor(nodeCount / 5));
  return { ringGap: RING_GAP_BASE + extra, ringMinSpacing: RING_MIN_SPACING_BASE + Math.floor(extra * 0.6) };
}

function isEdgeFiltered(edgeVisibility) {
  // Returns true if user has toggled specific edge types (not all visible)
  const keys = Object.keys(DEFAULT_EDGE_VISIBILITY);
  const visibleCount = keys.filter(k => edgeVisibility[k] !== false).length;
  return visibleCount > 0 && visibleCount < keys.length;
}

/* ================================================================
   Force-Directed Graph Layout (with temporal constraint)
   ================================================================ */

function stepForceLayout(positions, events, edges, width, height, useForceDirected) {
  const k = 80;
  const repulsion = useForceDirected ? FORCE_DIRECTED_REPULSION : 5000;
  const damping = 0.85;
  const dt = 0.3;

  // Use more square virtual bounds instead of long horizontal strip
  const totalNodes = events.length;
  const gridDim = Math.ceil(Math.sqrt(totalNodes));
  const virtualW = Math.max(width, gridDim * 120 + 200);
  const virtualH = Math.max(height, gridDim * 120 + 200);

  const ids = Object.keys(positions).filter(id => !id.startsWith('_'));

  // Build cluster centers based on time point (day + timeOfDay) — ring arrangement
  const timeGroups = {};
  events.forEach(ev => {
    const timeKey = `${ev.day || 0}_${ev.timeOfDay || '白天'}`;
    if (!timeGroups[timeKey]) timeGroups[timeKey] = [];
    timeGroups[timeKey].push(ev.id);
  });
  const timeKeys = Object.keys(timeGroups).sort((a, b) => {
    const [dayA, todA] = a.split('_');
    const [dayB, todB] = b.split('_');
    const timeOrder = { '清晨': 0, '白天': 1, '夜晚': 2 };
    return (Number(dayA) * 3 + (timeOrder[todA] || 0)) - (Number(dayB) * 3 + (timeOrder[todB] || 0));
  });
  const clusterCenters = {};
  const cx = virtualW / 2, cy = virtualH / 2;
  const clusterRadius = Math.min(virtualW, virtualH) * 0.3;
  timeKeys.forEach((timeKey, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, timeKeys.length);
    clusterCenters[timeKey] = {
      x: cx + Math.cos(angle) * clusterRadius,
      y: cy + Math.sin(angle) * clusterRadius,
    };
  });

  // Repulsion between all pairs (reduced when both nodes are on concentric rings)
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]], b = positions[ids[j]];
      if (a.fixed && b.fixed) continue;
      let dx = a.x - b.x, dy = a.y - b.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const effectiveRepulsion = (!useForceDirected && a.onRing && b.onRing) ? repulsion * RING_REPULSION_FACTOR : repulsion;
      const force = effectiveRepulsion / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.fixed) { a.vx += fx * dt; a.vy += fy * dt; }
      if (!b.fixed) { b.vx -= fx * dt; b.vy -= fy * dt; }
    }
  }

  // Attraction along edges (stronger in force-directed mode for better clustering)
  const edgeStrength = useForceDirected ? 0.12 : 0.05;
  edges.forEach(e => {
    const a = positions[e.from], b = positions[e.to];
    if (!a || !b) return;
    if (a.fixed && b.fixed) return;
    let dx = b.x - a.x, dy = b.y - a.y;
    let dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const force = (dist - k) * edgeStrength;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.fixed) { a.vx += fx * dt; a.vy += fy * dt; }
    if (!b.fixed) { b.vx -= fx * dt; b.vy -= fy * dt; }
  });

  // Cluster gravity / spiral attraction
  const eventTimeKeyMap = {};
  events.forEach(ev => { eventTimeKeyMap[ev.id] = `${ev.day || 0}_${ev.timeOfDay || '白天'}`; });
  ids.forEach(id => {
    const p = positions[id];
    if (p.fixed) return;
    // Spiral target attraction (timeline mode): stronger pull toward spiral position
    if (p.spiralTarget) {
      p.vx += (p.spiralTarget.x - p.x) * SPIRAL_ATTRACTION_STRENGTH;
      p.vy += (p.spiralTarget.y - p.y) * SPIRAL_ATTRACTION_STRENGTH;
      return;
    }
    // Ring radial attraction: pull toward assigned ring radius (not a specific point)
    if (p.ringRadius != null && p.ringCenter) {
      const dx = p.x - p.ringCenter.x;
      const dy = p.y - p.ringCenter.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const diff = dist - p.ringRadius;
      p.vx -= (dx / dist) * diff * RING_RADIAL_STRENGTH;
      p.vy -= (dy / dist) * diff * RING_RADIAL_STRENGTH;
      return;
    }
    // Normal cluster gravity
    const timeKey = eventTimeKeyMap[id];
    const center = clusterCenters[timeKey];
    if (center) {
      p.vx += (center.x - p.x) * 0.008;
      p.vy += (center.y - p.y) * 0.008;
    }
  });

  // Global center gravity (stronger in force-directed mode to keep graph compact)
  const centerGravity = useForceDirected ? 0.005 : 0.001;
  ids.forEach(id => {
    const p = positions[id];
    if (p.fixed) return;
    p.vx += (cx - p.x) * centerGravity;
    p.vy += (cy - p.y) * centerGravity;
  });

  // Apply velocity + damping
  let totalEnergy = 0;
  ids.forEach(id => {
    const p = positions[id];
    if (p.fixed) { p.vx = 0; p.vy = 0; return; }
    p.vx *= damping;
    p.vy *= damping;
    p.x += p.vx;
    p.y += p.vy;
    totalEnergy += p.vx * p.vx + p.vy * p.vy;
  });

  return totalEnergy < FORCE_LAYOUT_CONVERGENCE_THRESHOLD;
}

/* ================================================================
   Build Edges for Graph
   ================================================================ */

function buildEdges(events) {
  const edges = [];
  const eventMap = {};
  events.forEach(e => { eventMap[e.id] = e; });

  for (let i = 1; i < events.length; i++) {
    edges.push({ from: events[i - 1].id, to: events[i].id, type: 'time' });
  }

  const charEvents = {};
  events.forEach(e => {
    if (e.character) {
      if (charEvents[e.character]) {
        edges.push({ from: charEvents[e.character], to: e.id, type: 'character' });
      }
      charEvents[e.character] = e.id;
    }
  });

  events.forEach(e => {
    if (e.causes && e.causes.length > 0) {
      e.causes.forEach(causeId => {
        if (eventMap[causeId]) {
          edges.push({ from: causeId, to: e.id, type: 'causes' });
        }
      });
    }
  });

  // relates_to edges: same location AND sharing at least one character or within the same day
  // Only link events that have a meaningful contextual relationship beyond just location
  const locationLatest = {};
  const connectedPairs = new Set();
  edges.forEach(ed => {
    connectedPairs.add(`${ed.from}|${ed.to}`);
    connectedPairs.add(`${ed.to}|${ed.from}`);
  });
  events.forEach(e => {
    if (e.location && e.location !== '未知') {
      const prev = locationLatest[e.location];
      if (prev && prev !== e.id) {
        const prevEvent = eventMap[prev];
        // Only link if they share a character, are on the same day, or have overlapping effects
        const sameChar = e.character && prevEvent.character && e.character === prevEvent.character;
        const sameDay = e.day != null && prevEvent.day != null && e.day === prevEvent.day;
        const hasCausalLink = e.causes && e.causes.includes(prev);
        if ((sameChar || sameDay) && !hasCausalLink) {
          if (!connectedPairs.has(`${prev}|${e.id}`)) {
            edges.push({ from: prev, to: e.id, type: 'relates_to' });
            connectedPairs.add(`${prev}|${e.id}`);
            connectedPairs.add(`${e.id}|${prev}`);
          }
        }
      }
      locationLatest[e.location] = e.id;
    }
  });

  // Emotion edges: link social events that share a character or location (meaningful emotional link)
  const socialEvents = events.filter(e => e.type === 'social');
  for (let i = 1; i < socialEvents.length; i++) {
    const prev = socialEvents[i - 1], curr = socialEvents[i];
    const shareChar = prev.character && curr.character && prev.character === curr.character;
    const shareLoc = prev.location && curr.location && prev.location === curr.location && prev.location !== '未知';
    if (shareChar || shareLoc) {
      const pair = `${prev.id}|${curr.id}`;
      if (!connectedPairs.has(pair)) {
        edges.push({ from: prev.id, to: curr.id, type: 'emotion' });
        connectedPairs.add(pair);
        connectedPairs.add(`${curr.id}|${prev.id}`);
      }
    }
  }

  // Conflict edges: link conflict events that share a character or location (actual confrontation)
  const conflictEvents = events.filter(e => e.type === 'conflict');
  for (let i = 1; i < conflictEvents.length; i++) {
    const prev = conflictEvents[i - 1], curr = conflictEvents[i];
    const shareChar = prev.character && curr.character && prev.character === curr.character;
    const shareLoc = prev.location && curr.location && prev.location === curr.location && prev.location !== '未知';
    if (shareChar || shareLoc) {
      const pair = `${prev.id}|${curr.id}`;
      if (!connectedPairs.has(pair)) {
        edges.push({ from: prev.id, to: curr.id, type: 'conflict' });
        connectedPairs.add(pair);
        connectedPairs.add(`${curr.id}|${prev.id}`);
      }
    }
  }

  // Cooperation edges: link trade events that share a character or location (actual partnership)
  const tradeEvents = events.filter(e => e.type === 'trade');
  for (let i = 1; i < tradeEvents.length; i++) {
    const prev = tradeEvents[i - 1], curr = tradeEvents[i];
    const shareChar = prev.character && curr.character && prev.character === curr.character;
    const shareLoc = prev.location && curr.location && prev.location === curr.location && prev.location !== '未知';
    if (shareChar || shareLoc) {
      const pair = `${prev.id}|${curr.id}`;
      if (!connectedPairs.has(pair)) {
        edges.push({ from: prev.id, to: curr.id, type: 'cooperation' });
        connectedPairs.add(pair);
        connectedPairs.add(`${curr.id}|${prev.id}`);
      }
    }
  }

  return edges;
}

/* ================================================================
   Draw Arrow Head
   ================================================================ */

function drawArrowHead(ctx, fromX, fromY, toX, toY, size) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - size * Math.cos(angle - 0.4), toY - size * Math.sin(angle - 0.4));
  ctx.lineTo(toX - size * Math.cos(angle + 0.4), toY - size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

/* ================================================================
   Draw small arrow at a specific point along a direction
   ================================================================ */

function drawMidArrow(ctx, x, y, angle, size) {
  ctx.beginPath();
  ctx.moveTo(x + size * Math.cos(angle), y + size * Math.sin(angle));
  ctx.lineTo(x - size * Math.cos(angle - 0.5), y - size * Math.sin(angle - 0.5));
  ctx.lineTo(x - size * Math.cos(angle + 0.5), y - size * Math.sin(angle + 0.5));
  ctx.closePath();
  ctx.fill();
}

/* ================================================================
   Point-to-line-segment distance (for edge hover detection)
   ================================================================ */

function pointToSegmentDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx, projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

/* ================================================================
   Point-to-quadratic-bezier distance (for curved edge detection)
   Sample the bezier at N points and return the min distance.
   ================================================================ */

function pointToBezierDist(px, py, x1, y1, cpx, cpy, x2, y2) {
  let minDist = Infinity;
  const SAMPLES = 20;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const mt = 1 - t;
    const bx = mt * mt * x1 + 2 * mt * t * cpx + t * t * x2;
    const by = mt * mt * y1 + 2 * mt * t * cpy + t * t * y2;
    const d = Math.sqrt((px - bx) ** 2 + (py - by) ** 2);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/* ================================================================
   Assign curve indices to edges sharing the same node pair
   ================================================================ */

function assignCurveIndices(edges) {
  const pairCount = {};
  const pairIndex = {};
  edges.forEach(edge => {
    const pairKey = [edge.from, edge.to].sort().join('|');
    pairCount[pairKey] = (pairCount[pairKey] || 0) + 1;
  });
  edges.forEach(edge => {
    const pairKey = [edge.from, edge.to].sort().join('|');
    if (!pairIndex[pairKey]) pairIndex[pairKey] = 0;
    edge._curveIdx = pairIndex[pairKey]++;
    edge._curveTotal = pairCount[pairKey];
  });
}

/* ================================================================
   Compute edge distance accounting for curve offset
   ================================================================ */

function edgeDistToPoint(px, py, fromPos, toPos, edge) {
  const total = edge._curveTotal || 1;
  const idx = edge._curveIdx || 0;

  if (total > 1) {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const curveOffset = (idx - (total - 1) / 2) * 30;
    const cpx = (fromPos.x + toPos.x) / 2 + nx * curveOffset;
    const cpy = (fromPos.y + toPos.y) / 2 + ny * curveOffset;
    return pointToBezierDist(px, py, fromPos.x, fromPos.y, cpx, cpy, toPos.x, toPos.y);
  }
  return pointToSegmentDist(px, py, fromPos.x, fromPos.y, toPos.x, toPos.y);
}

/* ================================================================
   GraphRAG Context Builder
   ================================================================ */

function buildGraphRAGContext(events, recentCount = 5) {
  if (events.length === 0) return '';
  const edges = buildEdges(events);
  const eventMap = {};
  events.forEach(e => { eventMap[e.id] = e; });

  // Pre-build indexes for O(1) lookups
  const charIndex = {};  // character -> [event]
  const locIndex = {};   // location -> [event]
  events.forEach(e => {
    if (e.character) {
      if (!charIndex[e.character]) charIndex[e.character] = [];
      charIndex[e.character].push(e);
    }
    if (e.location && e.location !== '未知') {
      if (!locIndex[e.location]) locIndex[e.location] = [];
      locIndex[e.location].push(e);
    }
  });

  // Pre-build edge adjacency for O(1) neighbor lookup
  const adjMap = {};
  edges.forEach(edge => {
    if (!adjMap[edge.from]) adjMap[edge.from] = new Set();
    if (!adjMap[edge.to]) adjMap[edge.to] = new Set();
    adjMap[edge.from].add(edge.to);
    adjMap[edge.to].add(edge.from);
  });

  const recentEvents = events.slice(-recentCount);
  const lines = ['--- GraphRAG 关联分析 ---'];

  recentEvents.forEach(re => {
    const related = [];

    // Find causal ancestors (depth up to 3)
    const causalChain = [];
    const causalIds = new Set();
    let current = re;
    let depth = 0;
    while (current && current.causes && current.causes.length > 0 && depth < 3) {
      const causeId = current.causes[0];
      const causeEvent = eventMap[causeId];
      if (causeEvent) {
        causalChain.push(causeEvent);
        causalIds.add(causeEvent.id);
        current = causeEvent;
      } else break;
      depth++;
    }
    if (causalChain.length > 0) {
      related.push(`因果链: ${causalChain.map(e => `[${e.id}]${e.text}`).join(' → ')}`);
    }

    // Find same-character events using pre-built index
    if (re.character && charIndex[re.character]) {
      const charEvents = charIndex[re.character].filter(e => e.id !== re.id).slice(-3);
      if (charEvents.length > 0) {
        related.push(`${re.character}的近期经历: ${charEvents.map(e => `[${e.id}]${e.text}`).join('; ')}`);
      }
    }

    // Find same-location events using pre-built index
    if (re.location && re.location !== '未知' && locIndex[re.location]) {
      const locEvents = locIndex[re.location].filter(e => e.id !== re.id).slice(-2);
      if (locEvents.length > 0) {
        related.push(`${re.location}的历史: ${locEvents.map(e => `[${e.id}]${e.text}`).join('; ')}`);
      }
    }

    // Find connected events via pre-built adjacency map
    const neighbors = adjMap[re.id];
    if (neighbors && neighbors.size > 0) {
      const connectedEvents = [...neighbors]
        .filter(id => id !== re.id)
        .map(id => eventMap[id])
        .filter(Boolean)
        .slice(0, 3);
      if (connectedEvents.length > 0) {
        const notAlreadyMentioned = connectedEvents.filter(e => !causalIds.has(e.id));
        if (notAlreadyMentioned.length > 0) {
          related.push(`关联事件: ${notAlreadyMentioned.map(e => `[${e.id}]${e.text}`).join('; ')}`);
        }
      }
    }

    if (related.length > 0) {
      lines.push(`\n[${re.id}] ${re.text}:`);
      related.forEach(r => lines.push(`  ${r}`));
    }
  });

  return lines.length > 1 ? lines.join('\n') : '';
}

/* ================================================================
   System Prompt Builder
   ================================================================ */

function buildSystemPrompt(worldSummary, contextLayers, events, characters, worldState, eventSeed, day, timeOfDay, graphRAGContext) {
  let contextBlock = '';

  if (contextLayers.length > 0) {
    contextBlock += '历史摘要（早期事件概括）：\n';
    contextLayers.forEach((layer, i) => {
      contextBlock += `[第${i + 1}批] ${layer}\n`;
    });
    contextBlock += '\n';
  }

  const recentEvents = events.slice(-CONTEXT_BATCH_SIZE);
  if (recentEvents.length > 0) {
    contextBlock += '最近事件详情：\n';
    recentEvents.forEach(e => {
      contextBlock += `- [${e.id}] ${e.text} (类型:${e.type}, 地点:${e.location || '未知'}, 影响:${e.impact || 'low'})\n`;
    });
    contextBlock += '\n';
  }

  contextBlock += '当前角色状态：\n';
  characters.forEach(c => {
    contextBlock += `- ${c.name}: ${c.activity} (心情:${c.mood}, 位置:${c.location || '未知'})\n`;
  });

  contextBlock += `\n世界状态：天气=${worldState.weather}, 季节=${worldState.season}, 经济=${worldState.economy}, 时间=${worldState.time_of_day}, 民众情绪=${worldState.population_mood}, 当前是第${day}天(${timeOfDay})\n`;

  const trimmedSeed = eventSeed ? eventSeed.trim() : '';
  if (trimmedSeed) {
    contextBlock += `\n用户设定的事件种子/触发条件：${trimmedSeed}\n`;
  }

  if (graphRAGContext) {
    contextBlock += '\n' + graphRAGContext + '\n';
  }

  return `你是一个世界模拟器。你负责推进一个虚拟小镇的世界发展。

当前世界状态摘要：
${worldSummary}

${contextBlock}

已有事件的ID：${events.map(e => e.id).join(', ')}。新事件的causes字段应引用上述ID。

规则：
1. 根据当前世界状态和历史事件，生成1-2个新事件
2. 更新角色的活动、心情和位置。你也可以引入新角色——如果故事发展需要，在characters中添加新角色（必须包含name、activity、mood、location、relationships字段和一个emoji字段）
3. 事件类型：environment(环境), character(角色), social(社交), conflict(冲突), discovery(发现), trade(交易)
4. 每个事件要有明确的因果关系（causes引用之前的事件ID）。causes必须引用逻辑上真正导致该事件发生的先前事件，不要随意引用无关事件
5. 事件要有地点信息和影响程度
6. 更新世界状态（天气、经济、时间等可能变化）
7. 角色之间的关系必须使用以下标准分类之一：${Object.keys(RELATIONSHIP_TYPES).join('、')}。relationships格式为{"角色名": "关系类型:补充说明"}，例如{"铁匠": "贸易:工具供应商", "镇长": "友好:老朋友"}
8. 时间段对事件的影响规则：
   - 清晨：适合环境变化、日常准备、发现类事件
   - 白天：适合交易、社交、冲突、角色互动事件
   - 夜晚：适合社交聚会、秘密行动、冲突酝酿、情感事件
   当前时间是${timeOfDay}，请生成与该时段氛围一致的事件。
9. 关系逻辑要求（非常重要）：
   - social类型事件必须涉及至少一个已有角色的社交互动，character字段必须填写参与社交的角色名
   - conflict类型事件必须描述具体的对抗双方和冲突原因，character字段填写冲突的发起方
   - trade类型事件必须描述具体的交易双方和交易内容，character字段填写交易的发起方
   - 同一地点发生的事件应当有合理的关联（同一角色、因果关系等），不要在无关事件之间仅因地点相同而建立联系
   - 每个事件的character字段非常重要，它用于建立事件间的关联，请确保填写准确的角色名而非null

请严格用以下JSON格式回复（不要添加其他内容）：
{
  "events": [{"text": "事件描述", "type": "事件类型", "character": "相关角色名或null", "location": "事件发生地点", "impact": "low|medium|high", "causes": ["被哪些之前事件ID触发"], "effects": ["对世界的影响描述"]}],
  "characters": [{"name": "角色名", "activity": "当前活动", "mood": "心情", "emoji": "表情符号", "location": "当前位置", "relationships": {"其他角色名": "关系类型:补充说明"}}],
  "world": {"weather": "天气", "season": "季节", "economy": "经济状况", "time_of_day": "时间段", "population_mood": "整体民众情绪"},
  "summary": "用2-3句话总结当前世界状态"
}`;
}

/* ================================================================
   Context: WorldSimulatorContext
   ================================================================ */

const WorldSimulatorContext = createContext(null);

/* ================================================================
   Provider: WorldSimulatorProvider
   ================================================================ */

function WorldSimulatorProvider({ settings, children }) {
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [characters, setCharacters] = useState(INITIAL_CHARACTERS);
  const [worldSummary, setWorldSummary] = useState('一个宁静的小镇，面包师在烤面包，一位旅行者刚到达，镇长在广场发布公告。铁匠在铸造，农夫在浇灌作物。');
  const [isRunning, setIsRunning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [log, setLog] = useState([]);
  const [autoMode, setAutoMode] = useState(false);
  const [worldState, setWorldState] = useState(INITIAL_WORLD_STATE);
  const [contextLayers, setContextLayers] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [eventSeed, setEventSeed] = useState('');
  const [edgeVisibility, setEdgeVisibility] = useState(DEFAULT_EDGE_VISIBILITY);
  // When true, all edges are hidden and the annual ring timeline is displayed
  const [timelineMode, setTimelineMode] = useState(false);
  // Spiral year-ring spacing multiplier (1 = tight/min, 5 = very spread out)
  const [ringSpacing, setRingSpacing] = useState(1);
  const [chatTarget, setChatTarget] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatting, setIsChatting] = useState(false);
  // Chat buffer tip state
  const [chatBufferTip, setChatBufferTip] = useState('');
  // World generation seed for LLM-based random world creation
  const [worldSeed, setWorldSeed] = useState('');
  const [isGeneratingWorld, setIsGeneratingWorld] = useState(false);
  // Document event graph extraction state
  const [docTitle, setDocTitle] = useState('');
  const [docText, setDocText] = useState('');
  const [docChunks, setDocChunks] = useState([]);
  const [isAnalyzingDoc, setIsAnalyzingDoc] = useState(false);
  const [docAnalysisProgress, setDocAnalysisProgress] = useState({ current: 0, total: 0 });
  const [docChunkSize, setDocChunkSize] = useState(DOC_CHUNK_SIZE);
  const [docChunkOverlap, setDocChunkOverlap] = useState(DOC_CHUNK_OVERLAP);
  const abortRef = useRef(null);
  const eventIdCounter = useRef(INITIAL_EVENTS.length);
  // genHistory stores a snapshot for each generation, enabling step-by-step replay
  const genHistoryRef = useRef([]);

  /* --- Hierarchical Context Condensing --- */
  const condenseOldEvents = useCallback((currentEvents) => {
    if (currentEvents.length > CONTEXT_BATCH_SIZE) {
      const oldEvents = currentEvents.slice(0, currentEvents.length - CONTEXT_BATCH_SIZE);
      const newLayers = [];
      for (let i = 0; i < oldEvents.length; i += CONTEXT_BATCH_SIZE) {
        const batch = oldEvents.slice(i, i + CONTEXT_BATCH_SIZE);
        const summary = batch.map(e => e.text).join('；') + '。';
        newLayers.push(summary);
      }
      setContextLayers(newLayers);
    }
  }, []);

  /* --- Run One Step --- */
  const runStep = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);

    try {
      const day = Math.floor(generation / 3) + 1;
      const timePhase = generation % 3;
      const timeOfDay = ['清晨', '白天', '夜晚'][timePhase];
      const graphRAGContext = buildGraphRAGContext(events, 5);
      const systemPrompt = buildSystemPrompt(worldSummary, contextLayers, events, characters, worldState, eventSeed, day, timeOfDay, graphRAGContext);
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请推进世界发展，生成下一步事件。' },
      ];

      const controller = new AbortController();
      abortRef.current = controller;

      let fullContent = '';
      const result = await sendChatRequest(messages, settings, (chunk) => {
        if (chunk) fullContent += chunk;
      }, controller.signal);

      const content = stripThinkTags(result?.content || fullContent);
      if (!content) {
        setLog(prev => [`[Gen ${generation + 1}] 无响应`, ...prev].slice(0, 50));
        return;
      }

      let data;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        data = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        setLog(prev => [`[Gen ${generation + 1}] JSON解析失败`, ...prev].slice(0, 50));
        return;
      }

      if (!data) return;

      if (data.events && Array.isArray(data.events)) {
        const newEvents = data.events.map(e => ({
          id: `e${eventIdCounter.current++}`,
          text: e.text || '',
          type: e.type || 'environment',
          character: e.character || null,
          location: e.location || '未知',
          impact: e.impact || 'low',
          causes: Array.isArray(e.causes) ? e.causes : [],
          effects: Array.isArray(e.effects) ? e.effects : [],
          timeOfDay: timeOfDay,
          day: day,
        }));

        setEvents(prev => {
          const updated = [...prev, ...newEvents].slice(-MAX_EVENTS);
          condenseOldEvents(updated);
          return updated;
        });

        newEvents.forEach(e => {
          setLog(prev => [`[Gen ${generation + 1}] ${e.text}`, ...prev].slice(0, 50));
        });
      }

      if (data.characters && Array.isArray(data.characters)) {
        setCharacters(prev => {
          const charMap = {};
          prev.forEach(c => { charMap[c.name] = c; });
          data.characters.forEach(c => {
            if (charMap[c.name]) {
              // Update existing character
              charMap[c.name] = {
                ...charMap[c.name],
                activity: c.activity || charMap[c.name].activity,
                mood: c.mood || charMap[c.name].mood,
                location: c.location || charMap[c.name].location,
                relationships: c.relationships || charMap[c.name].relationships,
              };
              if (c.emoji) charMap[c.name].emoji = c.emoji;
            } else if (c.name) {
              // Add new character introduced by the model
              charMap[c.name] = {
                name: c.name,
                activity: c.activity || '刚刚到来',
                mood: c.mood || '未知',
                emoji: c.emoji || NEW_CHARACTER_EMOJIS[Object.keys(charMap).length % NEW_CHARACTER_EMOJIS.length],
                location: c.location || '未知',
                relationships: c.relationships || {},
              };
            }
          });
          return Object.values(charMap);
        });
      }

      if (data.world) {
        setWorldState(prev => ({
          weather: data.world.weather || prev.weather,
          season: data.world.season || prev.season,
          economy: data.world.economy || prev.economy,
          time_of_day: data.world.time_of_day || prev.time_of_day,
          population_mood: data.world.population_mood || prev.population_mood,
        }));
      }

      if (data.summary) {
        setWorldSummary(data.summary);
      }

      setGeneration(prev => prev + 1);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLog(prev => [`[错误] ${err.message}`, ...prev].slice(0, 50));
      }
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, worldSummary, contextLayers, events, characters, worldState, settings, generation, condenseOldEvents, eventSeed]);

  /* --- Auto Mode --- */
  useEffect(() => {
    if (!autoMode || isRunning) return;
    const timer = setTimeout(runStep, 2500);
    return () => clearTimeout(timer);
  }, [autoMode, isRunning, runStep]);

  /* --- Auto-capture gen snapshot whenever generation changes --- */
  useEffect(() => {
    if (generation === 0 && events === INITIAL_EVENTS) return;
    const snapshot = {
      events: [...events],
      characters: [...characters],
      worldSummary,
      generation,
      worldState: { ...worldState },
      contextLayers: [...contextLayers],
      eventIdCounter: eventIdCounter.current,
      eventSeed,
    };
    const hist = genHistoryRef.current;
    // Overwrite if same gen already exists (e.g., after load), or append
    const existIdx = hist.findIndex(s => s.generation === generation);
    if (existIdx >= 0) {
      hist[existIdx] = snapshot;
    } else {
      hist.push(snapshot);
      hist.sort((a, b) => a.generation - b.generation);
    }
  }, [generation, events, characters, worldSummary, worldState, contextLayers, eventSeed]);

  /* --- Reset --- */
  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setEvents(INITIAL_EVENTS);
    setCharacters(INITIAL_CHARACTERS);
    setWorldSummary('一个宁静的小镇，面包师在烤面包，一位旅行者刚到达，镇长在广场发布公告。铁匠在铸造，农夫在浇灌作物。');
    setIsRunning(false);
    setGeneration(0);
    setLog([]);
    setAutoMode(false);
    setWorldState(INITIAL_WORLD_STATE);
    setContextLayers([]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setEventSeed('');
    setEdgeVisibility(DEFAULT_EDGE_VISIBILITY);
    setTimelineMode(false);
    setChatBufferTip('');
    eventIdCounter.current = INITIAL_EVENTS.length;
    genHistoryRef.current = [];
  }, []);

  /* --- Save (includes full gen history for step-by-step replay) --- */
  const saveSimulation = useCallback(() => {
    try {
      const saveData = {
        events,
        characters,
        worldSummary,
        generation,
        worldState,
        contextLayers,
        eventIdCounter: eventIdCounter.current,
        eventSeed,
        timestamp: Date.now(),
        name: new Date().toLocaleString(),
        genHistory: [...genHistoryRef.current],
      };
      const existing = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '[]');
      existing.push(saveData);
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(existing));
      setLog(prev => [`[系统] 存档成功: ${saveData.name} (含 ${saveData.genHistory.length} 步历史)`, ...prev].slice(0, 50));
    } catch {
      setLog(prev => ['[错误] 存档失败', ...prev].slice(0, 50));
    }
  }, [events, characters, worldSummary, generation, worldState, contextLayers, eventSeed]);

  /* --- Load --- */
  const loadSimulation = useCallback((index) => {
    try {
      const saves = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '[]');
      const save = saves[index];
      if (!save) return;
      if (abortRef.current) abortRef.current.abort();
      setEvents(save.events || INITIAL_EVENTS);
      setCharacters(save.characters || INITIAL_CHARACTERS);
      setWorldSummary(save.worldSummary || '');
      setGeneration(save.generation || 0);
      setWorldState(save.worldState || INITIAL_WORLD_STATE);
      setContextLayers(save.contextLayers || []);
      setEventSeed(save.eventSeed || '');
      eventIdCounter.current = save.eventIdCounter || save.events.length;
      // Restore gen history if available
      genHistoryRef.current = Array.isArray(save.genHistory) ? [...save.genHistory] : [];
      setIsRunning(false);
      setAutoMode(false);
      setSelectedNode(null);
      setSelectedEdge(null);
      setLog(prev => [`[系统] 已加载存档: ${save.name}`, ...prev].slice(0, 50));
    } catch {
      setLog(prev => ['[错误] 加载存档失败', ...prev].slice(0, 50));
    }
  }, []);

  /* --- Load a specific gen from a save's history --- */
  const loadGenFromSave = useCallback((saveIndex, targetGen) => {
    try {
      const saves = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '[]');
      const save = saves[saveIndex];
      if (!save || !Array.isArray(save.genHistory)) return;
      const snapshot = save.genHistory.find(s => s.generation === targetGen);
      if (!snapshot) return;
      if (abortRef.current) abortRef.current.abort();
      setEvents(snapshot.events || INITIAL_EVENTS);
      setCharacters(snapshot.characters || INITIAL_CHARACTERS);
      setWorldSummary(snapshot.worldSummary || '');
      setGeneration(snapshot.generation || 0);
      setWorldState(snapshot.worldState || INITIAL_WORLD_STATE);
      setContextLayers(snapshot.contextLayers || []);
      setEventSeed(snapshot.eventSeed || '');
      eventIdCounter.current = snapshot.eventIdCounter || snapshot.events.length;
      genHistoryRef.current = Array.isArray(save.genHistory) ? [...save.genHistory] : [];
      setIsRunning(false);
      setAutoMode(false);
      setSelectedNode(null);
      setSelectedEdge(null);
      setLog(prev => [`[系统] 已跳转到 Gen ${targetGen}`, ...prev].slice(0, 50));
    } catch {
      setLog(prev => ['[错误] 加载指定迭代失败', ...prev].slice(0, 50));
    }
  }, []);

  /* --- Get saved list --- */
  const getSavedList = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }, []);

  /* --- Delete save --- */
  const deleteSave = useCallback((index) => {
    try {
      const saves = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '[]');
      saves.splice(index, 1);
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(saves));
      setLog(prev => ['[系统] 存档已删除', ...prev].slice(0, 50));
    } catch {
      setLog(prev => ['[错误] 删除存档失败', ...prev].slice(0, 50));
    }
  }, []);

  /* --- Character Management --- */
  const addCharacter = useCallback((char) => {
    if (!char || !char.name || !char.name.trim()) return;
    const trimmedName = char.name.trim();
    setCharacters(prev => {
      if (prev.some(c => c.name === trimmedName)) return prev;
      const newChar = {
        name: trimmedName,
        activity: char.activity || '刚刚到来',
        mood: char.mood || '平静',
        emoji: char.emoji || NEW_CHARACTER_EMOJIS[prev.length % NEW_CHARACTER_EMOJIS.length],
        location: char.location || '未知',
        relationships: char.relationships || {},
      };
      return [...prev, newChar];
    });
    setLog(p => [`[系统] 新增角色: ${char.emoji || '🧑'} ${trimmedName}`, ...p].slice(0, 50));
  }, []);

  const editCharacter = useCallback((name, updates) => {
    if (!name) return;
    setCharacters(prev => prev.map(c => {
      if (c.name !== name) return c;
      const updated = { ...c };
      if (updates.activity !== undefined) updated.activity = updates.activity;
      if (updates.mood !== undefined) updated.mood = updates.mood;
      if (updates.emoji !== undefined) updated.emoji = updates.emoji;
      if (updates.location !== undefined) updated.location = updates.location;
      if (updates.relationships !== undefined) updated.relationships = updates.relationships;
      return updated;
    }));
    setLog(prev => [`[系统] 已编辑角色: ${name}`, ...prev].slice(0, 50));
  }, []);

  const deleteCharacter = useCallback((name) => {
    if (!name) return;
    setCharacters(prev => prev.filter(c => c.name !== name));
    setLog(prev => [`[系统] 已删除角色: ${name}`, ...prev].slice(0, 50));
  }, []);

  /* --- Generate Random World --- */
  const generateRandomWorld = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    const template = RANDOM_WORLD_TEMPLATES[Math.floor(Math.random() * RANDOM_WORLD_TEMPLATES.length)];
    
    // Generate relationships between characters
    const relTypes = Object.keys(RELATIONSHIP_TYPES);
    const chars = template.characters.map((c, i) => {
      const relationships = {};
      template.characters.forEach((other, j) => {
        if (i !== j && Math.random() > 0.5) {
          const relType = relTypes[Math.floor(Math.random() * relTypes.length)];
          relationships[other.name] = relType;
        }
      });
      return { ...c, relationships };
    });

    // Generate events with proper IDs
    const newEvents = template.events.map((e, i) => ({
      id: `e${i}`,
      text: e.text,
      type: e.type,
      character: chars[i % chars.length]?.name || null,
      location: e.location,
      impact: e.impact,
      causes: i > 0 ? [`e${Math.floor(Math.random() * i)}`] : [],
      effects: [],
      timeOfDay: '清晨',
      day: 1,
    }));

    setEvents(newEvents);
    setCharacters(chars);
    setWorldSummary(template.summary);
    setGeneration(0);
    setWorldState({
      weather: template.weather || '晴朗',
      season: template.season || '春天',
      economy: '稳定',
      time_of_day: '白天',
      population_mood: '平和',
    });
    setIsRunning(false);
    setAutoMode(false);
    setLog([`[系统] 随机生成了「${template.name}」世界`]);
    setContextLayers([]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setEventSeed('');
    setEdgeVisibility(DEFAULT_EDGE_VISIBILITY);
    setTimelineMode(false);
    eventIdCounter.current = newEvents.length;
    genHistoryRef.current = [];
  }, []);

  /* --- Import from Knowledge Graph (MultiAgentSimulator) --- */
  const importFromKnowledgeGraph = useCallback((data) => {
    if (abortRef.current) abortRef.current.abort();

    const { characters: kgChars = [], relationships: kgRels = [], events: kgEvents = [], title = '' } = data;
    if (kgChars.length === 0) return;

    // Build relationship map from kgRels: {charName: {otherChar: "type:desc"}}
    const relMap = {};
    kgRels.forEach(r => {
      if (!relMap[r.from]) relMap[r.from] = {};
      if (!relMap[r.to]) relMap[r.to] = {};
      const desc = r.description ? `${r.type}:${r.description}` : r.type;
      relMap[r.from][r.to] = desc;
      relMap[r.to][r.from] = desc;
    });

    // Convert characters to WorldSimulator format
    const wsChars = kgChars.map(c => ({
      name: c.name,
      activity: c.activity || c.motivation || '活动中',
      mood: c.mood || '平静',
      emoji: c.emoji || '👤',
      location: c.location || '未知',
      relationships: relMap[c.name] || {},
    }));

    // Convert events to WorldSimulator format
    const wsEvents = kgEvents.map((e, i) => ({
      id: `e${i}`,
      text: e.description || e.text || '',
      type: 'character',
      character: (e.participants && e.participants[0]) || null,
      location: '未知',
      impact: e.impact ? (e.impact.length > 5 ? 'medium' : e.impact) : 'low',
      causes: i > 0 ? [`e${Math.max(0, i - 1)}`] : [],
      effects: [],
      timeOfDay: '清晨',
      day: 1,
    }));

    // Use at least initial events if none provided
    const finalEvents = wsEvents.length > 0 ? wsEvents : INITIAL_EVENTS;

    setEvents(finalEvents);
    setCharacters(wsChars);
    setWorldSummary(title ? `基于文档「${title}」的知识图谱导入的世界。包含 ${wsChars.length} 个角色和 ${wsEvents.length} 个事件。` : `知识图谱导入的世界，包含 ${wsChars.length} 个角色和 ${wsEvents.length} 个事件。`);
    setGeneration(0);
    setWorldState({
      weather: '晴朗',
      season: '春天',
      economy: '稳定',
      time_of_day: '白天',
      population_mood: '平和',
    });
    setIsRunning(false);
    setAutoMode(false);
    setLog([`[系统] 从文档知识图谱导入了 ${wsChars.length} 个角色、${wsEvents.length} 个事件`]);
    setContextLayers([]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setEventSeed('');
    setEdgeVisibility(DEFAULT_EDGE_VISIBILITY);
    setTimelineMode(false);
    eventIdCounter.current = finalEvents.length;
    genHistoryRef.current = [];
  }, []);

  /* --- Document Upload --- */
  const uploadDocument = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target.result;
      let text = new TextDecoder('utf-8').decode(buffer);
      let encoding = 'UTF-8';

      if (text.includes('\uFFFD')) {
        try {
          text = new TextDecoder('gbk').decode(buffer);
          encoding = 'GBK';
        } catch {
          /* GBK decoder not available, keep UTF-8 */
        }
      }

      if (!text || !text.trim()) {
        setLog(prev => ['[错误] 文件内容为空', ...prev].slice(0, 50));
        return;
      }
      const title = file.name.replace(/\.[^.]+$/, '') || '未命名文档';
      setDocTitle(title);
      setDocText(text);
      const chunks = splitDocIntoChunks(text, docChunkSize, docChunkOverlap);
      setDocChunks(chunks);
      setDocAnalysisProgress({ current: 0, total: 0 });

      setLog(prev => [
        `[文档] 已加载「${title}」(${encoding})，共${text.length}字，分为${chunks.length}个片段`,
        ...prev,
      ].slice(0, 50));
    };
    reader.onerror = () => {
      setLog(prev => ['[错误] 文件读取失败', ...prev].slice(0, 50));
    };
    reader.readAsArrayBuffer(file);
  }, [docChunkSize, docChunkOverlap]);

  /* --- Re-chunk document when settings change --- */
  const rechunkDocument = useCallback(() => {
    if (!docText) return;
    const chunks = splitDocIntoChunks(docText, docChunkSize, docChunkOverlap);
    setDocChunks(chunks);
    setLog(prev => [`[文档] 重新分段: ${chunks.length}个片段 (大小:${docChunkSize}, 重叠:${docChunkOverlap})`, ...prev].slice(0, 50));
  }, [docText, docChunkSize, docChunkOverlap]);

  /* --- Analyze Document into Event Graph --- */
  const analyzeDocumentAsEventGraph = useCallback(async () => {
    if (isAnalyzingDoc || docChunks.length === 0) return;
    setIsAnalyzingDoc(true);
    setDocAnalysisProgress({ current: 0, total: docChunks.length });

    const controller = new AbortController();
    abortRef.current = controller;

    const analysisSettings = { ...settings };
    if (analysisSettings.maxTokens < 2000) analysisSettings.maxTokens = 2000;

    /* Local accumulators – state is updated incrementally after every chunk */
    let currentGeneration = 0;
    let currentEventIdCounter = 0;
    const accumulatedEvents = [];
    const accumulatedCharacters = [];

    /* Reset world to a clean slate before starting */
    setEvents([]);
    setCharacters([]);
    setGeneration(0);
    setWorldState({ weather: '晴朗', season: '春天', economy: '稳定', time_of_day: '白天', population_mood: '平和' });
    setAutoMode(false);
    setContextLayers([]);
    setSelectedNode(null);
    setSelectedEdge(null);
    setEventSeed('');
    setEdgeVisibility(DEFAULT_EDGE_VISIBILITY);
    setTimelineMode(false);
    eventIdCounter.current = 0;
    genHistoryRef.current = [];
    setWorldSummary(`正在分析文档「${docTitle}」...`);

    try {
      for (let i = 0; i < docChunks.length; i++) {
        if (controller.signal.aborted) break;
        setDocAnalysisProgress({ current: i + 1, total: docChunks.length });

        /* ---- Time flows with each chunk/generation ---- */
        const day = Math.floor(currentGeneration / 3) + 1;
        const timePhase = currentGeneration % 3;
        const timeOfDay = ['清晨', '白天', '夜晚'][timePhase];

        /* ---- Build context from the existing timeline ---- */
        const recentEvents = accumulatedEvents.slice(-10);
        const knownContext = recentEvents.length > 0
          ? `\n【当前时间线事件】(共${accumulatedEvents.length}个，最近${recentEvents.length}个)\n` +
            recentEvents.map(e =>
              `- [${e.id}] ${e.text} (类型:${e.type}, 角色:${e.character || '无'}, 地点:${e.location}, 第${e.day}天${e.timeOfDay})`
            ).join('\n') +
            (accumulatedCharacters.length > 0
              ? `\n【已发现的角色】${accumulatedCharacters.map(c => `${c.name}(${c.emoji})`).join('、')}`
              : '')
          : '';

        const existingEventIds = recentEvents.map(e => e.id);
        const causesHint = existingEventIds.length > 0
          ? `\n6. causes字段填写导致该事件的前置事件ID列表，只能使用以下已有事件ID：${existingEventIds.join(', ')}。没有前因的事件causes填空数组[]`
          : '';

        const prompt = `你是一个专业的文本分析专家。请阅读以下小说/文档片段，基于当前时间线的已有事件，提取新的关键事件并建立因果关系。当前是第${day}天(${timeOfDay})。${knownContext}

【文档片段 ${i + 1}/${docChunks.length}】
${docChunks[i]}

请严格按照以下JSON格式回复，不要输出任何其他内容：
{
  "events": [
    {
      "text": "事件的详细描述（50字以内）",
      "type": "事件类型：environment(环境变化)/character(角色行为)/social(社交互动)/conflict(冲突对抗)/discovery(发现探索)/trade(交易经济) 之一",
      "character": "该事件的主要相关角色姓名，无则填null",
      "location": "事件发生的地点",
      "impact": "low(日常事件)/medium(重要事件)/high(关键转折) 之一",
      "causes": ["导致此事件的前置事件ID列表，可以引用已有事件ID"],
      "effects": ["此事件造成的影响或后果（每条20字以内）"]
    }
  ],
  "characters": [
    {
      "name": "角色姓名（使用原文中的称呼）",
      "emoji": "一个代表该角色特征的emoji",
      "activity": "该角色在此片段中的主要行为（15字以内）",
      "mood": "该角色的主要情绪",
      "location": "该角色所在位置",
      "relationships": {"其他角色名": "关系类型:说明"}
    }
  ]
}

注意：
1. 重点提取事件及其因果关系，新事件应与之前的时间线事件保持连贯
2. 事件类型要准确分类
3. 关系类型使用：友好、敌对、中立、亲属、师徒、同盟、竞争、恋人、主仆 之一
4. 如果片段中有明确的时间线索，请在事件描述中体现
5. 每个事件都需要causes字段来建立与已有时间线的因果关系${causesHint}`;

        let fullContent = '';
        const result = await sendChatRequest(
          [
            { role: 'system', content: '你是一个专业的事件图谱分析专家。请只输出JSON格式的分析结果。基于已有的时间线事件和新的文档片段，生成新的事件节点并建立因果关系链。' },
            { role: 'user', content: prompt },
          ],
          analysisSettings,
          (chunk) => { if (chunk) fullContent += chunk; },
          controller.signal,
        );

        const content = stripThinkTags(result?.content || fullContent);
        let parsed;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        } catch { parsed = null; }

        if (parsed) {
          /* ---- Process events from this chunk ---- */
          if (Array.isArray(parsed.events)) {
            const chunkStart = accumulatedEvents.length;
            const existingIds = new Set(accumulatedEvents.map(e => e.id));
            parsed.events.forEach(e => {
              const newEvent = {
                id: `e${currentEventIdCounter++}`,
                text: e.text || '',
                type: e.type || 'environment',
                character: e.character || null,
                location: e.location || '未知',
                impact: e.impact || 'low',
                causes: Array.isArray(e.causes) ? e.causes.filter(id => existingIds.has(id)) : [],
                effects: Array.isArray(e.effects) ? e.effects : [],
                timeOfDay,
                day,
              };
              accumulatedEvents.push(newEvent);
              existingIds.add(newEvent.id);
            });

            /* Fallback causal links for events without explicit causes */
            for (let k = chunkStart; k < accumulatedEvents.length; k++) {
              const evt = accumulatedEvents[k];
              if (evt.causes.length === 0 && k > 0) {
                if (evt.character) {
                  for (let j = k - 1; j >= Math.max(0, k - DOC_CAUSAL_LOOKBACK); j--) {
                    if (accumulatedEvents[j].character === evt.character) {
                      evt.causes = [accumulatedEvents[j].id];
                      break;
                    }
                  }
                }
                if (evt.causes.length === 0) {
                  evt.causes = [accumulatedEvents[k - 1].id];
                }
              }
            }
          }

          /* ---- Process characters from this chunk ---- */
          if (Array.isArray(parsed.characters)) {
            parsed.characters.forEach(c => {
              if (!c.name) return;
              const name = c.name.trim();
              const existing = accumulatedCharacters.find(ch => ch.name === name);
              if (existing) {
                if (c.activity) existing.activity = c.activity;
                if (c.mood) existing.mood = c.mood;
                if (c.emoji) existing.emoji = c.emoji;
                if (c.location) existing.location = c.location;
                if (c.relationships) existing.relationships = { ...existing.relationships, ...c.relationships };
              } else {
                accumulatedCharacters.push({
                  name,
                  emoji: c.emoji || '🧑',
                  activity: c.activity || '活动中',
                  mood: c.mood || '平静',
                  location: c.location || '未知',
                  relationships: c.relationships || {},
                });
              }
            });
          }

          /* ===== Immediately apply this generation to state ===== */
          if (accumulatedEvents.length > MAX_EVENTS) {
            accumulatedEvents.splice(0, accumulatedEvents.length - MAX_EVENTS);
          }
          setEvents([...accumulatedEvents]);
          setCharacters([...accumulatedCharacters]);
          eventIdCounter.current = currentEventIdCounter;
          currentGeneration++;
          setGeneration(currentGeneration);
          setWorldSummary(
            `基于文档「${docTitle}」提取事件中… (${i + 1}/${docChunks.length}) 已提取${accumulatedEvents.length}个事件、${accumulatedCharacters.length}个角色。`
          );
        }

        setLog(prev => [
          `[文档分析] 片段 ${i + 1}/${docChunks.length} → Gen${currentGeneration - 1}，提取${parsed?.events?.length || 0}个事件 (第${day}天${timeOfDay})`,
          ...prev,
        ].slice(0, 50));
      }

      if (controller.signal.aborted) {
        setLog(prev => ['[文档分析] 已中止', ...prev].slice(0, 50));
        setIsAnalyzingDoc(false);
        return;
      }

      /* ---- Final summary after all chunks processed ---- */
      if (accumulatedEvents.length === 0) {
        setEvents(INITIAL_EVENTS);
        setCharacters(INITIAL_CHARACTERS);
        eventIdCounter.current = INITIAL_EVENTS.length;
      }
      setWorldSummary(
        `基于文档「${docTitle}」提取的事件图谱。共${accumulatedEvents.length}个事件、${accumulatedCharacters.length}个角色。可继续推演。`
      );
      setLog(prev => [
        `[文档分析] 完成！共${accumulatedEvents.length}个事件、${accumulatedCharacters.length}个角色，可点击推演继续发展`,
        ...prev,
      ].slice(0, 50));
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLog(prev => [`[错误] 文档分析失败: ${err.message}`, ...prev].slice(0, 50));
      }
    } finally {
      setIsAnalyzingDoc(false);
    }
  }, [isAnalyzingDoc, docChunks, docTitle, settings]);

  /* --- Stop Document Analysis --- */
  const stopDocAnalysis = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setIsAnalyzingDoc(false);
    setLog(prev => ['[文档分析] 用户中止分析', ...prev].slice(0, 50));
  }, []);

  /* --- Generate Random World via LLM --- */
  const generateRandomWorldByLLM = useCallback(async () => {
    if (isGeneratingWorld) return;
    setIsGeneratingWorld(true);

    // Generate or use provided seed
    const seed = worldSeed.trim() || `seed-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const systemPrompt = `你是一个创意世界构建大师。请根据以下种子创建一个独特的虚拟世界。

种子: "${seed}"

请根据种子的含义或暗示，创造一个有趣且独特的世界。如果种子是数字或随机字符串，请自由发挥想象力创建世界。

请严格用以下JSON格式回复（不要添加其他内容）：
{
  "name": "世界名称",
  "summary": "用2-3句话描述这个世界的背景和氛围",
  "locations": ["地点1", "地点2", "地点3", "地点4", "地点5", "地点6"],
  "characters": [
    {"name": "角色名", "activity": "当前活动", "mood": "心情", "emoji": "一个emoji表情", "location": "所在地点"},
    {"name": "角色名", "activity": "当前活动", "mood": "心情", "emoji": "一个emoji表情", "location": "所在地点"},
    {"name": "角色名", "activity": "当前活动", "mood": "心情", "emoji": "一个emoji表情", "location": "所在地点"},
    {"name": "角色名", "activity": "当前活动", "mood": "心情", "emoji": "一个emoji表情", "location": "所在地点"}
  ],
  "events": [
    {"text": "事件描述", "type": "事件类型(environment/character/social/conflict/discovery/trade)", "location": "地点", "impact": "low/medium/high"},
    {"text": "事件描述", "type": "事件类型", "location": "地点", "impact": "low/medium/high"},
    {"text": "事件描述", "type": "事件类型", "location": "地点", "impact": "low/medium/high"},
    {"text": "事件描述", "type": "事件类型", "location": "地点", "impact": "low/medium/high"}
  ],
  "weather": "天气状况",
  "season": "季节",
  "relationships": {"角色A-角色B": "关系类型:描述", "角色C-角色D": "关系类型:描述"}
}

注意：
- 角色之间要有合理的关系网络
- 事件要与世界背景和角色相关
- 关系类型必须是以下之一：${Object.keys(RELATIONSHIP_TYPES).join('、')}`;

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `请基于种子"${seed}"创建一个独特的世界。` },
      ];

      let fullContent = '';
      const result = await sendChatRequest(messages, settings, (chunk) => {
        if (chunk) fullContent += chunk;
      }, controller.signal);

      const content = stripThinkTags(result?.content || fullContent);
      if (!content) {
        setLog(prev => ['[错误] LLM无响应，使用模板生成', ...prev].slice(0, 50));
        generateRandomWorld();
        return;
      }

      let data;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        data = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        setLog(prev => ['[错误] JSON解析失败，使用模板生成', ...prev].slice(0, 50));
        generateRandomWorld();
        return;
      }

      if (!data || !data.characters || !data.events) {
        setLog(prev => ['[错误] 返回数据不完整，使用模板生成', ...prev].slice(0, 50));
        generateRandomWorld();
        return;
      }

      // Build characters with relationships
      const relTypes = Object.keys(RELATIONSHIP_TYPES);
      const chars = (data.characters || []).map((c, i) => {
        const relationships = {};
        // Apply relationships from LLM response
        if (data.relationships) {
          Object.entries(data.relationships).forEach(([key, val]) => {
            const parts = key.split('-');
            if (parts[0] === c.name && data.characters.some(ch => ch.name === parts[1])) {
              relationships[parts[1]] = val;
            } else if (parts[1] === c.name && data.characters.some(ch => ch.name === parts[0])) {
              relationships[parts[0]] = val;
            }
          });
        }
        // Add random relationships for unconnected characters
        data.characters.forEach((other, j) => {
          if (i !== j && !relationships[other.name] && Math.random() > 0.6) {
            const relType = relTypes[Math.floor(Math.random() * relTypes.length)];
            relationships[other.name] = relType;
          }
        });
        return {
          name: c.name || `角色${i + 1}`,
          activity: c.activity || '观察',
          mood: c.mood || '平静',
          emoji: c.emoji || '👤',
          location: c.location || '未知',
          relationships,
        };
      });

      // Build events
      const newEvents = (data.events || []).map((e, i) => ({
        id: `e${i}`,
        text: e.text || '',
        type: e.type || 'environment',
        character: chars[i % chars.length]?.name || null,
        location: e.location || '未知',
        impact: e.impact || 'low',
        causes: i > 0 ? [`e${Math.floor(Math.random() * i)}`] : [],
        effects: [],
        timeOfDay: '清晨',
        day: 1,
      }));

      setEvents(newEvents);
      setCharacters(chars);
      setWorldSummary(data.summary || `由种子"${seed}"生成的世界`);
      setGeneration(0);
      setWorldState({
        weather: data.weather || '晴朗',
        season: data.season || '春天',
        economy: '稳定',
        time_of_day: '白天',
        population_mood: '平和',
      });
      setIsRunning(false);
      setAutoMode(false);
      setLog([`[系统] LLM创建了「${data.name || '随机世界'}」(种子: ${seed})`]);
      setContextLayers([]);
      setSelectedNode(null);
      setSelectedEdge(null);
      setEventSeed('');
      setEdgeVisibility(DEFAULT_EDGE_VISIBILITY);
      setTimelineMode(false);
      eventIdCounter.current = newEvents.length;
      genHistoryRef.current = [];
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLog(prev => [`[错误] LLM生成失败: ${err.message}，使用模板生成`, ...prev].slice(0, 50));
        generateRandomWorld();
      }
    } finally {
      setIsGeneratingWorld(false);
    }
  }, [isGeneratingWorld, worldSeed, settings, generateRandomWorld]);

  /* --- Chat with Character --- */
  const chatWithCharacter = useCallback(async (characterName, userMessage) => {
    if (isChatting || !characterName || !userMessage.trim()) return;
    setIsChatting(true);
    
    const character = characters.find(c => c.name === characterName);
    if (!character) { setIsChatting(false); return; }
    
    const tip = generateChatBufferTip(character);
    setChatBufferTip(tip);
    
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    
    const recentEvts = events.slice(-5);
    const charEvents = events.filter(e => e.character === characterName).slice(-3);
    
    const relDesc = character.relationships ? 
      Object.entries(character.relationships).map(([name, rel]) => `${name}: ${rel}`).join(', ') : '无';
    
    const sysPrompt = `你是"${character.name}"${character.emoji}，正在与来访者对话。请完全代入角色，直接用角色的口吻回复。

【角色档案】
姓名: ${character.name}
当前活动: ${character.activity}
心情: ${character.mood}
所在位置: ${character.location || '未知'}
人际关系: ${relDesc}

【世界背景】
${worldSummary}
当前状况: ${worldState.weather}，${worldState.season}，经济${worldState.economy}，${worldState.time_of_day}
${charEvents.length > 0 ? '\n【你的近期经历】\n' + charEvents.map(e => `- ${e.text}`).join('\n') : ''}
${recentEvts.length > 0 ? '\n【小镇近况】\n' + recentEvts.map(e => `- ${e.text}`).join('\n') : ''}

【回复要求】
- 以${character.name}的第一人称视角回答，语气符合当前心情（${character.mood}）
- 回答自然口语化，1-3句话，像日常闲聊一样
- 可以主动提及你知道的人和事，展现角色的社交圈
- 绝对不要暴露你是AI，不要输出JSON或任何格式化内容
- 直接输出对话内容，不要包含任何内心思考、分析推理或思维过程`;

    try {
      const controller = new AbortController();
      const messages = [
        { role: 'system', content: sysPrompt },
        ...chatMessages.slice(-10).map(m => ({
          role: m.role,
          content: m.content,
        })),
        { role: 'user', content: userMessage },
      ];
      
      let fullContent = '';
      const result = await sendChatRequest(messages, settings, (chunk) => {
        if (chunk) fullContent += chunk;
      }, controller.signal);
      
      const raw = stripThinkTags(result?.content || fullContent);
      const reply = raw || '...';
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `[错误: ${err.message}]` }]);
    } finally {
      setIsChatting(false);
      setChatBufferTip('');
    }
  }, [isChatting, characters, events, worldSummary, worldState, settings, chatMessages]);

  const day = Math.floor(generation / 3) + 1;
  const timePhase = generation % 3;
  const timeOfDay = ['清晨', '白天', '夜晚'][timePhase];

  const value = useMemo(() => ({
    events, characters, worldSummary, isRunning, generation, log, autoMode,
    worldState, contextLayers, selectedNode, selectedEdge, eventSeed,
    edgeVisibility, day, timeOfDay, timelineMode,
    setAutoMode, setSelectedNode, setSelectedEdge, setEventSeed, setEdgeVisibility, setTimelineMode,
    ringSpacing, setRingSpacing,
    runStep, reset, settings,
    saveSimulation, loadSimulation, getSavedList, deleteSave, loadGenFromSave,
    addCharacter, editCharacter, deleteCharacter,
    chatTarget, setChatTarget, chatMessages, setChatMessages, isChatting, chatWithCharacter,
    chatBufferTip,
    generateRandomWorld, generateRandomWorldByLLM, importFromKnowledgeGraph,
    worldSeed, setWorldSeed, isGeneratingWorld,
    docTitle, docText, docChunks, isAnalyzingDoc, docAnalysisProgress,
    docChunkSize, setDocChunkSize, docChunkOverlap, setDocChunkOverlap,
    uploadDocument, rechunkDocument, analyzeDocumentAsEventGraph, stopDocAnalysis,
  }), [events, characters, worldSummary, isRunning, generation, log, autoMode,
       worldState, contextLayers, selectedNode, selectedEdge, eventSeed,
       edgeVisibility, day, timeOfDay, timelineMode, ringSpacing,
       runStep, reset, settings,
       saveSimulation, loadSimulation, getSavedList, deleteSave, loadGenFromSave,
       addCharacter, editCharacter, deleteCharacter,
       chatTarget, chatMessages, isChatting, chatWithCharacter,
       chatBufferTip,
       generateRandomWorld, generateRandomWorldByLLM, importFromKnowledgeGraph,
       worldSeed, isGeneratingWorld,
       docTitle, docText, docChunks, isAnalyzingDoc, docAnalysisProgress,
       docChunkSize, docChunkOverlap,
       uploadDocument, rechunkDocument, analyzeDocumentAsEventGraph, stopDocAnalysis]);

  return (
    <WorldSimulatorContext.Provider value={value}>
      {children}
    </WorldSimulatorContext.Provider>
  );
}

/* ================================================================
   Canvas Component: WorldSimulatorCanvas
   ================================================================ */

const WorldSimulatorCanvas = memo(function WorldSimulatorCanvas() {
  const ctx = useContext(WorldSimulatorContext);
  const { events, selectedNode, setSelectedNode, selectedEdge, setSelectedEdge, worldState, characters, generation, worldSummary, day, timeOfDay, edgeVisibility, timelineMode, ringSpacing } = ctx;

  const graphCanvasRef = useRef(null);
  const graphPosRef = useRef({});
  const graphTransformRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragStateRef = useRef({ type: null, nodeId: null, lastX: 0, lastY: 0 });
  const hoveredEdgeRef = useRef(null);
  const hoveredLegendRef = useRef(null);
  const legendRectsRef = useRef([]);
  const animRef = useRef(null);

  /* ---- Graph View Rendering ---- */
  const drawGraph = useCallback(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;

    // Sync canvas pixel dimensions with CSS display size every frame to prevent
    // deformation when the container is resized (e.g. via a draggable divider).
    const parent = canvas.parentElement;
    if (parent) {
      const dw = parent.clientWidth;
      const dh = parent.clientHeight || 420;
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw;
        canvas.height = dh;
      }
    }

    const c = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);

    const t = graphTransformRef.current;

    // Background
    c.fillStyle = '#0a0e17';
    c.fillRect(0, 0, W, H);

    // Grid (transformed)
    c.save();
    c.strokeStyle = 'rgba(100,120,160,0.07)';
    c.lineWidth = 1;
    const gridSize = 30 * t.scale;
    const startX = t.offsetX % gridSize;
    const startY = t.offsetY % gridSize;
    for (let x = startX; x < W; x += gridSize) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = startY; y < H; y += gridSize) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.restore();

    const visibleEvents = events.slice(-MAX_GRAPH_NODES);
    if (visibleEvents.length === 0) return;

    // Compute expanded virtual dimensions using square layout for clusters
    const gridDim = Math.ceil(Math.sqrt(visibleEvents.length));
    const virtualW = Math.max(W, gridDim * 120 + 200);
    const virtualH = Math.max(H, gridDim * 120 + 200);

    // Initialize or update positions (in world space, before transform)
    const pos = graphPosRef.current;
    const existingIds = new Set(Object.keys(pos));
    const neededIds = new Set(visibleEvents.map(e => e.id));

    existingIds.forEach(id => { if (!neededIds.has(id)) delete pos[id]; });

    // Recover from corrupted (NaN) positions so nodes can be re-initialized below
    neededIds.forEach(id => {
      const p = pos[id];
      if (p && (isNaN(p.x) || isNaN(p.y))) delete pos[id];
    });

    // Time-based initial positions: place events in circular groups by time point
    const timeGroupMap = {};
    visibleEvents.forEach((ev, i) => {
      const timeKey = `${ev.day || 0}_${ev.timeOfDay || '白天'}`;
      if (!timeGroupMap[timeKey]) timeGroupMap[timeKey] = [];
      timeGroupMap[timeKey].push({ ev, i });
    });
    const timeKeysList = Object.keys(timeGroupMap).sort((a, b) => {
      const [dayA, todA] = a.split('_');
      const [dayB, todB] = b.split('_');
      const timeOrder = { '清晨': 0, '白天': 1, '夜晚': 2 };
      return (Number(dayA) * 3 + (timeOrder[todA] || 0)) - (Number(dayB) * 3 + (timeOrder[todB] || 0));
    });
    const clusterR = Math.min(virtualW, virtualH) * 0.3;
    const centerX = virtualW / 2, centerY = virtualH / 2;

    // Spiral helper: compute point on Archimedean spiral at parameter t in [0, 1]
    // ringSpacing (1-5) controls gap between spiral arms: higher = wider spacing
    const totalKeys = Math.max(1, timeKeysList.length);
    const effectiveItemsPerTurn = ITEMS_PER_SPIRAL_TURN * ringSpacing;
    const spiralTurns = Math.max(2, totalKeys / effectiveItemsPerTurn);
    const spiralTotalAngle = 2 * Math.PI * spiralTurns;
    const spiralMinR = SPIRAL_INNER_RADIUS;
    const spiralMaxR = clusterR * (1 + (ringSpacing - 1) * 0.5);
    const getSpiralPoint = (tParam) => {
      const angle = tParam * spiralTotalAngle;
      const r = spiralMinR + (spiralMaxR - spiralMinR) * tParam;
      return {
        x: centerX + Math.cos(angle) * r,
        y: centerY + Math.sin(angle) * r,
        angle, r,
      };
    };

    if (timelineMode) {
      // Spiral layout: nodes attracted to spiral positions (elastic, not fixed)
      delete graphPosRef.current._ringRadii;
      delete graphPosRef.current._ringCenter;
      visibleEvents.forEach((ev) => {
        const timeKey = `${ev.day || 0}_${ev.timeOfDay || '白天'}`;
        const timeIdx = timeKeysList.indexOf(timeKey);
        const groupItems = timeGroupMap[timeKey];
        const itemIdx = groupItems.findIndex(g => g.ev.id === ev.id);
        const n = Math.max(1, groupItems.length);
        const tParam = (timeIdx + (itemIdx + 0.5) / n) / totalKeys;
        const sp = getSpiralPoint(tParam);
        if (!pos[ev.id]) {
          pos[ev.id] = {
            x: sp.x + (Math.random() - 0.5) * INITIAL_POSITION_JITTER,
            y: sp.y + (Math.random() - 0.5) * INITIAL_POSITION_JITTER,
            vx: 0, vy: 0, fixed: false,
          };
        }
        pos[ev.id].spiralTarget = { x: sp.x, y: sp.y };
        delete pos[ev.id].onRing;
        delete pos[ev.id].ringRadius;
        delete pos[ev.id].ringCenter;
      });
    } else {
      const filtered = isEdgeFiltered(edgeVisibility);
      if (filtered) {
        // Force-directed layout when user is filtering specific edge types
        // Remove ring constraints so nodes spread based on visible edges
        delete graphPosRef.current._ringRadii;
        delete graphPosRef.current._ringCenter;
        visibleEvents.forEach((ev) => {
          if (!pos[ev.id]) {
            // Spread initial positions around center with jitter
            const angle = Math.random() * 2 * Math.PI;
            const r = 80 + Math.random() * clusterR * 0.8;
            pos[ev.id] = {
              x: centerX + Math.cos(angle) * r,
              y: centerY + Math.sin(angle) * r,
              vx: 0, vy: 0, fixed: false,
            };
          }
          delete pos[ev.id].onRing;
          delete pos[ev.id].ringRadius;
          delete pos[ev.id].ringCenter;
          delete pos[ev.id].spiralTarget;
        });
      } else {
        // Concentric ring layout when all edges visible (default view)
        // Use adaptive spacing to prevent node crowding
        const nodeCount = visibleEvents.length;
        const { ringGap, ringMinSpacing } = computeAdaptiveRingParams(nodeCount);
        const ringRadii = [];
        const nodeRingInfo = []; // { radius, angle } per node
        let placed = 0;
        let ringIdx = 0;
        while (placed < nodeCount) {
          const radius = RING_BASE_RADIUS + ringIdx * ringGap;
          const circumference = 2 * Math.PI * radius;
          const capacity = Math.max(1, Math.floor(circumference / ringMinSpacing));
          const nodesOnRing = Math.min(capacity, nodeCount - placed);
          ringRadii.push(radius);
          for (let i = 0; i < nodesOnRing; i++) {
            // Clockwise from top: start at -π/2, evenly spaced
            const angle = -Math.PI / 2 + (2 * Math.PI * i / nodesOnRing);
            nodeRingInfo.push({ radius, angle });
          }
          placed += nodesOnRing;
          ringIdx++;
        }
        graphPosRef.current._ringRadii = ringRadii;
        graphPosRef.current._ringCenter = { x: centerX, y: centerY };

        visibleEvents.forEach((ev, idx) => {
          const info = nodeRingInfo[idx];
          if (!pos[ev.id]) {
            // Place new nodes at symmetric clockwise positions on their ring
            pos[ev.id] = {
              x: centerX + Math.cos(info.angle) * info.radius,
              y: centerY + Math.sin(info.angle) * info.radius,
              vx: 0, vy: 0, fixed: false,
            };
          }
          pos[ev.id].ringRadius = info.radius;
          pos[ev.id].ringCenter = { x: centerX, y: centerY };
          pos[ev.id].onRing = true;
          delete pos[ev.id].spiralTarget;
        });
      }
    }

    const allEdges = buildEdges(visibleEvents);

    // In timeline mode, hide all edges; otherwise filter by user visibility settings
    const edges = timelineMode ? [] : allEdges.filter(e => edgeVisibility[e.type] !== false);
    const useForceDirected = !timelineMode && isEdgeFiltered(edgeVisibility);

    // Step force layout in both modes (timeline uses spiral attraction, normal uses edge springs)
    for (let i = 0; i < 3; i++) {
      if (stepForceLayout(pos, visibleEvents, edges, virtualW, virtualH, useForceDirected)) break;
    }

    // Helper: transform world coords to screen coords
    const toScreen = (wx, wy) => ({
      x: wx * t.scale + t.offsetX,
      y: wy * t.scale + t.offsetY,
    });

    // Draw spiral timeline (螺旋年轮时间线) — only shown in timeline mode
    if (timelineMode && timeKeysList.length > 0) {
      // Draw spiral curve as a continuous path
      const spiralSteps = SPIRAL_RENDER_STEPS;
      c.beginPath();
      for (let si = 0; si <= spiralSteps; si++) {
        const tParam = si / spiralSteps;
        const pt = getSpiralPoint(tParam);
        const sp = toScreen(pt.x, pt.y);
        if (si === 0) c.moveTo(sp.x, sp.y);
        else c.lineTo(sp.x, sp.y);
      }
      c.strokeStyle = 'rgba(140,150,160,0.25)';
      c.lineWidth = 1.5 * t.scale;
      c.stroke();

      // Draw time period labels along the spiral
      for (let ri = 0; ri < totalKeys; ri++) {
        const timeKey = timeKeysList[ri];
        const [d, tod] = timeKey.split('_');
        const ringColor = TIME_RING_COLORS[tod] || '#707a88';
        const tParam = ri / totalKeys;
        const pt = getSpiralPoint(tParam);
        const sp = toScreen(pt.x, pt.y);

        // Small tick mark on spiral
        const tickLen = 6 * t.scale;
        const perpAngle = pt.angle + Math.PI / 2;
        c.beginPath();
        c.moveTo(sp.x - Math.cos(perpAngle) * tickLen, sp.y - Math.sin(perpAngle) * tickLen);
        c.lineTo(sp.x + Math.cos(perpAngle) * tickLen, sp.y + Math.sin(perpAngle) * tickLen);
        c.strokeStyle = ringColor;
        c.globalAlpha = 0.5;
        c.lineWidth = 1.5 * t.scale;
        c.stroke();
        c.globalAlpha = 1.0;

        // Time label
        const ringLabel = `第${d}天 ${tod}`;
        c.font = `${Math.max(7, 9 * t.scale)}px sans-serif`;
        const labelW = c.measureText(ringLabel).width + 8;
        const labelOffset = tickLen + 4 * t.scale;
        const lx = sp.x + Math.cos(perpAngle) * labelOffset;
        const ly = sp.y + Math.sin(perpAngle) * labelOffset;
        c.fillStyle = 'rgba(10,14,23,0.75)';
        c.beginPath();
        c.roundRect(lx - labelW / 2, ly - 8 * t.scale, labelW, 14 * t.scale, 3);
        c.fill();
        c.strokeStyle = ringColor;
        c.globalAlpha = 0.45;
        c.lineWidth = 1;
        c.stroke();
        c.globalAlpha = 1.0;
        c.fillStyle = ringColor;
        c.textAlign = 'center';
        c.fillText(ringLabel, lx, ly + 3 * t.scale);
      }
    }

    // Concentric ring background lines hidden per user request

    // Draw edges - count edges between same node pairs for curve offset
    assignCurveIndices(edges);

    edges.forEach(edge => {
      const from = pos[edge.from], to = pos[edge.to];
      if (!from || !to) return;

      const sf = toScreen(from.x, from.y);
      const st = toScreen(to.x, to.y);

      const style = EDGE_STYLES[edge.type] || EDGE_STYLES.time;
      const isHovered = hoveredEdgeRef.current &&
        hoveredEdgeRef.current.from === edge.from &&
        hoveredEdgeRef.current.to === edge.to &&
        hoveredEdgeRef.current.type === edge.type;

      c.strokeStyle = isHovered ? '#fff' : style.color;
      c.lineWidth = (isHovered ? style.width + 1.5 : style.width) * Math.min(t.scale, 1.5);
      c.setLineDash(style.dash);

      // Compute curve offset for overlapping edges
      const total = edge._curveTotal;
      const idx = edge._curveIdx;
      const useCurve = total > 1;

      let midX, midY, cpx, cpy;

      if (useCurve) {
        // Perpendicular offset for curve control point
        const dx = st.x - sf.x;
        const dy = st.y - sf.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const curveOffset = (idx - (total - 1) / 2) * 30 * t.scale;
        cpx = (sf.x + st.x) / 2 + nx * curveOffset;
        cpy = (sf.y + st.y) / 2 + ny * curveOffset;
        // Midpoint on quadratic bezier at t=0.5
        midX = 0.25 * sf.x + 0.5 * cpx + 0.25 * st.x;
        midY = 0.25 * sf.y + 0.5 * cpy + 0.25 * st.y;

        c.beginPath();
        c.moveTo(sf.x, sf.y);
        c.quadraticCurveTo(cpx, cpy, st.x, st.y);
        c.stroke();
      } else {
        midX = (sf.x + st.x) / 2;
        midY = (sf.y + st.y) / 2;

        c.beginPath();
        c.moveTo(sf.x, sf.y);
        c.lineTo(st.x, st.y);
        c.stroke();
      }

      // Arrow at endpoint for causal edges, mid-arrow for all types
      c.setLineDash([]);
      c.fillStyle = isHovered ? '#fff' : style.color;
      if (edge.type === 'causes') {
        drawArrowHead(c, sf.x, sf.y, st.x, st.y, 8 * t.scale);
      }
      // Draw a small directional arrow at the midpoint
      const dirAngle = Math.atan2(st.y - sf.y, st.x - sf.x);
      drawMidArrow(c, midX, midY, dirAngle, 5 * Math.min(t.scale, 1.5));

      // Edge label (offset from midpoint to avoid overlap with arrow)
      c.fillStyle = isHovered ? '#fff' : 'rgba(200,200,200,0.7)';
      c.font = `${Math.max(7, 9 * t.scale)}px sans-serif`;
      c.textAlign = 'center';
      if (isHovered) {
        c.fillText(style.label, midX, midY - 8 * t.scale);
      }
    });
    c.setLineDash([]);

    // Draw nodes
    visibleEvents.forEach(ev => {
      const p = pos[ev.id];
      if (!p) return;

      const sp = toScreen(p.x, p.y);
      const r = (ev.impact === 'high' ? 14 : ev.impact === 'medium' ? 11 : 8) * t.scale;
      const color = EVENT_COLORS[ev.type] || '#888';
      const isSelected = selectedNode && selectedNode.id === ev.id;

      // Time-of-day indicator ring
      if (ev.timeOfDay) {
        const ringColor = TIME_RING_COLORS[ev.timeOfDay] || '#888';
        c.beginPath();
        c.arc(sp.x, sp.y, r + 3 * t.scale, 0, Math.PI * 2);
        c.strokeStyle = ringColor;
        c.lineWidth = 2 * t.scale;
        c.globalAlpha = 0.6;
        c.stroke();
        c.globalAlpha = 1.0;
      }

      if (isSelected) {
        c.shadowColor = color;
        c.shadowBlur = 15;
      }

      c.beginPath();
      c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
      c.strokeStyle = isSelected ? '#fff' : 'rgba(255,255,255,0.3)';
      c.lineWidth = isSelected ? 2.5 : 1;
      c.stroke();
      c.shadowBlur = 0;

      // Label
      c.fillStyle = '#ccc';
      c.font = `${Math.max(7, 9 * t.scale)}px sans-serif`;
      c.textAlign = 'center';
      const label = ev.text.length > 6 ? ev.text.slice(0, 6) + '…' : ev.text;
      c.fillText(label, sp.x, sp.y + r + 12 * t.scale);
    });

    // Selected node overlay
    if (selectedNode) {
      const np = pos[selectedNode.id];
      if (np) {
        const sp = toScreen(np.x, np.y);
        const panelW = 220, panelH = 120;
        let px = sp.x + 20, py = sp.y - panelH / 2;
        if (px + panelW > W) px = sp.x - panelW - 20;
        if (py < 10) py = 10;
        if (py + panelH > H) py = H - panelH - 10;

        c.fillStyle = 'rgba(15,20,35,0.92)';
        c.strokeStyle = EVENT_COLORS[selectedNode.type] || '#888';
        c.lineWidth = 1.5;
        c.beginPath();
        c.roundRect(px, py, panelW, panelH, 6);
        c.fill();
        c.stroke();

        c.fillStyle = '#fff';
        c.font = 'bold 11px sans-serif';
        c.textAlign = 'left';
        c.fillText(`[${selectedNode.id}] ${selectedNode.type}`, px + 10, py + 18);

        c.fillStyle = '#ccc';
        c.font = '10px sans-serif';
        const chars = selectedNode.text.split('');
        let line = '', lineY = py + 35;
        for (let i = 0; i < chars.length && lineY < py + panelH - 10; i++) {
          line += chars[i];
          if (line.length >= 22 || i === chars.length - 1) {
            c.fillText(line, px + 10, lineY);
            line = '';
            lineY += 14;
          }
        }

        c.fillStyle = '#999';
        c.font = '9px sans-serif';
        if (selectedNode.location) c.fillText(`📍 ${selectedNode.location}`, px + 10, py + panelH - 28);
        if (selectedNode.character) c.fillText(`👤 ${selectedNode.character}`, px + 10, py + panelH - 14);
        if (selectedNode.impact) c.fillText(`⚡ ${selectedNode.impact}`, px + 120, py + panelH - 14);
      }
    }

    // Hovered edge overlay
    const he = hoveredEdgeRef.current;
    if (he) {
      const eventMap = {};
      visibleEvents.forEach(e => { eventMap[e.id] = e; });
      const fromEv = eventMap[he.from];
      const toEv = eventMap[he.to];
      if (fromEv && toEv) {
        const fromP = pos[he.from], toP = pos[he.to];
        if (fromP && toP) {
          const sf = toScreen(fromP.x, fromP.y);
          const st = toScreen(toP.x, toP.y);
          const mx = (sf.x + st.x) / 2, my = (sf.y + st.y) / 2;

          const edgeStyle = EDGE_STYLES[he.type] || EDGE_STYLES.time;
          const extraLines = [];
          if (fromEv.location || toEv.location) {
            extraLines.push(`📍 ${fromEv.location || '未知'} → ${toEv.location || '未知'}`);
          }
          if (fromEv.character && toEv.character && fromEv.character === toEv.character) {
            extraLines.push(`👤 角色: ${fromEv.character}`);
          } else if (fromEv.character || toEv.character) {
            extraLines.push(`👤 ${fromEv.character || '-'} → ${toEv.character || '-'}`);
          }
          if (he.type === 'causes') {
            const effectsStr = (fromEv.effects || []).join('、');
            if (effectsStr) extraLines.push(`⚡ 影响: ${effectsStr.length > 30 ? effectsStr.slice(0, 30) + '…' : effectsStr}`);
          }

          const panelW = 260, panelH = 65 + extraLines.length * 14;
          let px = mx - panelW / 2, py = my + 12;
          if (px < 5) px = 5;
          if (px + panelW > W - 5) px = W - panelW - 5;
          if (py + panelH > H - 5) py = my - panelH - 12;

          c.fillStyle = 'rgba(10,15,30,0.93)';
          c.strokeStyle = edgeStyle.color;
          c.lineWidth = 1.5;
          c.beginPath();
          c.roundRect(px, py, panelW, panelH, 5);
          c.fill();
          c.stroke();

          c.fillStyle = '#fff';
          c.font = 'bold 10px sans-serif';
          c.textAlign = 'left';
          c.fillText(`关系: ${edgeStyle.label}`, px + 8, py + 16);

          c.fillStyle = '#bbb';
          c.font = '9px sans-serif';
          const fromLabel = fromEv.text.length > 18 ? fromEv.text.slice(0, 18) + '…' : fromEv.text;
          const toLabel = toEv.text.length > 18 ? toEv.text.slice(0, 18) + '…' : toEv.text;
          c.fillText(`起: [${he.from}] ${fromLabel}`, px + 8, py + 33);
          c.fillText(`终: [${he.to}] ${toLabel}`, px + 8, py + 50);

          c.fillStyle = '#999';
          let extraY = py + 64;
          for (const line of extraLines) {
            c.fillText(line, px + 8, extraY);
            extraY += 14;
          }
        }
      }
    }

    // Legend (fixed position, not affected by transform) — dim hidden edge types
    // Position: start high enough to not be blocked at the bottom
    c.font = '9px sans-serif';
    c.textAlign = 'left';
    const legendEntries = Object.entries(EDGE_STYLES);
    const legendItemH = 16;
    const legendTotalH = legendEntries.length * legendItemH;
    let ly = H - legendTotalH - 24;
    const legendRects = [];
    legendEntries.forEach(([key, style]) => {
      const visible = edgeVisibility[key] !== false;
      const alpha = visible ? 1 : 0.25;
      c.globalAlpha = alpha;
      c.strokeStyle = style.color;
      c.lineWidth = style.width;
      c.setLineDash(style.dash);
      c.beginPath();
      c.moveTo(12, ly);
      c.lineTo(40, ly);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#aaa';
      c.fillText(style.label + (visible ? '' : ' (隐藏)'), 46, ly + 3);
      c.globalAlpha = 1;
      legendRects.push({ key, x: 8, y: ly - 7, w: 140, h: legendItemH });
      ly += legendItemH;
    });
    legendRectsRef.current = legendRects;

    // Legend hover tooltip
    const hl = hoveredLegendRef.current;
    if (hl && EDGE_STYLES[hl]) {
      const style = EDGE_STYLES[hl];
      const rect = legendRects.find(r => r.key === hl);
      if (rect) {
        const tooltipX = rect.x + rect.w + 6;
        const tooltipY = rect.y;
        const tooltipText = style.desc || style.label;
        c.font = '10px sans-serif';
        const textW = c.measureText(tooltipText).width;
        const tw = textW + 16;
        const th = 22;
        c.fillStyle = 'rgba(10,15,30,0.93)';
        c.strokeStyle = style.color;
        c.lineWidth = 1;
        c.beginPath();
        c.roundRect(tooltipX, tooltipY, tw, th, 4);
        c.fill();
        c.stroke();
        c.fillStyle = '#ddd';
        c.textAlign = 'left';
        c.fillText(tooltipText, tooltipX + 8, tooltipY + 15);
      }
    }

    // --- Info overlay at top-left corner: show selected node/edge details ---
    {
      const infoX = 10, infoY = 10;
      const lineH = 15;
      const infoW = 280;
      const maxOverlayH = 400;
      const textAreaW = infoW - 16;

      // Wrap text into multiple lines that fit pixel width
      const wrapLine = (text, font) => {
        c.font = font || '10px sans-serif';
        if (c.measureText(text).width <= textAreaW) return [text];
        const wrapped = [];
        let remaining = text;
        while (remaining.length > 0) {
          if (c.measureText(remaining).width <= textAreaW) {
            wrapped.push(remaining);
            break;
          }
          let lo = 1, hi = remaining.length;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (c.measureText(remaining.slice(0, mid)).width <= textAreaW) lo = mid;
            else hi = mid - 1;
          }
          wrapped.push(remaining.slice(0, lo));
          remaining = remaining.slice(lo);
          if (wrapped.length >= 5) {
            if (remaining.length > 0) wrapped.push(remaining + '…');
            break;
          }
        }
        return wrapped;
      };

      const infoLines = [];
      let borderColor = 'rgba(100,120,160,0.3)';

      if (selectedNode) {
        borderColor = EVENT_COLORS[selectedNode.type] || '#888';
        infoLines.push({ text: `📌 事件详情 [${selectedNode.id}]`, color: '#fff', font: 'bold 10px sans-serif' });
        infoLines.push({ text: `  类型: ${selectedNode.type}`, color: '#aaa' });
        if (selectedNode.text) infoLines.push({ text: `  📝 ${selectedNode.text}`, color: '#ccc', wrap: true });
        if (selectedNode.location) infoLines.push({ text: `  📍 地点: ${selectedNode.location}`, color: '#7ec8e3', wrap: true });
        if (selectedNode.character) infoLines.push({ text: `  👤 角色: ${selectedNode.character}`, color: '#a5d6a7', wrap: true });
        if (selectedNode.impact) infoLines.push({ text: `  ⚡ 影响: ${selectedNode.impact}`, color: '#ffd54f', wrap: true });
        if (selectedNode.causes && selectedNode.causes.length > 0) {
          infoLines.push({ text: `  🔗 原因:`, color: '#9cdcfe' });
          selectedNode.causes.forEach(cause => {
            infoLines.push({ text: `    • ${cause}`, color: '#aaa', wrap: true });
          });
        }
        if (selectedNode.effects && selectedNode.effects.length > 0) {
          infoLines.push({ text: `  💥 后果:`, color: '#ff9800' });
          selectedNode.effects.forEach(eff => {
            infoLines.push({ text: `    • ${eff}`, color: '#aaa', wrap: true });
          });
        }
      } else if (selectedEdge) {
        const eventMap = {};
        visibleEvents.forEach(e => { eventMap[e.id] = e; });
        const fromEv = eventMap[selectedEdge.from];
        const toEv = eventMap[selectedEdge.to];
        const edgeStyle = EDGE_STYLES[selectedEdge.type] || EDGE_STYLES.time;
        borderColor = edgeStyle.color;

        infoLines.push({ text: `🔗 关系: ${edgeStyle.label}`, color: '#fff', font: 'bold 10px sans-serif' });
        if (fromEv) {
          infoLines.push({ text: `  起点 [${selectedEdge.from}]:`, color: '#9cdcfe' });
          if (fromEv.text) infoLines.push({ text: `    ${fromEv.text}`, color: '#ccc', wrap: true });
          if (fromEv.location) infoLines.push({ text: `    📍 ${fromEv.location}`, color: '#7ec8e3', wrap: true });
          if (fromEv.character) infoLines.push({ text: `    👤 ${fromEv.character}`, color: '#a5d6a7', wrap: true });
        }
        if (toEv) {
          infoLines.push({ text: `  终点 [${selectedEdge.to}]:`, color: '#9cdcfe' });
          if (toEv.text) infoLines.push({ text: `    ${toEv.text}`, color: '#ccc', wrap: true });
          if (toEv.location) infoLines.push({ text: `    📍 ${toEv.location}`, color: '#7ec8e3', wrap: true });
          if (toEv.character) infoLines.push({ text: `    👤 ${toEv.character}`, color: '#a5d6a7', wrap: true });
        }
        if (selectedEdge.type === 'causes' && fromEv && fromEv.effects && fromEv.effects.length > 0) {
          infoLines.push({ text: `  ⚡ 因果效果:`, color: '#ff9800' });
          fromEv.effects.forEach(eff => {
            infoLines.push({ text: `    • ${eff}`, color: '#aaa', wrap: true });
          });
        }
        if (selectedEdge.type === 'character' && fromEv && fromEv.character) {
          infoLines.push({ text: `  👤 共同角色: ${fromEv.character}`, color: '#a5d6a7', wrap: true });
        }
      } else {
        infoLines.push({ text: '💡 点击节点或边查看详情', color: '#888' });
        infoLines.push({ text: `📊 第 ${generation} 代 | 第 ${day} 天 ${timeOfDay}`, color: '#aaa' });
        infoLines.push({ text: `👥 角色: ${characters.length} | 📌 事件: ${events.length}`, color: '#aaa' });
      }

      // Expand wrapped lines into flat display list
      const expandedLines = [];
      for (const line of infoLines) {
        if (line.wrap && line.text) {
          const wrappedArr = wrapLine(line.text, line.font);
          wrappedArr.forEach(wl => expandedLines.push({ text: wl, font: line.font, color: line.color }));
        } else {
          expandedLines.push(line);
        }
      }

      // Cap lines to prevent overflow
      const maxLines = Math.floor((maxOverlayH - 12) / lineH);
      const displayLines = expandedLines.slice(0, maxLines);
      if (expandedLines.length > maxLines) {
        displayLines.push({ text: '…', color: '#666' });
      }

      const infoH = Math.min(displayLines.length * lineH + 12, maxOverlayH);
      c.fillStyle = 'rgba(10,14,23,0.85)';
      c.beginPath();
      c.roundRect(infoX, infoY, infoW, infoH, 6);
      c.fill();
      c.strokeStyle = borderColor;
      c.lineWidth = 1;
      c.stroke();

      // Clip to prevent text overflow
      c.save();
      c.beginPath();
      c.roundRect(infoX, infoY, infoW, infoH, 6);
      c.clip();

      c.textAlign = 'left';
      let iy = infoY + 14;
      for (const line of displayLines) {
        c.font = line.font || '10px sans-serif';
        c.fillStyle = line.color || 'rgba(255,255,255,0.85)';
        const displayText = line.text;
        c.fillText(displayText, infoX + 8, iy);
        iy += lineH;
      }
      c.restore();
    }

    // Zoom hint
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.font = '9px sans-serif';
    c.textAlign = 'right';
    c.fillText(`缩放: ${Math.round(t.scale * 100)}% | 滚轮缩放 拖拽平移`, W - 10, H - 8);
  }, [events, selectedNode, selectedEdge, worldState, characters, generation, worldSummary, day, timeOfDay, edgeVisibility, timelineMode, ringSpacing]);

  /* ---- Animation Loop ---- */
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      drawGraph();
      animRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [drawGraph]);

  /* ---- Canvas Resize ---- */
  useEffect(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      if (canvas && canvas.parentElement) {
        canvas.width = canvas.parentElement.clientWidth;
        canvas.height = canvas.parentElement.clientHeight || 420;
      }
    };
    resizeCanvas();

    // Use ResizeObserver on parent to detect divider-driven resizes
    const parent = canvas.parentElement;
    let ro;
    if (parent && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { resizeCanvas(); });
      ro.observe(parent);
    }

    window.addEventListener('resize', resizeCanvas);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (ro) ro.disconnect();
    };
  }, []);

  /* ---- Mouse Handlers ---- */
  const handleMouseDown = useCallback((e) => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const t = graphTransformRef.current;

    // Convert screen coords to world coords
    const wx = (mx - t.offsetX) / t.scale;
    const wy = (my - t.offsetY) / t.scale;

    const pos = graphPosRef.current;
    const visibleEvents = events.slice(-MAX_GRAPH_NODES);

    // Check if clicking on a node
    let clickedNode = null;
    visibleEvents.forEach(ev => {
      const p = pos[ev.id];
      if (!p) return;
      const r = ev.impact === 'high' ? 14 : ev.impact === 'medium' ? 11 : 8;
      const dist = Math.sqrt((wx - p.x) ** 2 + (wy - p.y) ** 2);
      if (dist <= r + 4) clickedNode = ev.id;
    });

    if (clickedNode) {
      dragStateRef.current = { type: 'node', nodeId: clickedNode, lastX: mx, lastY: my };
      const p = pos[clickedNode];
      if (p) p.fixed = true;
    } else {
      dragStateRef.current = { type: 'pan', nodeId: null, lastX: mx, lastY: my };
    }
  }, [events]);

  const handleMouseMove = useCallback((e) => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const drag = dragStateRef.current;
    const t = graphTransformRef.current;

    const pos = graphPosRef.current;

    if (drag.type === 'node' && drag.nodeId) {
      const dx = (mx - drag.lastX) / t.scale;
      const dy = (my - drag.lastY) / t.scale;
      const p = pos[drag.nodeId];
      if (p) {
        p.x += dx;
        p.y += dy;
        p.vx = 0;
        p.vy = 0;
      }
      drag.lastX = mx;
      drag.lastY = my;
      return;
    }

    if (drag.type === 'pan') {
      const dx = mx - drag.lastX;
      const dy = my - drag.lastY;
      t.offsetX += dx;
      t.offsetY += dy;
      drag.lastX = mx;
      drag.lastY = my;
      return;
    }

    // Edge hover detection (only when not dragging)
    const wx = (mx - t.offsetX) / t.scale;
    const wy = (my - t.offsetY) / t.scale;
    const visibleEvents = events.slice(-MAX_GRAPH_NODES);
    const edges = buildEdges(visibleEvents).filter(e => edgeVisibility[e.type] !== false);
    assignCurveIndices(edges);

    let closestEdge = null;
    let closestDist = EDGE_HOVER_THRESHOLD;
    edges.forEach(edge => {
      const from = pos[edge.from], to = pos[edge.to];
      if (!from || !to) return;
      const d = edgeDistToPoint(wx, wy, from, to, edge);
      if (d < closestDist) {
        closestDist = d;
        closestEdge = edge;
      }
    });

    hoveredEdgeRef.current = closestEdge;

    // Legend hover detection (screen coordinates)
    let foundLegend = null;
    for (const lr of legendRectsRef.current) {
      if (mx >= lr.x && mx <= lr.x + lr.w && my >= lr.y && my <= lr.y + lr.h) {
        foundLegend = lr.key;
        break;
      }
    }
    hoveredLegendRef.current = foundLegend;
  }, [events, edgeVisibility]);

  const handleMouseUp = useCallback(() => {
    const drag = dragStateRef.current;
    if (drag.type === 'node' && drag.nodeId) {
      const p = graphPosRef.current[drag.nodeId];
      if (p) p.fixed = false;
    }
    dragStateRef.current = { type: null, nodeId: null, lastX: 0, lastY: 0 };
  }, []);

  const handleClick = useCallback((e) => {
    // Select node or edge on click (not after drag)
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const t = graphTransformRef.current;

    const wx = (mx - t.offsetX) / t.scale;
    const wy = (my - t.offsetY) / t.scale;

    const pos = graphPosRef.current;
    const visibleEvents = events.slice(-MAX_GRAPH_NODES);

    // Check nodes first
    let clickedNode = null;
    visibleEvents.forEach(ev => {
      const p = pos[ev.id];
      if (!p) return;
      const r = ev.impact === 'high' ? 14 : ev.impact === 'medium' ? 11 : 8;
      const dist = Math.sqrt((wx - p.x) ** 2 + (wy - p.y) ** 2);
      if (dist <= r + 4) clickedNode = ev;
    });

    if (clickedNode) {
      setSelectedNode(clickedNode);
      setSelectedEdge(null);
      return;
    }

    // Check edges
    const edges = buildEdges(visibleEvents).filter(e => edgeVisibility[e.type] !== false);
    assignCurveIndices(edges);
    let closestEdge = null;
    let closestDist = EDGE_HOVER_THRESHOLD + 2;
    edges.forEach(edge => {
      const from = pos[edge.from], to = pos[edge.to];
      if (!from || !to) return;
      const d = edgeDistToPoint(wx, wy, from, to, edge);
      if (d < closestDist) {
        closestDist = d;
        closestEdge = edge;
      }
    });

    if (closestEdge) {
      setSelectedEdge(closestEdge);
      setSelectedNode(null);
    } else {
      setSelectedNode(null);
      setSelectedEdge(null);
    }
  }, [events, setSelectedNode, setSelectedEdge, edgeVisibility]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const t = graphTransformRef.current;

    const oldScale = t.scale;
    const delta = -e.deltaY * 0.001;
    const newScale = Math.max(0.1, Math.min(5.0, oldScale + delta));

    // Zoom toward mouse position
    t.offsetX = mx - (mx - t.offsetX) * (newScale / oldScale);
    t.offsetY = my - (my - t.offsetY) * (newScale / oldScale);
    t.scale = newScale;
  }, []);

  useEffect(() => {
    const el = graphCanvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  return (
    <>
      <div className="world-sim-header">
        <span className="world-sim-title">🔮 虚拟世界推演 — 事件图谱</span>
      </div>

      <div className="world-sim-canvas-container">
        <canvas
          ref={graphCanvasRef}
          className="world-sim-canvas"
          style={{ display: 'block' }}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      </div>
    </>
  );
});

/* ================================================================
   Info Component: WorldSimulatorInfo
   ================================================================ */

const WorldSimulatorInfo = memo(function WorldSimulatorInfo() {
  const ctx = useContext(WorldSimulatorContext);
  const {
    characters, worldSummary, isRunning, generation, log, autoMode, worldState,
    eventSeed, setEventSeed, edgeVisibility, setEdgeVisibility, day, timeOfDay,
    timelineMode, setTimelineMode, ringSpacing, setRingSpacing,
    setAutoMode, runStep, reset,
    saveSimulation, loadSimulation, getSavedList, deleteSave, loadGenFromSave,
    addCharacter, editCharacter, deleteCharacter,
    chatTarget, setChatTarget, chatMessages, setChatMessages, isChatting, chatWithCharacter,
    chatBufferTip,
    generateRandomWorld, generateRandomWorldByLLM,
    worldSeed, setWorldSeed, isGeneratingWorld,
    docTitle, docText, docChunks, isAnalyzingDoc, docAnalysisProgress,
    docChunkSize, setDocChunkSize, docChunkOverlap, setDocChunkOverlap,
    uploadDocument, rechunkDocument, analyzeDocumentAsEventGraph, stopDocAnalysis,
  } = ctx;

  const logListRef = useRef(null);
  const [showSaves, setShowSaves] = useState(false);
  const [saves, setSaves] = useState([]);
  const [expandedSaveIdx, setExpandedSaveIdx] = useState(null);
  const [showAddChar, setShowAddChar] = useState(false);
  const [editingChar, setEditingChar] = useState(null); // name of character being edited
  const [charForm, setCharForm] = useState({ name: '', activity: '', mood: '', emoji: '', location: '' });
  const chatInputRef = useRef(null);
  const docFileInputRef = useRef(null);

  const [expandedSections, setExpandedSections] = useState({ worldState: true, chars: true, chat: true, log: false, saves: false, docUpload: false, docChunkSettings: false });
  const toggleSection = useCallback((key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const refreshSaves = useCallback(() => {
    setSaves(getSavedList());
  }, [getSavedList]);

  const handleDocFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) uploadDocument(file);
    if (e.target) e.target.value = '';
  }, [uploadDocument]);

  const docChunkSizeMax = Math.floor((ctx.settings?.maxTokens || 4096) * 2 / 3);

  const handleAddChar = useCallback(() => {
    if (!charForm.name.trim()) return;
    addCharacter(charForm);
    setCharForm({ name: '', activity: '', mood: '', emoji: '', location: '' });
    setShowAddChar(false);
  }, [charForm, addCharacter]);

  const handleStartEdit = useCallback((ch) => {
    setEditingChar(ch.name);
    setCharForm({ name: ch.name, activity: ch.activity, mood: ch.mood, emoji: ch.emoji, location: ch.location || '' });
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingChar) return;
    editCharacter(editingChar, {
      activity: charForm.activity,
      mood: charForm.mood,
      emoji: charForm.emoji,
      location: charForm.location,
    });
    setEditingChar(null);
    setCharForm({ name: '', activity: '', mood: '', emoji: '', location: '' });
  }, [editingChar, charForm, editCharacter]);

  const handleCancelEdit = useCallback(() => {
    setEditingChar(null);
    setShowAddChar(false);
    setCharForm({ name: '', activity: '', mood: '', emoji: '', location: '' });
  }, []);

  // Helper to parse relationship type from "类型:说明" format
  const parseRelType = (rel) => {
    if (!rel) return { type: DEFAULT_RELATIONSHIP_TYPE, desc: '' };
    const colonIdx = rel.indexOf(':');
    if (colonIdx !== -1) {
      const parsedType = rel.slice(0, colonIdx);
      if (RELATIONSHIP_TYPES[parsedType]) {
        return { type: parsedType, desc: rel.slice(colonIdx + 1) };
      }
    }
    // Legacy or unrecognized format - try exact match against known types
    if (RELATIONSHIP_TYPES[rel]) {
      return { type: rel, desc: '' };
    }
    return { type: DEFAULT_RELATIONSHIP_TYPE, desc: rel };
  };

  return (
    <>
      {/* Common Controls */}
      <div className="world-sim-controls">
        <button className="world-sim-btn" onClick={reset}>🆕 新建</button>
        <button className="world-sim-btn" onClick={generateRandomWorld} title="随机模板生成世界">🎲 随机世界</button>
        <button
          className="world-sim-btn primary"
          onClick={generateRandomWorldByLLM}
          disabled={isGeneratingWorld}
          title="使用大模型生成独特世界"
        >{isGeneratingWorld ? '⏳ 生成中...' : '🤖 AI创世'}</button>
        <button className="world-sim-btn" onClick={saveSimulation}>💾 存档</button>
        <button className="world-sim-btn" onClick={() => { refreshSaves(); setShowSaves(s => !s); }}>📂 读档</button>
      </div>

      {/* World Seed Input */}
      <div className="world-sim-controls" style={{ paddingTop: 0 }}>
        <input
          type="text"
          className="world-sim-seed-input"
          placeholder="世界种子 (留空随机生成，如: 末日废土、星际文明...)"
          value={worldSeed}
          onChange={e => setWorldSeed(e.target.value)}
          style={{
            flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 12, outline: 'none',
          }}
        />
        <button
          className="world-sim-btn"
          onClick={() => setWorldSeed(`seed-${Math.floor(Math.random() * 100000)}`)}
          title="生成随机种子"
          style={{ fontSize: 10, padding: '3px 6px' }}
        >🎰</button>
      </div>

      {/* Event Simulation Controls */}
      <div className="world-sim-controls" style={{ borderLeft: '3px solid #2196F3', paddingLeft: 8 }}>
        <span style={{ fontSize: 10, color: '#90caf9', marginRight: 4 }}>📊 事件推演</span>
        <button
          className="world-sim-btn primary"
          onClick={runStep}
          disabled={isRunning}
        >{isRunning ? '⏳ 推演中...' : '▶ 下一步'}</button>
        <button
          className={`world-sim-btn${autoMode ? ' primary' : ''}`}
          onClick={() => setAutoMode(a => !a)}
        >{autoMode ? '⏸ 暂停' : '🔄 自动'}</button>
        <span className="world-sim-gen">Gen:{generation} | 第{day}天 {timeOfDay}</span>
      </div>

      {/* Event Seed */}
      <div className="world-sim-controls" style={{ paddingTop: 0 }}>
        <input
          type="text"
          className="world-sim-seed-input"
          placeholder="事件种子 (如: 一条龙出现了, 战争爆发...)"
          value={eventSeed}
          onChange={e => setEventSeed(e.target.value)}
          style={{
            flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 12, outline: 'none',
          }}
        />
      </div>

      {/* Edge Visibility Toggles */}
      <div className="world-sim-controls" style={{ paddingTop: 0, flexWrap: 'wrap', gap: 4 }}>
        <button
          className={`world-sim-btn${timelineMode ? ' primary' : ''}`}
          style={{
            fontSize: 10, padding: '2px 7px',
            borderLeft: '3px solid #FFD54F',
            background: timelineMode ? 'rgba(255,213,79,0.2)' : undefined,
          }}
          onClick={() => setTimelineMode(prev => !prev)}
          title={timelineMode ? '隐藏年轮时间线，恢复关系线显示' : '显示年轮时间线'}
        >
          {timelineMode ? '🕐 隐藏年轮线' : '🕐 显示年轮线'}
        </button>
        {timelineMode && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#FFD54F' }}>
            <span>间距</span>
            <input
              type="range" min={1} max={5} step={1}
              value={ringSpacing}
              onChange={e => setRingSpacing(Number(e.target.value))}
              style={{ width: 60, accentColor: '#FFD54F' }}
              title={`年轮线间距: ${ringSpacing}`}
            />
            <span>{ringSpacing}</span>
          </span>
        )}
        {Object.entries(EDGE_STYLES).map(([key, style]) => (
          <button
            key={key}
            className={`world-sim-btn${!timelineMode && edgeVisibility[key] !== false ? ' primary' : ''}`}
            style={{ fontSize: 10, padding: '2px 7px', borderLeft: `3px solid ${style.color}`, opacity: timelineMode ? 0.5 : 1 }}
            onClick={() => {
              // When user clicks to show a specific edge type, exit timeline mode and show that edge
              if (timelineMode) {
                setTimelineMode(false);
                // Hide all edges except the clicked one
                const newVis = {};
                Object.keys(EDGE_STYLES).forEach(k => { newVis[k] = k === key; });
                setEdgeVisibility(newVis);
              } else {
                setEdgeVisibility(prev => ({ ...prev, [key]: !prev[key] }));
              }
            }}
          >
            {!timelineMode && edgeVisibility[key] !== false ? '👁' : '🚫'} {style.label}
          </button>
        ))}
      </div>

      {/* Document Event Graph Extraction */}
      <div className="world-sim-controls" style={{ borderLeft: '3px solid #9C27B0', paddingLeft: 8, flexWrap: 'wrap', gap: 4 }}>
        <span style={{ fontSize: 10, color: '#CE93D8', marginRight: 4 }}>📄 文档事件图谱</span>
        <input
          ref={docFileInputRef}
          type="file"
          accept=".txt,.text,.md,.markdown,.csv,.log,.json,.xml,.html,.htm"
          onChange={handleDocFileUpload}
          style={{ display: 'none' }}
        />
        <button
          className="world-sim-btn"
          onClick={() => docFileInputRef.current?.click()}
          disabled={isAnalyzingDoc}
          title="上传文档解析为事件图谱"
        >📁 上传文档</button>
        {docChunks.length > 0 && !isAnalyzingDoc && (
          <button
            className="world-sim-btn primary"
            onClick={analyzeDocumentAsEventGraph}
            disabled={isRunning}
            title="分析文档并提取事件图谱"
          >🔍 解析事件图谱</button>
        )}
        {isAnalyzingDoc && (
          <button
            className="world-sim-btn"
            onClick={stopDocAnalysis}
            style={{ color: '#f44336' }}
          >⏹ 停止</button>
        )}
        {isAnalyzingDoc && (
          <span style={{ fontSize: 10, color: '#CE93D8' }}>
            分析中 {docAnalysisProgress.current}/{docAnalysisProgress.total}
          </span>
        )}
      </div>

      {/* Document info & progress */}
      {docTitle && (
        <div className="world-sim-controls" style={{ paddingTop: 0, flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#aaa', flexWrap: 'wrap' }}>
            <span>📄 {docTitle}</span>
            <span>📝 {docText.length}字</span>
            <span>📑 {docChunks.length}段</span>
          </div>
          {isAnalyzingDoc && docAnalysisProgress.total > 0 && (
            <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                width: `${(docAnalysisProgress.current / docAnalysisProgress.total) * 100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #9C27B0, #CE93D8)',
                borderRadius: 2,
                transition: 'width 0.3s ease',
              }} />
            </div>
          )}
        </div>
      )}

      {/* Single scrollable container with collapsible sections */}
      <div className="novel-scrollable-area">
        {/* 📄 文档分段设置 section */}
        {docTitle && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('docChunkSettings')}>
              <span className="novel-section-arrow">{expandedSections.docChunkSettings ? '▾' : '▸'}</span>
              <h4>✂️ 分段设置</h4>
              <span className="novel-section-badge">{docChunks.length}段</span>
            </div>
            {expandedSections.docChunkSettings && (
              <div className="novel-section-body">
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>
                  <label>片段大小: {docChunkSize}字</label>
                  <input
                    type="range" min={DOC_CHUNK_SIZE_MIN} max={Math.max(docChunkSizeMax, DOC_CHUNK_OVERLAP_MAX)} step={DOC_CHUNK_SIZE_STEP}
                    value={docChunkSize}
                    onChange={e => setDocChunkSize(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#9C27B0' }}
                  />
                </div>
                <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>
                  <label>重叠大小: {docChunkOverlap}字</label>
                  <input
                    type="range" min={0} max={Math.min(DOC_CHUNK_OVERLAP_MAX, Math.floor(docChunkSize * DOC_CHUNK_OVERLAP_RATIO))} step={DOC_CHUNK_OVERLAP_STEP}
                    value={docChunkOverlap}
                    onChange={e => setDocChunkOverlap(Number(e.target.value))}
                    style={{ width: '100%', accentColor: '#9C27B0' }}
                  />
                </div>
                <button
                  className="world-sim-btn"
                  onClick={rechunkDocument}
                  disabled={isAnalyzingDoc}
                  style={{ fontSize: 10 }}
                >🔄 重新分段 ({docChunks.length}段)</button>
              </div>
            )}
          </>
        )}

        {/* 📂 存档列表 section */}
        {showSaves && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('saves')}>
              <span className="novel-section-arrow">{expandedSections.saves ? '▾' : '▸'}</span>
              <h4>📂 存档列表</h4>
              <span className="novel-section-badge">{saves.length}</span>
            </div>
            {expandedSections.saves && (
              <div className="novel-section-body" style={{ maxHeight: 250, overflowY: 'auto' }}>
                {saves.length === 0 ? (
                  <div style={{ color: '#888', fontSize: 12 }}>暂无存档</div>
                ) : (
                  saves.map((s, i) => (
                    <div key={i} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                        <span
                          style={{ flex: 1, color: '#ccc', cursor: s.genHistory && s.genHistory.length > 0 ? 'pointer' : 'default' }}
                          onClick={() => {
                            if (s.genHistory && s.genHistory.length > 0) {
                              setExpandedSaveIdx(expandedSaveIdx === i ? null : i);
                            }
                          }}
                        >
                          {s.genHistory && s.genHistory.length > 0 ? (expandedSaveIdx === i ? '▼' : '▶') : '•'}{' '}
                          {s.name} (Gen {s.generation}{s.genHistory ? `, ${s.genHistory.length}步` : ''})
                        </span>
                        <button
                          className="world-sim-btn"
                          style={{ padding: '2px 6px', fontSize: 10 }}
                          onClick={() => { loadSimulation(i); setShowSaves(false); }}
                        >加载最新</button>
                        <button
                          className="world-sim-btn"
                          style={{ padding: '2px 6px', fontSize: 10 }}
                          onClick={() => { deleteSave(i); refreshSaves(); }}
                        >删除</button>
                      </div>
                      {/* Expanded gen history for this save */}
                      {expandedSaveIdx === i && s.genHistory && s.genHistory.length > 0 && (
                        <div style={{ marginTop: 4, marginLeft: 16, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {s.genHistory.map((snap) => (
                            <button
                              key={snap.generation}
                              className="world-sim-btn"
                              style={{
                                padding: '2px 8px', fontSize: 9,
                                background: snap.generation === generation ? 'rgba(33,150,243,0.3)' : undefined,
                                borderColor: snap.generation === generation ? '#2196F3' : undefined,
                              }}
                              onClick={() => { loadGenFromSave(i, snap.generation); setShowSaves(false); }}
                              title={`加载到 Gen ${snap.generation}（${snap.events ? snap.events.length : 0} 事件）`}
                            >
                              Gen {snap.generation}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}

        {/* 🌍 世界状态 section */}
        <div className="novel-section-header" onClick={() => toggleSection('worldState')}>
          <span className="novel-section-arrow">{expandedSections.worldState ? '▾' : '▸'}</span>
          <h4>🌍 世界状态</h4>
          {generation > 0 && <span className="novel-section-badge">Gen:{generation}</span>}
        </div>
        {expandedSections.worldState && (
          <div className="novel-section-body">
            <div className="world-sim-world-state">
              <span>🌤 {worldState.weather}</span>
              <span>🌸 {worldState.season}</span>
              <span>💰 {worldState.economy}</span>
              <span>🕐 {worldState.time_of_day}</span>
              <span>😊 {worldState.population_mood}</span>
            </div>
            <p className="world-sim-summary-text">{worldSummary}</p>
          </div>
        )}

        {/* 👥 角色状态 section */}
        <div className="novel-section-header" onClick={() => toggleSection('chars')}>
          <span className="novel-section-arrow">{expandedSections.chars ? '▾' : '▸'}</span>
          <h4>👥 角色状态</h4>
          <span className="novel-section-badge">{characters.length}</span>
        </div>
        {expandedSections.chars && (
          <div className="novel-section-body" style={{ padding: '4px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <button
                className="world-sim-btn"
                style={{ fontSize: 10, padding: '2px 8px' }}
                onClick={() => { setShowAddChar(a => !a); setEditingChar(null); setCharForm({ name: '', activity: '', mood: '', emoji: '', location: '' }); }}
              >
                {showAddChar ? '✕ 取消' : '➕ 添加角色'}
              </button>
            </div>

            {/* Add Character Form */}
            {showAddChar && (
              <div className="world-sim-char-form">
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input
                    type="text"
                    placeholder="角色名 *"
                    value={charForm.name}
                    onChange={e => setCharForm(f => ({ ...f, name: e.target.value }))}
                    style={{ flex: 1, padding: '3px 6px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none' }}
                  />
                  <input
                    type="text"
                    placeholder="Emoji"
                    value={charForm.emoji}
                    onChange={e => setCharForm(f => ({ ...f, emoji: e.target.value }))}
                    style={{ width: 50, padding: '3px 6px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none', textAlign: 'center' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                  <input
                    type="text"
                    placeholder="活动"
                    value={charForm.activity}
                    onChange={e => setCharForm(f => ({ ...f, activity: e.target.value }))}
                    style={{ flex: 1, padding: '3px 6px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none' }}
                  />
                  <input
                    type="text"
                    placeholder="心情"
                    value={charForm.mood}
                    onChange={e => setCharForm(f => ({ ...f, mood: e.target.value }))}
                    style={{ flex: 1, padding: '3px 6px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none' }}
                  />
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="位置"
                    value={charForm.location}
                    onChange={e => setCharForm(f => ({ ...f, location: e.target.value }))}
                    style={{ flex: 1, padding: '3px 6px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none' }}
                  />
                  <button
                    className="world-sim-btn primary"
                    style={{ fontSize: 10, padding: '3px 10px' }}
                    onClick={handleAddChar}
                  >确认添加</button>
                </div>
              </div>
            )}

            <div className="world-sim-char-list">
              {characters.map(ch => (
                <div key={ch.name} className="world-sim-char-item" style={{ position: 'relative' }}>
                  {editingChar === ch.name ? (
                    /* Edit mode */
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 3, alignItems: 'center' }}>
                        <input
                          type="text"
                          value={charForm.emoji}
                          onChange={e => setCharForm(f => ({ ...f, emoji: e.target.value }))}
                          style={{ width: 32, padding: '2px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 14, outline: 'none', textAlign: 'center' }}
                        />
                        <span style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>{ch.name}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
                        <input type="text" placeholder="活动" value={charForm.activity} onChange={e => setCharForm(f => ({ ...f, activity: e.target.value }))} style={{ flex: 1, padding: '2px 5px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none' }} />
                        <input type="text" placeholder="心情" value={charForm.mood} onChange={e => setCharForm(f => ({ ...f, mood: e.target.value }))} style={{ flex: 1, padding: '2px 5px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none' }} />
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input type="text" placeholder="位置" value={charForm.location} onChange={e => setCharForm(f => ({ ...f, location: e.target.value }))} style={{ flex: 1, padding: '2px 5px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none' }} />
                        <button className="world-sim-btn primary" style={{ fontSize: 9, padding: '2px 6px' }} onClick={handleSaveEdit}>✓</button>
                        <button className="world-sim-btn" style={{ fontSize: 9, padding: '2px 6px' }} onClick={handleCancelEdit}>✕</button>
                      </div>
                    </div>
                  ) : (
                    /* Display mode */
                    <>
                      <span className="world-sim-char-emoji">{ch.emoji}</span>
                      <div style={{ flex: 1 }}>
                        <div className="world-sim-char-name">{ch.name}</div>
                        <div className="world-sim-char-activity">{ch.activity}</div>
                        <div className="world-sim-char-mood">心情: {ch.mood} | 📍 {ch.location || '未知'}</div>
                        {/* Character relationships display */}
                        {ch.relationships && Object.keys(ch.relationships).length > 0 && (
                          <div style={{ marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {Object.entries(ch.relationships).map(([target, rel]) => {
                              const { type, desc } = parseRelType(rel);
                              const relStyle = RELATIONSHIP_TYPES[type] || RELATIONSHIP_TYPES[DEFAULT_RELATIONSHIP_TYPE];
                              return (
                                <span
                                  key={target}
                                  style={{
                                    fontSize: 9,
                                    padding: '1px 5px',
                                    borderRadius: 8,
                                    background: `${relStyle.color}22`,
                                    border: `1px solid ${relStyle.color}55`,
                                    color: relStyle.color,
                                  }}
                                  title={desc ? `${type}: ${desc}` : type}
                                >
                                  {relStyle.icon} {target}
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 4 }}>
                        <button
                          className="world-sim-btn"
                          style={{ fontSize: 9, padding: '1px 5px', lineHeight: 1.2 }}
                          onClick={() => handleStartEdit(ch)}
                          title="编辑角色"
                        >✏️</button>
                        <button
                          className="world-sim-btn"
                          style={{ fontSize: 9, padding: '1px 5px', lineHeight: 1.2 }}
                          onClick={() => deleteCharacter(ch.name)}
                          title="删除角色"
                        >🗑️</button>
                        <button
                          className="world-sim-btn"
                          style={{ fontSize: 9, padding: '1px 5px', lineHeight: 1.2 }}
                          onClick={() => { setChatTarget(ch.name); setChatMessages([]); }}
                          title="与角色对话"
                        >💬</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 💬 角色对话 section */}
        <div className="novel-section-header" onClick={() => toggleSection('chat')}>
          <span className="novel-section-arrow">{expandedSections.chat ? '▾' : '▸'}</span>
          <h4>💬 角色对话</h4>
          {chatTarget && <span className="novel-section-badge">{chatTarget}</span>}
        </div>
        {expandedSections.chat && (
          <div className="novel-section-body">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {chatTarget && (
                <button
                  className="world-sim-btn"
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => { setChatTarget(null); setChatMessages([]); }}
                >✕ 结束对话</button>
              )}
            </div>
            {!chatTarget ? (
              <div style={{ fontSize: 11, color: '#888', padding: '4px 0' }}>
                点击角色旁的 💬 按钮开始对话
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: '#9cdcfe', marginBottom: 4 }}>
                  正在与 {characters.find(c => c.name === chatTarget)?.emoji || '🧑'} {chatTarget} 对话
                </div>
                <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 6 }}>
                  {chatMessages.map((msg, i) => (
                    <div key={i} style={{
                      fontSize: 11, padding: '3px 6px', marginBottom: 2,
                      borderRadius: 4,
                      background: msg.role === 'user' ? 'rgba(33,150,243,0.15)' : 'rgba(76,175,80,0.15)',
                      color: msg.role === 'user' ? '#90caf9' : '#a5d6a7',
                      textAlign: msg.role === 'user' ? 'right' : 'left',
                    }}>
                      {msg.role === 'user' ? '你' : chatTarget}: {msg.content}
                      {msg.meta && <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>{msg.meta}</div>}
                    </div>
                  ))}
                  {isChatting && chatBufferTip && (
                    <div style={{
                      fontSize: 11, padding: '3px 6px', marginBottom: 2,
                      borderRadius: 4, background: 'rgba(76,175,80,0.10)',
                      color: '#a5d6a7', textAlign: 'left',
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }}>
                      {chatTarget}: {chatBufferTip}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    type="text"
                    ref={chatInputRef}
                    placeholder={`对${chatTarget}说...`}
                    className="world-sim-seed-input"
                    style={{
                      flex: 1, padding: '4px 8px', borderRadius: 4,
                      border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none',
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        chatWithCharacter(chatTarget, e.target.value.trim());
                        e.target.value = '';
                      }
                    }}
                    disabled={isChatting}
                  />
                  <button
                    className="world-sim-btn primary"
                    style={{ fontSize: 10, padding: '3px 8px' }}
                    disabled={isChatting}
                    onClick={() => {
                      const input = chatInputRef.current;
                      if (input && input.value.trim()) {
                        chatWithCharacter(chatTarget, input.value.trim());
                        input.value = '';
                      }
                    }}
                  >{isChatting ? '⏳' : '发送'}</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 📜 事件日志 section */}
        <div className="novel-section-header" onClick={() => toggleSection('log')}>
          <span className="novel-section-arrow">{expandedSections.log ? '▾' : '▸'}</span>
          <h4>📜 事件日志</h4>
          {log.length > 0 && <span className="novel-section-badge">{log.length}</span>}
        </div>
        {expandedSections.log && (
          <div className="novel-section-body">
            <div className="world-sim-log-list" ref={logListRef} style={{ maxHeight: 200, overflowY: 'auto' }}>
              {log.length === 0 ? (
                <div className="world-sim-log-empty">点击"下一步"开始推演...</div>
              ) : (
                log.map((entry, i) => (
                  <div key={i} className="world-sim-log-entry">{entry}</div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
});

/* ================================================================
   Default Export: WorldSimulator (backwards compatible)
   ================================================================ */

export default function WorldSimulator({ settings }) {
  return (
    <WorldSimulatorProvider settings={settings}>
      <div className="world-simulator">
        <WorldSimulatorCanvas />
        <WorldSimulatorInfo />
      </div>
    </WorldSimulatorProvider>
  );
}

export { WorldSimulatorProvider, WorldSimulatorCanvas, WorldSimulatorInfo, WorldSimulatorContext };
