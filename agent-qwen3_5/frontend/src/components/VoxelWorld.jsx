import { useState, useRef, useEffect, useCallback, createContext, useContext, useMemo } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createNoise2D } from 'simplex-noise';
import { sendChatRequest } from '../services/openai';
import { loadSettings } from '../utils/storage';

/* ================================================================
   Constants
   ================================================================ */

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 32;
const RENDER_DISTANCE = 3;
const WATER_LEVEL = 6;
const DAY_LENGTH = 1200; // ticks per full day cycle

const BLOCK_TYPES = {
  grass:       { top: [0.35, 0.62, 0.24], side: [0.29, 0.48, 0.20], label: 'Grass',    preview: '#5a9e3e', transparent: false },
  dirt:        { top: [0.55, 0.41, 0.08], side: [0.43, 0.33, 0.06], label: 'Dirt',     preview: '#8b6914', transparent: false },
  stone:       { top: [0.53, 0.53, 0.53], side: [0.44, 0.44, 0.44], label: 'Stone',    preview: '#888888', transparent: false },
  wood:        { top: [0.77, 0.60, 0.42], side: [0.63, 0.47, 0.28], label: 'Wood',     preview: '#c49a6c', transparent: false },
  water:       { top: [0.16, 0.39, 0.78], side: [0.12, 0.31, 0.67], label: 'Water',    preview: '#2864c8', transparent: true, opacity: 0.7 },
  sand:        { top: [0.91, 0.84, 0.55], side: [0.79, 0.72, 0.44], label: 'Sand',     preview: '#e8d68c', transparent: false },
  brick:       { top: [0.63, 0.25, 0.19], side: [0.53, 0.22, 0.16], label: 'Brick',    preview: '#a04030', transparent: false },
  glass:       { top: [0.71, 0.86, 1.00], side: [0.59, 0.78, 0.94], label: 'Glass',    preview: '#b4dcff', transparent: true, opacity: 0.4 },
  snow:        { top: [0.94, 0.94, 0.94], side: [0.85, 0.85, 0.85], label: 'Snow',     preview: '#f0f0f0', transparent: false },
  leaf:        { top: [0.18, 0.48, 0.12], side: [0.14, 0.40, 0.08], label: 'Leaf',     preview: '#2d7a1e', transparent: false },
  cobblestone: { top: [0.45, 0.45, 0.45], side: [0.38, 0.38, 0.38], label: '圆石',    preview: '#737373', transparent: false },
  planks:      { top: [0.70, 0.56, 0.35], side: [0.62, 0.48, 0.28], label: '木板',    preview: '#b38f59', transparent: false },
  farmland:    { top: [0.35, 0.25, 0.08], side: [0.40, 0.30, 0.12], label: '农田',    preview: '#5a4014', transparent: false },
  wheat1:      { top: [0.20, 0.50, 0.05], side: [0.18, 0.42, 0.04], label: '小麦(幼)', preview: '#338010', transparent: true, opacity: 0.9 },
  wheat2:      { top: [0.45, 0.68, 0.10], side: [0.40, 0.58, 0.08], label: '小麦(中)', preview: '#73ad1a', transparent: true, opacity: 0.9 },
  wheat3:      { top: [0.92, 0.85, 0.15], side: [0.85, 0.75, 0.12], label: '小麦(熟)', preview: '#ebd926', transparent: true, opacity: 0.9 },
  fence:       { top: [0.65, 0.52, 0.30], side: [0.58, 0.45, 0.25], label: '栅栏',    preview: '#a68548', transparent: false },
  torch:       { top: [1.0,  0.85, 0.2 ], side: [0.9,  0.75, 0.15], label: '火把',    preview: '#ffd933', transparent: true, opacity: 0.9 },
  path:        { top: [0.72, 0.62, 0.38], side: [0.60, 0.50, 0.30], label: '小路',    preview: '#b89e61', transparent: false },
  bed:         { top: [0.70, 0.20, 0.20], side: [0.55, 0.15, 0.15], bottom: [0.45, 0.30, 0.15], pillow: [0.92, 0.90, 0.85], label: '床', preview: '#b33333', transparent: false },
  furnace:     { top: [0.50, 0.50, 0.50], side: [0.42, 0.42, 0.42], label: '熔炉',    preview: '#808080', transparent: false },
  chest:       { top: [0.60, 0.45, 0.20], side: [0.52, 0.38, 0.15], label: '箱子',    preview: '#997333', transparent: false },
  bookshelf:   { top: [0.70, 0.56, 0.35], side: [0.45, 0.30, 0.15], label: '书架',    preview: '#734d26', transparent: false },
  anvil:       { top: [0.30, 0.30, 0.30], side: [0.22, 0.22, 0.22], label: '铁砧',    preview: '#4d4d4d', transparent: false },
  hay:         { top: [0.90, 0.78, 0.20], side: [0.82, 0.68, 0.15], label: '干草块',  preview: '#e0b830', transparent: false },
  lantern:     { top: [1.0, 0.90, 0.40], side: [0.85, 0.70, 0.20], label: '灯笼',    preview: '#ffe066', transparent: true, opacity: 0.9 },
  log:         { top: [0.55, 0.40, 0.20], side: [0.35, 0.22, 0.10], label: '原木',    preview: '#8c6633', transparent: false },
  wool:        { top: [0.90, 0.20, 0.20], side: [0.82, 0.15, 0.15], label: '羊毛',    preview: '#e63333', transparent: false },
  stained_glass: { top: [0.50, 0.20, 0.70], side: [0.45, 0.15, 0.60], label: '彩色玻璃', preview: '#8033b3', transparent: true, opacity: 0.5 },
  flower:      { top: [0.95, 0.40, 0.40], side: [0.20, 0.55, 0.10], label: '花',      preview: '#f26666', transparent: true, opacity: 0.9 },
  crafting_table: { top: [0.60, 0.45, 0.25], side: [0.50, 0.38, 0.18], label: '工作台', preview: '#997340', transparent: false },
  iron_block:  { top: [0.78, 0.78, 0.78], side: [0.68, 0.68, 0.68], label: '铁块',    preview: '#c7c7c7', transparent: false },
  ladder:      { top: [0.65, 0.52, 0.30], side: [0.55, 0.42, 0.22], label: '梯子',    preview: '#a68548', transparent: true, opacity: 0.9 },
  pumpkin:     { top: [0.85, 0.55, 0.10], side: [0.90, 0.60, 0.12], label: '南瓜',    preview: '#e09019', transparent: false },
  melon:       { top: [0.35, 0.60, 0.15], side: [0.50, 0.70, 0.20], label: '西瓜',    preview: '#80b333', transparent: false },
  smoker:      { top: [0.45, 0.40, 0.35], side: [0.38, 0.33, 0.28], label: '烟熏炉',  preview: '#736659', transparent: false },
  bell:        { top: [0.85, 0.75, 0.15], side: [0.80, 0.68, 0.10], label: '钟',      preview: '#d9bf26', transparent: false },
};

const BLOCK_LIST = Object.keys(BLOCK_TYPES);

/* ================================================================
   Villager Profession System
   ================================================================ */

const PROFESSIONS = {
  farmer:     { label: '农民',     icon: '🌾', color: '#4CAF50', workDesc: '种植和收割庄稼' },
  builder:    { label: '建筑师',   icon: '🔨', color: '#2196F3', workDesc: '建造和修缮房屋' },
  blacksmith: { label: '铁匠',     icon: '⚒️', color: '#FF5722', workDesc: '在熔炉旁锻造' },
  librarian:  { label: '图书管理员', icon: '📚', color: '#9C27B0', workDesc: '整理和研究知识' },
  guard:      { label: '守卫',     icon: '🛡️', color: '#F44336', workDesc: '巡逻保卫村庄' },
};

const PROFESSION_LIST = Object.keys(PROFESSIONS);

/* ================================================================
   Schedule Phases
   ================================================================ */

const SCHEDULE_PHASES = {
  sleep:     { label: '睡眠', icon: '😴', hours: [22, 23, 0, 1, 2, 3, 4, 5] },
  wake:      { label: '起床', icon: '🌅', hours: [6] },
  work:      { label: '工作', icon: '⚒️', hours: [7, 8, 9, 10, 11, 12, 13, 14, 15, 16] },
  eat:       { label: '进食', icon: '🍖', hours: [12] },
  socialize: { label: '社交', icon: '💬', hours: [17, 18, 19] },
  leisure:   { label: '休闲', icon: '🎵', hours: [20, 21] },
};

function getSchedulePhase(hour) {
  if (hour >= 22 || hour < 6) return 'sleep';
  if (hour === 6) return 'wake';
  if (hour === 12) return 'eat';
  if (hour >= 7 && hour <= 16) return 'work';
  if (hour >= 17 && hour <= 19) return 'socialize';
  return 'leisure';
}

/* ================================================================
   AI Goal System — Need-based autonomous decision making
   ================================================================ */

const AI_GOALS = {
  sleep:     { label: '睡觉', icon: '😴', color: '#3F51B5', needKey: 'rest',   restoreKey: 'rest',   restoreRate: 0.6, durationRange: [80, 120], targetBlock: 'bed' },
  eat:       { label: '吃饭', icon: '🍖', color: '#FF9800', needKey: 'hunger', restoreKey: 'hunger', restoreRate: 0.5, durationRange: [25, 40],  targetBlock: 'chest' },
  farm:      { label: '耕作', icon: '🌾', color: '#4CAF50', needKey: null,     restoreKey: null,     restoreRate: 0,   durationRange: [50, 80],  targetBlock: 'farmland' },
  cook:      { label: '烹饪', icon: '🔥', color: '#FF5722', needKey: null,     restoreKey: 'hunger', restoreRate: 0.3, durationRange: [30, 50],  targetBlock: 'furnace' },
  socialize: { label: '聊天', icon: '💬', color: '#E91E63', needKey: 'social', restoreKey: 'social', restoreRate: 0.4, durationRange: [25, 40],  targetBlock: null },
  read:      { label: '阅读', icon: '📖', color: '#9C27B0', needKey: 'mood',   restoreKey: 'mood',   restoreRate: 0.3, durationRange: [30, 50],  targetBlock: null },
  patrol:    { label: '巡逻', icon: '🛡️', color: '#F44336', needKey: null,     restoreKey: null,     restoreRate: 0,   durationRange: [60, 90],  targetBlock: null },
  build:     { label: '建造', icon: '🔨', color: '#2196F3', needKey: null,     restoreKey: 'mood',   restoreRate: 0.1, durationRange: [40, 70],  targetBlock: null },
  wander:    { label: '散步', icon: '🚶', color: '#00BCD4', needKey: null,     restoreKey: 'mood',   restoreRate: 0.15, durationRange: [30, 50], targetBlock: null },
  rest:      { label: '休息', icon: '💤', color: '#888888', needKey: 'rest',   restoreKey: 'rest',   restoreRate: 0.2, durationRange: [20, 35],  targetBlock: null },
};

const AI_GOAL_KEYS = Object.keys(AI_GOALS);

const AI_THOUGHTS = {
  sleep_urgent: '太困了...必须找张床休息',
  sleep_night: '天黑了，该回家睡觉了',
  sleep_normal: '有些疲惫，想躺一会儿',
  eat_urgent: '快饿晕了！赶紧找东西吃',
  eat_mealtime: '到饭点了，去吃点东西',
  eat_normal: '肚子有点饿，找些食物',
  farm_work: '该去田里看看庄稼了',
  farm_harvest: '麦子熟了，去收割吧',
  cook_need: '做一顿热饭补充体力',
  socialize_lonely: '好久没跟人说话了...',
  socialize_meet: '去和邻居打个招呼吧',
  read_bored: '看看书放松一下心情',
  read_study: '去研究些新知识',
  patrol_duty: '该去村子周围巡逻了',
  patrol_night: '夜晚了，加强警戒',
  build_job: '有建筑工程要做',
  build_improve: '改善一下居住环境',
  wander_explore: '出去走走看看风景',
  wander_relax: '散散步放松心情',
  rest_tired: '歇会儿恢复体力',
  rest_relax: '坐下来休息一阵',
};

const SOCIAL_CHATS = {
  greeting: ['你好啊！', '今天天气真好！', '最近怎么样？', '嘿，忙什么呢？'],
  work:     ['活儿干完了真舒服', '今天产量不错', '该加把劲了'],
  hungry:   ['好饿啊...', '该吃饭了', '肚子咕咕叫'],
  tired:    ['好困...', '该休息了', '累死了'],
  happy:    ['心情不错！', '今天真开心', '生活真美好'],
};

function randomFromArray(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const PROFESSION_GOAL_BONUS = {
  farmer:     { farm: 35, cook: 10 },
  builder:    { build: 35 },
  blacksmith: { cook: 25, build: 15 },
  librarian:  { read: 35, socialize: 10 },
  guard:      { patrol: 35, wander: 5 },
};

const BLOCK_SEARCH_RADIUS = 20;

const NPC_NAMES = ['小石', '木子', '阿土', '水灵', '砖匠', '草儿', '云朵', '铁柱',
  '大山', '秀兰', '金锤', '墨香', '安平', '春花', '志远', '巧儿'];

/* ================================================================
   Goal activity display helper
   ================================================================ */

function getActivityDisplay(npc) {
  if (!npc.currentGoal) return '思考中...';
  const goal = AI_GOALS[npc.currentGoal];
  if (!goal) return '空闲';
  if (npc.goalPhase === 'walking') return '前往' + goal.label;
  if (npc.goalPhase === 'performing') return goal.label + '中';
  return '思考中...';
}

function getGoalProgress(npc) {
  if (!npc.currentGoal || npc.goalPhase !== 'performing' || !npc.activityTicks) return 0;
  const goal = AI_GOALS[npc.currentGoal];
  if (!goal) return 0;
  const maxDuration = goal.durationRange[1];
  return Math.max(0, Math.min(100, 100 - (npc.activityTicks / maxDuration * 100)));
}

/* ================================================================
   Physics Constants
   ================================================================ */

const PHYSICS = {
  GRAVITY: -0.05,
  MAX_FALL_SPEED: -1.0,
  MAX_STEP_HEIGHT: 1.05,
  WALK_SPEED: 0.1,
  SWIM_SPEED: 0.045,
  SWIM_UP_SPEED: 0.07,
  BUOYANCY: 0.035,
  WATER_DRAG: -0.025,
  MAX_OXYGEN: 100,
  OXYGEN_DRAIN: 0.35,
  OXYGEN_RECOVER: 0.8,
  STUCK_TIMEOUT: 200,
  NPC_COLLISION_RADIUS: 0.6,
  Y_LERP_FACTOR: 0.25,
};

/* ================================================================
   AI Decision Engine — Goal scoring & target finding
   ================================================================ */

/* ================================================================
   Villager NPC Factory
   ================================================================ */

function createNPC(id, x, z, profession) {
  const prof = profession || PROFESSION_LIST[id % PROFESSION_LIST.length];
  return {
    id,
    name: NPC_NAMES[id % NPC_NAMES.length],
    profession: prof,
    x, z,
    y: 0,
    vy: 0,
    onGround: false,
    inWater: false,
    oxygen: PHYSICS.MAX_OXYGEN,
    mood: 50 + Math.random() * 40,
    hunger: 40 + Math.random() * 40,
    rest: 50 + Math.random() * 40,
    social: 30 + Math.random() * 40,
    // Goal-driven AI fields
    currentGoal: null,
    goalPhase: 'idle',       // 'idle' | 'walking' | 'performing'
    thoughtBubble: '',
    interactTarget: null,
    lastGoal: null,
    goalCooldown: Math.floor(Math.random() * 20),
    activityTicks: 0,
    targetX: null,
    targetZ: null,
    homeX: x,
    homeZ: z,
    workX: x + (Math.random() * 8 - 4),
    workZ: z + (Math.random() * 8 - 4),
    facing: 0,               // radians, yaw rotation for facing direction
    inventory: [],
    color: `hsl(${(id * 83) % 360}, 70%, 55%)`,
    needsYInit: true,
    lastChat: '',
    lastChatTick: 0,
    isLLMControlled: false,   // true for LLM-controlled NPC
    llmGoalQueue: [],         // queued goals from LLM commands
  };
}

function createLLMControlledNPC(id, x, z) {
  const npc = createNPC(id, x, z, 'builder');
  npc.name = '小智';
  npc.isLLMControlled = true;
  npc.color = '#FFD700';
  npc.thoughtBubble = '等待指令...';
  return npc;
}

/* ================================================================
   LLM Command System — Parse natural language to NPC goals
   ================================================================ */

const LLM_COMMAND_SYSTEM_PROMPT = `你是一个体素世界中角色"小智"的AI控制器。你基于视觉导航来决策——你能看到角色周围的环境信息。
用户会用自然语言给你指令，你需要结合当前视野信息，将指令转换为JSON格式的动作序列。

可用的动作(goal)类型：
- sleep: 睡觉休息
- eat: 吃饭
- farm: 耕作/种地
- cook: 烹饪做饭
- socialize: 社交聊天
- read: 阅读学习
- patrol: 巡逻
- build: 建造
- wander: 散步/移动
- rest: 休息

每个动作可以附带目标坐标(targetX, targetZ)和描述(thought)。
根据视野中看到的环境信息(方块类型、地形、附近NPC等)，智能选择目标坐标。
例如：如果看到农田在某个方向，去耕地时应朝那个方向设置坐标。

请严格按以下JSON格式回复，不要包含其他文字：
{"actions":[{"goal":"动作类型","thought":"角色心理活动描述","targetX":数字或null,"targetZ":数字或null}]}

示例：
用户说"去耕地干活"，视野中南方有农田→ {"actions":[{"goal":"farm","thought":"看到南边有农田，过去干活！","targetX":null,"targetZ":null}]}
用户说"去坐标10,5的地方建房子"→ {"actions":[{"goal":"wander","thought":"先走到目标位置","targetX":10,"targetZ":5},{"goal":"build","thought":"开始建造房屋","targetX":10,"targetZ":5}]}
用户说"先吃饭再去巡逻"→ {"actions":[{"goal":"eat","thought":"先填饱肚子","targetX":null,"targetZ":null},{"goal":"patrol","thought":"吃饱了去巡逻","targetX":null,"targetZ":null}]}
用户说"去散步"→ {"actions":[{"goal":"wander","thought":"出去走走散散心","targetX":null,"targetZ":null}]}`;

/**
 * Generate a text description of what the NPC "sees" from its current position and facing.
 * Used for vision-based LLM navigation.
 */
function getVisionDescription(npc, allBlocks, allNpcs) {
  var desc = [];
  var px = Math.floor(npc.x), pz = Math.floor(npc.z), py = Math.floor(npc.y);
  var facing = npc.facing || 0;

  // Cardinal direction from facing angle
  var facingDeg = ((facing * 180 / Math.PI) % 360 + 360) % 360;
  var facingDir = facingDeg < 45 || facingDeg >= 315 ? '北' :
    facingDeg < 135 ? '东' : facingDeg < 225 ? '南' : '西';
  desc.push('朝向: ' + facingDir);

  // Scan nearby blocks in view range
  var viewRange = 8;
  var blockCounts = {};
  var nearestBlocks = {};
  var obstacles = [];

  for (var dx = -viewRange; dx <= viewRange; dx++) {
    for (var dz = -viewRange; dz <= viewRange; dz++) {
      var dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > viewRange) continue;
      var wx = px + dx, wz = pz + dz;
      // Check surface block
      for (var sy = py + 3; sy >= py - 3; sy--) {
        var bt = allBlocks ? allBlocks.get(makeKey(wx, sy, wz)) : undefined;
        if (bt && bt !== 'dirt' && bt !== 'grass' && bt !== 'stone') {
          blockCounts[bt] = (blockCounts[bt] || 0) + 1;
          if (!nearestBlocks[bt] || dist < nearestBlocks[bt].dist) {
            nearestBlocks[bt] = { x: wx, z: wz, dist: dist };
          }
          break;
        }
        if (bt) break;
      }
      // Check for walls at head height (obstacles in front)
      if (dist < 3) {
        if (isSolidBlock(allBlocks, wx, py, wz) || isSolidBlock(allBlocks, wx, py + 1, wz)) {
          obstacles.push({ x: wx, z: wz });
        }
      }
    }
  }

  // Describe interesting blocks
  var interestingBlocks = ['farmland', 'wheat1', 'wheat2', 'wheat3', 'bed', 'furnace',
    'chest', 'bookshelf', 'crafting_table', 'anvil', 'fence', 'torch', 'flower'];
  for (var bi = 0; bi < interestingBlocks.length; bi++) {
    var btype = interestingBlocks[bi];
    if (nearestBlocks[btype]) {
      var nb = nearestBlocks[btype];
      var dirStr = getDirectionStr(px, pz, nb.x, nb.z);
      desc.push(BLOCK_TYPES[btype].label + ': ' + dirStr + ' (距离' + Math.round(nb.dist) + ')');
    }
  }

  if (obstacles.length > 3) {
    desc.push('附近有障碍物(' + obstacles.length + '处)');
  }

  // Describe nearby NPCs
  if (allNpcs) {
    for (var ni = 0; ni < allNpcs.length; ni++) {
      var other = allNpcs[ni];
      if (other.id === npc.id) continue;
      var odx = other.x - npc.x, odz = other.z - npc.z;
      var odist = Math.sqrt(odx * odx + odz * odz);
      if (odist < viewRange) {
        var odir = getDirectionStr(npc.x, npc.z, other.x, other.z);
        desc.push('NPC ' + other.name + ': ' + odir + ' (距离' + Math.round(odist) + ')');
      }
    }
  }

  return desc.join('\n');
}

function getDirectionStr(fromX, fromZ, toX, toZ) {
  var dx = toX - fromX, dz = toZ - fromZ;
  var angle = ((Math.atan2(dx, dz) * 180 / Math.PI) % 360 + 360) % 360;
  if (angle < 22.5 || angle >= 337.5) return '北方';
  if (angle < 67.5) return '东北方';
  if (angle < 112.5) return '东方';
  if (angle < 157.5) return '东南方';
  if (angle < 202.5) return '南方';
  if (angle < 247.5) return '西南方';
  if (angle < 292.5) return '西方';
  return '西北方';
}

/**
 * Determine if a command needs deep thinking (complex/critical decisions).
 * Simple commands: basic movement, eating, sleeping
 * Complex commands: building, multi-step plans, patrol routes
 */
function needsDeepThinking(commandText) {
  var simpleKeywords = ['散步', '走', '吃', '睡', '休息', '聊天', '看书'];
  var complexKeywords = ['建造', '建', '盖', '规划', '巡逻', '寻找', '探索', '分析', '策略'];
  var text = commandText.toLowerCase();
  for (var ci = 0; ci < complexKeywords.length; ci++) {
    if (text.includes(complexKeywords[ci])) return true;
  }
  for (var si = 0; si < simpleKeywords.length; si++) {
    if (text.includes(simpleKeywords[si])) return false;
  }
  // Multi-step commands (containing "然后", "再", "先...再") are complex
  if (text.includes('然后') || text.includes('先') || text.includes('接着')) return true;
  return false;
}

function parseLLMResponse(responseText) {
  try {
    // Try to extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*"actions"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.actions && Array.isArray(parsed.actions)) {
        return parsed.actions.filter(function(a) {
          return a.goal && AI_GOALS[a.goal];
        }).map(function(a) {
          return {
            goal: a.goal,
            thought: a.thought || AI_GOALS[a.goal].label,
            targetX: typeof a.targetX === 'number' ? a.targetX : null,
            targetZ: typeof a.targetZ === 'number' ? a.targetZ : null,
          };
        });
      }
    }
  } catch (e) {
    // Parse error — try simple keyword matching fallback
  }
  // Fallback: keyword-based command parsing
  const text = responseText.toLowerCase();
  const goalMap = {
    '睡': 'sleep', '吃': 'eat', '耕': 'farm', '种': 'farm', '做饭': 'cook', '烹': 'cook',
    '聊': 'socialize', '社交': 'socialize', '读': 'read', '看书': 'read', '学': 'read',
    '巡': 'patrol', '建': 'build', '走': 'wander', '散步': 'wander', '休息': 'rest',
  };
  for (const [keyword, goal] of Object.entries(goalMap)) {
    if (text.includes(keyword)) {
      return [{ goal: goal, thought: AI_GOALS[goal].label, targetX: null, targetZ: null }];
    }
  }
  return [{ goal: 'wander', thought: '不太明白，先走走看', targetX: null, targetZ: null }];
}

/* ================================================================
   Time Helpers
   ================================================================ */

function tickToHour(worldTime) {
  return Math.floor((worldTime % DAY_LENGTH) / (DAY_LENGTH / 24));
}

function tickToTimeStr(worldTime) {
  const hour = tickToHour(worldTime);
  const minute = Math.floor(((worldTime % DAY_LENGTH) / (DAY_LENGTH / 24) - hour) * 60);
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function isDaytime(worldTime) {
  const h = tickToHour(worldTime);
  return h >= 6 && h < 20;
}

/* ================================================================
   Physics helpers
   ================================================================ */

function makeKey(x, y, z) {
  return `${x},${y},${z}`;
}

function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

function worldToChunk(wx, wz) {
  return {
    cx: Math.floor(wx / CHUNK_SIZE),
    cz: Math.floor(wz / CHUNK_SIZE),
  };
}

function isSolidBlock(allBlocks, x, y, z) {
  const bt = allBlocks ? allBlocks.get(makeKey(x, y, z)) : undefined;
  if (!bt) return false;
  return !BLOCK_TYPES[bt].transparent;
}

/**
 * Check if a position is walkable: the foot and head positions must not be inside solid blocks.
 */
function isWalkable(allBlocks, x, y, z) {
  if (!allBlocks || allBlocks.size === 0) return true;
  const bx = Math.floor(x), bz = Math.floor(z), by = Math.floor(y);
  // Foot and head must be free of solid blocks
  if (isSolidBlock(allBlocks, bx, by, bz)) return false;
  if (isSolidBlock(allBlocks, bx, by + 1, bz)) return false;
  return true;
}

function findGroundBelow(allBlocks, x, startY, z) {
  if (!allBlocks || allBlocks.size === 0) return 1;
  const bx = Math.floor(x), bz = Math.floor(z);
  for (let y = Math.floor(startY); y >= 0; y--) {
    if (isSolidBlock(allBlocks, bx, y, bz)) return y + 1;
  }
  return 1;
}

function findSurfaceY(allBlocks, x, z) {
  return findGroundBelow(allBlocks, x, CHUNK_HEIGHT - 1, z);
}

/* ================================================================
   AI Decision Engine — Goal scoring & target finding
   ================================================================ */

function chooseGoal(npc, worldTime) {
  const hour = tickToHour(worldTime);
  const night = !isDaytime(worldTime);
  let bestGoal = 'rest';
  let bestScore = -1;

  for (let i = 0; i < AI_GOAL_KEYS.length; i++) {
    const goalKey = AI_GOAL_KEYS[i];
    const goal = AI_GOALS[goalKey];
    let score = 0;

    // Need-based urgency
    if (goal.needKey) {
      const val = npc[goal.needKey] != null ? npc[goal.needKey] : 50;
      if (val < 15) score += 90;
      else if (val < 30) score += 60;
      else if (val < 50) score += 30;
      else if (val < 70) score += 10;
    }

    // Time-of-day
    if (goalKey === 'sleep') {
      if (night) score += 45;
      else score -= 20;
    }
    if (goalKey === 'eat' && (hour === 7 || hour === 12 || hour === 18)) score += 30;
    if ((goalKey === 'farm' || goalKey === 'build') && !night) score += 15;
    if ((goalKey === 'farm' || goalKey === 'build') && night) score -= 15;
    if (goalKey === 'patrol' && night) score += 20;

    // Profession bonuses
    const bonus = PROFESSION_GOAL_BONUS[npc.profession];
    if (bonus && bonus[goalKey]) {
      score += bonus[goalKey];
    }

    // Avoid repetition
    if (npc.lastGoal === goalKey) score -= 15;

    // Random factor
    score += Math.random() * 12;
    score = Math.max(0, score);

    if (score > bestScore) {
      bestScore = score;
      bestGoal = goalKey;
    }
  }
  return bestGoal;
}

function getThought(npc, goalKey, worldTime) {
  const night = !isDaytime(worldTime);
  const hour = tickToHour(worldTime);
  switch (goalKey) {
    case 'sleep':
      if (npc.rest < 20) return AI_THOUGHTS.sleep_urgent;
      if (night) return AI_THOUGHTS.sleep_night;
      return AI_THOUGHTS.sleep_normal;
    case 'eat':
      if (npc.hunger < 20) return AI_THOUGHTS.eat_urgent;
      if (hour === 7 || hour === 12 || hour === 18) return AI_THOUGHTS.eat_mealtime;
      return AI_THOUGHTS.eat_normal;
    case 'farm':
      return Math.random() > 0.5 ? AI_THOUGHTS.farm_work : AI_THOUGHTS.farm_harvest;
    case 'cook':
      return AI_THOUGHTS.cook_need;
    case 'socialize':
      if (npc.social < 25) return AI_THOUGHTS.socialize_lonely;
      return AI_THOUGHTS.socialize_meet;
    case 'read':
      if (npc.mood < 30) return AI_THOUGHTS.read_bored;
      return AI_THOUGHTS.read_study;
    case 'patrol':
      if (night) return AI_THOUGHTS.patrol_night;
      return AI_THOUGHTS.patrol_duty;
    case 'build':
      return Math.random() > 0.5 ? AI_THOUGHTS.build_job : AI_THOUGHTS.build_improve;
    case 'wander':
      return Math.random() > 0.5 ? AI_THOUGHTS.wander_explore : AI_THOUGHTS.wander_relax;
    case 'rest':
      if (npc.rest < 30) return AI_THOUGHTS.rest_tired;
      return AI_THOUGHTS.rest_relax;
    default:
      return '在想些什么...';
  }
}

function findNearestBlockXZ(allBlocks, cx, cz, blockType, radius) {
  let bestDist = Infinity, bestPos = null;
  // Search in expanding rings for faster early exit
  for (let ring = 0; ring <= radius; ring++) {
    if (ring * ring >= bestDist) break; // Can't find closer in outer rings
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dz = -ring; dz <= ring; dz++) {
        if (Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue; // Only check ring perimeter
        const dist2 = dx * dx + dz * dz;
        if (dist2 >= bestDist) continue;
        for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
          const key = makeKey(cx + dx, y, cz + dz);
          const bt = allBlocks.get(key);
          if (bt === blockType) {
            bestDist = dist2;
            bestPos = { x: cx + dx, z: cz + dz };
            break;
          }
          if (bt && !BLOCK_TYPES[bt].transparent) break;
        }
      }
    }
  }
  return bestPos;
}

function getGoalTarget(npc, goalKey, allBlocks, allNpcs) {
  switch (goalKey) {
    case 'sleep': {
      if (allBlocks && allBlocks.size > 0) {
        const found = findNearestBlockXZ(allBlocks, Math.floor(npc.x), Math.floor(npc.z), 'bed', BLOCK_SEARCH_RADIUS);
        if (found) return { x: found.x + 0.5, z: found.z + 0.5 };
      }
      return { x: npc.homeX, z: npc.homeZ };
    }
    case 'eat': {
      if (allBlocks && allBlocks.size > 0) {
        const found = findNearestBlockXZ(allBlocks, Math.floor(npc.x), Math.floor(npc.z), 'chest', BLOCK_SEARCH_RADIUS);
        if (found) return { x: found.x + 0.5, z: found.z + 0.5 };
      }
      return { x: npc.homeX + 1, z: npc.homeZ + 1 };
    }
    case 'read':
      return { x: npc.homeX + 1, z: npc.homeZ + 1 };
    case 'farm':
      if (npc.profession === 'farmer') return { x: npc.workX, z: npc.workZ };
      return { x: npc.homeX, z: npc.homeZ };
    case 'cook': {
      if (allBlocks && allBlocks.size > 0) {
        const found = findNearestBlockXZ(allBlocks, Math.floor(npc.x), Math.floor(npc.z), 'furnace', BLOCK_SEARCH_RADIUS);
        if (found) return { x: found.x + 0.5, z: found.z + 0.5 };
      }
      return { x: npc.workX, z: npc.workZ };
    }
    case 'socialize': {
      if (!allNpcs || allNpcs.length <= 1) return null;
      let nearest = null, bestDist = Infinity;
      for (let ni = 0; ni < allNpcs.length; ni++) {
        if (allNpcs[ni].id === npc.id) continue;
        const ddx = allNpcs[ni].x - npc.x, ddz = allNpcs[ni].z - npc.z;
        const d = ddx * ddx + ddz * ddz;
        if (d < bestDist) { bestDist = d; nearest = allNpcs[ni]; }
      }
      if (nearest) return { x: nearest.x + (Math.random() - 0.5), z: nearest.z + (Math.random() - 0.5) };
      return null;
    }
    case 'patrol': {
      const angle = Math.random() * Math.PI * 2;
      const r = 10 + Math.random() * 15;
      return { x: npc.homeX + Math.cos(angle) * r, z: npc.homeZ + Math.sin(angle) * r };
    }
    case 'build':
      return { x: npc.workX + (Math.random() * 4 - 2), z: npc.workZ + (Math.random() * 4 - 2) };
    case 'wander':
      return { x: npc.x + (Math.random() * 16 - 8), z: npc.z + (Math.random() * 16 - 8) };
    case 'rest':
      return null;
    default:
      return null;
  }
}

/* ================================================================
   NPC Update with physics + goal-driven AI
   ================================================================ */

function updateNPC(npc, allBlocks, worldTime, allNpcs, addLogEntry) {
  const u = { ...npc };
  const hasBlocks = allBlocks && allBlocks.size > 0;

  // --- Init Y from terrain on first tick ---
  if (u.needsYInit && hasBlocks) {
    u.y = findSurfaceY(allBlocks, u.x, u.z);
    u.needsYInit = false;
    u.onGround = true;
  }

  // --- Physics: gravity & water ---
  if (hasBlocks) {
    if (!u.onGround && !u.inWater) {
      u.vy = Math.max(u.vy + PHYSICS.GRAVITY, PHYSICS.MAX_FALL_SPEED);
    }
    const bx = Math.floor(u.x), bz = Math.floor(u.z), by = Math.floor(u.y);
    const feetBt = allBlocks.get(makeKey(bx, by, bz));
    const headBt = allBlocks.get(makeKey(bx, by + 1, bz));
    u.inWater = feetBt === 'water' || headBt === 'water';

    if (u.inWater) {
      u.vy = Math.max(u.vy, PHYSICS.WATER_DRAG);
      u.vy += PHYSICS.BUOYANCY;
      u.vy = Math.min(u.vy, PHYSICS.SWIM_UP_SPEED);
      u.oxygen = Math.max(0, u.oxygen - PHYSICS.OXYGEN_DRAIN);
      if (u.oxygen <= 0) u.mood = Math.max(0, u.mood - 0.5);
    } else {
      u.oxygen = Math.min(PHYSICS.MAX_OXYGEN, u.oxygen + PHYSICS.OXYGEN_RECOVER);
    }

    const newY = u.y + u.vy;
    const groundY = findGroundBelow(allBlocks, u.x, u.y + 1, u.z);
    if (newY <= groundY) {
      // Smooth landing with lerp
      u.y = u.y + (groundY - u.y) * PHYSICS.Y_LERP_FACTOR;
      if (Math.abs(u.y - groundY) < 0.1) u.y = groundY;
      u.vy = 0;
      u.onGround = true;
    } else {
      u.y = newY;
      u.onGround = false;
    }
    u.y = Math.max(1, Math.min(CHUNK_HEIGHT - 1, u.y));

    // --- Push out of wall: if NPC is inside a solid block, teleport to surface ---
    if (!isWalkable(allBlocks, u.x, u.y, u.z)) {
      const surfY = findSurfaceY(allBlocks, u.x, u.z);
      if (isWalkable(allBlocks, u.x, surfY, u.z)) {
        u.y = surfY;
        u.onGround = true;
        u.vy = 0;
      } else {
        // Surface is also blocked, try nearby offsets
        var pushed = false;
        for (var offset = 1; offset <= 3 && !pushed; offset++) {
          var dirs = [[offset, 0], [-offset, 0], [0, offset], [0, -offset]];
          for (var di = 0; di < dirs.length; di++) {
            var tx = u.x + dirs[di][0], tz = u.z + dirs[di][1];
            var ty = findSurfaceY(allBlocks, tx, tz);
            if (isWalkable(allBlocks, tx, ty, tz)) {
              u.x = tx; u.z = tz; u.y = ty;
              u.onGround = true; u.vy = 0;
              pushed = true;
              break;
            }
          }
        }
      }
    }

    // --- NPC collision avoidance ---
    if (allNpcs) {
      for (let ni = 0; ni < allNpcs.length; ni++) {
        const other = allNpcs[ni];
        if (other.id === u.id) continue;
        const ddx = u.x - other.x, ddz = u.z - other.z;
        const d = Math.sqrt(ddx * ddx + ddz * ddz);
        const MIN_COLLISION_DIST = 0.01;
        if (d < PHYSICS.NPC_COLLISION_RADIUS && d > MIN_COLLISION_DIST) {
          const pushStr = (PHYSICS.NPC_COLLISION_RADIUS - d) * 0.3;
          u.x += (ddx / d) * pushStr;
          u.z += (ddz / d) * pushStr;
        }
      }
    }
  }

  // --- Force swim up when drowning ---
  if (u.inWater && u.oxygen < 30) {
    u.vy = PHYSICS.SWIM_UP_SPEED;
    if (u.goalPhase === 'walking') {
      u.goalPhase = 'idle';
      u.currentGoal = null;
      u.targetX = null;
      u.targetZ = null;
    }
  }

  // --- Stat decay (time-based) ---
  u.hunger = Math.max(0, u.hunger - 0.05);
  u.rest   = Math.max(0, u.rest - (u.goalPhase === 'performing' && u.currentGoal === 'sleep' ? -0.6 : 0.035));
  u.social = Math.max(0, u.social - 0.02);
  u.mood   = Math.max(0, Math.min(100,
    u.mood + (u.hunger > 50 && u.rest > 50 ? 0.02 : -0.02)
    + (u.social > 40 ? 0.01 : -0.01)));

  // --- Goal-based activity effects ---
  if (u.goalPhase === 'performing' && u.currentGoal) {
    const goal = AI_GOALS[u.currentGoal];
    if (goal && goal.restoreKey) {
      u[goal.restoreKey] = Math.min(100, (u[goal.restoreKey] || 0) + goal.restoreRate);
    }
    if (u.currentGoal === 'socialize') {
      u.social = Math.min(100, u.social + 0.4);
    }
    if (u.currentGoal === 'eat') {
      // Consume food from inventory when starting to eat
      if (u.activityTicks > 0 && u.activityTicks % 20 === 0) {
        const foodIdx = u.inventory.findIndex(function(item) { return item.type === 'wheat3'; });
        if (foodIdx >= 0) {
          u.inventory = u.inventory.filter(function(_, i) { return i !== foodIdx; });
          u.hunger = Math.min(100, u.hunger + 20);
        }
      }
    }
    if (u.currentGoal === 'farm' && Math.random() < 0.005) {
      u.inventory = u.inventory.concat([{ type: 'wheat3', label: '小麦' }]).slice(-8);
    }
    u.activityTicks = Math.max(0, (u.activityTicks || 0) - 1);
    if (u.activityTicks <= 0) {
      // Goal complete
      u.lastGoal = u.currentGoal;
      u.currentGoal = null;
      u.goalPhase = 'idle';
      u.interactTarget = null;
      u.goalCooldown = 10 + Math.floor(Math.random() * 20);
    }
  }

  // --- Walking to target ---
  if (u.goalPhase === 'walking' && u.targetX != null) {
    const dx = u.targetX - u.x, dz = u.targetZ - u.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.5) {
      // Arrived at target — start performing
      u.goalPhase = 'performing';
      u.targetX = null;
      u.targetZ = null;
      const goal = AI_GOALS[u.currentGoal];
      if (goal) {
        const dMin = goal.durationRange[0], dMax = goal.durationRange[1];
        u.activityTicks = dMin + Math.floor(Math.random() * (dMax - dMin));
      }
      if (u.currentGoal === 'socialize') {
        u.lastChat = randomFromArray(SOCIAL_CHATS.greeting);
        u.lastChatTick = worldTime;
      }
    } else {
      const spd = u.inWater ? PHYSICS.SWIM_SPEED : PHYSICS.WALK_SPEED;
      const nx = u.x + (dx / dist) * spd;
      const nz = u.z + (dz / dist) * spd;
      // Update facing direction toward movement target
      u.facing = Math.atan2(dx, dz);
      if (hasBlocks) {
        const destY = findGroundBelow(allBlocks, nx, u.y + 2, nz);
        const canStep = destY - u.y <= PHYSICS.MAX_STEP_HEIGHT;
        const walkable = isWalkable(allBlocks, nx, destY, nz);
        if (canStep && walkable) {
          u.x = nx;
          u.z = nz;
          if (destY > u.y && u.onGround) u.y = destY;
          u.stuckTicks = 0;
        } else {
          // Obstacle — try perpendicular directions before random reroute
          u.stuckTicks = (u.stuckTicks || 0) + 1;
          const perpX = -dz / dist;
          const perpZ = dx / dist;
          const side = u.stuckTicks % 2 === 0 ? 1 : -1;
          const altX = u.x + perpX * spd * side;
          const altZ = u.z + perpZ * spd * side;
          const altY = findGroundBelow(allBlocks, altX, u.y + 2, altZ);
          const altWalkable = isWalkable(allBlocks, altX, altY, altZ);
          if (altY - u.y <= PHYSICS.MAX_STEP_HEIGHT && altWalkable) {
            u.x = altX;
            u.z = altZ;
            if (altY > u.y && u.onGround) u.y = altY;
          } else if (u.stuckTicks > Math.floor(PHYSICS.STUCK_TIMEOUT * 0.33)) {
            // Stuck too long — reroute to nearby walkable position
            u.targetX = u.x + (Math.random() * 8 - 4);
            u.targetZ = u.z + (Math.random() * 8 - 4);
            u.stuckTicks = 0;
          }
          // Full stuck timeout — abandon goal
          if (u.stuckTicks > PHYSICS.STUCK_TIMEOUT) {
            u.currentGoal = null;
            u.goalPhase = 'idle';
            u.targetX = null;
            u.targetZ = null;
            u.stuckTicks = 0;
          }
        }
      } else {
        u.x = nx;
        u.z = nz;
      }
    }
  }

  // --- Goal evaluation (when idle) ---
  if (u.goalPhase === 'idle') {
    if (u.isLLMControlled) {
      // LLM-controlled NPC: execute queued commands instead of autonomous AI
      if (u.llmGoalQueue && u.llmGoalQueue.length > 0) {
        const cmd = u.llmGoalQueue[0];
        u.llmGoalQueue = u.llmGoalQueue.slice(1);
        if (cmd.goal && AI_GOALS[cmd.goal]) {
          u.currentGoal = cmd.goal;
          u.thoughtBubble = cmd.thought || AI_GOALS[cmd.goal].label;
          if (cmd.targetX != null && cmd.targetZ != null) {
            u.goalPhase = 'walking';
            u.targetX = cmd.targetX;
            u.targetZ = cmd.targetZ;
          } else {
            const target = getGoalTarget(u, cmd.goal, allBlocks, allNpcs);
            if (target) {
              u.goalPhase = 'walking';
              u.targetX = target.x;
              u.targetZ = target.z;
              u.interactTarget = target;
            } else {
              u.goalPhase = 'performing';
              const goal = AI_GOALS[cmd.goal];
              const dMin = goal.durationRange[0], dMax = goal.durationRange[1];
              u.activityTicks = dMin + Math.floor(Math.random() * (dMax - dMin));
            }
          }
          if (addLogEntry) {
            addLogEntry(u.name, '🤖 ' + u.thoughtBubble);
          }
        } else if (cmd.targetX != null && cmd.targetZ != null) {
          // Move-only command (no specific goal)
          u.currentGoal = 'wander';
          u.thoughtBubble = cmd.thought || '前往指定位置';
          u.goalPhase = 'walking';
          u.targetX = cmd.targetX;
          u.targetZ = cmd.targetZ;
          if (addLogEntry) {
            addLogEntry(u.name, '🤖 ' + u.thoughtBubble);
          }
        }
      } else {
        // LLM NPC stays idle when no commands
        u.thoughtBubble = '等待指令...';
      }
    } else {
      // Autonomous NPC: standard AI goal selection
      u.goalCooldown = Math.max(0, (u.goalCooldown || 0) - 1);
      if (u.goalCooldown <= 0) {
        const newGoal = chooseGoal(u, worldTime);
        u.currentGoal = newGoal;
        u.thoughtBubble = getThought(u, newGoal, worldTime);

        const target = getGoalTarget(u, newGoal, allBlocks, allNpcs);
        if (target) {
          u.goalPhase = 'walking';
          u.targetX = target.x;
          u.targetZ = target.z;
          u.interactTarget = target;
        } else {
          u.goalPhase = 'performing';
          const goal = AI_GOALS[newGoal];
          const dMin = goal.durationRange[0], dMax = goal.durationRange[1];
          u.activityTicks = dMin + Math.floor(Math.random() * (dMax - dMin));
        }

        if (addLogEntry) {
          addLogEntry(u.name, AI_GOALS[newGoal].icon + ' ' + u.thoughtBubble);
        }
      }
    }
  }

  return u;
}

/* ================================================================
   Terrain generator using simplex noise — Minecraft-style
   Village-aware: terrain flattens and blends smoothly around village
   ================================================================ */

const VILLAGE_RADIUS = 28;
const VILLAGE_BLEND = 14;

function createTerrainGenerator(seed) {
  const noise2d = createNoise2D(() => seed);
  const noise2d2 = createNoise2D(() => seed + 0.1);
  const noise2d3 = createNoise2D(() => seed + 0.2);

  // Raw height without village influence
  function getRawHeight(wx, wz) {
    const n1 = noise2d(wx * 0.01, wz * 0.01) * 8;
    const n2 = noise2d2(wx * 0.03, wz * 0.03) * 4;
    const n3 = noise2d3(wx * 0.08, wz * 0.08) * 2;
    const raw = n1 + n2 + n3 + 8;
    return Math.max(1, Math.min(CHUNK_HEIGHT - 1, Math.floor(raw)));
  }

  // Find the flattest area near origin for village center
  let villageCx = 0, villageCz = 0, villageY = 8;
  {
    let bestVariance = Infinity, bestAvgY = 0;
    for (let sx = -16; sx <= 16; sx += 4) {
      for (let sz = -16; sz <= 16; sz += 4) {
        const sampleY = [];
        for (let dx = -8; dx <= 8; dx += 2) {
          for (let dz = -8; dz <= 8; dz += 2) {
            sampleY.push(getRawHeight(sx + dx, sz + dz));
          }
        }
        const avg = sampleY.reduce((a, b) => a + b, 0) / sampleY.length;
        if (avg <= WATER_LEVEL + 1) continue;
        const variance = sampleY.reduce((a, b) => a + (b - avg) ** 2, 0) / sampleY.length;
        if (variance < bestVariance) {
          bestVariance = variance;
          villageCx = sx;
          villageCz = sz;
          bestAvgY = Math.round(avg);
        }
      }
    }
    villageY = bestAvgY > WATER_LEVEL ? bestAvgY : getRawHeight(villageCx, villageCz);
  }

  // Noise-perturbed effective radius for organic village boundary
  function getEffectiveRadius(wx, wz) {
    return VILLAGE_RADIUS + noise2d(wx * 0.12 + 500, wz * 0.12 + 500) * 5;
  }

  // Height with village blending — terrain flattens smoothly around village
  // Uses noise-perturbed radius for organic, natural-looking edge
  function getHeight(wx, wz) {
    const raw = getRawHeight(wx, wz);
    const ddx = wx - villageCx, ddz = wz - villageCz;
    const dist = Math.sqrt(ddx * ddx + ddz * ddz);
    const effectiveRadius = getEffectiveRadius(wx, wz);
    if (dist <= effectiveRadius) {
      return villageY;
    }
    if (dist < effectiveRadius + VILLAGE_BLEND) {
      // Quintic smooth blend (smoother than cubic smoothstep)
      const t = (dist - effectiveRadius) / VILLAGE_BLEND;
      const s = t * t * t * (t * (t * 6 - 15) + 10); // quintic smoothstep
      return Math.max(1, Math.min(CHUNK_HEIGHT - 1, Math.floor(villageY + (raw - villageY) * s)));
    }
    return raw;
  }

  function hasTree(wx, wz) {
    // No trees in or near village — use noise-perturbed radius for consistency
    const ddx = wx - villageCx, ddz = wz - villageCz;
    const dist = Math.sqrt(ddx * ddx + ddz * ddz);
    if (dist < getEffectiveRadius(wx, wz) + VILLAGE_BLEND + 2) return false;
    const v = noise2d(wx * 0.5 + 1000, wz * 0.5 + 1000);
    return v > 0.7;
  }

  return { getHeight, hasTree, villageCx, villageCz, villageY };
}

/* ================================================================
   Village Generator — places village structures near origin
   ================================================================ */

function generateVillageBlocks(blocks, gen) {
  // Helper to set block
  function placeBlock(x, y, z, type) {
    blocks.set(makeKey(x, y, z), type);
  }

  // Use village center from terrain generator (already computed for blending)
  const cx = gen.villageCx, cz = gen.villageCz;
  const villageY = gen.villageY;

  // Helper: clear tree blocks (wood/leaf) above ground in a rectangular area.
  // Extends 3 blocks beyond bounds to catch tree canopies that overhang nearby.
  function clearTreesInArea(x1, z1, x2, z2) {
    for (let x = x1 - 3; x <= x2 + 3; x++) {
      for (let z = z1 - 3; z <= z2 + 3; z++) {
        const gy = gen.getHeight(x, z);
        for (let y = gy; y < CHUNK_HEIGHT; y++) {
          const key = makeKey(x, y, z);
          const bt = blocks.get(key);
          if (bt === 'wood' || bt === 'leaf') {
            blocks.delete(key);
          }
        }
      }
    }
  }

  // Helper: level terrain in a rectangular area to a consistent height.
  function levelGround(x1, z1, x2, z2, targetY) {
    for (let x = x1; x <= x2; x++) {
      for (let z = z1; z <= z2; z++) {
        for (let y = 1; y < targetY; y++) {
          const key = makeKey(x, y, z);
          if (!blocks.has(key)) {
            placeBlock(x, y, z, y < targetY - 1 ? 'dirt' : 'grass');
          }
        }
        for (let y = targetY; y < targetY + 8; y++) {
          const key = makeKey(x, y, z);
          const bt = blocks.get(key);
          if (bt === 'grass' || bt === 'dirt' || bt === 'stone' || bt === 'snow' || bt === 'wood' || bt === 'leaf') {
            blocks.delete(key);
          }
        }
      }
    }
  }

  // Pre-flatten the entire village area using circular check
  {
    const flatR = VILLAGE_RADIUS + 2;
    for (let x = cx - flatR - 5; x <= cx + flatR + 5; x++) {
      for (let z = cz - flatR - 5; z <= cz + flatR + 5; z++) {
        const ddx = x - cx, ddz = z - cz;
        const dist = Math.sqrt(ddx * ddx + ddz * ddz);
        if (dist > flatR) continue;
        const gy = gen.getHeight(x, z);
        for (let y = gy; y < CHUNK_HEIGHT; y++) {
          const key = makeKey(x, y, z);
          const bt = blocks.get(key);
          if (bt === 'wood' || bt === 'leaf') blocks.delete(key);
        }
        for (let y = 1; y < villageY; y++) {
          const key = makeKey(x, y, z);
          if (!blocks.has(key)) {
            placeBlock(x, y, z, y < villageY - 1 ? 'dirt' : 'grass');
          }
        }
        for (let y = villageY; y < villageY + 8; y++) {
          const key = makeKey(x, y, z);
          const bt = blocks.get(key);
          if (bt === 'grass' || bt === 'dirt' || bt === 'stone' || bt === 'snow' || bt === 'wood' || bt === 'leaf') {
            blocks.delete(key);
          }
        }
      }
    }
  }

  // ============================================================
  // 1. WELL + BELL GATHERING POINT (center hub)
  // ============================================================
  const wellY = villageY;
  clearTreesInArea(cx - 3, cz - 3, cx + 3, cz + 3);
  levelGround(cx - 3, cz - 3, cx + 3, cz + 3, wellY);
  // Well base: 3x3 cobblestone ring with water center
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) {
        placeBlock(cx, wellY - 1, cz, 'cobblestone');
        placeBlock(cx, wellY, cz, 'water');
        placeBlock(cx, wellY + 1, cz, 'water');
      } else {
        placeBlock(cx + dx, wellY, cz + dz, 'cobblestone');
        placeBlock(cx + dx, wellY + 1, cz + dz, 'cobblestone');
        placeBlock(cx + dx, wellY + 2, cz + dz, 'fence');
      }
    }
  }
  // Well roof: 4 log pillars + planks roof
  const wellPillars = [[-1,-1],[1,-1],[-1,1],[1,1]];
  for (const [px, pz] of wellPillars) {
    for (let dy = 2; dy <= 4; dy++) {
      placeBlock(cx + px, wellY + dy, cz + pz, 'log');
    }
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      placeBlock(cx + dx, wellY + 5, cz + dz, 'planks');
    }
  }
  // Bell on gathering post next to well
  placeBlock(cx + 2, wellY, cz + 2, 'cobblestone');
  placeBlock(cx + 2, wellY + 1, cz + 2, 'fence');
  placeBlock(cx + 2, wellY + 2, cz + 2, 'fence');
  placeBlock(cx + 2, wellY + 3, cz + 2, 'bell');
  // Lantern on bell post
  placeBlock(cx + 2, wellY + 4, cz + 2, 'lantern');

  // ============================================================
  // 2. ROAD SYSTEM (3-wide paths with cobblestone support)
  // ============================================================
  const pathDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [pdx, pdz] of pathDirs) {
    for (let i = 2; i < 27; i++) {
      const px = cx + pdx * i, pz = cz + pdz * i;
      const py = wellY - 1;
      if (py > WATER_LEVEL) {
        // 3-wide path
        placeBlock(px, py, pz, 'path');
        if (pdx !== 0) {
          placeBlock(px, py, pz - 1, 'path');
          placeBlock(px, py, pz + 1, 'path');
          // Cobblestone support underneath
          placeBlock(px, py - 1, pz, 'cobblestone');
          placeBlock(px, py - 1, pz - 1, 'cobblestone');
          placeBlock(px, py - 1, pz + 1, 'cobblestone');
        } else {
          placeBlock(px - 1, py, pz, 'path');
          placeBlock(px + 1, py, pz, 'path');
          placeBlock(px, py - 1, pz, 'cobblestone');
          placeBlock(px - 1, py - 1, pz, 'cobblestone');
          placeBlock(px + 1, py - 1, pz, 'cobblestone');
        }
      }
    }
  }

  // ============================================================
  // 3. HOUSES (7 houses with porches, flowers, better detail)
  // ============================================================
  function buildHouse(hx, hz, hy, sizeX, sizeZ, wallHeight) {
    clearTreesInArea(hx - 2, hz - 2, hx + sizeX + 2, hz + sizeZ + 2);
    levelGround(hx - 1, hz - 1, hx + sizeX, hz + sizeZ, hy);

    // Foundation (cobblestone base)
    for (let dx = -1; dx <= sizeX; dx++) {
      for (let dz = -1; dz <= sizeZ; dz++) {
        placeBlock(hx + dx, hy - 2, hz + dz, 'cobblestone');
      }
    }
    // Floor (wooden planks)
    for (let dx = 0; dx < sizeX; dx++) {
      for (let dz = 0; dz < sizeZ; dz++) {
        placeBlock(hx + dx, hy - 1, hz + dz, 'planks');
      }
    }

    // Walls: log corner pillars + cobblestone fill + wood top beam
    for (let dy = 0; dy < wallHeight; dy++) {
      for (let dx = 0; dx < sizeX; dx++) {
        const isCorner = dx === 0 || dx === sizeX - 1;
        const wallType = isCorner ? 'log' : 'cobblestone';
        placeBlock(hx + dx, hy + dy, hz, wallType);
        placeBlock(hx + dx, hy + dy, hz + sizeZ - 1, wallType);
      }
      for (let dz = 1; dz < sizeZ - 1; dz++) {
        placeBlock(hx, hy + dy, hz + dz, 'log');
        placeBlock(hx + sizeX - 1, hy + dy, hz + dz, 'log');
      }
      // Top beam (wood all around)
      if (dy === wallHeight - 1) {
        for (let dx = 1; dx < sizeX - 1; dx++) {
          placeBlock(hx + dx, hy + dy, hz, 'log');
          placeBlock(hx + dx, hy + dy, hz + sizeZ - 1, 'log');
        }
      }
    }

    // Door opening (front wall center)
    const doorX = hx + Math.floor(sizeX / 2);
    placeBlock(doorX, hy, hz, 'path');
    placeBlock(doorX, hy + 1, hz, 'path');
    // Door frame (log surround)
    placeBlock(doorX - 1, hy, hz, 'log');
    placeBlock(doorX + 1, hy, hz, 'log');
    placeBlock(doorX - 1, hy + 1, hz, 'log');
    placeBlock(doorX + 1, hy + 1, hz, 'log');
    placeBlock(doorX - 1, hy + 2, hz, 'log');
    placeBlock(doorX, hy + 2, hz, 'log');
    placeBlock(doorX + 1, hy + 2, hz, 'log');

    // Front porch (1 block deep overhang)
    for (let dx = 0; dx < sizeX; dx++) {
      placeBlock(hx + dx, hy - 1, hz - 1, 'planks');
    }
    // Porch fence posts at corners
    placeBlock(hx, hy, hz - 1, 'fence');
    placeBlock(hx + sizeX - 1, hy, hz - 1, 'fence');

    // Windows with glass on side walls
    if (sizeZ >= 4) {
      const winZ = hz + Math.floor(sizeZ / 2);
      placeBlock(hx, hy + 1, winZ, 'glass');
      placeBlock(hx + sizeX - 1, hy + 1, winZ, 'glass');
      if (sizeZ >= 6) {
        placeBlock(hx, hy + 1, winZ - 2, 'glass');
        placeBlock(hx + sizeX - 1, hy + 1, winZ - 2, 'glass');
      }
    }
    // Back window
    placeBlock(hx + Math.floor(sizeX / 2), hy + 1, hz + sizeZ - 1, 'glass');

    // Peaked roof (A-frame along X axis)
    const roofBase = hy + wallHeight;
    const halfX = Math.floor(sizeX / 2);
    const roofPeakH = Math.max(2, Math.floor(halfX));
    for (let layer = 0; layer <= roofPeakH; layer++) {
      const insetX = layer;
      if (insetX > halfX) break;
      for (let dz = -1; dz <= sizeZ; dz++) {
        if (hx + insetX < hx + sizeX - insetX) {
          placeBlock(hx + insetX, roofBase + layer, hz + dz, layer === roofPeakH ? 'log' : 'planks');
        }
        if (sizeX - 1 - insetX > insetX) {
          placeBlock(hx + sizeX - 1 - insetX, roofBase + layer, hz + dz, layer === roofPeakH ? 'log' : 'planks');
        }
        if (layer === roofPeakH) {
          for (let dx = insetX; dx <= sizeX - 1 - insetX; dx++) {
            placeBlock(hx + dx, roofBase + layer, hz + dz, 'log');
          }
        }
      }
    }

    // Chimney (brick)
    const chimX = hx + sizeX - 2;
    const chimZ = hz + sizeZ - 2;
    for (let dy = 0; dy <= roofPeakH + 2; dy++) {
      placeBlock(chimX, roofBase + dy, chimZ, 'brick');
    }

    // Interior furniture
    placeBlock(hx + 1, hy, hz + sizeZ - 2, 'bed');
    if (sizeX >= 6) {
      placeBlock(hx + 2, hy, hz + sizeZ - 2, 'bed');
    }
    placeBlock(hx + sizeX - 2, hy, hz + sizeZ - 2, 'chest');
    // Crafting table
    if (sizeX >= 5 && sizeZ >= 5) {
      placeBlock(hx + Math.floor(sizeX / 2), hy, hz + Math.floor(sizeZ / 2), 'crafting_table');
    }
    // Interior lanterns (brighter than torches)
    placeBlock(hx + 1, hy + 2, hz + 1, 'lantern');
    if (sizeX >= 6) {
      placeBlock(hx + sizeX - 2, hy + 2, hz + 1, 'lantern');
    }
    // Exterior lantern (above door)
    placeBlock(doorX, roofBase - 1, hz - 1, 'lantern');

    // Flower decorations next to doorway
    placeBlock(doorX - 2, hy, hz - 1, 'flower');
    placeBlock(doorX + 2, hy, hz - 1, 'flower');
  }

  const housePositions = [
    { x: 11, z: 5, sx: 5, sz: 5 },
    { x: -12, z: 5, sx: 5, sz: 5 },
    { x: 4, z: 12, sx: 5, sz: 5 },
    { x: -5, z: 12, sx: 5, sz: 5 },
    { x: 13, z: -9, sx: 5, sz: 5 },
    { x: -14, z: -9, sx: 6, sz: 5 },
    { x: -4, z: -14, sx: 5, sz: 6 },
  ];

  for (const hp of housePositions) {
    const hx = cx + hp.x, hz = cz + hp.z;
    buildHouse(hx, hz, villageY, hp.sx, hp.sz, 3);
  }

  // ============================================================
  // 4. CHURCH / TOWER (3-story cobblestone with stained glass + ladder)
  // ============================================================
  const chX = cx + 16, chZ = cz + 12;
  {
    const chy = villageY;
    clearTreesInArea(chX - 2, chZ - 2, chX + 9, chZ + 11);
    levelGround(chX - 1, chZ - 1, chX + 8, chZ + 10, chy);

    // Floor (cobblestone)
    for (let dx = 0; dx < 7; dx++) {
      for (let dz = 0; dz < 9; dz++) {
        placeBlock(chX + dx, chy - 1, chZ + dz, 'cobblestone');
      }
    }
    // Walls (4 high, cobblestone with log corner pillars)
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const isCorner = dx === 0 || dx === 6;
        placeBlock(chX + dx, chy + dy, chZ, isCorner ? 'log' : 'cobblestone');
        placeBlock(chX + dx, chy + dy, chZ + 8, isCorner ? 'log' : 'cobblestone');
      }
      for (let dz = 1; dz < 8; dz++) {
        placeBlock(chX, chy + dy, chZ + dz, 'log');
        placeBlock(chX + 6, chy + dy, chZ + dz, 'log');
      }
    }
    // Door (double tall)
    placeBlock(chX + 3, chy, chZ, 'path');
    placeBlock(chX + 3, chy + 1, chZ, 'path');
    placeBlock(chX + 3, chy + 2, chZ, 'path');
    // Stained glass windows (purple tinted)
    placeBlock(chX, chy + 1, chZ + 2, 'stained_glass');
    placeBlock(chX, chy + 2, chZ + 2, 'stained_glass');
    placeBlock(chX, chy + 1, chZ + 4, 'stained_glass');
    placeBlock(chX, chy + 2, chZ + 4, 'stained_glass');
    placeBlock(chX, chy + 1, chZ + 6, 'stained_glass');
    placeBlock(chX, chy + 2, chZ + 6, 'stained_glass');
    placeBlock(chX + 6, chy + 1, chZ + 2, 'stained_glass');
    placeBlock(chX + 6, chy + 2, chZ + 2, 'stained_glass');
    placeBlock(chX + 6, chy + 1, chZ + 4, 'stained_glass');
    placeBlock(chX + 6, chy + 2, chZ + 4, 'stained_glass');
    placeBlock(chX + 6, chy + 1, chZ + 6, 'stained_glass');
    placeBlock(chX + 6, chy + 2, chZ + 6, 'stained_glass');
    // Back window
    placeBlock(chX + 3, chy + 2, chZ + 8, 'stained_glass');
    // Peaked roof
    for (let dz = -1; dz <= 9; dz++) {
      for (let dx = -1; dx <= 7; dx++) {
        placeBlock(chX + dx, chy + 4, chZ + dz, 'cobblestone');
      }
      for (let dx = 0; dx <= 6; dx++) {
        placeBlock(chX + dx, chy + 5, chZ + dz, 'cobblestone');
      }
    }
    // Bell tower (at back, taller — 3-story height)
    for (let dy = 0; dy < 8; dy++) {
      placeBlock(chX + 2, chy + dy, chZ + 7, 'cobblestone');
      placeBlock(chX + 4, chy + dy, chZ + 7, 'cobblestone');
      placeBlock(chX + 2, chy + dy, chZ + 8, 'cobblestone');
      placeBlock(chX + 4, chy + dy, chZ + 8, 'cobblestone');
    }
    // Bell at top of tower
    placeBlock(chX + 3, chy + 7, chZ + 7, 'bell');
    placeBlock(chX + 3, chy + 7, chZ + 8, 'bell');
    // Tower cap
    for (let dx = 1; dx <= 5; dx++) {
      placeBlock(chX + dx, chy + 8, chZ + 7, 'cobblestone');
      placeBlock(chX + dx, chy + 8, chZ + 8, 'cobblestone');
    }
    // Top finial
    placeBlock(chX + 3, chy + 9, chZ + 7, 'cobblestone');
    placeBlock(chX + 3, chy + 9, chZ + 8, 'cobblestone');
    // Ladder inside tower for access (stop before bell level)
    for (let dy = 0; dy < 7; dy++) {
      placeBlock(chX + 3, chy + dy, chZ + 7, 'ladder');
    }
    // Interior lanterns
    placeBlock(chX + 1, chy + 2, chZ + 1, 'lantern');
    placeBlock(chX + 5, chy + 2, chZ + 1, 'lantern');
    placeBlock(chX + 3, chy + 2, chZ + 5, 'lantern');
    // Exterior lantern above door
    placeBlock(chX + 3, chy + 3, chZ - 1, 'lantern');
  }

  // ============================================================
  // 5. LIBRARY (2-story with bookshelves + reading area)
  // ============================================================
  const libX = cx - 16, libZ = cz + 12;
  {
    const liby = villageY;
    clearTreesInArea(libX - 2, libZ - 2, libX + 8, libZ + 8);
    levelGround(libX - 1, libZ - 1, libX + 7, libZ + 7, liby);

    // Floor
    for (let dx = 0; dx < 7; dx++) {
      for (let dz = 0; dz < 7; dz++) {
        placeBlock(libX + dx, liby - 1, libZ + dz, 'planks');
      }
    }
    // Walls (5 high for 2 stories, log corners + planks fill)
    for (let dy = 0; dy < 5; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const isCorner = dx === 0 || dx === 6;
        placeBlock(libX + dx, liby + dy, libZ, isCorner ? 'log' : 'planks');
        placeBlock(libX + dx, liby + dy, libZ + 6, isCorner ? 'log' : 'planks');
      }
      for (let dz = 1; dz < 6; dz++) {
        placeBlock(libX, liby + dy, libZ + dz, 'log');
        placeBlock(libX + 6, liby + dy, libZ + dz, 'log');
      }
    }
    // 2nd floor (planks at dy=3)
    for (let dx = 1; dx < 6; dx++) {
      for (let dz = 1; dz < 6; dz++) {
        placeBlock(libX + dx, liby + 3, libZ + dz, 'planks');
      }
    }
    // Door
    placeBlock(libX + 3, liby, libZ, 'path');
    placeBlock(libX + 3, liby + 1, libZ, 'path');
    // Windows (glass on both floors)
    placeBlock(libX, liby + 1, libZ + 2, 'glass');
    placeBlock(libX + 6, liby + 1, libZ + 2, 'glass');
    placeBlock(libX, liby + 1, libZ + 4, 'glass');
    placeBlock(libX + 6, liby + 1, libZ + 4, 'glass');
    placeBlock(libX, liby + 4, libZ + 2, 'glass');
    placeBlock(libX + 6, liby + 4, libZ + 2, 'glass');
    placeBlock(libX, liby + 4, libZ + 4, 'glass');
    placeBlock(libX + 6, liby + 4, libZ + 4, 'glass');
    // Roof (peaked)
    for (let dz = -1; dz <= 7; dz++) {
      for (let dx = -1; dx <= 7; dx++) {
        placeBlock(libX + dx, liby + 5, libZ + dz, 'planks');
      }
      for (let dx = 0; dx <= 6; dx++) {
        placeBlock(libX + dx, liby + 6, libZ + dz, 'planks');
      }
    }
    placeBlock(libX + 3, liby + 7, libZ + 3, 'log'); // roof finial
    // Interior: bookshelves along walls (both floors)
    for (let dz = 1; dz <= 5; dz++) {
      // Ground floor bookshelves
      placeBlock(libX + 1, liby, libZ + dz, 'bookshelf');
      placeBlock(libX + 1, liby + 1, libZ + dz, 'bookshelf');
      placeBlock(libX + 5, liby, libZ + dz, 'bookshelf');
      placeBlock(libX + 5, liby + 1, libZ + dz, 'bookshelf');
    }
    // Back wall bookshelves
    for (let dx = 2; dx <= 4; dx++) {
      placeBlock(libX + dx, liby, libZ + 5, 'bookshelf');
      placeBlock(libX + dx, liby + 1, libZ + 5, 'bookshelf');
    }
    // Reading tables
    placeBlock(libX + 3, liby, libZ + 3, 'crafting_table');
    placeBlock(libX + 2, liby, libZ + 3, 'crafting_table');
    // Bed for librarian
    placeBlock(libX + 5, liby + 4, libZ + 5, 'bed');
    // Ladder to 2nd floor
    for (let dy = 0; dy < 4; dy++) {
      placeBlock(libX + 1, liby + dy, libZ + 1, 'ladder');
    }
    // Interior lanterns
    placeBlock(libX + 3, liby + 2, libZ + 2, 'lantern');
    placeBlock(libX + 3, liby + 4, libZ + 4, 'lantern');
    // Exterior lantern + bookshelf decoration
    placeBlock(libX + 3, liby + 2, libZ - 1, 'lantern');
    placeBlock(libX + 5, liby, libZ - 1, 'bookshelf');
    // Flowers at entrance
    placeBlock(libX + 1, liby, libZ - 1, 'flower');
    placeBlock(libX + 5, liby, libZ - 1, 'flower');
  }

  // ============================================================
  // 6. BUTCHER SHOP (肉店 with smoker)
  // ============================================================
  const butchX = cx + 18, butchZ = cz - 4;
  {
    const by2 = villageY;
    clearTreesInArea(butchX - 2, butchZ - 2, butchX + 6, butchZ + 6);
    levelGround(butchX - 1, butchZ - 1, butchX + 5, butchZ + 5, by2);
    // Floor
    for (let dx = 0; dx < 5; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        placeBlock(butchX + dx, by2 - 1, butchZ + dz, 'cobblestone');
      }
    }
    // Walls (3 high)
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 5; dx++) {
        const isC = dx === 0 || dx === 4;
        placeBlock(butchX + dx, by2 + dy, butchZ, isC ? 'log' : 'cobblestone');
        placeBlock(butchX + dx, by2 + dy, butchZ + 4, isC ? 'log' : 'cobblestone');
      }
      for (let dz = 1; dz < 4; dz++) {
        placeBlock(butchX, by2 + dy, butchZ + dz, 'log');
        placeBlock(butchX + 4, by2 + dy, butchZ + dz, 'log');
      }
    }
    // Door
    placeBlock(butchX + 2, by2, butchZ, 'path');
    placeBlock(butchX + 2, by2 + 1, butchZ, 'path');
    // Windows
    placeBlock(butchX, by2 + 1, butchZ + 2, 'glass');
    placeBlock(butchX + 4, by2 + 1, butchZ + 2, 'glass');
    // Roof
    for (let dx = -1; dx <= 5; dx++) {
      for (let dz = -1; dz <= 5; dz++) {
        placeBlock(butchX + dx, by2 + 3, butchZ + dz, 'planks');
      }
    }
    // Interior: smokers + chest
    placeBlock(butchX + 1, by2, butchZ + 3, 'smoker');
    placeBlock(butchX + 2, by2, butchZ + 3, 'smoker');
    placeBlock(butchX + 3, by2, butchZ + 3, 'chest');
    placeBlock(butchX + 3, by2, butchZ + 1, 'crafting_table');
    // Lantern
    placeBlock(butchX + 2, by2 + 2, butchZ + 2, 'lantern');
    placeBlock(butchX + 2, by2 + 2, butchZ - 1, 'lantern');
    // Animal fence outside (side)
    for (let dz = 0; dz <= 3; dz++) {
      placeBlock(butchX + 5, by2, butchZ + dz, 'fence');
    }
    for (let dx = 5; dx <= 7; dx++) {
      placeBlock(butchX + dx, by2, butchZ, 'fence');
      placeBlock(butchX + dx, by2, butchZ + 3, 'fence');
    }
    placeBlock(butchX + 7, by2, butchZ + 1, 'fence');
    placeBlock(butchX + 7, by2, butchZ + 2, 'fence');
  }

  // ============================================================
  // 7. MARKET STALLS (open-air with wool awnings + bell)
  // ============================================================
  const stallPositions = [
    { x: -6, z: 4 }, { x: 5, z: 5 },
  ];
  for (const sp of stallPositions) {
    const sx = cx + sp.x, sz = cz + sp.z;
    const sy = villageY;
    clearTreesInArea(sx - 1, sz - 1, sx + 4, sz + 3);
    levelGround(sx - 1, sz - 1, sx + 4, sz + 3, sy);

    // 4 log posts (taller for better awning)
    for (let dy = 0; dy < 3; dy++) {
      placeBlock(sx, sy + dy, sz, 'log');
      placeBlock(sx + 3, sy + dy, sz, 'log');
      placeBlock(sx, sy + dy, sz + 2, 'log');
      placeBlock(sx + 3, sy + dy, sz + 2, 'log');
    }
    // Wool awning roof (colored)
    for (let dx = 0; dx <= 3; dx++) {
      for (let dz = 0; dz <= 2; dz++) {
        placeBlock(sx + dx, sy + 3, sz + dz, 'wool');
      }
    }
    // Counter (cobblestone)
    placeBlock(sx + 1, sy, sz, 'cobblestone');
    placeBlock(sx + 2, sy, sz, 'cobblestone');
    // Goods on counter
    placeBlock(sx + 1, sy + 1, sz, 'chest');
    placeBlock(sx + 2, sy + 1, sz, 'pumpkin');
    // Melon/pumpkin display
    placeBlock(sx + 1, sy, sz + 1, 'melon');
    // Lantern hanging from awning
    placeBlock(sx + 1, sy + 2, sz + 1, 'lantern');
  }

  // ============================================================
  // 8. ANIMAL PEN (fenced with hay bales + water trough)
  // ============================================================
  const penX = cx + 18, penZ = cz - 14;
  {
    const penY = villageY;
    clearTreesInArea(penX - 2, penZ - 2, penX + 8, penZ + 8);
    levelGround(penX - 1, penZ - 1, penX + 7, penZ + 7, penY);

    // Fence perimeter (7x7 for more space)
    for (let dx = 0; dx <= 6; dx++) {
      placeBlock(penX + dx, penY, penZ, 'fence');
      placeBlock(penX + dx, penY, penZ + 6, 'fence');
    }
    for (let dz = 1; dz <= 5; dz++) {
      placeBlock(penX, penY, penZ + dz, 'fence');
      placeBlock(penX + 6, penY, penZ + dz, 'fence');
    }
    // Gate opening
    blocks.delete(makeKey(penX, penY, penZ + 3));
    // Hay bales inside (proper hay blocks)
    placeBlock(penX + 4, penY, penZ + 2, 'hay');
    placeBlock(penX + 5, penY, penZ + 2, 'hay');
    placeBlock(penX + 4, penY + 1, penZ + 2, 'hay');
    placeBlock(penX + 4, penY, penZ + 4, 'hay');
    placeBlock(penX + 5, penY, penZ + 4, 'hay');
    // Water trough (2 blocks)
    placeBlock(penX + 2, penY, penZ + 5, 'water');
    placeBlock(penX + 3, penY, penZ + 5, 'water');
    // Lantern on fence post
    placeBlock(penX + 3, penY + 1, penZ, 'lantern');
  }

  // ============================================================
  // 9. FARMS (3 farms with proper water irrigation + crop variety)
  // ============================================================
  const farmPositions = [
    { x: -10, z: -22 },
    { x: 6, z: -20 },
    { x: -24, z: -6 },
  ];
  for (const fp of farmPositions) {
    const fx = cx + fp.x, fz = cz + fp.z;
    const fy = villageY;

    clearTreesInArea(fx - 2, fz - 2, fx + 9, fz + 9);
    levelGround(fx - 1, fz - 1, fx + 8, fz + 8, fy);

    // Fence around farm (8x8 — larger farm)
    for (let dx = -1; dx <= 8; dx++) {
      placeBlock(fx + dx, fy, fz - 1, 'fence');
      placeBlock(fx + dx, fy, fz + 8, 'fence');
    }
    for (let dz = 0; dz <= 7; dz++) {
      placeBlock(fx - 1, fy, fz + dz, 'fence');
      placeBlock(fx + 8, fy, fz + dz, 'fence');
    }
    // Gate opening
    blocks.delete(makeKey(fx - 1, fy, fz + 3));
    blocks.delete(makeKey(fx - 1, fy, fz + 4));

    // Farmland + crops with water irrigation channels
    for (let dx = 0; dx <= 7; dx++) {
      for (let dz = 0; dz <= 7; dz++) {
        // Water channel every 4 rows in center
        if (dx === 3 || dx === 4) {
          if (dz % 4 === 0) {
            placeBlock(fx + dx, fy - 1, fz + dz, 'water');
            continue;
          }
        }
        placeBlock(fx + dx, fy - 1, fz + dz, 'farmland');
        // Random growth stages
        const r = Math.random();
        if (r < 0.25) placeBlock(fx + dx, fy, fz + dz, 'wheat1');
        else if (r < 0.55) placeBlock(fx + dx, fy, fz + dz, 'wheat2');
        else placeBlock(fx + dx, fy, fz + dz, 'wheat3');
      }
    }
    // Central water channel connecting
    for (let dz = 0; dz <= 7; dz++) {
      placeBlock(fx + 3, fy - 1, fz + dz, 'water');
    }
    // Lantern on a fence post
    placeBlock(fx + 4, fy + 1, fz - 1, 'lantern');
  }

  // ============================================================
  // 10. BLACKSMITH (anvil, forge, iron blocks, tool display)
  // ============================================================
  const bsX = cx - 6, bsZ = cz + 18;
  {
    const bsY = villageY;
    clearTreesInArea(bsX - 2, bsZ - 2, bsX + 7, bsZ + 6);
    levelGround(bsX - 1, bsZ - 1, bsX + 6, bsZ + 5, bsY);

    // Cobblestone floor (6x5)
    for (let dx = 0; dx < 6; dx++) {
      for (let dz = 0; dz < 5; dz++) {
        placeBlock(bsX + dx, bsY - 1, bsZ + dz, 'cobblestone');
      }
    }
    // Half walls (cobblestone, open front)
    for (let dy = 0; dy < 3; dy++) {
      for (let dx = 0; dx < 6; dx++) {
        placeBlock(bsX + dx, bsY + dy, bsZ + 4, 'cobblestone');
      }
      placeBlock(bsX, bsY + dy, bsZ, 'log');
      placeBlock(bsX + 5, bsY + dy, bsZ, 'log');
      for (let dz = 1; dz < 4; dz++) {
        placeBlock(bsX, bsY + dy, bsZ + dz, 'cobblestone');
        placeBlock(bsX + 5, bsY + dy, bsZ + dz, 'cobblestone');
      }
    }
    // Open front (remove center front wall blocks for open workshop)
    for (let dx = 1; dx < 5; dx++) {
      for (let dy = 0; dy < 3; dy++) {
        blocks.delete(makeKey(bsX + dx, bsY + dy, bsZ));
      }
    }
    // Front pillars remain
    for (let dy = 0; dy < 3; dy++) {
      placeBlock(bsX, bsY + dy, bsZ, 'log');
      placeBlock(bsX + 5, bsY + dy, bsZ, 'log');
    }
    // Roof (cobblestone + chimney)
    for (let dx = -1; dx <= 6; dx++) {
      for (let dz = -1; dz <= 5; dz++) {
        placeBlock(bsX + dx, bsY + 3, bsZ + dz, 'cobblestone');
      }
    }
    // Forge area: furnaces + lava/fire glow
    placeBlock(bsX + 1, bsY, bsZ + 3, 'furnace');
    placeBlock(bsX + 2, bsY, bsZ + 3, 'furnace');
    placeBlock(bsX + 3, bsY, bsZ + 3, 'furnace');
    // Anvil
    placeBlock(bsX + 1, bsY, bsZ + 1, 'anvil');
    // Iron block (material storage)
    placeBlock(bsX + 4, bsY, bsZ + 3, 'iron_block');
    // Tool chest + crafting table
    placeBlock(bsX + 4, bsY, bsZ + 1, 'chest');
    placeBlock(bsX + 3, bsY, bsZ + 1, 'crafting_table');
    // Water quench barrel
    placeBlock(bsX + 2, bsY, bsZ + 1, 'water');
    // Chimney (brick, taller)
    for (let dy = 0; dy <= 4; dy++) {
      placeBlock(bsX + 2, bsY + 4 + dy, bsZ + 3, 'brick');
    }
    placeBlock(bsX + 2, bsY + 4, bsZ + 2, 'brick');
    // Exterior tool display: anvil outside
    placeBlock(bsX + 3, bsY, bsZ - 1, 'anvil');
    // Lanterns
    placeBlock(bsX + 1, bsY + 2, bsZ + 2, 'lantern');
    placeBlock(bsX + 4, bsY + 2, bsZ + 2, 'lantern');
    placeBlock(bsX + 2, bsY + 2, bsZ - 1, 'lantern');
  }

  // ============================================================
  // 11. LAMP POSTS (lantern-topped, along all paths)
  // ============================================================
  for (const [pdx, pdz] of pathDirs) {
    for (let i = 4; i < 26; i += 4) {
      const tx = cx + pdx * i + (pdz !== 0 ? 3 : 0);
      const tz = cz + pdz * i + (pdx !== 0 ? 3 : 0);
      const ty = villageY;
      if (ty > WATER_LEVEL) {
        // Lamp post: cobblestone base + fence column + lantern on top
        placeBlock(tx, ty, tz, 'cobblestone');
        placeBlock(tx, ty + 1, tz, 'fence');
        placeBlock(tx, ty + 2, tz, 'fence');
        placeBlock(tx, ty + 3, tz, 'lantern');
      }
    }
  }

  // ============================================================
  // 12. DECORATIONS (hay stacks, crop piles, flowers along paths)
  // ============================================================
  // Hay bale stacks near farms
  placeBlock(cx - 8, villageY, cz - 18, 'hay');
  placeBlock(cx - 8, villageY, cz - 17, 'hay');
  placeBlock(cx - 8, villageY + 1, cz - 18, 'hay');
  // Pumpkin/melon piles near paths
  placeBlock(cx + 3, villageY, cz + 5, 'pumpkin');
  placeBlock(cx - 3, villageY, cz - 5, 'melon');
  placeBlock(cx + 6, villageY, cz - 4, 'pumpkin');
  // Flowers along main paths
  const flowerPositions = [
    [6, 3], [-6, 3], [3, 6], [-3, -6],
    [12, 3], [-12, 3], [3, 12], [-3, -12],
    [8, -5], [-8, 5], [15, 3], [-15, 3],
  ];
  for (const [fx, fz] of flowerPositions) {
    placeBlock(cx + fx, villageY, cz + fz, 'flower');
  }
  // Additional hay/crop decorations scattered
  placeBlock(cx + 14, villageY, cz + 4, 'hay');
  placeBlock(cx - 14, villageY, cz - 4, 'hay');
}

/* ================================================================
   Generate a single chunk's blocks
   ================================================================ */

function generateChunk(cx, cz, gen) {
  const blocks = new Map();
  const baseX = cx * CHUNK_SIZE;
  const baseZ = cz * CHUNK_SIZE;

  for (let lx = 0; lx < CHUNK_SIZE; lx++) {
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      const wx = baseX + lx;
      const wz = baseZ + lz;
      const height = gen.getHeight(wx, wz);

      for (let y = 0; y < height; y++) {
        let type;
        if (y === 0) type = 'stone';
        else if (y < height - 3) type = 'stone';
        else if (y < height - 1) type = 'dirt';
        else if (height <= WATER_LEVEL) type = 'sand';
        else if (height > 14) type = 'snow';
        else type = 'grass';
        blocks.set(makeKey(wx, y, wz), type);
      }

      if (height <= WATER_LEVEL) {
        for (let y = height; y <= WATER_LEVEL; y++) {
          blocks.set(makeKey(wx, y, wz), 'water');
        }
      }

      if (height > WATER_LEVEL + 1 && height <= 14 && gen.hasTree(wx, wz)) {
        const trunkH = 3 + Math.floor(Math.abs(gen.getHeight(wx + 100, wz + 100)) % 3);
        for (let ty = 0; ty < trunkH; ty++) {
          blocks.set(makeKey(wx, height + ty, wz), 'wood');
        }
        const leafY = height + trunkH;
        for (let dx = -2; dx <= 2; dx++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dy = 0; dy <= 1; dy++) {
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && dy === 1) continue;
              blocks.set(makeKey(wx + dx, leafY + dy, wz + dz), 'leaf');
            }
          }
        }
        blocks.set(makeKey(wx, leafY + 2, wz), 'leaf');
      }
    }
  }

  return blocks;
}

/* ================================================================
   Face definitions for geometry builder
   ================================================================ */

const FACES = [
  { dir: [0,  1,  0], corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]], colorKey: 'top' },
  { dir: [0, -1,  0], corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]], colorKey: 'side' },
  { dir: [ 1, 0,  0], corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], colorKey: 'side' },
  { dir: [-1, 0,  0], corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], colorKey: 'side' },
  { dir: [0,  0,  1], corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]], colorKey: 'side' },
  { dir: [0,  0, -1], corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]], colorKey: 'side' },
];

function buildChunkGeometry(chunkBlocks, allBlocks, includeTransparent) {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  let vtx = 0;

  for (const [key, type] of chunkBlocks) {
    const def = BLOCK_TYPES[type];
    if (includeTransparent !== def.transparent) continue;

    const [bx, by, bz] = key.split(',').map(Number);

    // --- Bed: half-height frame with pillow end ---
    if (type === 'bed') {
      const bedH = 0.45;
      const pillowH = 0.55;
      const blanket = def.top;    // red blanket
      const side = def.side;      // dark red frame
      const bottom = def.bottom;  // wood brown
      const pillow = def.pillow;  // off-white pillow

      // Bottom face (wood brown)
      positions.push(bx,by,bz+1, bx,by,bz, bx+1,by,bz, bx+1,by,bz+1);
      normals.push(0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0);
      colors.push(bottom[0],bottom[1],bottom[2], bottom[0],bottom[1],bottom[2], bottom[0],bottom[1],bottom[2], bottom[0],bottom[1],bottom[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;

      // Top face (blanket red, excluding pillow area at +Z end)
      positions.push(bx,by+bedH,bz, bx,by+bedH,bz+0.75, bx+1,by+bedH,bz+0.75, bx+1,by+bedH,bz);
      normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
      colors.push(blanket[0],blanket[1],blanket[2], blanket[0],blanket[1],blanket[2], blanket[0],blanket[1],blanket[2], blanket[0],blanket[1],blanket[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;

      // Pillow top (off-white, at +Z end, slightly higher)
      positions.push(bx+0.15,by+pillowH,bz+0.75, bx+0.15,by+pillowH,bz+0.95, bx+0.85,by+pillowH,bz+0.95, bx+0.85,by+pillowH,bz+0.75);
      normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
      colors.push(pillow[0],pillow[1],pillow[2], pillow[0],pillow[1],pillow[2], pillow[0],pillow[1],pillow[2], pillow[0],pillow[1],pillow[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;

      // +X side
      positions.push(bx+1,by,bz, bx+1,by+bedH,bz, bx+1,by+bedH,bz+1, bx+1,by,bz+1);
      normals.push(1,0,0, 1,0,0, 1,0,0, 1,0,0);
      colors.push(side[0],side[1],side[2], side[0],side[1],side[2], side[0],side[1],side[2], side[0],side[1],side[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;

      // -X side
      positions.push(bx,by,bz+1, bx,by+bedH,bz+1, bx,by+bedH,bz, bx,by,bz);
      normals.push(-1,0,0, -1,0,0, -1,0,0, -1,0,0);
      colors.push(side[0],side[1],side[2], side[0],side[1],side[2], side[0],side[1],side[2], side[0],side[1],side[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;

      // +Z side (headboard, taller)
      positions.push(bx+1,by,bz+1, bx+1,by+pillowH+0.1,bz+1, bx,by+pillowH+0.1,bz+1, bx,by,bz+1);
      normals.push(0,0,1, 0,0,1, 0,0,1, 0,0,1);
      colors.push(bottom[0],bottom[1],bottom[2], bottom[0],bottom[1],bottom[2], bottom[0],bottom[1],bottom[2], bottom[0],bottom[1],bottom[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;

      // -Z side (footboard)
      positions.push(bx,by,bz, bx,by+bedH,bz, bx+1,by+bedH,bz, bx+1,by,bz);
      normals.push(0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1);
      colors.push(bottom[0],bottom[1],bottom[2], bottom[0],bottom[1],bottom[2], bottom[0],bottom[1],bottom[2], bottom[0],bottom[1],bottom[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;

      continue;
    }

    // --- Torch: thin pillar with bright flame top ---
    if (type === 'torch') {
      const minOff = 0.4, maxOff = 0.6, torchH = 0.7;
      const sr = def.side, tr = def.top;
      // +X side
      positions.push(bx+maxOff,by,bz+minOff, bx+maxOff,by+torchH,bz+minOff, bx+maxOff,by+torchH,bz+maxOff, bx+maxOff,by,bz+maxOff);
      normals.push(1,0,0, 1,0,0, 1,0,0, 1,0,0);
      colors.push(sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // -X side
      positions.push(bx+minOff,by,bz+maxOff, bx+minOff,by+torchH,bz+maxOff, bx+minOff,by+torchH,bz+minOff, bx+minOff,by,bz+minOff);
      normals.push(-1,0,0, -1,0,0, -1,0,0, -1,0,0);
      colors.push(sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // +Z side
      positions.push(bx+maxOff,by,bz+maxOff, bx+maxOff,by+torchH,bz+maxOff, bx+minOff,by+torchH,bz+maxOff, bx+minOff,by,bz+maxOff);
      normals.push(0,0,1, 0,0,1, 0,0,1, 0,0,1);
      colors.push(sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // -Z side
      positions.push(bx+minOff,by,bz+minOff, bx+minOff,by+torchH,bz+minOff, bx+maxOff,by+torchH,bz+minOff, bx+maxOff,by,bz+minOff);
      normals.push(0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1);
      colors.push(sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // Top (bright flame)
      positions.push(bx+minOff,by+torchH,bz+minOff, bx+minOff,by+torchH,bz+maxOff, bx+maxOff,by+torchH,bz+maxOff, bx+maxOff,by+torchH,bz+minOff);
      normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
      colors.push(tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      continue;
    }

    // --- Lantern: small cube hanging/sitting ---
    if (type === 'lantern') {
      const lo = 0.25, hi = 0.75, lanH = 0.6;
      const sr = def.side, tr = def.top;
      // 4 sides
      const lanSides = [
        [[hi,0,lo],[hi,lanH,lo],[hi,lanH,hi],[hi,0,hi],[1,0,0]],
        [[lo,0,hi],[lo,lanH,hi],[lo,lanH,lo],[lo,0,lo],[-1,0,0]],
        [[hi,0,hi],[hi,lanH,hi],[lo,lanH,hi],[lo,0,hi],[0,0,1]],
        [[lo,0,lo],[lo,lanH,lo],[hi,lanH,lo],[hi,0,lo],[0,0,-1]],
      ];
      for (const [p0,p1,p2,p3,n] of lanSides) {
        positions.push(bx+p0[0],by+p0[1],bz+p0[2], bx+p1[0],by+p1[1],bz+p1[2], bx+p2[0],by+p2[1],bz+p2[2], bx+p3[0],by+p3[1],bz+p3[2]);
        normals.push(n[0],n[1],n[2], n[0],n[1],n[2], n[0],n[1],n[2], n[0],n[1],n[2]);
        colors.push(sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2], sr[0],sr[1],sr[2]);
        indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      }
      // Top (bright glow)
      positions.push(bx+lo,by+lanH,bz+lo, bx+lo,by+lanH,bz+hi, bx+hi,by+lanH,bz+hi, bx+hi,by+lanH,bz+lo);
      normals.push(0,1,0, 0,1,0, 0,1,0, 0,1,0);
      colors.push(tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      continue;
    }

    // --- Flower: cross-shaped shorter quads ---
    if (type === 'flower') {
      const fh = 0.55;
      const sr = def.side, tr = def.top;
      const diagNorm = 0.707;
      // Diagonal 1 front
      positions.push(bx+0.15,by,bz+0.15, bx+0.15,by+fh,bz+0.15, bx+0.85,by+fh,bz+0.85, bx+0.85,by,bz+0.85);
      normals.push(-diagNorm,0,diagNorm, -diagNorm,0,diagNorm, -diagNorm,0,diagNorm, -diagNorm,0,diagNorm);
      colors.push(sr[0],sr[1],sr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // Diagonal 1 back
      positions.push(bx+0.85,by,bz+0.85, bx+0.85,by+fh,bz+0.85, bx+0.15,by+fh,bz+0.15, bx+0.15,by,bz+0.15);
      normals.push(diagNorm,0,-diagNorm, diagNorm,0,-diagNorm, diagNorm,0,-diagNorm, diagNorm,0,-diagNorm);
      colors.push(sr[0],sr[1],sr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // Diagonal 2 front
      positions.push(bx+0.85,by,bz+0.15, bx+0.85,by+fh,bz+0.15, bx+0.15,by+fh,bz+0.85, bx+0.15,by,bz+0.85);
      normals.push(diagNorm,0,diagNorm, diagNorm,0,diagNorm, diagNorm,0,diagNorm, diagNorm,0,diagNorm);
      colors.push(sr[0],sr[1],sr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // Diagonal 2 back
      positions.push(bx+0.15,by,bz+0.85, bx+0.15,by+fh,bz+0.85, bx+0.85,by+fh,bz+0.15, bx+0.85,by,bz+0.15);
      normals.push(-diagNorm,0,-diagNorm, -diagNorm,0,-diagNorm, -diagNorm,0,-diagNorm, -diagNorm,0,-diagNorm);
      colors.push(sr[0],sr[1],sr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      continue;
    }

    // --- Wheat: cross-shaped quads (Minecraft-style crops) ---
    if (type === 'wheat1' || type === 'wheat2' || type === 'wheat3') {
      const WHEAT_HEIGHTS = { wheat1: 0.35, wheat2: 0.6, wheat3: 0.85 };
      const wh = WHEAT_HEIGHTS[type];
      const sr = def.side, tr = def.top;
      const diagNorm = 0.707; // 1/sqrt(2) for diagonal face normals
      // Diagonal 1 front
      positions.push(bx,by,bz, bx,by+wh,bz, bx+1,by+wh,bz+1, bx+1,by,bz+1);
      normals.push(-diagNorm,0,diagNorm, -diagNorm,0,diagNorm, -diagNorm,0,diagNorm, -diagNorm,0,diagNorm);
      colors.push(sr[0],sr[1],sr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // Diagonal 1 back
      positions.push(bx+1,by,bz+1, bx+1,by+wh,bz+1, bx,by+wh,bz, bx,by,bz);
      normals.push(diagNorm,0,-diagNorm, diagNorm,0,-diagNorm, diagNorm,0,-diagNorm, diagNorm,0,-diagNorm);
      colors.push(sr[0],sr[1],sr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // Diagonal 2 front
      positions.push(bx+1,by,bz, bx+1,by+wh,bz, bx,by+wh,bz+1, bx,by,bz+1);
      normals.push(diagNorm,0,diagNorm, diagNorm,0,diagNorm, diagNorm,0,diagNorm, diagNorm,0,diagNorm);
      colors.push(sr[0],sr[1],sr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      // Diagonal 2 back
      positions.push(bx,by,bz+1, bx,by+wh,bz+1, bx+1,by+wh,bz, bx+1,by,bz);
      normals.push(-diagNorm,0,-diagNorm, -diagNorm,0,-diagNorm, -diagNorm,0,-diagNorm, -diagNorm,0,-diagNorm);
      colors.push(sr[0],sr[1],sr[2], tr[0],tr[1],tr[2], tr[0],tr[1],tr[2], sr[0],sr[1],sr[2]);
      indices.push(vtx,vtx+1,vtx+2, vtx,vtx+2,vtx+3); vtx+=4;
      continue;
    }

    for (const face of FACES) {
      const [dx, dy, dz] = face.dir;
      const nk = makeKey(bx + dx, by + dy, bz + dz);
      const neighbor = allBlocks.get(nk);
      if (neighbor !== undefined) {
        const nDef = BLOCK_TYPES[neighbor];
        if (!def.transparent && !nDef.transparent) continue;
        if (def.transparent && nDef.transparent) continue;
      }

      const rgb = def[face.colorKey];
      for (const [fcx, fcy, fcz] of face.corners) {
        positions.push(bx + fcx, by + fcy, bz + fcz);
        normals.push(dx, dy, dz);
        colors.push(rgb[0], rgb[1], rgb[2]);
      }
      indices.push(vtx, vtx + 1, vtx + 2, vtx, vtx + 2, vtx + 3);
      vtx += 4;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  return geo;
}

/* ================================================================
   VoxelWorld Context & Provider
   ================================================================ */

const VoxelWorldContext = createContext(null);

function useVoxelWorld() {
  const ctx = useContext(VoxelWorldContext);
  if (!ctx) throw new Error('useVoxelWorld must be used within VoxelWorldProvider');
  return ctx;
}

function VoxelWorldProvider({ children }) {
  const [npcs, setNpcs] = useState(function() {
    // Spawn NPCs near village house entrances (house offsets from village center near origin)
    return [
      createNPC(0, 8, 3, 'farmer'),
      createNPC(1, -9, 3, 'builder'),
      createNPC(2, 3, 9, 'blacksmith'),
      createNPC(3, -4, -9, 'guard'),
      createNPC(4, 9, -6, 'librarian'),
      createLLMControlledNPC(5, 0, 0),
    ];
  });
  const [selectedNpc, setSelectedNpc] = useState(null);
  const [speed, setSpeed] = useState(1);
  const [worldTime, setWorldTime] = useState(350); // Start at ~7am
  const [events, setEvents] = useState([
    { tick: 0, text: '村民和AI助手小智来到了体素世界' },
  ]);
  const [activityLog, setActivityLog] = useState([]);
  const [tick, setTick] = useState(0);
  const [villageStats, setVillageStats] = useState({ food: 10, buildings: 5, safety: 80 });
  const npcsRef = useRef(npcs);
  const nextNpcIdRef = useRef(6);
  const blocksRef = useRef(null);
  const worldTimeRef = useRef(worldTime);
  const activityLogRef = useRef(activityLog);

  useEffect(function() { npcsRef.current = npcs; }, [npcs]);
  useEffect(function() { worldTimeRef.current = worldTime; }, [worldTime]);
  useEffect(function() { activityLogRef.current = activityLog; }, [activityLog]);

  // Simulation tick
  useEffect(function() {
    if (speed === 0) return;
    const addLogEntry = function(name, text) {
      const entry = { tick: worldTimeRef.current, time: tickToTimeStr(worldTimeRef.current), name: name, text: text };
      setActivityLog(function(prev) {
        let next = prev.concat([entry]);
        if (next.length > 50) next = next.slice(next.length - 50);
        return next;
      });
    };
    const interval = setInterval(function() {
      setTick(function(t) { return t + 1; });
      setWorldTime(function(wt) { return wt + 1; });
      setNpcs(function(prev) {
        return prev.map(function(n) {
          return updateNPC(n, blocksRef.current, worldTimeRef.current, prev, addLogEntry);
        });
      });
      setVillageStats(function(prev) {
        return {
          food: Math.max(0, Math.min(100, prev.food + (Math.random() > 0.7 ? 0.1 : -0.05))),
          buildings: prev.buildings,
          safety: Math.max(0, Math.min(100, prev.safety + (Math.random() > 0.5 ? 0.05 : -0.03))),
        };
      });
    }, Math.floor(200 / speed));
    return function() { clearInterval(interval); };
  }, [speed]);

  // Crop growth tick (wheat grows over time)
  useEffect(function() {
    if (speed === 0) return;
    const cropInterval = setInterval(function() {
      const blocks = blocksRef.current;
      if (!blocks || blocks.size === 0) return;
      // Grow wheat randomly during daytime
      if (!isDaytime(worldTimeRef.current)) return;
      const entries = Array.from(blocks.entries());
      for (let i = 0; i < entries.length; i++) {
        const [key, type] = entries[i];
        if (type === 'wheat1' && Math.random() < 0.002) {
          blocks.set(key, 'wheat2');
        } else if (type === 'wheat2' && Math.random() < 0.001) {
          blocks.set(key, 'wheat3');
        }
      }
    }, 2000);
    return function() { clearInterval(cropInterval); };
  }, [speed]);

  const addNpc = useCallback(function(profession) {
    const id = nextNpcIdRef.current++;
    const prof = profession || PROFESSION_LIST[id % PROFESSION_LIST.length];
    const npc = createNPC(id, Math.random() * 16 - 8, Math.random() * 16 - 8, prof);
    setNpcs(function(prev) { return prev.concat([npc]); });
    setEvents(function(prev) {
      return prev.concat([{ tick: tick, text: npc.name + '(' + PROFESSIONS[prof].label + ') 加入了体素世界' }]);
    });
  }, [tick]);

  const removeNpc = useCallback(function(npcId) {
    setNpcs(function(prev) {
      const npc = prev.find(function(n) { return n.id === npcId; });
      if (npc) {
        setEvents(function(evts) { return evts.concat([{ tick: tick, text: npc.name + ' 离开了体素世界' }]); });
      }
      return prev.filter(function(n) { return n.id !== npcId; });
    });
    setSelectedNpc(function(sel) { return sel === npcId ? null : sel; });
  }, [tick]);

  // Send a command to the LLM-controlled NPC via large language model
  const sendLLMCommand = useCallback(async function(commandText, settings) {
    if (!commandText || !settings) return { success: false, error: '缺少指令或设置' };
    const llmNpc = npcsRef.current.find(function(n) { return n.isLLMControlled; });
    if (!llmNpc) return { success: false, error: '没有找到AI控制的角色' };

    try {
      // Generate vision description for context
      var visionDesc = getVisionDescription(llmNpc, blocksRef.current, npcsRef.current);
      var useDeepThinking = needsDeepThinking(commandText);

      const messages = [
        { role: 'system', content: LLM_COMMAND_SYSTEM_PROMPT },
        { role: 'user', content: '角色当前位置: (' + Math.floor(llmNpc.x) + ', ' + Math.floor(llmNpc.z) + ')，当前状态: ' + (llmNpc.currentGoal ? AI_GOALS[llmNpc.currentGoal].label : '空闲') + '。\n\n【小智的视野信息】\n' + visionDesc + '\n\n用户指令: ' + commandText },
      ];
      const llmSettings = { ...settings, stream: true, enableThinking: useDeepThinking ? true : false };
      let streamedContent = '';
      const result = await sendChatRequest(messages, llmSettings, function(chunk, isDone) {
        if (!isDone && chunk) streamedContent += chunk;
      });
      const finalContent = result.content || streamedContent;
      const actions = parseLLMResponse(finalContent);
      if (actions.length > 0) {
        setNpcs(function(prev) {
          return prev.map(function(n) {
            if (n.isLLMControlled) {
              return {
                ...n,
                llmGoalQueue: n.llmGoalQueue.concat(actions),
                goalPhase: n.goalPhase === 'idle' ? 'idle' : n.goalPhase,
              };
            }
            return n;
          });
        });
        setActivityLog(function(prev) {
          const entry = { tick: worldTimeRef.current, time: tickToTimeStr(worldTimeRef.current), name: llmNpc.name, text: '🤖 收到指令: ' + commandText };
          let next = prev.concat([entry]);
          if (next.length > 50) next = next.slice(next.length - 50);
          return next;
        });
        return { success: true, actions: actions };
      }
      return { success: false, error: '无法解析指令' };
    } catch (err) {
      return { success: false, error: err.message || '请求失败' };
    }
  }, []);

  const value = useMemo(function() {
    return {
      npcs, setNpcs, selectedNpc, setSelectedNpc,
      speed, setSpeed, events, tick, worldTime, addNpc, removeNpc, sendLLMCommand,
      npcsRef, blocksRef, villageStats, activityLog,
    };
  }, [npcs, selectedNpc, speed, events, tick, worldTime, addNpc, removeNpc, sendLLMCommand, villageStats, activityLog]);

  return (
    <VoxelWorldContext.Provider value={value}>
      {children}
    </VoxelWorldContext.Provider>
  );
}

/* ================================================================
   VoxelWorldCanvas — Open World with Minecraft-style chunks + Village
   ================================================================ */

function VoxelWorldCanvas() {
  const containerRef = useRef(null);
  const minimapRef = useRef(null);
  const [selectedBlock, setSelectedBlock] = useState('grass');
  const [tool, setTool] = useState('place');
  const [blockCount, setBlockCount] = useState(0);
  const [chunkCount, setChunkCount] = useState(0);

  const selectedBlockRef = useRef(selectedBlock);
  const toolRef = useRef(tool);
  const threeRef = useRef(null);

  const worldRef = useRef({
    allBlocks: new Map(),
    chunks: new Map(),
    gen: null,
    centerChunk: { cx: 0, cz: 0 },
    villageGenerated: false,
    torchLightsAdded: false,
  });

  useEffect(() => { selectedBlockRef.current = selectedBlock; }, [selectedBlock]);
  useEffect(() => { toolRef.current = tool; }, [tool]);

  const { npcsRef, blocksRef, worldTime } = useVoxelWorld();

  const isNight = !isDaytime(worldTime);

  const fnRef = useRef({});

  useEffect(() => {
    const rebuildChunk = (key) => {
      const world = worldRef.current;
      const t = threeRef.current;
      if (!t) return;
      const cd = world.chunks.get(key);
      if (!cd) return;
      if (cd.opaqueMesh) { t.scene.remove(cd.opaqueMesh); cd.opaqueMesh.geometry.dispose(); }
      if (cd.transMesh) { t.scene.remove(cd.transMesh); cd.transMesh.geometry.dispose(); }
      const og = buildChunkGeometry(cd.blocks, world.allBlocks, false);
      const tg = buildChunkGeometry(cd.blocks, world.allBlocks, true);
      cd.opaqueMesh = new THREE.Mesh(og, t.opaqueMat);
      cd.transMesh = new THREE.Mesh(tg, t.transMat);
      t.scene.add(cd.opaqueMesh);
      t.scene.add(cd.transMesh);
    };

    fnRef.current.rebuildAll = () => {
      const world = worldRef.current;
      const t = threeRef.current;
      if (!t) return;
      let totalBlocks = 0;
      for (const [, cd] of world.chunks) {
        if (cd.opaqueMesh) { t.scene.remove(cd.opaqueMesh); cd.opaqueMesh.geometry.dispose(); }
        if (cd.transMesh) { t.scene.remove(cd.transMesh); cd.transMesh.geometry.dispose(); }
        const opaqueGeo = buildChunkGeometry(cd.blocks, world.allBlocks, false);
        const transGeo = buildChunkGeometry(cd.blocks, world.allBlocks, true);
        cd.opaqueMesh = new THREE.Mesh(opaqueGeo, t.opaqueMat);
        cd.transMesh = new THREE.Mesh(transGeo, t.transMat);
        t.scene.add(cd.opaqueMesh);
        t.scene.add(cd.transMesh);
        totalBlocks += cd.blocks.size;
      }
      setBlockCount(totalBlocks);
      setChunkCount(world.chunks.size);
    };

    fnRef.current.rebuildAt = (wx, wz) => {
      const world = worldRef.current;
      const t = threeRef.current;
      if (!t) return;
      const rebuildOne = (ck) => {
        const cd = world.chunks.get(ck);
        if (!cd) return;
        if (cd.opaqueMesh) { t.scene.remove(cd.opaqueMesh); cd.opaqueMesh.geometry.dispose(); }
        if (cd.transMesh) { t.scene.remove(cd.transMesh); cd.transMesh.geometry.dispose(); }
        const og = buildChunkGeometry(cd.blocks, world.allBlocks, false);
        const tg = buildChunkGeometry(cd.blocks, world.allBlocks, true);
        cd.opaqueMesh = new THREE.Mesh(og, t.opaqueMat);
        cd.transMesh = new THREE.Mesh(tg, t.transMat);
        t.scene.add(cd.opaqueMesh);
        t.scene.add(cd.transMesh);
      };
      const { cx, cz } = worldToChunk(wx, wz);
      rebuildOne(chunkKey(cx, cz));
      const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
      if (lx === 0) rebuildOne(chunkKey(cx - 1, cz));
      if (lx === CHUNK_SIZE - 1) rebuildOne(chunkKey(cx + 1, cz));
      if (lz === 0) rebuildOne(chunkKey(cx, cz - 1));
      if (lz === CHUNK_SIZE - 1) rebuildOne(chunkKey(cx, cz + 1));
    };

    fnRef.current.ensureChunks = (ecx, ecz) => {
      const world = worldRef.current;
      const t = threeRef.current;
      if (!world.gen || !t) return;

      const needed = new Set();
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
        for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
          needed.add(chunkKey(ecx + dx, ecz + dz));
        }
      }

      const newChunkKeys = [];
      for (const key of needed) {
        if (world.chunks.has(key)) continue;
        const [ccx, ccz] = key.split(',').map(Number);
        const blocks = generateChunk(ccx, ccz, world.gen);
        for (const [bk, btype] of blocks) {
          world.allBlocks.set(bk, btype);
        }
        world.chunks.set(key, { blocks, opaqueMesh: null, transMesh: null });
        newChunkKeys.push(key);
      }

      // Generate village structures once initial chunks are loaded
      if (!world.villageGenerated && world.chunks.size > 0) {
        generateVillageBlocks(world.allBlocks, world.gen);
        world.villageGenerated = true;
        // Add village blocks to correct chunks
        for (const [bk, btype] of world.allBlocks) {
          const [bx, , bz] = bk.split(',').map(Number);
          const ck = chunkKey(Math.floor(bx / CHUNK_SIZE), Math.floor(bz / CHUNK_SIZE));
          const cd = world.chunks.get(ck);
          if (cd) cd.blocks.set(bk, btype);
        }
      }

      // Add torch point lights after village generation
      if (world.villageGenerated && !world.torchLightsAdded) {
        world.torchLightsAdded = true;
        if (!t.torchLights) t.torchLights = [];
        for (const [bk, btype] of world.allBlocks) {
          if (btype === 'torch' || btype === 'lantern') {
            const [tx, ty, tz] = bk.split(',').map(Number);
            // Warm glow: lanterns are slightly brighter with wider radius
            const intensity = btype === 'lantern' ? 2.0 : 1.5;
            const radius = btype === 'lantern' ? 14 : 12;
            const light = new THREE.PointLight(0xffaa33, intensity, radius, 2);
            light.position.set(tx + 0.5, ty + 0.8, tz + 0.5);
            t.scene.add(light);
            t.torchLights.push(light);
          }
        }
      }

      for (const [key, cd] of world.chunks) {
        if (!needed.has(key)) {
          if (cd.opaqueMesh) { t.scene.remove(cd.opaqueMesh); cd.opaqueMesh.geometry.dispose(); }
          if (cd.transMesh) { t.scene.remove(cd.transMesh); cd.transMesh.geometry.dispose(); }
          for (const bk of cd.blocks.keys()) { world.allBlocks.delete(bk); }
          world.chunks.delete(key);
        }
      }

      if (newChunkKeys.length > 0 || !world.villageGenerated) {
        const toRebuild = new Set();
        for (const key of newChunkKeys) {
          toRebuild.add(key);
          const [ncx, ncz] = key.split(',').map(Number);
          for (const [adjx, adjz] of [[ncx-1,ncz],[ncx+1,ncz],[ncx,ncz-1],[ncx,ncz+1]]) {
            const ak = chunkKey(adjx, adjz);
            if (world.chunks.has(ak)) toRebuild.add(ak);
          }
        }
        for (const key of toRebuild) {
          rebuildChunk(key);
        }

        let totalBlocks = 0;
        for (const [, cd] of world.chunks) totalBlocks += cd.blocks.size;
        setBlockCount(totalBlocks);
        setChunkCount(world.chunks.size);
      }

      world.centerChunk = { cx: ecx, cz: ecz };
    };
  }, []);

  // ---- Three.js initialization ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const seed = Math.random();
    worldRef.current.gen = createTerrainGenerator(seed);
    blocksRef.current = worldRef.current.allBlocks;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);

    const camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 500);
    camera.position.set(30, 25, 30);
    camera.lookAt(0, 2, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 2, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.minDistance = 5;
    controls.maxDistance = 120;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.mouseButtons = { MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controls.update();

    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.5);
    dir.position.set(40, 60, 30);
    scene.add(dir);
    const hemi = new THREE.HemisphereLight(0x87CEEB, 0x556633, 0.5);
    scene.add(hemi);

    const hlGeo = new THREE.BoxGeometry(1.01, 1.01, 1.01);
    const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.7 });
    const highlight = new THREE.Mesh(hlGeo, hlMat);
    highlight.visible = false;
    scene.add(highlight);

    const opaqueMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const transMat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    threeRef.current = { scene, camera, renderer, controls, ambient, dir, hemi, highlight, opaqueMat, transMat, raycaster, mouse, npcMeshMap: new Map() };

    // First-person camera for 小智 PiP view
    var fpCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 300);
    threeRef.current.fpCamera = fpCamera;

    fnRef.current.ensureChunks(0, 0);

    let lastCx = 0;
    let lastCz = 0;

    let animId;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();

      const tgt = controls.target;
      const { cx, cz } = worldToChunk(Math.floor(tgt.x), Math.floor(tgt.z));
      if (cx !== lastCx || cz !== lastCz) {
        lastCx = cx;
        lastCz = cz;
        fnRef.current.ensureChunks(cx, cz);
      }

      // ---- Update NPC meshes ----
      const currentNpcs = npcsRef.current;
      const meshMap = threeRef.current.npcMeshMap;
      const wBlocks = worldRef.current.allBlocks;

      const activeIds = new Set();
      for (const npc of currentNpcs) {
        activeIds.add(npc.id);
        let group = meshMap.get(npc.id);
        if (!group) {
          group = new THREE.Group();
          const isLLM = npc.isLLMControlled;
          const profColor = isLLM ? '#FFD700' : (PROFESSIONS[npc.profession] ? PROFESSIONS[npc.profession].color : npc.color);
          const baseColor = new THREE.Color(profColor);
          const darkColor = new THREE.Color(profColor).multiplyScalar(0.7);
          const skinColor = 0xffcc88;
          const skinDark = 0xeebb77;

          // Body (torso - slightly wider and shorter)
          const bodyGeo = new THREE.BoxGeometry(0.5, 0.65, 0.3);
          const bodyMat = new THREE.MeshLambertMaterial({ color: baseColor });
          const body = new THREE.Mesh(bodyGeo, bodyMat);
          body.position.y = 0.65;
          group.add(body);
          group.userData.body = body;

          // Head (slightly larger, more detailed)
          const headGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
          const headMat = new THREE.MeshLambertMaterial({ color: skinColor });
          const head = new THREE.Mesh(headGeo, headMat);
          head.position.y = 1.2;
          group.add(head);
          group.userData.head = head;

          // Eyes (two small dark cubes on face)
          const eyeGeo = new THREE.BoxGeometry(0.06, 0.06, 0.04);
          const eyeMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
          const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
          leftEye.position.set(-0.1, 1.24, -0.22);
          group.add(leftEye);
          const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
          rightEye.position.set(0.1, 1.24, -0.22);
          group.add(rightEye);

          // Nose (tiny bump)
          const noseGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
          const noseMat = new THREE.MeshLambertMaterial({ color: skinDark });
          const nose = new THREE.Mesh(noseGeo, noseMat);
          nose.position.set(0, 1.18, -0.24);
          group.add(nose);

          // Hair/hat based on profession
          const hatGeo = new THREE.BoxGeometry(0.46, 0.12, 0.46);
          const hatColor = isLLM ? 0xFFD700 :
                           npc.profession === 'guard' ? 0x8B0000 :
                           npc.profession === 'farmer' ? 0xC8A24E :
                           npc.profession === 'blacksmith' ? 0x444444 :
                           npc.profession === 'librarian' ? 0x6B3FA0 : 0x654321;
          const hatMat = new THREE.MeshLambertMaterial({ color: hatColor });
          const hat = new THREE.Mesh(hatGeo, hatMat);
          hat.position.y = 1.47;
          group.add(hat);
          // Hat brim for farmer
          if (npc.profession === 'farmer' && !isLLM) {
            const brimGeo = new THREE.BoxGeometry(0.56, 0.04, 0.56);
            const brim = new THREE.Mesh(brimGeo, hatMat);
            brim.position.y = 1.42;
            group.add(brim);
          }
          // Golden crown spikes for LLM-controlled NPC
          if (isLLM) {
            const spikeGeo = new THREE.BoxGeometry(0.08, 0.14, 0.08);
            const spikeMat = new THREE.MeshLambertMaterial({ color: 0xFFD700 });
            const positions = [[-0.14, 1.58, -0.14], [0.14, 1.58, -0.14], [-0.14, 1.58, 0.14], [0.14, 1.58, 0.14], [0, 1.62, 0]];
            for (const pos of positions) {
              const spike = new THREE.Mesh(spikeGeo, spikeMat);
              spike.position.set(pos[0], pos[1], pos[2]);
              group.add(spike);
            }
          }

          // Left Arm (with hand)
          const armGeo = new THREE.BoxGeometry(0.16, 0.55, 0.16);
          const armMat = new THREE.MeshLambertMaterial({ color: darkColor });
          const leftArm = new THREE.Mesh(armGeo, armMat);
          leftArm.position.set(-0.33, 0.6, 0);
          group.add(leftArm);
          group.userData.leftArm = leftArm;
          // Left hand
          const handGeo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
          const handMat = new THREE.MeshLambertMaterial({ color: skinColor });
          const leftHand = new THREE.Mesh(handGeo, handMat);
          leftHand.position.set(0, -0.32, 0);
          leftArm.add(leftHand);

          // Right Arm (with hand)
          const rightArm = new THREE.Mesh(armGeo, armMat);
          rightArm.position.set(0.33, 0.6, 0);
          group.add(rightArm);
          group.userData.rightArm = rightArm;
          const rightHand = new THREE.Mesh(handGeo, handMat);
          rightHand.position.set(0, -0.32, 0);
          rightArm.add(rightHand);

          // Left Leg
          const legGeo = new THREE.BoxGeometry(0.18, 0.45, 0.18);
          const legColor = new THREE.Color(profColor).multiplyScalar(0.6);
          const legMat = new THREE.MeshLambertMaterial({ color: legColor });
          const leftLeg = new THREE.Mesh(legGeo, legMat);
          leftLeg.position.set(-0.12, 0.22, 0);
          group.add(leftLeg);
          group.userData.leftLeg = leftLeg;
          // Left boot
          const bootGeo = new THREE.BoxGeometry(0.2, 0.1, 0.22);
          const bootMat = new THREE.MeshLambertMaterial({ color: 0x3d2b1f });
          const leftBoot = new THREE.Mesh(bootGeo, bootMat);
          leftBoot.position.set(0, -0.22, -0.02);
          leftLeg.add(leftBoot);

          // Right Leg
          const rightLeg = new THREE.Mesh(legGeo, legMat);
          rightLeg.position.set(0.12, 0.22, 0);
          group.add(rightLeg);
          group.userData.rightLeg = rightLeg;
          const rightBoot = new THREE.Mesh(bootGeo, bootMat);
          rightBoot.position.set(0, -0.22, -0.02);
          rightLeg.add(rightBoot);

          // Goal indicator as emoji sprite
          const indicatorCanvas = document.createElement('canvas');
          indicatorCanvas.width = 64;
          indicatorCanvas.height = 64;
          const ictx = indicatorCanvas.getContext('2d');
          ictx.font = '48px serif';
          ictx.textAlign = 'center';
          ictx.textBaseline = 'middle';
          ictx.fillText('💭', 32, 32);
          const indicatorTex = new THREE.CanvasTexture(indicatorCanvas);
          const indicatorSpriteMat = new THREE.SpriteMaterial({ map: indicatorTex, transparent: true });
          const indicator = new THREE.Sprite(indicatorSpriteMat);
          indicator.position.y = 1.7;
          indicator.scale.set(0.4, 0.4, 0.4);
          group.add(indicator);
          group.userData.indicator = indicator;
          group.userData.indicatorCanvas = indicatorCanvas;
          group.userData.indicatorTex = indicatorTex;
          group.userData.lastGoalIcon = null;
          group.userData.npcId = npc.id;
          group.userData.lastBx = null;
          group.userData.lastBz = null;
          group.userData.cachedSy = 1;
          scene.add(group);
          meshMap.set(npc.id, group);
        }
        const targetY = npc.needsYInit ? findSurfaceY(wBlocks, npc.x, npc.z) : npc.y;
        const displayY = group.userData.displayY != null ? group.userData.displayY : targetY;
        group.userData.displayY = displayY + (targetY - displayY) * 0.3;
        group.position.set(npc.x, group.userData.displayY, npc.z);

        // Reset transformations each frame
        const body = group.userData.body;
        const head = group.userData.head;
        const leftArm = group.userData.leftArm;
        const rightArm = group.userData.rightArm;
        const tNow = Date.now() * 0.001;
        const leftLeg = group.userData.leftLeg;
        const rightLeg = group.userData.rightLeg;

        if (body) body.rotation.set(0, 0, 0);
        if (head) head.rotation.set(0, 0, 0);
        if (leftArm) { leftArm.rotation.set(0, 0, 0); leftArm.position.y = 0.6; }
        if (rightArm) { rightArm.rotation.set(0, 0, 0); rightArm.position.y = 0.6; }
        if (leftLeg) leftLeg.rotation.set(0, 0, 0);
        if (rightLeg) rightLeg.rotation.set(0, 0, 0);
        // Apply facing direction (yaw rotation)
        const targetFacing = npc.facing || 0;
        const prevFacing = group.userData.currentFacing != null ? group.userData.currentFacing : targetFacing;
        // Smooth interpolation for facing rotation
        let facingDelta = targetFacing - prevFacing;
        // Normalize delta to [-PI, PI] for shortest rotation path
        while (facingDelta > Math.PI) facingDelta -= Math.PI * 2;
        while (facingDelta < -Math.PI) facingDelta += Math.PI * 2;
        const smoothFacing = prevFacing + facingDelta * 0.15;
        group.userData.currentFacing = smoothFacing;
        group.rotation.set(0, smoothFacing, 0);

        const goal = npc.currentGoal;
        const phase = npc.goalPhase;

        if (goal === 'sleep' && phase === 'performing') {
          // Sleeping: lie down horizontally on bed
          group.rotation.z = Math.PI / 2;
          group.position.y = group.userData.displayY - 0.55;
        } else if (goal === 'eat' && phase === 'performing') {
          // Eating: bob right arm up/down, slight head tilt
          if (rightArm) rightArm.rotation.x = Math.sin(tNow * 4) * 0.6;
          if (head) head.rotation.x = Math.sin(tNow * 2) * 0.1;
        } else if (goal === 'farm' && phase === 'performing') {
          // Farming: lean forward, swing arms like hoeing, bend knees, periodic body bob
          if (body) body.rotation.x = 0.35 + Math.sin(tNow * 3) * 0.1;
          if (leftArm) leftArm.rotation.x = Math.sin(tNow * 3) * 0.8;
          if (rightArm) rightArm.rotation.x = Math.sin(tNow * 3 + Math.PI) * 0.8;
          if (leftLeg) leftLeg.rotation.x = -0.2 + Math.sin(tNow * 1.5) * 0.05;
          if (rightLeg) rightLeg.rotation.x = 0.1 + Math.sin(tNow * 1.5 + 1) * 0.05;
          // Periodic squat motion
          if (body) body.position.y = (body.userData.origY || body.position.y) - Math.abs(Math.sin(tNow * 1.5)) * 0.08;
        } else if (goal === 'patrol' && phase === 'walking') {
          // Patrolling: upright walk, arms at sides, head scanning
          if (leftLeg) leftLeg.rotation.x = Math.sin(tNow * 4) * 0.35;
          if (rightLeg) rightLeg.rotation.x = Math.sin(tNow * 4 + Math.PI) * 0.35;
          if (leftArm) leftArm.rotation.x = Math.sin(tNow * 4 + Math.PI) * 0.2;
          if (rightArm) rightArm.rotation.x = Math.sin(tNow * 4) * 0.2;
          if (head) head.rotation.y = Math.sin(tNow * 1) * 0.2;
        } else if (phase === 'walking') {
          // Walking: sway body, swing arms AND legs
          if (body) body.rotation.z = Math.sin(tNow * 5) * 0.04;
          if (leftArm) leftArm.rotation.x = Math.sin(tNow * 5) * 0.5;
          if (rightArm) rightArm.rotation.x = Math.sin(tNow * 5 + Math.PI) * 0.5;
          if (leftLeg) leftLeg.rotation.x = Math.sin(tNow * 5 + Math.PI) * 0.4;
          if (rightLeg) rightLeg.rotation.x = Math.sin(tNow * 5) * 0.4;
          // Head slight bob
          if (head) head.rotation.y = Math.sin(tNow * 2.5) * 0.08;
        } else if (goal === 'build' && phase === 'performing') {
          // Building: hammering motion with both arms, body involvement, stance
          if (rightArm) rightArm.rotation.x = Math.sin(tNow * 6) * 0.9 - 0.5;
          if (leftArm) leftArm.rotation.x = -0.6 + Math.sin(tNow * 6 + 0.5) * 0.3;
          if (body) body.rotation.x = 0.15 + Math.sin(tNow * 6) * 0.08;
          if (leftLeg) leftLeg.rotation.x = -0.15;
          if (rightLeg) rightLeg.rotation.x = 0.05;
        } else if (goal === 'cook' && phase === 'performing') {
          // Cooking: stir motion with body turn
          if (body) body.rotation.y = Math.sin(tNow * 2) * 0.15;
          if (rightArm) rightArm.rotation.x = Math.sin(tNow * 3) * 0.4;
          if (leftArm) leftArm.rotation.x = Math.sin(tNow * 3 + 2) * 0.2;
        } else if (goal === 'socialize' && phase === 'performing') {
          // Socializing: gesture with arms, head nod
          if (leftArm) leftArm.rotation.x = Math.sin(tNow * 2) * 0.3 - 0.2;
          if (rightArm) rightArm.rotation.x = Math.sin(tNow * 2 + 1) * 0.3 - 0.2;
          if (head) head.rotation.y = Math.sin(tNow * 1.5) * 0.15;
          if (head) head.rotation.x = Math.sin(tNow * 3) * 0.08;
        } else if (goal === 'read' && phase === 'performing') {
          // Reading: look down, slight arm movement
          if (head) head.rotation.x = 0.3;
          if (rightArm) rightArm.rotation.x = -0.5;
          if (leftArm) leftArm.rotation.x = -0.5;
        }

        // Update goal indicator emoji sprite
        if (group.userData.indicator) {
          const goalInfo = npc.currentGoal ? AI_GOALS[npc.currentGoal] : null;
          const goalIcon = goalInfo ? goalInfo.icon : '💭';
          if (group.userData.lastGoalIcon !== goalIcon) {
            group.userData.lastGoalIcon = goalIcon;
            const cvs = group.userData.indicatorCanvas;
            const ctx2d = cvs.getContext('2d');
            ctx2d.clearRect(0, 0, 64, 64);
            ctx2d.font = '48px serif';
            ctx2d.textAlign = 'center';
            ctx2d.textBaseline = 'middle';
            ctx2d.fillText(goalIcon, 32, 32);
            group.userData.indicatorTex.needsUpdate = true;
          }
          if (phase === 'performing') {
            group.userData.indicator.position.y = 1.7 + Math.sin(Date.now() * 0.006) * 0.08;
          } else {
            group.userData.indicator.position.y = 1.7;
          }
        }
      }

      for (const [id, group] of meshMap) {
        if (!activeIds.has(id)) {
          scene.remove(group);
          group.children.forEach(c => {
            if (c.geometry) c.geometry.dispose();
            if (c.material) {
              if (c.material.map) c.material.map.dispose();
              c.material.dispose();
            }
          });
          meshMap.delete(id);
        }
      }

      renderer.render(scene, camera);

      // ---- PiP first-person view for 小智 ----
      var llmNpc = currentNpcs.find(function(n) { return n.isLLMControlled; });
      if (llmNpc && threeRef.current.fpCamera) {
        var fpc = threeRef.current.fpCamera;
        var eyeHeight = 1.6;
        fpc.position.set(llmNpc.x, (llmNpc.y || 0) + eyeHeight, llmNpc.z);
        var lookDist = 10;
        var facingAngle = llmNpc.facing || 0;
        fpc.lookAt(
          llmNpc.x + Math.sin(facingAngle) * lookDist,
          (llmNpc.y || 0) + eyeHeight - 0.5,
          llmNpc.z + Math.cos(facingAngle) * lookDist
        );
        // Hide 小智's mesh temporarily for FP view
        var llmMesh = meshMap.get(llmNpc.id);
        if (llmMesh) llmMesh.visible = false;
        // Render PiP in bottom-right corner
        var pipSize = Math.min(180, Math.floor(renderer.domElement.width * 0.22));
        var pipMargin = 8;
        renderer.setViewport(
          renderer.domElement.width - pipSize - pipMargin,
          pipMargin,
          pipSize,
          pipSize
        );
        renderer.setScissor(
          renderer.domElement.width - pipSize - pipMargin,
          pipMargin,
          pipSize,
          pipSize
        );
        renderer.setScissorTest(true);
        renderer.render(scene, fpc);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
        // Restore 小智's mesh
        if (llmMesh) llmMesh.visible = true;
      }
    };
    animate();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onResize);
      ro.observe(container);
    }
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
      controls.dispose();
      renderer.dispose();
      for (const [, group] of threeRef.current.npcMeshMap) {
        scene.remove(group);
        group.children.forEach(c => {
          if (c.geometry) c.geometry.dispose();
          if (c.material) {
            if (c.material.map) c.material.map.dispose();
            c.material.dispose();
          }
        });
      }
      threeRef.current.npcMeshMap.clear();
      if (threeRef.current.torchLights) {
        threeRef.current.torchLights.forEach(l => { scene.remove(l); l.dispose(); });
        threeRef.current.torchLights = [];
      }
      const w = worldRef.current;
      for (const [, cd] of w.chunks) {
        if (cd.opaqueMesh) cd.opaqueMesh.geometry.dispose();
        if (cd.transMesh) cd.transMesh.geometry.dispose();
      }
      w.chunks.clear();
      w.allBlocks.clear();
      w.villageGenerated = false;
      w.torchLightsAdded = false;
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
  }, []);

  // ---- Day/night lighting ----
  useEffect(() => {
    const t = threeRef.current;
    if (!t) return;
    if (isNight) {
      t.scene.background = new THREE.Color(0x0a0a1e);
      t.ambient.intensity = 0.25;
      t.dir.intensity = 0.3;
      t.dir.color.set(0x6666aa);
      t.hemi.intensity = 0.15;
    } else {
      t.scene.background = new THREE.Color(0x87CEEB);
      t.ambient.intensity = 1.0;
      t.dir.intensity = 1.5;
      t.dir.color.set(0xffffff);
      t.hemi.intensity = 0.5;
    }
  }, [isNight]);

  // ---- Minimap ----
  useEffect(() => {
    const minimap = minimapRef.current;
    if (!minimap) return;
    const mctx = minimap.getContext('2d');
    const mw = minimap.width;
    const mh = minimap.height;
    const world = worldRef.current;

    mctx.fillStyle = isNight ? '#0a0a2e' : '#4488aa';
    mctx.fillRect(0, 0, mw, mh);

    if (world.chunks.size === 0) return;

    const halfRange = RENDER_DISTANCE * CHUNK_SIZE;
    const { cx, cz } = world.centerChunk;
    const minX = cx * CHUNK_SIZE - halfRange;
    const minZ = cz * CHUNK_SIZE - halfRange;
    const rangeSize = halfRange * 2 + CHUNK_SIZE;
    const scale = mw / rangeSize;

    for (const [, chunkData] of world.chunks) {
      for (const [key, type] of chunkData.blocks) {
        const [bx, , bz] = key.split(',').map(Number);
        const aboveKey = makeKey(bx, parseInt(key.split(',')[1]) + 1, bz);
        if (world.allBlocks.has(aboveKey)) continue;
        const c = BLOCK_TYPES[type].top;
        mctx.fillStyle = `rgb(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)})`;
        const px = (bx - minX) * scale;
        const pz = (bz - minZ) * scale;
        if (px >= 0 && px < mw && pz >= 0 && pz < mh) {
          mctx.fillRect(px, pz, Math.max(1, scale), Math.max(1, scale));
        }
      }
    }

    const t = threeRef.current;
    if (t) {
      const tgt = t.controls.target;
      const camX = ((tgt.x - minX) / rangeSize) * mw;
      const camZ = ((tgt.z - minZ) / rangeSize) * mh;
      mctx.strokeStyle = '#ff0';
      mctx.lineWidth = 2;
      mctx.beginPath();
      mctx.arc(camX, camZ, 4, 0, Math.PI * 2);
      mctx.stroke();
    }

    const currentNpcs = npcsRef.current;
    for (const npc of currentNpcs) {
      const nx = ((npc.x - minX) / rangeSize) * mw;
      const nz = ((npc.z - minZ) / rangeSize) * mh;
      if (nx >= 0 && nx < mw && nz >= 0 && nz < mh) {
        const profColor = PROFESSIONS[npc.profession] ? PROFESSIONS[npc.profession].color : npc.color;
        mctx.fillStyle = profColor;
        mctx.beginPath();
        mctx.arc(nx, nz, 3, 0, Math.PI * 2);
        mctx.fill();
        mctx.strokeStyle = '#fff';
        mctx.lineWidth = 1;
        mctx.stroke();
      }
    }
  }, [blockCount, isNight]);

  // ---- Raycasting helpers ----
  const getRayTarget = useCallback((e) => {
    const t = threeRef.current;
    if (!t) return null;
    const rect = t.renderer.domElement.getBoundingClientRect();
    t.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    t.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    t.raycaster.setFromCamera(t.mouse, t.camera);
    const targets = [];
    const world = worldRef.current;
    for (const [, chunkData] of world.chunks) {
      if (chunkData.opaqueMesh) targets.push(chunkData.opaqueMesh);
      if (chunkData.transMesh) targets.push(chunkData.transMesh);
    }
    const hits = t.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const hit = hits[0];
    const n = hit.face.normal;
    const hitBlock = {
      x: Math.floor(hit.point.x - n.x * 0.5),
      y: Math.floor(hit.point.y - n.y * 0.5),
      z: Math.floor(hit.point.z - n.z * 0.5),
    };
    const placePos = {
      x: Math.floor(hit.point.x + n.x * 0.5),
      y: Math.floor(hit.point.y + n.y * 0.5),
      z: Math.floor(hit.point.z + n.z * 0.5),
    };
    return { hitBlock, placePos };
  }, []);

  const handleMouseMove = useCallback((e) => {
    const t = threeRef.current;
    if (!t) return;
    const result = getRayTarget(e);
    if (!result) { t.highlight.visible = false; return; }
    if (toolRef.current === 'place') {
      const p = result.placePos;
      if (p.y >= 0 && p.y < CHUNK_HEIGHT) {
        t.highlight.position.set(p.x + 0.5, p.y + 0.5, p.z + 0.5);
        t.highlight.visible = true;
      } else {
        t.highlight.visible = false;
      }
    } else if (result.hitBlock) {
      const h = result.hitBlock;
      t.highlight.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5);
      t.highlight.visible = true;
    } else {
      t.highlight.visible = false;
    }
  }, [getRayTarget]);

  const handleClick = useCallback((e) => {
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
    const result = getRayTarget(e);
    if (!result) return;
    const world = worldRef.current;
    if (toolRef.current === 'remove') {
      if (!result.hitBlock) return;
      const { x, y, z } = result.hitBlock;
      const key = makeKey(x, y, z);
      if (world.allBlocks.has(key)) {
        world.allBlocks.delete(key);
        const { cx, cz } = worldToChunk(x, z);
        const ck = chunkKey(cx, cz);
        const cd = world.chunks.get(ck);
        if (cd) cd.blocks.delete(key);
        fnRef.current.rebuildAt(x, z);
        setBlockCount(world.allBlocks.size);
      }
    } else {
      const p = result.placePos;
      if (p.y >= 0 && p.y < CHUNK_HEIGHT) {
        const key = makeKey(p.x, p.y, p.z);
        if (!world.allBlocks.has(key)) {
          const blockType = selectedBlockRef.current;
          world.allBlocks.set(key, blockType);
          const { cx, cz } = worldToChunk(p.x, p.z);
          const ck = chunkKey(cx, cz);
          const cd = world.chunks.get(ck);
          if (cd) cd.blocks.set(key, blockType);
          fnRef.current.rebuildAt(p.x, p.z);
          setBlockCount(world.allBlocks.size);
        }
      }
    }
  }, [getRayTarget]);

  const handleContextMenu = useCallback((e) => e.preventDefault(), []);

  // ---- Keyboard movement ----
  useEffect(() => {
    const keys = {};
    const onKeyDown = (e) => { keys[e.key.toLowerCase()] = true; };
    const onKeyUp = (e) => { keys[e.key.toLowerCase()] = false; };
    const interval = setInterval(() => {
      const t = threeRef.current;
      if (!t) return;
      const spd = 0.4;
      const forward = new THREE.Vector3();
      t.camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      let moved = false;
      if (keys['w'] || keys['arrowup'])    { t.controls.target.addScaledVector(forward, spd); t.camera.position.addScaledVector(forward, spd); moved = true; }
      if (keys['s'] || keys['arrowdown'])  { t.controls.target.addScaledVector(forward, -spd); t.camera.position.addScaledVector(forward, -spd); moved = true; }
      if (keys['a'] || keys['arrowleft'])  { t.controls.target.addScaledVector(right, -spd); t.camera.position.addScaledVector(right, -spd); moved = true; }
      if (keys['d'] || keys['arrowright']) { t.controls.target.addScaledVector(right, spd); t.camera.position.addScaledVector(right, spd); moved = true; }
      if (keys['q']) { t.camera.position.y += spd; t.controls.target.y += spd; moved = true; }
      if (keys['e']) { t.camera.position.y -= spd; t.controls.target.y -= spd; moved = true; }
      if (moved) t.controls.update();
    }, 16);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      clearInterval(interval);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const resetCamera = useCallback(() => {
    const t = threeRef.current;
    if (!t) return;
    t.camera.position.set(30, 25, 30);
    t.controls.target.set(0, 2, 0);
    t.controls.update();
  }, []);

  const resetWorld = useCallback(() => {
    const world = worldRef.current;
    const t = threeRef.current;
    if (!t) return;
    for (const [, chunkData] of world.chunks) {
      if (chunkData.opaqueMesh) { t.scene.remove(chunkData.opaqueMesh); chunkData.opaqueMesh.geometry.dispose(); }
      if (chunkData.transMesh) { t.scene.remove(chunkData.transMesh); chunkData.transMesh.geometry.dispose(); }
    }
    if (t.torchLights) {
      t.torchLights.forEach(l => { t.scene.remove(l); l.dispose(); });
      t.torchLights = [];
    }
    world.chunks.clear();
    world.allBlocks.clear();
    world.villageGenerated = false;
    world.torchLightsAdded = false;
    world.gen = createTerrainGenerator(Math.random());
    fnRef.current.ensureChunks(0, 0);
    resetCamera();
  }, [resetCamera]);

  return (
    <div className="voxel-world">
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        onMouseMove={handleMouseMove}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />

      <div className="voxel-hud">
        <canvas ref={minimapRef} width={128} height={128} className="voxel-minimap" />
        <div className="voxel-hud-controls">
          <button onClick={resetCamera} title="Reset Camera">🎯</button>
          <button onClick={resetWorld} title="New World">🔄</button>
        </div>
        <div className="voxel-hud-info">
          <span>{isNight ? '🌙 夜晚' : '☀️ 白天'} {tickToTimeStr(worldTime)}</span>
          <span>Chunks: {chunkCount} | Blocks: {blockCount}</span>
        </div>
        <div className="voxel-hud-info" style={{ fontSize: '9px', opacity: 0.7, marginTop: '2px' }}>
          <span>WASD:移动 Q/E:升降 滚轮:缩放</span>
        </div>
        <div className="voxel-hud-info" style={{ fontSize: '9px', opacity: 0.7 }}>
          <span>中键:旋转 右键:平移 左键:放置/移除</span>
        </div>
      </div>

      <div className="voxel-toolbar">
        <div className="voxel-tools">
          <button
            className={tool === 'place' ? 'active' : ''}
            onClick={() => setTool('place')}
            title="Place Block"
          >
            ➕
          </button>
          <button
            className={tool === 'remove' ? 'active' : ''}
            onClick={() => setTool('remove')}
            title="Remove Block"
          >
            ⛏️
          </button>
          <div className="voxel-separator" />
          {BLOCK_LIST.map(type => (
            <button
              key={type}
              className={selectedBlock === type ? 'active' : ''}
              onClick={() => { setSelectedBlock(type); setTool('place'); }}
              title={BLOCK_TYPES[type].label}
            >
              <span
                className="voxel-block-preview"
                style={{ background: BLOCK_TYPES[type].preview }}
              />
              <span className="voxel-block-label">{BLOCK_TYPES[type].label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   VoxelWorldInfo — AI Life Observation Panel
   ================================================================ */

function VoxelWorldInfo() {
  const {
    npcs, selectedNpc, setSelectedNpc, speed, setSpeed,
    events, addNpc, removeNpc, worldTime, villageStats, activityLog, sendLLMCommand,
  } = useVoxelWorld();

  const [expandedSections, setExpandedSections] = useState({
    llmCommand: true,
    villageStats: true,
    recruit: false,
    npcDetail: true,
    npcList: true,
    aiLog: false,
    eventLog: false,
  });

  const [llmCommandText, setLlmCommandText] = useState('');
  const [llmSending, setLlmSending] = useState(false);
  const [llmFeedback, setLlmFeedback] = useState('');
  const [llmSettings, setLlmSettings] = useState(null);

  // Try to load settings from storage utility
  useEffect(function() {
    try {
      const stored = loadSettings();
      if (stored && stored.apiKey) setLlmSettings(stored);
    } catch (e) { void e; }
  }, []);

  const toggleSection = useCallback(function(key) {
    setExpandedSections(function(prev) { return { ...prev, [key]: !prev[key] }; });
  }, []);

  const selNpcData = selectedNpc !== null ? npcs.find(function(n) { return n.id === selectedNpc; }) : null;

  const currentHour = tickToHour(worldTime);
  const currentPhase = getSchedulePhase(currentHour);
  const phaseInfo = SCHEDULE_PHASES[currentPhase] || SCHEDULE_PHASES.work;

  const styles = useMemo(function() {
    return {
      statRow: {
        display: 'flex', alignItems: 'center', gap: '6px',
        padding: '2px 0', fontSize: '11px',
      },
      statBar: {
        flex: 1, height: '8px', background: '#333',
        borderRadius: '4px', overflow: 'hidden',
      },
      statBarInner: function(pct, color) {
        return {
          width: pct + '%', height: '100%', background: color,
          borderRadius: '4px', transition: 'width 0.3s',
        };
      },
    };
  }, []);

  const handleSendLLMCommandWithText = useCallback(function(text) {
    if (!text || !text.trim() || llmSending) return;
    if (!llmSettings) {
      setLlmFeedback('❌ 请先在设置中配置API Key和模型');
      return;
    }
    setLlmSending(true);
    setLlmFeedback('');
    sendLLMCommand(text.trim(), llmSettings).then(function(result) {
      setLlmSending(false);
      if (result.success) {
        const actionDesc = result.actions.map(function(a) { return AI_GOALS[a.goal] ? AI_GOALS[a.goal].icon + AI_GOALS[a.goal].label : a.goal; }).join(' → ');
        setLlmFeedback('✅ ' + actionDesc);
        setLlmCommandText('');
      } else {
        setLlmFeedback('❌ ' + (result.error || '指令执行失败'));
      }
    });
  }, [llmSending, llmSettings, sendLLMCommand]);

  const handleSendLLMCommand = useCallback(function() {
    handleSendLLMCommandWithText(llmCommandText);
  }, [llmCommandText, handleSendLLMCommandWithText]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#1e1e1e', color: '#ccc', fontFamily: 'sans-serif', fontSize: '12px' }}>
      {/* Top Controls — Speed & Time */}
      <div className="real-world-controls">
        {[0, 1, 2, 3].map(function(s) {
          return (
            <button key={s} className={'real-world-btn' + (speed === s ? ' primary' : '')} onClick={function() { setSpeed(s); }}>
              {s === 0 ? '⏸' : s + 'x'}
            </button>
          );
        })}
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#aaa' }}>
          {isDaytime(worldTime) ? '☀️' : '🌙'} {tickToTimeStr(worldTime)}
        </span>
        <span style={{ fontSize: '10px', color: phaseInfo.color || '#aaa' }}>{phaseInfo.icon} {phaseInfo.label}</span>
        <span style={{ fontSize: '10px', color: '#888' }}>第{Math.floor(worldTime / DAY_LENGTH) + 1}天</span>
      </div>

      {/* Recruit Buttons */}
      <div className="real-world-controls" style={{ paddingTop: 0, flexWrap: 'wrap' }}>
        {PROFESSION_LIST.map(function(prof) {
          var p = PROFESSIONS[prof];
          return (
            <button key={prof} className="real-world-btn" onClick={function() { addNpc(prof); }} title={p.workDesc}
              style={{ color: p.color, fontSize: '10px', padding: '2px 6px' }}>
              {p.icon} +
            </button>
          );
        })}
        <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#888' }}>👥 {npcs.length}</span>
      </div>

      {/* Scrollable Sections */}
      <div className="novel-scrollable-area">
        {/* LLM Command Section */}
        <div className="novel-section-header" onClick={function() { toggleSection('llmCommand'); }}>
          <span className="novel-section-arrow">{expandedSections.llmCommand ? '▾' : '▸'}</span>
          <h4>🤖 AI指令 (小智)</h4>
          {(function() {
            var llmNpc = npcs.find(function(n) { return n.isLLMControlled; });
            return llmNpc ? <span className="novel-section-badge" style={{ color: '#FFD700' }}>{llmNpc.goalPhase === 'idle' ? '等待指令' : llmNpc.goalPhase === 'walking' ? '🚶前往中' : '✨执行中'}</span> : null;
          })()}
        </div>
        {expandedSections.llmCommand && (
          <div className="novel-section-body">
            {(function() {
              var llmNpc = npcs.find(function(n) { return n.isLLMControlled; });
              if (!llmNpc) return <div style={{ fontSize: '11px', color: '#888' }}>没有AI控制角色</div>;
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                    <span style={{ fontSize: '12px' }}>👑</span>
                    <span style={{ color: '#FFD700', fontWeight: 'bold', fontSize: '12px' }}>{llmNpc.name}</span>
                    <span style={{ fontSize: '10px', color: '#aaa' }}>位置: ({Math.floor(llmNpc.x)}, {Math.floor(llmNpc.z)})</span>
                  </div>
                  {llmNpc.thoughtBubble && (
                    <div style={{ fontSize: '11px', color: '#aac', fontStyle: 'italic', marginBottom: '6px', paddingLeft: '4px' }}>
                      💭 &ldquo;{llmNpc.thoughtBubble}&rdquo;
                    </div>
                  )}
                  {llmNpc.llmGoalQueue && llmNpc.llmGoalQueue.length > 0 && (
                    <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>
                      📋 待执行指令: {llmNpc.llmGoalQueue.length}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      type="text"
                      value={llmCommandText}
                      onChange={function(e) { setLlmCommandText(e.target.value); }}
                      onKeyDown={function(e) {
                        if (e.key === 'Enter' && !llmSending && llmCommandText.trim()) {
                          e.preventDefault();
                          handleSendLLMCommand();
                        }
                      }}
                      placeholder="输入指令，如：去耕地干活..."
                      disabled={llmSending}
                      style={{
                        flex: 1, padding: '4px 8px', fontSize: '11px',
                        background: '#2a2a3a', border: '1px solid #444', borderRadius: '4px',
                        color: '#ddd', outline: 'none',
                      }}
                    />
                    <button
                      className="real-world-btn primary"
                      disabled={llmSending || !llmCommandText.trim()}
                      onClick={handleSendLLMCommand}
                      style={{ fontSize: '11px', padding: '4px 10px', whiteSpace: 'nowrap' }}
                    >
                      {llmSending ? '⏳' : '▶ 发送'}
                    </button>
                  </div>
                  {llmFeedback && (
                    <div style={{
                      marginTop: '4px', fontSize: '10px', padding: '3px 6px', borderRadius: '4px',
                      background: llmFeedback.startsWith('✅') ? 'rgba(80,200,80,0.1)' : 'rgba(255,80,80,0.1)',
                      color: llmFeedback.startsWith('✅') ? '#8d8' : '#f88',
                    }}>
                      {llmFeedback}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', marginTop: '6px' }}>
                    {[
                      { label: '🌾 去耕地', cmd: '去耕地干活' },
                      { label: '🔨 建造', cmd: '去建造房屋' },
                      { label: '🚶 散步', cmd: '去散步' },
                      { label: '🍖 吃饭', cmd: '去吃饭' },
                      { label: '😴 睡觉', cmd: '去睡觉' },
                      { label: '🛡️ 巡逻', cmd: '去巡逻' },
                      { label: '📖 看书', cmd: '去看书学习' },
                      { label: '💬 聊天', cmd: '去和别人聊天' },
                    ].map(function(shortcut) {
                      return (
                        <button
                          key={shortcut.cmd}
                          className="real-world-btn"
                          disabled={llmSending}
                          onClick={function() {
                            setLlmCommandText(shortcut.cmd);
                            handleSendLLMCommandWithText(shortcut.cmd);
                          }}
                          style={{ fontSize: '9px', padding: '2px 5px' }}
                        >
                          {shortcut.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Village Stats Section */}
        <div className="novel-section-header" onClick={function() { toggleSection('villageStats'); }}>
          <span className="novel-section-arrow">{expandedSections.villageStats ? '▾' : '▸'}</span>
          <h4>🏘️ 村庄状态</h4>
        </div>
        {expandedSections.villageStats && (
          <div className="novel-section-body">
            <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: '#aaa' }}>
              <span>🌾 食物: {Math.floor(villageStats.food)}</span>
              <span>🏠 建筑: {villageStats.buildings}</span>
              <span>🛡️ 安全: {Math.floor(villageStats.safety)}</span>
            </div>
          </div>
        )}

        {/* Recruit Section */}
        <div className="novel-section-header" onClick={function() { toggleSection('recruit'); }}>
          <span className="novel-section-arrow">{expandedSections.recruit ? '▾' : '▸'}</span>
          <h4>➕ 招募村民</h4>
        </div>
        {expandedSections.recruit && (
          <div className="novel-section-body">
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {PROFESSION_LIST.map(function(prof) {
                var p = PROFESSIONS[prof];
                return (
                  <button key={prof} className="real-world-btn" onClick={function() { addNpc(prof); }} title={p.workDesc}
                    style={{ color: p.color, fontSize: '10px', padding: '3px 6px' }}>
                    {p.icon} {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Selected NPC Details */}
        {selNpcData && (
          <>
            <div className="novel-section-header" onClick={function() { toggleSection('npcDetail'); }}>
              <span className="novel-section-arrow">{expandedSections.npcDetail ? '▾' : '▸'}</span>
              <h4>
                {selNpcData.isLLMControlled ? '👑' : (PROFESSIONS[selNpcData.profession] ? PROFESSIONS[selNpcData.profession].icon : '👤')}{' '}
                {selNpcData.name}
              </h4>
              <span className="novel-section-badge" style={{ color: selNpcData.isLLMControlled ? '#FFD700' : (PROFESSIONS[selNpcData.profession] ? PROFESSIONS[selNpcData.profession].color : '#888') }}>
                {selNpcData.isLLMControlled ? 'AI助手' : (PROFESSIONS[selNpcData.profession] ? PROFESSIONS[selNpcData.profession].label : selNpcData.profession)}
              </span>
            </div>
            {expandedSections.npcDetail && (
              <div className="novel-section-body">
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '4px', marginBottom: '4px' }}>
                  <button className="real-world-btn" style={{ color: '#f88', fontSize: '10px', padding: '1px 6px' }} onClick={function() { removeNpc(selNpcData.id); }} title="移除村民">🗑️ 移除</button>
                  <button className="real-world-btn" style={{ fontSize: '10px', padding: '1px 6px' }} onClick={function() { setSelectedNpc(null); }}>✕ 关闭</button>
                </div>
                {/* Current Goal & Thought */}
                <div style={{ background: '#1a2a3a', borderRadius: '6px', padding: '6px 8px', marginBottom: '6px' }}>
                  {selNpcData.currentGoal ? (
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 6px', borderRadius: '10px', fontSize: '11px',
                          background: AI_GOALS[selNpcData.currentGoal] ? AI_GOALS[selNpcData.currentGoal].color : '#555',
                          color: '#fff',
                        }}>
                          {AI_GOALS[selNpcData.currentGoal] ? AI_GOALS[selNpcData.currentGoal].icon : '?'} {AI_GOALS[selNpcData.currentGoal] ? AI_GOALS[selNpcData.currentGoal].label : selNpcData.currentGoal}
                        </span>
                        <span style={{ fontSize: '10px', color: '#8ab' }}>
                          {selNpcData.goalPhase === 'walking' ? '🚶 前往中...' : selNpcData.goalPhase === 'performing' ? '✨ 进行中' : '💭 思考中'}
                        </span>
                      </div>
                      {selNpcData.thoughtBubble && (
                        <div style={{ fontSize: '11px', color: '#aac', fontStyle: 'italic', paddingLeft: '4px' }}>
                          💭 &ldquo;{selNpcData.thoughtBubble}&rdquo;
                        </div>
                      )}
                      {selNpcData.goalPhase === 'performing' && selNpcData.activityTicks > 0 && (
                        <div style={{ marginTop: '4px' }}>
                          <div style={{ fontSize: '9px', color: '#888', marginBottom: '2px' }}>进度</div>
                          <div style={{ height: '4px', background: '#333', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{
                              width: getGoalProgress(selNpcData) + '%',
                              height: '100%', background: AI_GOALS[selNpcData.currentGoal] ? AI_GOALS[selNpcData.currentGoal].color : '#4a90d9',
                              borderRadius: '2px', transition: 'width 0.3s',
                            }} />
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ fontSize: '11px', color: '#888' }}>💭 思考下一步行动...</div>
                  )}
                </div>
                <div style={{ color: '#aaa', fontSize: '10px', marginBottom: '6px' }}>
                  {getActivityDisplay(selNpcData)} | 位置: ({Math.floor(selNpcData.x)}, {Math.floor(selNpcData.z)})
                  {selNpcData.inWater ? ' 🌊水中' : ''} | Y: {Math.floor(selNpcData.y || 0)}
                </div>
                {/* Chat bubble */}
                {selNpcData.lastChat && (worldTime - selNpcData.lastChatTick) < 100 && (
                  <div style={{ background: '#2a2a3a', padding: '4px 8px', borderRadius: '8px', fontSize: '11px', color: '#ddd', marginBottom: '6px', fontStyle: 'italic' }}>
                    💬 &ldquo;{selNpcData.lastChat}&rdquo;
                  </div>
                )}
                {[
                  { label: '😊 心情', val: selNpcData.mood, color: '#5b5' },
                  { label: '🍗 饱食', val: selNpcData.hunger, color: '#da5' },
                  { label: '😴 精力', val: selNpcData.rest, color: '#58d' },
                  { label: '💬 社交', val: selNpcData.social, color: '#e5a' },
                  { label: '💨 氧气', val: selNpcData.oxygen != null ? selNpcData.oxygen : 100, color: '#4ad' },
                ].map(function(stat) {
                  return (
                    <div key={stat.label} style={styles.statRow}>
                      <span style={{ width: '60px' }}>{stat.label}</span>
                      <span style={{ width: '24px', textAlign: 'right', color: stat.val < 20 ? '#f66' : '#ccc' }}>{Math.floor(stat.val)}</span>
                      <div style={styles.statBar}>
                        <div style={styles.statBarInner(stat.val, stat.color)} />
                      </div>
                    </div>
                  );
                })}
                {/* Inventory */}
                {selNpcData.inventory && selNpcData.inventory.length > 0 && (
                  <div style={{ marginTop: '6px' }}>
                    <div style={{ fontSize: '10px', color: '#aaa', marginBottom: '2px' }}>🎒 背包:</div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {selNpcData.inventory.map(function(item, idx) {
                        return (
                          <span key={idx} style={{ background: '#2a2a2a', padding: '1px 4px', borderRadius: '3px', fontSize: '10px', color: '#ccc' }}>
                            {item.label || item.type}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* NPC/Villager List */}
        <div className="novel-section-header" onClick={function() { toggleSection('npcList'); }}>
          <span className="novel-section-arrow">{expandedSections.npcList ? '▾' : '▸'}</span>
          <h4>👥 村民列表</h4>
          {npcs.length > 0 && <span className="novel-section-badge">{npcs.length}</span>}
        </div>
        {expandedSections.npcList && (
          <div className="novel-section-body" style={{ padding: 0 }}>
            {npcs.map(function(npc) {
              var prof = PROFESSIONS[npc.profession];
              var goalInfo = npc.currentGoal ? AI_GOALS[npc.currentGoal] : null;
              return (
                <div key={npc.id} style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '4px 12px', borderBottom: '1px solid #2a2a2a', fontSize: '11px',
                  cursor: 'pointer', background: selectedNpc === npc.id ? '#2a3a4a' : 'transparent',
                }} onClick={function() { setSelectedNpc(npc.id); }}>
                  <span style={{ fontSize: '12px' }}>{npc.isLLMControlled ? '👑' : (prof ? prof.icon : '👤')}</span>
                  <span style={{ color: npc.isLLMControlled ? '#FFD700' : '#ddd', fontWeight: 'bold' }}>{npc.name}</span>
                  <span style={{ color: npc.isLLMControlled ? '#FFD700' : (prof ? prof.color : '#888'), fontSize: '9px' }}>
                    {npc.isLLMControlled ? 'AI助手' : (prof ? prof.label : npc.profession)}
                  </span>
                  {goalInfo && (
                    <span style={{
                      color: goalInfo.color, fontSize: '10px', marginLeft: 'auto',
                      display: 'inline-flex', alignItems: 'center', gap: '2px',
                    }}>
                      {goalInfo.icon}
                      <span style={{ fontSize: '9px' }}>
                        {npc.goalPhase === 'walking' ? '前往' + goalInfo.label : goalInfo.label}
                      </span>
                    </span>
                  )}
                  {!goalInfo && (
                    <span style={{ color: '#666', fontSize: '10px', marginLeft: 'auto' }}>💭 思考中</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* AI Activity Log */}
        <div className="novel-section-header" onClick={function() { toggleSection('aiLog'); }}>
          <span className="novel-section-arrow">{expandedSections.aiLog ? '▾' : '▸'}</span>
          <h4>🧠 AI 活动日志</h4>
          {activityLog.length > 0 && <span className="novel-section-badge">{activityLog.length}</span>}
        </div>
        {expandedSections.aiLog && (
          <div className="novel-section-body">
            <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
              {activityLog.slice(-20).reverse().map(function(entry, i) {
                return (
                  <div key={i} style={{
                    padding: '3px 0', borderBottom: '1px solid #2a2a2a',
                    fontSize: '10px', color: '#aaa',
                  }}>
                    <span style={{ color: '#666', marginRight: '4px' }}>{entry.time}</span>
                    <span style={{ color: '#8ab', fontWeight: 'bold', marginRight: '4px' }}>{entry.name}</span>
                    <span>{entry.text}</span>
                  </div>
                );
              })}
              {activityLog.length === 0 && (
                <div style={{ fontSize: '10px', color: '#666', fontStyle: 'italic' }}>等待AI做出决策...</div>
              )}
            </div>
          </div>
        )}

        {/* Event Log */}
        <div className="novel-section-header" onClick={function() { toggleSection('eventLog'); }}>
          <span className="novel-section-arrow">{expandedSections.eventLog ? '▾' : '▸'}</span>
          <h4>📜 事件日志</h4>
          {events.length > 0 && <span className="novel-section-badge">{events.length}</span>}
        </div>
        {expandedSections.eventLog && (
          <div className="novel-section-body">
            <div style={{ maxHeight: '120px', overflowY: 'auto' }}>
              {events.slice(-10).reverse().map(function(ev, i) {
                return <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid #2a2a2a', fontSize: '11px', color: '#aaa' }}>{ev.text}</div>;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================================================================
   Default export & named exports
   ================================================================ */

export default function VoxelWorld() {
  return (
    <VoxelWorldProvider>
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <VoxelWorldCanvas />
        </div>
      </div>
    </VoxelWorldProvider>
  );
}

export { VoxelWorldProvider, VoxelWorldCanvas, VoxelWorldInfo };
