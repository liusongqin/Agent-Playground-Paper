import { useState, useRef, useCallback, useEffect, useMemo, useContext, createContext, memo } from 'react';
import { sendChatRequest } from '../services/openai';
import { WorldSimulatorContext } from './WorldSimulator';

/* ================================================================
   Constants & Configuration
   ================================================================ */

const MAX_EVENTS = 200;
const MAX_DISPLAYED_CONTINUATION_EVENTS = 20;
const MAX_ACTION_TEXT_LENGTH = 20;
const LOCALSTORAGE_KEY = 'novelAnalysisSaves';
const CHUNK_SIZE = 3000;
const CHUNK_OVERLAP = 500;

const AGENT_NODE_COLORS = {
  idle: '#9E9E9E',
  active: '#4CAF50',
  conflict: '#f44336',
  trade: '#00BCD4',
  social: '#FF9800',
  discovery: '#9C27B0',
};

const AGENT_EDGE_STYLES = {
  友好: { color: '#4CAF50', width: 1.5, dash: [], label: '友好' },
  敌对: { color: '#f44336', width: 1.5, dash: [4, 3], label: '敌对' },
  中立: { color: '#9E9E9E', width: 1, dash: [2, 2], label: '中立' },
  亲属: { color: '#E91E63', width: 2, dash: [], label: '亲属' },
  贸易: { color: '#00BCD4', width: 1.5, dash: [6, 3], label: '贸易' },
  师徒: { color: '#9C27B0', width: 1.5, dash: [4, 4], label: '师徒' },
  同盟: { color: '#2196F3', width: 2, dash: [], label: '同盟' },
  竞争: { color: '#FF9800', width: 1.5, dash: [4, 3], label: '竞争' },
  恋人: { color: '#FF69B4', width: 2, dash: [], label: '恋人' },
  主仆: { color: '#795548', width: 1.5, dash: [3, 2], label: '主仆' },
};

const DEFAULT_EDGE_STYLE = { color: '#9E9E9E', width: 1, dash: [2, 2], label: '关系' };

const RELATIONSHIP_TYPES = {
  友好: { color: '#4CAF50', icon: '💚' },
  敌对: { color: '#f44336', icon: '💔' },
  中立: { color: '#9E9E9E', icon: '🤝' },
  亲属: { color: '#E91E63', icon: '👨‍👩‍👧‍👦' },
  贸易: { color: '#00BCD4', icon: '💰' },
  师徒: { color: '#9C27B0', icon: '📚' },
  同盟: { color: '#2196F3', icon: '🤜🤛' },
  竞争: { color: '#FF9800', icon: '⚔️' },
  恋人: { color: '#FF69B4', icon: '❤️' },
  主仆: { color: '#795548', icon: '🏰' },
};

const AGENT_NODE_CLICK_RADIUS = 26;
const AGENT_EDGE_CLICK_THRESHOLD = 10;

const NEW_CHARACTER_EMOJIS = ['🧑', '👩', '👨', '🧓', '👧', '🧔', '🤵', '👷', '💂', '🕵️', '👸', '🤴'];

/* ================================================================
   Helper Functions
   ================================================================ */

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

/** Split novel text into chunks at paragraph / sentence boundaries */
function splitNovelIntoChunks(text, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
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
      // Keep tail as overlap context for next chunk — split at sentence boundaries
      const sentences = currentChunk.split(/(?<=[。！？；.!?\n])/);
      let overlapBuf = sentences.slice(-3).join('');
      if (overlapBuf.length > overlap) overlapBuf = overlapBuf.slice(-overlap);
      currentChunk = overlapBuf + '\n' + trimmed;
    } else {
      currentChunk = currentChunk ? currentChunk + '\n' + trimmed : trimmed;
    }

    // If a single paragraph makes the chunk too large, split at sentence boundaries
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

/** Merge new characters into existing array (deduplicate by name) */
function mergeCharacters(existing, newChars) {
  const map = new Map();
  existing.forEach(c => map.set(c.name, { ...c }));

  newChars.forEach(c => {
    if (!c.name) return;
    const name = c.name.trim();
    if (map.has(name)) {
      const prev = map.get(name);
      if (c.description && (!prev.description || c.description.length > prev.description.length)) {
        prev.description = c.description;
      }
      if (c.mood) prev.mood = c.mood;
      if (c.activity) prev.activity = c.activity;
      if (c.emoji && c.emoji !== '🧑') prev.emoji = c.emoji;
      map.set(name, prev);
    } else {
      map.set(name, {
        name,
        emoji: c.emoji || NEW_CHARACTER_EMOJIS[map.size % NEW_CHARACTER_EMOJIS.length],
        description: c.description || '',
        mood: c.mood || '未知',
        activity: c.activity || '未知',
        relationships: {},
      });
    }
  });
  return Array.from(map.values());
}

/** Merge new relationships into existing array (deduplicate by from→to) */
function mergeRelationships(existing, newRels) {
  const map = new Map();
  existing.forEach(r => map.set(`${r.from}->${r.to}`, { ...r }));

  newRels.forEach(r => {
    if (!r.from || !r.to) return;
    const key = `${r.from.trim()}->${r.to.trim()}`;
    const reverseKey = `${r.to.trim()}->${r.from.trim()}`;
    if (map.has(key)) {
      const prev = map.get(key);
      if (r.description && (!prev.description || r.description.length > prev.description.length)) {
        prev.description = r.description;
      }
      if (r.type) prev.type = r.type;
    } else if (!map.has(reverseKey)) {
      map.set(key, {
        from: r.from.trim(),
        to: r.to.trim(),
        type: r.type || '中立',
        description: r.description || '',
      });
    }
  });
  return Array.from(map.values());
}

function generateChatBufferTip(character) {
  if (!character) return '正在思考...';
  const name = character.name;
  const tips = [
    `${name}正在思考你说的话...`,
    `${name}沉吟片刻...`,
    `${name}若有所思地看着你...`,
  ];
  return tips[Math.floor(Math.random() * tips.length)];
}

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
   Context
   ================================================================ */

const MultiAgentSimulatorContext = createContext(null);

/* ================================================================
   Provider: MultiAgentSimulatorProvider
   ================================================================ */

function MultiAgentSimulatorProvider({ settings, children }) {
  /* --- Novel state --- */
  const [novelTitle, setNovelTitle] = useState('');
  const [novelText, setNovelText] = useState('');
  const [novelChunks, setNovelChunks] = useState([]);
  const [novelSummaries, setNovelSummaries] = useState([]);

  /* --- Chunk size settings --- */
  const [chunkSize, setChunkSize] = useState(CHUNK_SIZE);
  const [chunkOverlap, setChunkOverlap] = useState(CHUNK_OVERLAP);

  /* --- Analysis state --- */
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0, phase: '' });

  /* --- Character & relationship state --- */
  const [characters, setCharacters] = useState([]);
  const [relationships, setRelationships] = useState([]);
  const [events, setEvents] = useState([]);

  /* --- Graph state --- */
  const [agentGraphNodes, setAgentGraphNodes] = useState([]);
  const [agentGraphEdges, setAgentGraphEdges] = useState([]);
  const [selectedAgentNode, setSelectedAgentNode] = useState(null);
  const [selectedAgentEdge, setSelectedAgentEdge] = useState(null);

  /* --- Continuation (story extrapolation) state --- */
  const [isRunning, setIsRunning] = useState(false);
  const [agentGeneration, setAgentGeneration] = useState(0);
  const [continuationEvents, setContinuationEvents] = useState([]);
  const [agentThoughts, setAgentThoughts] = useState({});

  /* --- Chat state --- */
  const [chatTarget, setChatTarget] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatting, setIsChatting] = useState(false);
  const [chatBufferTip, setChatBufferTip] = useState('');

  /* --- Log --- */
  const [log, setLog] = useState([]);
  const abortRef = useRef(null);
  const eventIdCounter = useRef(0);

  /* =====================================================
     Upload Novel — with automatic encoding detection
     ===================================================== */
  const uploadNovel = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const buffer = e.target.result;

      /* Try UTF-8 first; if the decoded text contains the Unicode
         replacement character (U+FFFD) it means the file is not valid
         UTF-8 — fall back to GBK which covers most Chinese-encoded
         novel files (e.g. from WenKu8 and similar sources). */
      let text = new TextDecoder('utf-8').decode(buffer);
      let encoding = 'UTF-8';

      if (text.includes('\uFFFD')) {
        try {
          text = new TextDecoder('gbk').decode(buffer);
          encoding = 'GBK';
        } catch {
          /* If GBK decoder is not available, keep the UTF-8 result */
        }
      }

      if (!text || !text.trim()) {
        setLog(prev => ['[错误] 文件内容为空', ...prev].slice(0, 50));
        return;
      }
      const title = file.name.replace(/\.[^.]+$/, '') || '未命名文档';
      setNovelTitle(title);
      setNovelText(text);
      const chunks = splitNovelIntoChunks(text, chunkSize, chunkOverlap);
      setNovelChunks(chunks);

      /* reset downstream state */
      setCharacters([]);
      setRelationships([]);
      setEvents([]);
      setAgentGraphNodes([]);
      setAgentGraphEdges([]);
      setNovelSummaries([]);
      setContinuationEvents([]);
      setAgentThoughts({});
      setAgentGeneration(0);
      setChatTarget(null);
      setChatMessages([]);
      setSelectedAgentNode(null);
      setSelectedAgentEdge(null);

      setLog(prev => [
        `[系统] 已加载「${title}」(${encoding})，共${text.length}字，分为${chunks.length}个片段`,
        ...prev,
      ].slice(0, 50));
    };
    reader.onerror = () => {
      setLog(prev => ['[错误] 文件读取失败', ...prev].slice(0, 50));
    };
    reader.readAsArrayBuffer(file);
  }, [chunkSize, chunkOverlap]);

  /* --- Re-chunk when chunk settings change (if text already loaded) --- */
  const rechunkNovel = useCallback(() => {
    if (!novelText) return;
    const chunks = splitNovelIntoChunks(novelText, chunkSize, chunkOverlap);
    setNovelChunks(chunks);
    setLog(prev => [
      `[系统] 已重新分段：片段大小${chunkSize}，重叠${chunkOverlap}，共${chunks.length}个片段`,
      ...prev,
    ].slice(0, 50));
  }, [novelText, chunkSize, chunkOverlap]);

  /* =====================================================
     Analyze Novel — chunk-by-chunk extraction
     ===================================================== */
  const analyzeNovel = useCallback(async () => {
    if (isAnalyzing || novelChunks.length === 0) return;
    setIsAnalyzing(true);

    /* Use settings from user config directly */
    const analysisSettings = { ...settings };

    let allCharacters = [];
    let allRelationships = [];
    let allEvents = [];
    const summaries = [];

    try {
      for (let i = 0; i < novelChunks.length; i++) {
        setAnalysisProgress({ current: i + 1, total: novelChunks.length, phase: '提取人物、关系与事件' });

        const knownCharsContext = allCharacters.length > 0
          ? `\n【已发现的人物】${allCharacters.map(c => `${c.name}(${c.description || ''})`).join('、')}` +
            (allRelationships.length > 0
              ? `\n【已发现的关系】${allRelationships.map(r => `${r.from}→${r.to}:${r.type}${r.description ? '(' + r.description + ')' : ''}`).join('、')}`
              : '')
          : '';

        const prompt = `你是一个专业的文本分析专家。请仔细阅读以下文档片段，提取其中出现的所有人物、关系以及关键事件。${knownCharsContext}

【文档片段 ${i + 1}/${novelChunks.length}】
${novelChunks[i]}

请严格按照以下JSON格式回复，不要输出任何其他内容：
{
  "characters": [
    {
      "name": "人物姓名（使用原文中的称呼）",
      "emoji": "一个代表该人物特征的emoji",
      "description": "对该人物的详细描述（身份、性格、外貌、背景等，50字以内）",
      "mood": "该人物在此片段中的主要情绪",
      "activity": "该人物在此片段中的主要行为（15字以内）",
      "motivation": "该人物的动机或目标（20字以内）"
    }
  ],
  "relationships": [
    {
      "from": "人物A的姓名",
      "to": "人物B的姓名",
      "type": "友好/敌对/中立/亲属/师徒/同盟/竞争/恋人/主仆 之一",
      "description": "关系的详细描述，包括关系的由来和发展（30字以内）"
    }
  ],
  "events": [
    {
      "description": "事件的详细描述（50字以内）",
      "participants": ["参与者1姓名", "参与者2姓名"],
      "impact": "事件造成的影响或后果（20字以内）"
    }
  ],
  "summary": "此片段的故事梗概（80字以内）"
}`;

        try {
          const controller = new AbortController();
          abortRef.current = controller;
          let fullContent = '';
          const result = await sendChatRequest(
            [
              { role: 'system', content: '你是一个专业的文本分析专家。请只输出JSON格式的分析结果，不要输出其他内容。尽可能详细地分析人物特征、关系和关键事件。' },
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
          } catch (e) { console.warn('Chunk JSON parse failed:', e); parsed = null; }

          if (parsed) {
            if (Array.isArray(parsed.characters)) {
              allCharacters = mergeCharacters(allCharacters, parsed.characters);
            }
            if (Array.isArray(parsed.relationships)) {
              allRelationships = mergeRelationships(allRelationships, parsed.relationships);
            }
            if (Array.isArray(parsed.events)) {
              allEvents = [...allEvents, ...parsed.events.filter(e => e && e.description)];
            }
            if (parsed.summary) summaries.push(parsed.summary);

            setLog(prev => [
              `[分析] 片段 ${i + 1}/${novelChunks.length}: 发现${parsed.characters?.length || 0}个人物, ${parsed.relationships?.length || 0}条关系, ${parsed.events?.length || 0}个事件`,
              ...prev,
            ].slice(0, 50));
          } else {
            setLog(prev => [`[警告] 片段 ${i + 1}/${novelChunks.length}: JSON解析失败`, ...prev].slice(0, 50));
          }
        } catch (err) {
          if (err.name === 'AbortError') break;
          setLog(prev => [`[错误] 片段 ${i + 1}: ${err.message}`, ...prev].slice(0, 50));
        }
      }

      /* --- Consolidation / Merge step --- */
      if (allCharacters.length > 0) {
        setAnalysisProgress({ current: novelChunks.length, total: novelChunks.length, phase: '合并与优化分析结果' });

        const consolidationPrompt = `你是一个专业的文本分析专家。以下是从文档分段提取的人物、关系和事件数据，请帮我优化和合并：

【已提取的人物】
${allCharacters.map(c => `- ${c.name}: ${c.description || '无描述'} (情绪:${c.mood || '未知'}, 行为:${c.activity || '未知'}, 动机:${c.motivation || '未知'})`).join('\n')}

【已提取的关系】
${allRelationships.map(r => `- ${r.from} → ${r.to}: ${r.type}${r.description ? '(' + r.description + ')' : ''}`).join('\n')}

【已提取的事件】
${allEvents.map(e => `- ${e.description}${e.participants ? ' [' + e.participants.join(', ') + ']' : ''}${e.impact ? ' → ' + e.impact : ''}`).join('\n') || '无'}

请进行以下优化：
1. 合并同一人物的不同称呼（如"小明"和"明明"是同一人则合并）
2. 为每个人物设定一个importance值(1-10)，表示在故事中的重要程度，主角为10，配角5-8，路人1-4
3. 补充遗漏的重要关系，确保关系描述详细准确
4. 修正不合理的关系类型
5. 为每个人物补充动机/目标分析
6. 合并重复事件，按时间顺序排列，标注参与者

请严格按照JSON格式回复：
{
  "characters": [
    {
      "name": "统一后的姓名",
      "aliases": ["其他称呼"],
      "emoji": "emoji",
      "description": "详细描述（身份、性格、特征等，50字以内）",
      "mood": "主要情绪",
      "activity": "主要行为(15字以内)",
      "motivation": "动机或目标(20字以内)",
      "importance": 8
    }
  ],
  "relationships": [
    {
      "from": "人物A",
      "to": "人物B",
      "type": "关系类型",
      "description": "详细描述关系的由来和发展(30字以内)"
    }
  ],
  "events": [
    {
      "description": "事件详细描述(50字以内)",
      "participants": ["参与者姓名"],
      "impact": "影响或后果(20字以内)"
    }
  ]
}`;

        try {
          const controller = new AbortController();
          abortRef.current = controller;
          let fullContent = '';
          const result = await sendChatRequest(
            [
              { role: 'system', content: '你是专业文本分析专家。只输出JSON。请尽可能详细地分析人物特征、关系和事件。' },
              { role: 'user', content: consolidationPrompt },
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
            if (Array.isArray(parsed.characters) && parsed.characters.length > 0) {
              allCharacters = parsed.characters.map(c => ({
                ...c,
                emoji: c.emoji || '🧑',
                relationships: {},
                importance: c.importance || 5,
                motivation: c.motivation || '',
              }));
            }
            if (Array.isArray(parsed.relationships)) {
              allRelationships = parsed.relationships.map(r => ({
                from: r.from?.trim(),
                to: r.to?.trim(),
                type: r.type || '中立',
                description: r.description || '',
              })).filter(r => r.from && r.to);
            }
            if (Array.isArray(parsed.events)) {
              allEvents = parsed.events.filter(e => e && e.description);
            }
            setLog(prev => [`[合并] 优化完成: ${allCharacters.length}个人物, ${allRelationships.length}条关系, ${allEvents.length}个事件`, ...prev].slice(0, 50));
          }
        } catch (err) {
          if (err.name !== 'AbortError') {
            setLog(prev => [`[警告] 合并优化失败: ${err.message}，使用原始提取结果`, ...prev].slice(0, 50));
          }
        }
      }

      /* Attach relationships to character objects */
      allRelationships.forEach(rel => {
        const char = allCharacters.find(c => c.name === rel.from);
        if (char) {
          if (!char.relationships) char.relationships = {};
          char.relationships[rel.to] = `${rel.type}${rel.description ? ':' + rel.description : ''}`;
        }
      });

      setCharacters(allCharacters);
      setRelationships(allRelationships);
      setEvents(allEvents);
      setNovelSummaries(summaries);

      /* Build graph nodes */
      setAgentGraphNodes(allCharacters.map(ch => ({
        id: ch.name,
        emoji: ch.emoji || '🧑',
        activity: ch.activity || '',
        mood: ch.mood || '',
        description: ch.description || '',
        motivation: ch.motivation || '',
        thought: '',
        lastAction: '',
        actionType: 'idle',
        gen: 0,
      })));

      /* Build graph edges */
      setAgentGraphEdges(allRelationships.map(rel => ({
        from: rel.from,
        to: rel.to,
        type: rel.type || '中立',
        label: `${rel.type}${rel.description ? ': ' + rel.description : ''}`,
        description: rel.description || '',
        gen: 0,
      })));

      setAnalysisProgress({ current: novelChunks.length, total: novelChunks.length, phase: '完成' });
      setLog(prev => [
        `[完成] 分析完毕！共发现${allCharacters.length}个人物，${allRelationships.length}条关系，${allEvents.length}个事件`,
        ...prev,
      ].slice(0, 50));
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLog(prev => [`[错误] 分析失败: ${err.message}`, ...prev].slice(0, 50));
      }
    } finally {
      setIsAnalyzing(false);
      abortRef.current = null;
    }
  }, [isAnalyzing, novelChunks, settings]);

  /* =====================================================
     Stop Analysis
     ===================================================== */
  const stopAnalysis = useCallback(() => {
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    setIsAnalyzing(false);
    setLog(prev => ['[系统] 已停止分析', ...prev].slice(0, 50));
  }, []);

  /* =====================================================
     Continue Story — each character acts as an agent
     ===================================================== */
  const runContinuationStep = useCallback(async () => {
    if (isRunning || characters.length === 0) return;
    setIsRunning(true);

    try {
      const nextGen = agentGeneration + 1;
      const allNewEvents = [];
      const thoughts = {};
      const updatedCharsMap = {};
      characters.forEach(c => { updatedCharsMap[c.name] = { ...c }; });

      const novelSummary = novelSummaries.join(' ');
      const recentEvents = continuationEvents.slice(-10);

      for (const char of characters) {
        const relDesc = char.relationships
          ? Object.entries(char.relationships).map(([name, rel]) => `${name}: ${rel}`).join(', ')
          : '无';

        const nearbyChars = characters.filter(c =>
          c.name !== char.name && char.relationships && char.relationships[c.name]
        );

        const agentPrompt = `你是文档中的角色"${char.name}"。

【你的信息】
- 身份描述: ${char.description || '未知'}
- 当前情绪: ${char.mood || '未知'}
- 近期行为: ${char.activity || '未知'}
- 动机目标: ${char.motivation || '未知'}
- 人际关系: ${relDesc}

【故事背景】
${novelSummary || '暂无'}
${recentEvents.length > 0 ? '\n【最近的故事发展】\n' + recentEvents.map(e => `- ${e.text}`).join('\n') : ''}

【你知道的人物】
${nearbyChars.map(c => `- ${c.name}: ${c.description || ''}（关系：${char.relationships?.[c.name] || '未知'}）`).join('\n') || '- 暂无'}

请以${char.name}的视角，结合你的动机和当前处境，决定你接下来要做什么。用JSON回复：
{
  "thought": "你的内心想法（1句话）",
  "action": "你的行动描述（1-2句话）",
  "dialogue": "你说的话（可以为空字符串）",
  "mood": "你现在的心情",
  "activity": "你现在在做什么（5字以内）"
}`;

        try {
          const controller = new AbortController();
          let fullContent = '';
          const result = await sendChatRequest(
            [
              { role: 'system', content: agentPrompt },
              { role: 'user', content: '请决定你的下一步行动。' },
            ],
            settings,
            (chunk) => { if (chunk) fullContent += chunk; },
            controller.signal,
          );

          const content = stripThinkTags(result?.content || fullContent);
          let actionData;
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            actionData = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
          } catch (e) { console.warn('Continuation JSON parse failed:', e); actionData = null; }

          if (actionData) {
            thoughts[char.name] = actionData.thought || '...';

            let eventText;
            if (actionData.dialogue && actionData.action) {
              eventText = `${actionData.action} "${actionData.dialogue}"`;
            } else if (actionData.dialogue) {
              eventText = `"${actionData.dialogue}"`;
            } else {
              eventText = actionData.action || `${char.name}继续思考着`;
            }

            allNewEvents.push({
              id: `e${eventIdCounter.current++}`,
              text: eventText,
              character: char.name,
              gen: nextGen,
            });

            updatedCharsMap[char.name] = {
              ...updatedCharsMap[char.name],
              mood: actionData.mood || char.mood,
              activity: actionData.activity || char.activity,
            };
          } else {
            thoughts[char.name] = '(无响应)';
          }
        } catch (err) {
          thoughts[char.name] = `(错误: ${err.message})`;
        }
      }

      setAgentThoughts(thoughts);
      setCharacters(Object.values(updatedCharsMap));

      if (allNewEvents.length > 0) {
        setContinuationEvents(prev => [...prev, ...allNewEvents].slice(-MAX_EVENTS));
      }

      /* Update graph nodes with latest thoughts / actions */
      setAgentGraphNodes(prev => {
        const updatedNodes = [...prev];
        Object.values(updatedCharsMap).forEach(ch => {
          const existing = updatedNodes.find(n => n.id === ch.name);
          const lastAction = allNewEvents.find(e => e.character === ch.name);
          if (existing) {
            existing.mood = ch.mood;
            existing.activity = ch.activity;
            existing.thought = thoughts[ch.name] || '';
            existing.lastAction = lastAction?.text || '';
            existing.gen = nextGen;
          }
        });
        return updatedNodes;
      });

      setAgentGeneration(prev => prev + 1);

      allNewEvents.forEach(e => {
        setLog(prev => [`[推演 Gen${nextGen}] ${e.character}: ${e.text}`, ...prev].slice(0, 50));
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLog(prev => [`[错误] 推演失败: ${err.message}`, ...prev].slice(0, 50));
      }
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, characters, novelSummaries, continuationEvents, agentGeneration, settings]);

  /* =====================================================
     Chat with Character
     ===================================================== */
  const chatWithCharacter = useCallback(async (characterName, userMessage) => {
    if (isChatting || !characterName || !userMessage.trim()) return;
    setIsChatting(true);

    const character = characters.find(c => c.name === characterName);
    if (!character) { setIsChatting(false); return; }

    const tip = generateChatBufferTip(character);
    setChatBufferTip(tip);
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    const relDesc = character.relationships
      ? Object.entries(character.relationships).map(([name, rel]) => `${name}: ${rel}`).join(', ')
      : '无';

    const novelSummary = novelSummaries.join(' ');
    const recentEvents = continuationEvents.filter(e => e.character === characterName).slice(-5);

    const sysPrompt = `你是文档中的角色"${character.name}"${character.emoji}，正在与读者对话。请完全代入角色，用角色的口吻回复。

【角色档案】
姓名: ${character.name}
身份描述: ${character.description || '未知'}
当前情绪: ${character.mood || '未知'}
近期行为: ${character.activity || '未知'}
动机目标: ${character.motivation || '未知'}
人际关系: ${relDesc}

【故事背景】
${novelSummary || '暂无'}
${recentEvents.length > 0 ? '\n【你的近期经历】\n' + recentEvents.map(e => `- ${e.text}`).join('\n') : ''}

【回复要求】
- 以${character.name}的第一人称视角回答，语气符合当前情绪（${character.mood}）
- 回答自然口语化，1-3句话
- 可以主动提及你知道的人和事
- 不要暴露你是AI，不要输出JSON
- 直接输出对话内容`;

    try {
      const controller = new AbortController();
      const messages = [
        { role: 'system', content: sysPrompt },
        ...chatMessages.slice(-10).map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: userMessage },
      ];

      let fullContent = '';
      const result = await sendChatRequest(messages, settings, (chunk) => {
        if (chunk) fullContent += chunk;
      }, controller.signal);

      const reply = stripThinkTags(result?.content || fullContent) || '...';
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `[错误: ${err.message}]` }]);
    } finally {
      setIsChatting(false);
      setChatBufferTip('');
    }
  }, [isChatting, characters, novelSummaries, continuationEvents, settings, chatMessages]);

  /* =====================================================
     Reset
     ===================================================== */
  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setNovelTitle('');
    setNovelText('');
    setNovelChunks([]);
    setNovelSummaries([]);
    setIsAnalyzing(false);
    setAnalysisProgress({ current: 0, total: 0, phase: '' });
    setCharacters([]);
    setRelationships([]);
    setEvents([]);
    setAgentGraphNodes([]);
    setAgentGraphEdges([]);
    setSelectedAgentNode(null);
    setSelectedAgentEdge(null);
    setIsRunning(false);
    setAgentGeneration(0);
    setContinuationEvents([]);
    setAgentThoughts({});
    setChatTarget(null);
    setChatMessages([]);
    setChatBufferTip('');
    setLog([]);
    eventIdCounter.current = 0;
  }, []);

  /* =====================================================
     Save / Load
     ===================================================== */
  const saveAnalysis = useCallback(() => {
    try {
      /* Save analysis results without the full novel text/chunks to avoid
         exceeding localStorage limits (typically 5-10 MB). Users can re-upload
         the novel if they need to re-analyze. */
      const saveData = {
        novelTitle, novelSummaries,
        novelTextLength: novelText.length,
        novelChunkCount: novelChunks.length,
        characters, relationships, events, agentGraphNodes, agentGraphEdges,
        continuationEvents, agentThoughts, agentGeneration, log,
        timestamp: Date.now(),
        name: `${novelTitle || '未命名'} - ${new Date().toLocaleString()}`,
      };
      const existing = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '[]');
      existing.push(saveData);
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(existing));
      setLog(prev => [`[系统] 存档成功: ${saveData.name}`, ...prev].slice(0, 50));
    } catch (e) {
      console.warn('Save failed:', e);
      setLog(prev => ['[错误] 存档失败（可能超出存储限制）', ...prev].slice(0, 50));
    }
  }, [novelTitle, novelText, novelChunks, novelSummaries, characters, relationships, events, agentGraphNodes, agentGraphEdges, continuationEvents, agentThoughts, agentGeneration, log]);

  const loadAnalysis = useCallback((index) => {
    try {
      const saves = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '[]');
      const save = saves[index];
      if (!save) return;
      if (abortRef.current) abortRef.current.abort();
      setNovelTitle(save.novelTitle || '');
      /* Novel text/chunks are not stored in saves to conserve space.
         User must re-upload the file to re-analyze. */
      setNovelText('');
      setNovelChunks([]);
      setNovelSummaries(save.novelSummaries || []);
      setCharacters(save.characters || []);
      setRelationships(save.relationships || []);
      setEvents(save.events || []);
      setAgentGraphNodes(save.agentGraphNodes || []);
      setAgentGraphEdges(save.agentGraphEdges || []);
      setContinuationEvents(save.continuationEvents || []);
      setAgentThoughts(save.agentThoughts || {});
      setAgentGeneration(save.agentGeneration || 0);
      setLog(save.log || []);
      setIsRunning(false);
      setIsAnalyzing(false);
      setSelectedAgentNode(null);
      setSelectedAgentEdge(null);
      setChatTarget(null);
      setChatMessages([]);
    } catch (e) {
      console.warn('Load failed:', e);
      setLog(prev => ['[错误] 加载存档失败', ...prev].slice(0, 50));
    }
  }, []);

  const getSavedList = useCallback(() => {
    try { return JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '[]'); }
    catch (e) { console.warn('Failed to load saves:', e); return []; }
  }, []);

  const deleteSave = useCallback((index) => {
    try {
      const saves = JSON.parse(localStorage.getItem(LOCALSTORAGE_KEY) || '[]');
      saves.splice(index, 1);
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(saves));
      setLog(prev => ['[系统] 存档已删除', ...prev].slice(0, 50));
    } catch (e) {
      console.warn('Delete save failed:', e);
      setLog(prev => ['[错误] 删除存档失败', ...prev].slice(0, 50));
    }
  }, []);

  /* =====================================================
     Context Value
     ===================================================== */
  const value = useMemo(() => ({
    novelTitle, novelText, novelChunks, novelSummaries,
    isAnalyzing, analysisProgress,
    characters, relationships, events,
    agentGraphNodes, agentGraphEdges,
    selectedAgentNode, setSelectedAgentNode,
    selectedAgentEdge, setSelectedAgentEdge,
    isRunning, agentGeneration, continuationEvents, agentThoughts,
    chatTarget, setChatTarget, chatMessages, setChatMessages,
    isChatting, chatWithCharacter, chatBufferTip,
    log,
    uploadNovel, analyzeNovel, stopAnalysis,
    runContinuationStep, reset,
    saveAnalysis, loadAnalysis, getSavedList, deleteSave,
    chunkSize, setChunkSize, chunkOverlap, setChunkOverlap, rechunkNovel,
    settings,
  }), [
    novelTitle, novelText, novelChunks, novelSummaries,
    isAnalyzing, analysisProgress,
    characters, relationships, events,
    agentGraphNodes, agentGraphEdges,
    selectedAgentNode, selectedAgentEdge,
    isRunning, agentGeneration, continuationEvents, agentThoughts,
    chatTarget, chatMessages, isChatting, chatWithCharacter, chatBufferTip,
    log,
    uploadNovel, analyzeNovel, stopAnalysis,
    runContinuationStep, reset,
    saveAnalysis, loadAnalysis, getSavedList, deleteSave,
    chunkSize, chunkOverlap, rechunkNovel,
    settings,
  ]);

  return (
    <MultiAgentSimulatorContext.Provider value={value}>
      {children}
    </MultiAgentSimulatorContext.Provider>
  );
}

/* ================================================================
   Canvas Component: Knowledge Graph Visualization
   ================================================================ */

const MultiAgentSimulatorCanvas = memo(function MultiAgentSimulatorCanvas() {
  const ctx = useContext(MultiAgentSimulatorContext);
  const {
    agentGraphNodes, agentGraphEdges, agentGeneration, characters,
    continuationEvents,
    selectedAgentNode, setSelectedAgentNode,
    selectedAgentEdge, setSelectedAgentEdge,
  } = ctx;

  const graphCanvasRef = useRef(null);
  const agentPosRef = useRef({});
  const graphTransformRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });
  const dragStateRef = useRef({ type: null, nodeId: null, lastX: 0, lastY: 0 });
  const animRef = useRef(null);
  const prevNodeCountRef = useRef(0);

  /* ---- Auto-fit: adjust scale+offset so all nodes are visible ---- */
  const autoFitGraph = useCallback(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const pos = agentPosRef.current;
    const ids = Object.keys(pos);
    if (ids.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ids.forEach(id => {
      const p = pos[id];
      if (!p) return;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });

    const W = canvas.width, H = canvas.height;
    const padding = 60;
    const bboxW = (maxX - minX) || 1;
    const bboxH = (maxY - minY) || 1;
    const scaleX = (W - padding * 2) / bboxW;
    const scaleY = (H - padding * 2) / bboxH;
    const scale = Math.min(scaleX, scaleY, 2.0);
    const centerWX = (minX + maxX) / 2;
    const centerWY = (minY + maxY) / 2;
    const t = graphTransformRef.current;
    t.scale = Math.max(0.2, scale);
    t.offsetX = W / 2 - centerWX * t.scale;
    t.offsetY = H / 2 - centerWY * t.scale;
  }, []);

  /* ---- Graph Rendering ---- */
  const drawGraph = useCallback(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const c = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    c.clearRect(0, 0, W, H);

    const t = graphTransformRef.current;

    // Background
    c.fillStyle = '#0d0a17';
    c.fillRect(0, 0, W, H);

    // Grid
    c.save();
    c.strokeStyle = 'rgba(140,100,200,0.07)';
    c.lineWidth = 1;
    const gridSize = 30 * t.scale;
    const startX = t.offsetX % gridSize;
    const startY = t.offsetY % gridSize;
    for (let x = startX; x < W; x += gridSize) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let y = startY; y < H; y += gridSize) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.restore();

    if (agentGraphNodes.length === 0) {
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.font = '14px sans-serif';
      c.textAlign = 'center';
      c.fillText('📖 上传文档并分析以生成知识图谱', W / 2, H / 2 - 10);
      c.font = '11px sans-serif';
      c.fillText('在右侧面板上传文档文件开始', W / 2, H / 2 + 15);
      return;
    }

    const pos = agentPosRef.current;
    const centerX = W / 2, centerY = H / 2;

    // Position nodes in a circle (initial placement)
    const nodeCount = agentGraphNodes.length;
    const baseRadius = Math.min(W, H) * 0.25;
    const adaptiveRadius = nodeCount > 15 ? baseRadius * (1 + (nodeCount - 15) * 0.04) : baseRadius;
    agentGraphNodes.forEach((node, i) => {
      if (!pos[node.id]) {
        const angle = (2 * Math.PI * i) / Math.max(1, nodeCount);
        pos[node.id] = {
          x: centerX / t.scale + Math.cos(angle) * adaptiveRadius,
          y: centerY / t.scale + Math.sin(angle) * adaptiveRadius,
          vx: 0, vy: 0, fixed: false,
        };
      }
    });

    // Force layout: repulsion
    const repulsion = nodeCount > 20 ? 3000 + (nodeCount - 20) * 200 : 3000;
    const ids = agentGraphNodes.map(n => n.id);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = pos[ids[i]], b = pos[ids[j]];
        if (!a || !b) continue;
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = repulsion / (dist * dist);
        const fx = (dx / dist) * force * 0.3;
        const fy = (dy / dist) * force * 0.3;
        if (!a.fixed) { a.vx += fx; a.vy += fy; }
        if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
      }
    }

    // Edge attraction
    agentGraphEdges.forEach(edge => {
      const a = pos[edge.from], b = pos[edge.to];
      if (!a || !b) return;
      let dx = b.x - a.x, dy = b.y - a.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - 120) * 0.02;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.fixed) { a.vx += fx; a.vy += fy; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    });

    // Center gravity and damping
    ids.forEach(id => {
      const p = pos[id];
      if (!p || p.fixed) return;
      p.vx += (centerX / t.scale - p.x) * 0.002;
      p.vy += (centerY / t.scale - p.y) * 0.002;
      p.vx *= 0.85;
      p.vy *= 0.85;
      p.x += p.vx;
      p.y += p.vy;
    });

    const toScreen = (wx, wy) => ({
      x: wx * t.scale + t.offsetX,
      y: wy * t.scale + t.offsetY,
    });

    // Draw edges
    agentGraphEdges.forEach(edge => {
      const from = pos[edge.from], to = pos[edge.to];
      if (!from || !to) return;
      const sf = toScreen(from.x, from.y);
      const st = toScreen(to.x, to.y);

      const edgeStyle = AGENT_EDGE_STYLES[edge.type] || DEFAULT_EDGE_STYLE;
      c.strokeStyle = edgeStyle.color + '80';
      c.lineWidth = edgeStyle.width * t.scale;
      c.setLineDash(edgeStyle.dash);
      c.beginPath();
      c.moveTo(sf.x, sf.y);
      c.lineTo(st.x, st.y);
      c.stroke();
      c.setLineDash([]);

      // Edge label
      const midX = (sf.x + st.x) / 2;
      const midY = (sf.y + st.y) / 2;
      c.fillStyle = 'rgba(200,200,200,0.6)';
      c.font = `${Math.max(7, 9 * t.scale)}px sans-serif`;
      c.textAlign = 'center';
      c.fillText(edge.type || '', midX, midY - 4 * t.scale);
    });

    // Draw nodes
    agentGraphNodes.forEach(node => {
      const p = pos[node.id];
      if (!p) return;
      const sp = toScreen(p.x, p.y);
      const r = 22 * t.scale;
      const color = AGENT_NODE_COLORS[node.actionType] || AGENT_NODE_COLORS.idle;

      // Continuation event pulse indicator
      if (node.gen > 0 && node.gen === agentGeneration) {
        c.beginPath();
        c.arc(sp.x, sp.y, r + 8 * t.scale, 0, Math.PI * 2);
        c.strokeStyle = '#FFD700';
        c.lineWidth = 1.5 * t.scale;
        c.globalAlpha = 0.5;
        c.setLineDash([3, 3]);
        c.stroke();
        c.setLineDash([]);
        c.globalAlpha = 1.0;
      }

      // Outer glow
      c.beginPath();
      c.arc(sp.x, sp.y, r + 4 * t.scale, 0, Math.PI * 2);
      c.strokeStyle = color;
      c.lineWidth = 2 * t.scale;
      c.globalAlpha = 0.4;
      c.stroke();
      c.globalAlpha = 1.0;

      // Node circle
      c.beginPath();
      c.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      c.fillStyle = `${color}33`;
      c.fill();
      c.strokeStyle = color;
      c.lineWidth = 2 * t.scale;
      c.stroke();

      // Emoji
      c.font = `${Math.max(12, 16 * t.scale)}px sans-serif`;
      c.textAlign = 'center';
      c.fillText(node.emoji || '🧑', sp.x, sp.y + 5 * t.scale);

      // Name
      c.fillStyle = '#fff';
      c.font = `bold ${Math.max(8, 10 * t.scale)}px sans-serif`;
      c.fillText(node.id, sp.x, sp.y + r + 14 * t.scale);

      // Show last action text for nodes with recent continuation events
      if (node.lastAction && node.gen === agentGeneration && agentGeneration > 0) {
        c.fillStyle = 'rgba(255, 215, 0, 0.7)';
        c.font = `${Math.max(7, 8 * t.scale)}px sans-serif`;
        const actionText = node.lastAction.length > MAX_ACTION_TEXT_LENGTH ? node.lastAction.slice(0, MAX_ACTION_TEXT_LENGTH) + '…' : node.lastAction;
        c.fillText(actionText, sp.x, sp.y + r + 26 * t.scale);
      }
    });

    // Edge type legend
    {
      const usedTypes = new Set(agentGraphEdges.map(e => e.type));
      const legendEntries = Object.entries(AGENT_EDGE_STYLES).filter(([key]) => usedTypes.has(key));
      const legendItemH = 14;
      const legendTotalH = legendEntries.length * legendItemH;
      let ly = H - legendTotalH - 20;
      legendEntries.forEach(([, style]) => {
        c.strokeStyle = style.color;
        c.lineWidth = style.width;
        c.setLineDash(style.dash);
        c.beginPath();
        c.moveTo(12, ly);
        c.lineTo(36, ly);
        c.stroke();
        c.setLineDash([]);
        c.fillStyle = '#aaa';
        c.font = '8px sans-serif';
        c.textAlign = 'left';
        c.fillText(style.label, 42, ly + 3);
        ly += legendItemH;
      });
    }

    // Selected node highlight
    if (selectedAgentNode) {
      const p = pos[selectedAgentNode.id];
      if (p) {
        const sp = toScreen(p.x, p.y);
        const r = 22 * t.scale;
        c.beginPath();
        c.arc(sp.x, sp.y, r + 6 * t.scale, 0, Math.PI * 2);
        c.strokeStyle = '#FFD700';
        c.lineWidth = 2.5 * t.scale;
        c.stroke();
      }
    }

    // Selected edge highlight
    if (selectedAgentEdge) {
      const from = pos[selectedAgentEdge.from], to = pos[selectedAgentEdge.to];
      if (from && to) {
        const sf = toScreen(from.x, from.y);
        const st = toScreen(to.x, to.y);
        c.strokeStyle = '#FFD700';
        c.lineWidth = 3 * t.scale;
        c.setLineDash([]);
        c.beginPath();
        c.moveTo(sf.x, sf.y);
        c.lineTo(st.x, st.y);
        c.stroke();
      }
    }

    // Info overlay (top-left) — basic stats only, detail shown in HTML overlay
    c.fillStyle = 'rgba(10,14,23,0.85)';
    c.beginPath();
    c.roundRect(10, 10, 210, 60, 6);
    c.fill();
    c.strokeStyle = 'rgba(140,100,200,0.5)';
    c.lineWidth = 1;
    c.stroke();

    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = '10px sans-serif';
    c.textAlign = 'left';
    c.fillText(`📖 文档知识图谱${agentGeneration > 0 ? ` | 推演 Gen ${agentGeneration}` : ''}`, 18, 28);
    c.fillText(`👥 ${agentGraphNodes.length} 人物 | 🔗 ${agentGraphEdges.length} 关系`, 18, 44);
    c.fillText('📊 点击节点/关系查看详情', 18, 60);

    // Zoom hint (bottom-right)
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.font = '9px sans-serif';
    c.textAlign = 'right';
    c.fillText(`缩放: ${Math.round(t.scale * 100)}% | 滚轮缩放 拖拽平移`, W - 10, H - 8);
  }, [agentGraphNodes, agentGraphEdges, agentGeneration, selectedAgentNode, selectedAgentEdge]);

  /* ---- Animation Loop ---- */
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      drawGraph();
      animRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => { running = false; if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [drawGraph]);

  /* ---- Auto-fit when node count changes ---- */
  useEffect(() => {
    const currentCount = agentGraphNodes.length;
    if (currentCount > 0 && currentCount !== prevNodeCountRef.current) {
      // Delay to allow position initialization
      const timer = setTimeout(() => { autoFitGraph(); }, 300);
      prevNodeCountRef.current = currentCount;
      return () => clearTimeout(timer);
    }
    if (currentCount === 0) prevNodeCountRef.current = 0;
  }, [agentGraphNodes.length, autoFitGraph]);

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
    const parent = canvas.parentElement;
    let ro;
    if (parent && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => { resizeCanvas(); });
      ro.observe(parent);
    }
    window.addEventListener('resize', resizeCanvas);
    return () => { window.removeEventListener('resize', resizeCanvas); if (ro) ro.disconnect(); };
  }, []);

  /* ---- Mouse Handlers ---- */
  const handleMouseDown = useCallback((e) => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const t = graphTransformRef.current;
    const wx = (mx - t.offsetX) / t.scale;
    const wy = (my - t.offsetY) / t.scale;

    const aPos = agentPosRef.current;
    let clickedAgent = null;
    agentGraphNodes.forEach(node => {
      const p = aPos[node.id];
      if (!p) return;
      if (Math.sqrt((wx - p.x) ** 2 + (wy - p.y) ** 2) <= AGENT_NODE_CLICK_RADIUS) clickedAgent = node.id;
    });
    if (clickedAgent) {
      dragStateRef.current = { type: 'agent-node', nodeId: clickedAgent, lastX: mx, lastY: my };
      const p = aPos[clickedAgent];
      if (p) p.fixed = true;
    } else {
      dragStateRef.current = { type: 'pan', nodeId: null, lastX: mx, lastY: my };
    }
  }, [agentGraphNodes]);

  const handleMouseMove = useCallback((e) => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const drag = dragStateRef.current;
    const t = graphTransformRef.current;

    if (drag.type === 'agent-node' && drag.nodeId) {
      const dx = (mx - drag.lastX) / t.scale;
      const dy = (my - drag.lastY) / t.scale;
      const p = agentPosRef.current[drag.nodeId];
      if (p) { p.x += dx; p.y += dy; p.vx = 0; p.vy = 0; }
      drag.lastX = mx; drag.lastY = my;
      return;
    }
    if (drag.type === 'pan') {
      t.offsetX += mx - drag.lastX;
      t.offsetY += my - drag.lastY;
      drag.lastX = mx; drag.lastY = my;
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    const drag = dragStateRef.current;
    if (drag.type === 'agent-node' && drag.nodeId) {
      const p = agentPosRef.current[drag.nodeId];
      if (p) p.fixed = false;
    }
    dragStateRef.current = { type: null, nodeId: null, lastX: 0, lastY: 0 };
  }, []);

  const handleClick = useCallback((e) => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const t = graphTransformRef.current;
    const wx = (mx - t.offsetX) / t.scale;
    const wy = (my - t.offsetY) / t.scale;

    const aPos = agentPosRef.current;
    let clickedAgent = null;
    agentGraphNodes.forEach(node => {
      const p = aPos[node.id];
      if (!p) return;
      if (Math.sqrt((wx - p.x) ** 2 + (wy - p.y) ** 2) <= AGENT_NODE_CLICK_RADIUS) clickedAgent = node;
    });
    if (clickedAgent) {
      setSelectedAgentNode(clickedAgent);
      setSelectedAgentEdge(null);
      return;
    }

    let closestEdge = null, closestDist = AGENT_EDGE_CLICK_THRESHOLD;
    agentGraphEdges.forEach(edge => {
      const from = aPos[edge.from], to = aPos[edge.to];
      if (!from || !to) return;
      const d = pointToSegmentDist(wx, wy, from.x, from.y, to.x, to.y);
      if (d < closestDist) { closestDist = d; closestEdge = edge; }
    });
    if (closestEdge) {
      setSelectedAgentEdge(closestEdge);
      setSelectedAgentNode(null);
    } else {
      setSelectedAgentNode(null);
      setSelectedAgentEdge(null);
    }
  }, [agentGraphNodes, agentGraphEdges, setSelectedAgentNode, setSelectedAgentEdge]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const t = graphTransformRef.current;
    const oldScale = t.scale;
    const newScale = Math.max(0.1, Math.min(5.0, oldScale + -e.deltaY * 0.001));
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

  /* Build detail info for selected node or edge */
  const selectedNodeChar = selectedAgentNode ? characters.find(ch => ch.name === selectedAgentNode.id) : null;
  const nodeRelatedEvents = selectedAgentNode ? (continuationEvents || []).filter(e => e.character === selectedAgentNode.id).slice(-5) : [];

  return (
    <>
      <div className="world-sim-header">
        <span className="world-sim-title">📖 文档知识图谱</span>
      </div>

      <div className="world-sim-canvas-container" style={{ position: 'relative' }}>
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

        {/* HTML Detail Overlay — shows full info for selected node/edge */}
        {(selectedAgentNode || selectedAgentEdge) && (
          <div className="novel-detail-overlay">
            <button
              className="novel-detail-close"
              onClick={() => { setSelectedAgentNode(null); setSelectedAgentEdge(null); }}
            >✕</button>

            {selectedAgentNode && (
              <div className="novel-detail-content">
                <div className="novel-detail-title">
                  {selectedAgentNode.emoji || '🧑'} {selectedAgentNode.id}
                </div>
                <ul className="novel-detail-list">
                  {selectedAgentNode.description && (
                    <li><span className="novel-detail-label">📋 描述:</span> {selectedAgentNode.description}</li>
                  )}
                  {selectedAgentNode.motivation && (
                    <li><span className="novel-detail-label">🎯 动机:</span> {selectedAgentNode.motivation}</li>
                  )}
                  {selectedAgentNode.activity && (
                    <li><span className="novel-detail-label">🎭 行为:</span> {selectedAgentNode.activity}</li>
                  )}
                  {selectedAgentNode.mood && (
                    <li><span className="novel-detail-label">😊 情绪:</span> {selectedAgentNode.mood}</li>
                  )}
                  {selectedAgentNode.thought && (
                    <li><span className="novel-detail-label">💭 想法:</span> {selectedAgentNode.thought}</li>
                  )}
                  {selectedAgentNode.lastAction && (
                    <li><span className="novel-detail-label">⚡ 最近行动:</span> {selectedAgentNode.lastAction}</li>
                  )}
                </ul>
                {selectedNodeChar?.relationships && Object.keys(selectedNodeChar.relationships).length > 0 && (
                  <>
                    <div className="novel-detail-subtitle">🔗 关系</div>
                    <ul className="novel-detail-list">
                      {Object.entries(selectedNodeChar.relationships).map(([target, rel]) => (
                        <li key={target}><span style={{ color: '#90caf9' }}>{target}</span>: {rel}</li>
                      ))}
                    </ul>
                  </>
                )}
                {nodeRelatedEvents.length > 0 && (
                  <>
                    <div className="novel-detail-subtitle">📜 推演事件</div>
                    <ul className="novel-detail-list">
                      {nodeRelatedEvents.map(e => (
                        <li key={e.id}><span style={{ color: '#ffd54f' }}>Gen{e.gen}</span>: {e.text}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {selectedAgentEdge && (
              <div className="novel-detail-content">
                <div className="novel-detail-title">
                  🔗 {selectedAgentEdge.from} ↔ {selectedAgentEdge.to}
                </div>
                <ul className="novel-detail-list">
                  <li><span className="novel-detail-label">类型:</span> {selectedAgentEdge.type}</li>
                  {selectedAgentEdge.description && (
                    <li><span className="novel-detail-label">描述:</span> {selectedAgentEdge.description}</li>
                  )}
                  {selectedAgentEdge.label && (
                    <li><span className="novel-detail-label">标签:</span> {selectedAgentEdge.label}</li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
});

/* ================================================================
   Info Component: MultiAgentSimulatorInfo
   ================================================================ */

const MultiAgentSimulatorInfo = memo(function MultiAgentSimulatorInfo() {
  const ctx = useContext(MultiAgentSimulatorContext);
  const {
    novelTitle, novelText, novelChunks, novelSummaries,
    isAnalyzing, analysisProgress,
    characters, relationships, events, agentThoughts,
    isRunning, agentGeneration, continuationEvents,
    chatTarget, setChatTarget, chatMessages, setChatMessages,
    isChatting, chatWithCharacter, chatBufferTip,
    log,
    uploadNovel, analyzeNovel, stopAnalysis,
    runContinuationStep, reset,
    saveAnalysis, loadAnalysis, getSavedList, deleteSave,
    chunkSize, setChunkSize, chunkOverlap, setChunkOverlap, rechunkNovel,
    settings,
  } = ctx;

  const fileInputRef = useRef(null);
  const chatInputRef = useRef(null);
  const [showSaves, setShowSaves] = useState(false);
  const [saves, setSaves] = useState([]);

  const [expandedSections, setExpandedSections] = useState({ info: true, chars: true, events: false, chat: true, log: false });
  const [expandedChars, setExpandedChars] = useState({});

  const chunkSizeMax = Math.max(500, Math.floor((settings?.maxTokens || 1024) * 2 / 3));

  // Access WorldSimulator context for knowledge graph export
  const worldSimCtx = useContext(WorldSimulatorContext);

  const exportToWorldSim = useCallback(() => {
    if (!worldSimCtx || !worldSimCtx.importFromKnowledgeGraph) return;
    worldSimCtx.importFromKnowledgeGraph({
      characters,
      relationships,
      events,
      title: novelTitle,
    });
  }, [worldSimCtx, characters, relationships, events, novelTitle]);

  const refreshSaves = useCallback(() => { setSaves(getSavedList()); }, [getSavedList]);

  const toggleSection = useCallback((key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleChar = useCallback((name) => {
    setExpandedChars(prev => ({ ...prev, [name]: !prev[name] }));
  }, []);

  const handleFileUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) uploadNovel(file);
    if (e.target) e.target.value = '';
  }, [uploadNovel]);

  const parseRelType = (rel) => {
    if (!rel) return { type: '中立', desc: '' };
    const colonIdx = rel.indexOf(':');
    if (colonIdx !== -1) {
      const parsedType = rel.slice(0, colonIdx);
      if (RELATIONSHIP_TYPES[parsedType]) return { type: parsedType, desc: rel.slice(colonIdx + 1) };
    }
    if (RELATIONSHIP_TYPES[rel]) return { type: rel, desc: '' };
    return { type: '中立', desc: rel };
  };

  return (
    <>
      {/* Top toolbar: all action buttons in a single row */}
      <div className="novel-toolbar">
        <button className="world-sim-btn" onClick={reset}>🆕 新建</button>
        <button className="world-sim-btn" onClick={saveAnalysis} disabled={characters.length === 0}>💾 存档</button>
        <button className="world-sim-btn" onClick={() => { refreshSaves(); setShowSaves(s => !s); }}>📂 读档</button>
        {characters.length > 0 && worldSimCtx?.importFromKnowledgeGraph && (
          <button
            className="world-sim-btn"
            onClick={exportToWorldSim}
            title="将知识图谱导入到虚拟世界推演作为初始种子"
          >🔮 导入到虚拟世界</button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.text,.md,.markdown,.csv,.log,.json,.xml,.html,.htm"
          onChange={handleFileUpload}
          style={{ display: 'none' }}
        />
        <button
          className="world-sim-btn primary"
          onClick={() => fileInputRef.current?.click()}
        >📁 上传文档</button>
        {novelChunks.length > 0 && !isAnalyzing && characters.length === 0 && (
          <button className="world-sim-btn primary" onClick={analyzeNovel}>🔍 开始分析</button>
        )}
        {isAnalyzing && (
          <button className="world-sim-btn" onClick={stopAnalysis} style={{ color: '#f44336' }}>⏹ 停止</button>
        )}
        {characters.length > 0 && (
          <button
            className="world-sim-btn primary"
            onClick={runContinuationStep}
            disabled={isRunning || isAnalyzing}
          >{isRunning ? '⏳...' : '🔮 故事推演'}</button>
        )}
        {agentGeneration > 0 && (
          <span className="world-sim-gen">Gen:{agentGeneration}</span>
        )}
      </div>

      {/* Analysis Progress */}
      {isAnalyzing && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #333', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: '#FFD700', marginBottom: 4 }}>
            ⏳ {analysisProgress.phase} ({analysisProgress.current}/{analysisProgress.total})
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${analysisProgress.total > 0 ? (analysisProgress.current / analysisProgress.total * 100) : 0}%`,
              background: 'linear-gradient(90deg, #FFD700, #FF9800)',
              borderRadius: 2,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {/* Save list dropdown */}
      {showSaves && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #333', maxHeight: 200, overflowY: 'auto', flexShrink: 0 }}>
          <h4 style={{ fontSize: 10, fontWeight: 600, color: '#888', margin: '0 0 4px 0' }}>📂 存档列表</h4>
          {saves.length === 0 ? (
            <div style={{ color: '#888', fontSize: 12 }}>暂无存档</div>
          ) : (
            saves.map((s, i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                  <span style={{ flex: 1, color: '#ccc' }}>• {s.name}</span>
                  <button className="world-sim-btn" style={{ padding: '2px 6px', fontSize: 10 }}
                    onClick={() => { loadAnalysis(i); setShowSaves(false); }}>加载</button>
                  <button className="world-sim-btn" style={{ padding: '2px 6px', fontSize: 10 }}
                    onClick={() => { deleteSave(i); refreshSaves(); }}>删除</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Single scrollable container with collapsible sections */}
      <div className="novel-scrollable-area">
        {/* 📖 文档信息 section */}
        <div className="novel-section-header" onClick={() => toggleSection('info')}>
          <span className="novel-section-arrow">{expandedSections.info ? '▾' : '▸'}</span>
          <h4>📖 文档信息</h4>
          {novelTitle && <span className="novel-section-badge">{characters.length}人 {relationships.length}关系 {events.length}事件</span>}
        </div>
        {expandedSections.info && (
          <div className="novel-section-body">
            {novelTitle ? (
              <>
                <div className="world-sim-world-state">
                  <span>📄 {novelTitle}</span>
                  <span>📝 {novelText.length}字</span>
                  <span>📑 {novelChunks.length}段</span>
                  <span>👥 {characters.length}人</span>
                  <span>🔗 {relationships.length}关系</span>
                  <span>📋 {events.length}事件</span>
                </div>
                {novelSummaries.length > 0 && (
                  <p className="world-sim-summary-text" style={{ maxHeight: 80, overflowY: 'auto' }}>
                    {novelSummaries.join(' ')}
                  </p>
                )}
              </>
            ) : (
              <div style={{ color: '#888', fontSize: 12, padding: '4px 0' }}>
                请上传文档文件开始分析（支持 .txt .md .csv .json .xml 等格式）
              </div>
            )}
          </div>
        )}

        {/* ✂️ 分段设置 section */}
        <div className="novel-section-header" onClick={() => toggleSection('chunkSettings')}>
          <span className="novel-section-arrow">{expandedSections.chunkSettings ? '▾' : '▸'}</span>
          <h4>✂️ 分段设置</h4>
          <span className="novel-section-badge">片段{chunkSize} 重叠{chunkOverlap}</span>
        </div>
        {expandedSections.chunkSettings && (
          <div className="novel-section-body" style={{ padding: '6px 10px' }}>
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 2 }}>
                片段大小: {chunkSize} 字 (上限: {chunkSizeMax})
              </label>
              <input
                type="range"
                min={500}
                max={chunkSizeMax}
                step={100}
                value={Math.min(chunkSize, chunkSizeMax)}
                onChange={e => setChunkSize(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#9c27b0' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#666' }}>
                <span>500</span><span>{chunkSizeMax}</span>
              </div>
            </div>
            <div style={{ marginBottom: 6 }}>
              <label style={{ fontSize: 11, color: '#aaa', display: 'block', marginBottom: 2 }}>
                重叠大小: {chunkOverlap} 字
              </label>
              <input
                type="range"
                min={0}
                max={Math.min(2000, Math.floor(chunkSize * 0.5))}
                step={50}
                value={chunkOverlap}
                onChange={e => setChunkOverlap(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#9c27b0' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#666' }}>
                <span>0</span><span>{Math.min(2000, Math.floor(chunkSize * 0.5))}</span>
              </div>
            </div>
            <div style={{ fontSize: 9, color: '#888', marginBottom: 4 }}>
              💡 片段在段落/句子边界处切分，不会裁剪连续语句
            </div>
            {novelText && (
              <button
                className="world-sim-btn"
                style={{ fontSize: 11, padding: '3px 8px', width: '100%' }}
                onClick={rechunkNovel}
                disabled={isAnalyzing}
              >🔄 重新分段 ({novelChunks.length}段)</button>
            )}
          </div>
        )}

        {/* 👥 人物列表 section */}
        <div className="novel-section-header" onClick={() => toggleSection('chars')}>
          <span className="novel-section-arrow">{expandedSections.chars ? '▾' : '▸'}</span>
          <h4>👥 人物列表</h4>
          {characters.length > 0 && <span className="novel-section-badge">{characters.length}</span>}
        </div>
        {expandedSections.chars && (
          <div className="novel-section-body" style={{ padding: '4px 8px' }}>
            {characters.length === 0 ? (
              <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>
                {novelTitle ? '点击"🔍 开始分析"提取文档人物' : '上传文档后将自动分析人物'}
              </div>
            ) : (
              characters.map(ch => (
                <div key={ch.name} style={{ marginBottom: 2 }}>
                  {/* Character collapsed header: emoji + name + brief tag */}
                  <div className="novel-char-header" onClick={() => toggleChar(ch.name)}>
                    <span className="novel-char-arrow">{expandedChars[ch.name] ? '▾' : '▸'}</span>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{ch.emoji}</span>
                    <span style={{ color: '#ddd', fontWeight: 600, fontSize: 11 }}>{ch.name}</span>
                    {ch.mood && <span style={{ fontSize: 9, color: '#ffd54f', marginLeft: 'auto' }}>{ch.mood}</span>}
                  </div>
                  {/* Character expanded details */}
                  {expandedChars[ch.name] && (
                    <div className="novel-char-detail">
                      {ch.description && (
                        <div style={{ color: '#9cdcfe', marginBottom: 2 }}>{ch.description}</div>
                      )}
                      <div style={{ color: '#ffd54f', marginBottom: 2 }}>
                        {ch.mood && `情绪: ${ch.mood}`}
                        {ch.activity && ` | 行为: ${ch.activity}`}
                      </div>
                      {ch.motivation && (
                        <div style={{ color: '#c3e88d', marginBottom: 2 }}>
                          🎯 动机: {ch.motivation}
                        </div>
                      )}
                      {agentThoughts[ch.name] && (
                        <div style={{ color: '#ce93d8', marginBottom: 2 }}>
                          💭 {agentThoughts[ch.name]}
                        </div>
                      )}
                      {ch.relationships && Object.keys(ch.relationships).length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 2 }}>
                          {Object.entries(ch.relationships).map(([target, rel]) => {
                            const { type, desc } = parseRelType(rel);
                            const relStyle = RELATIONSHIP_TYPES[type] || RELATIONSHIP_TYPES['中立'];
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
                      <button
                        className="world-sim-btn"
                        style={{ fontSize: 9, padding: '1px 6px', lineHeight: 1.2 }}
                        onClick={(e) => { e.stopPropagation(); setChatTarget(ch.name); setChatMessages([]); }}
                      >💬 对话</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* 📋 事件列表 section */}
        <div className="novel-section-header" onClick={() => toggleSection('events')}>
          <span className="novel-section-arrow">{expandedSections.events ? '▾' : '▸'}</span>
          <h4>📋 事件列表</h4>
          {(events.length > 0 || continuationEvents.length > 0) && (
            <span className="novel-section-badge">{events.length + continuationEvents.length}</span>
          )}
        </div>
        {expandedSections.events && (
          <div className="novel-section-body" style={{ padding: '4px 8px' }}>
            {events.length === 0 && continuationEvents.length === 0 ? (
              <div style={{ color: '#888', fontSize: 11, padding: '4px 0' }}>
                分析文档后将自动提取事件
              </div>
            ) : (
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {events.map((evt, i) => (
                  <div key={`evt-${i}`} style={{ marginBottom: 4, padding: '3px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', fontSize: 10 }}>
                    <div style={{ color: '#9cdcfe' }}>{evt.description}</div>
                    {evt.participants && evt.participants.length > 0 && (
                      <div style={{ color: '#888', fontSize: 9 }}>👥 {evt.participants.join(', ')}</div>
                    )}
                    {evt.impact && (
                      <div style={{ color: '#ffd54f', fontSize: 9 }}>💥 {evt.impact}</div>
                    )}
                  </div>
                ))}
                {continuationEvents.length > 0 && (
                  <>
                    <div style={{ fontSize: 9, color: '#FFD700', padding: '4px 0 2px', borderTop: '1px solid #333', marginTop: 4 }}>
                      🔮 推演事件
                    </div>
                    {continuationEvents.slice(-MAX_DISPLAYED_CONTINUATION_EVENTS).map((evt) => (
                      <div key={evt.id} style={{ marginBottom: 3, padding: '2px 6px', borderRadius: 4, background: 'rgba(255,215,0,0.05)', fontSize: 10 }}>
                        <span style={{ color: '#FFD700', fontSize: 9 }}>Gen{evt.gen}</span>{' '}
                        <span style={{ color: '#a5d6a7' }}>{evt.character}</span>: {evt.text}
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
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
                展开人物详情，点击 💬 对话 按钮与角色对话
              </div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: '#9cdcfe', marginBottom: 4 }}>
                  正在与 {characters.find(c => c.name === chatTarget)?.emoji || '🧑'} {chatTarget} 对话
                </div>
                <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 6 }}>
                  {chatMessages.map((msg, i) => (
                    <div key={i} style={{
                      fontSize: 11, padding: '3px 6px', marginBottom: 2,
                      borderRadius: 4,
                      background: msg.role === 'user' ? 'rgba(33,150,243,0.15)' : 'rgba(76,175,80,0.15)',
                      color: msg.role === 'user' ? '#90caf9' : '#a5d6a7',
                      textAlign: msg.role === 'user' ? 'right' : 'left',
                    }}>
                      {msg.role === 'user' ? '你' : chatTarget}: {msg.content}
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

        {/* 📜 日志 section */}
        <div className="novel-section-header" onClick={() => toggleSection('log')}>
          <span className="novel-section-arrow">{expandedSections.log ? '▾' : '▸'}</span>
          <h4>📜 日志</h4>
          {log.length > 0 && <span className="novel-section-badge">{log.length}</span>}
        </div>
        {expandedSections.log && (
          <div className="novel-section-body">
            <div className="world-sim-log-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {log.length === 0 ? (
                <div className="world-sim-log-empty">上传文档文件开始分析...</div>
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
   Default Export: MultiAgentSimulator
   ================================================================ */

export default function MultiAgentSimulator({ settings }) {
  return (
    <MultiAgentSimulatorProvider settings={settings}>
      <div className="world-simulator">
        <MultiAgentSimulatorCanvas />
        <MultiAgentSimulatorInfo />
      </div>
    </MultiAgentSimulatorProvider>
  );
}

export { MultiAgentSimulatorProvider, MultiAgentSimulatorCanvas, MultiAgentSimulatorInfo };
