import { useState, useRef, useCallback, useEffect, useMemo, useContext, createContext, memo } from 'react';
import { sendChatRequest } from '../services/openai';

/* ================================================================
   News Fetching - Get real-time news from public RSS feeds
   ================================================================ */

const ADB_URL_STORAGE_KEY = 'agent-chat-adb-url';
const DEFAULT_ADB_URL = 'http://localhost:8080';

function getServerUrl() {
  try {
    return localStorage.getItem(ADB_URL_STORAGE_KEY) || DEFAULT_ADB_URL;
  } catch {
    return DEFAULT_ADB_URL;
  }
}

async function fetchNewsFromRSS(abortSignal, { count, sources } = {}) {
  // Fetch news exclusively through the backend proxy to avoid CORS issues.
  // Direct RSS fetching from the browser to sources like Bing is blocked by CORS policy.
  try {
    const serverUrl = getServerUrl();
    const params = new URLSearchParams();
    if (count != null) params.set('count', String(count));
    if (sources && sources.length > 0) params.set('sources', sources.join(','));
    const qs = params.toString();
    const url = `${serverUrl}/api/news/fetch${qs ? `?${qs}` : ''}`;
    const resp = await fetch(url, { signal: abortSignal });
    if (resp.ok) {
      const data = await resp.json();
      if (data.headlines && data.headlines.length > 0) {
        return data.headlines;
      }
    }
  } catch {
    // Backend proxy not available
  }

  return [];
}

/* ================================================================
   Constants & Configuration
   ================================================================ */

const ARCHIVES_STORAGE_KEY = 'realWorldPredictorArchives';
const MAX_EVENTS = 30;
const CONTEXT_BATCH_SIZE = 10;
const AUTO_INTERVAL = 30000;
const TILE_SIZE = 256;
const MIN_ZOOM = 2;
const MAX_ZOOM = 20;

// Available news sources (must match server-side NEWS_RSS_SOURCES keys)
const NEWS_SOURCES = [
  { key: '新华网', label: '新华网' },
  { key: '人民网国际', label: '人民网国际' },
  { key: '央视新闻国际', label: '央视新闻国际' },
  { key: '中国日报国际', label: '中国日报国际' },
  { key: '中新网国际', label: '中新网国际' },
  { key: '观察者网国际', label: '观察者网国际' },
  { key: 'NPR News', label: 'NPR News' },
  { key: 'CNBC World', label: 'CNBC World' },
];

const CATEGORY_COLORS = {
  conflict: '#f44336',
  economy: '#ff9800',
  politics: '#9c27b0',
  environment: '#4caf50',
  technology: '#2196f3',
  society: '#00bcd4',
  disaster: '#ff5722',
};

const CATEGORY_ICONS = {
  conflict: '⚔️',
  economy: '💰',
  politics: '🏛️',
  environment: '🌿',
  technology: '💻',
  society: '👥',
  disaster: '🌋',
};

const IMPACT_COLORS = {
  low: '#4caf50',
  medium: '#ff9800',
  high: '#f44336',
};

const TENSION_COLORS = {
  '低': '#4caf50',
  '中': '#ff9800',
  '高': '#f44336',
  '极高': '#d32f2f',
};

const ECON_COLORS = {
  '衰退': '#f44336',
  '低迷': '#ff9800',
  '稳定': '#ffc107',
  '增长': '#8bc34a',
  '繁荣': '#4caf50',
};

const CITY_DOT_COLORS = {
  mega: '#ff6b6b',
  large: '#ffa94d',
  medium: '#74c0fc',
};

const WORLD_CITIES = [
  // East Asia
  { name: '北京', nameEn: 'Beijing', lat: 39.9, lng: 116.4, pop: 'mega' },
  { name: '上海', nameEn: 'Shanghai', lat: 31.2, lng: 121.5, pop: 'mega' },
  { name: '东京', nameEn: 'Tokyo', lat: 35.7, lng: 139.7, pop: 'mega' },
  { name: '首尔', nameEn: 'Seoul', lat: 37.6, lng: 127.0, pop: 'mega' },
  { name: '香港', nameEn: 'Hong Kong', lat: 22.3, lng: 114.2, pop: 'large' },
  { name: '台北', nameEn: 'Taipei', lat: 25.0, lng: 121.5, pop: 'large' },
  // South/Southeast Asia
  { name: '孟买', nameEn: 'Mumbai', lat: 19.1, lng: 72.9, pop: 'mega' },
  { name: '新德里', nameEn: 'New Delhi', lat: 28.6, lng: 77.2, pop: 'mega' },
  { name: '曼谷', nameEn: 'Bangkok', lat: 13.8, lng: 100.5, pop: 'large' },
  { name: '新加坡', nameEn: 'Singapore', lat: 1.3, lng: 103.8, pop: 'large' },
  { name: '雅加达', nameEn: 'Jakarta', lat: -6.2, lng: 106.8, pop: 'mega' },
  { name: '马尼拉', nameEn: 'Manila', lat: 14.6, lng: 121.0, pop: 'large' },
  // Middle East
  { name: '迪拜', nameEn: 'Dubai', lat: 25.2, lng: 55.3, pop: 'large' },
  { name: '伊斯坦布尔', nameEn: 'Istanbul', lat: 41.0, lng: 29.0, pop: 'mega' },
  { name: '利雅得', nameEn: 'Riyadh', lat: 24.7, lng: 46.7, pop: 'large' },
  { name: '德黑兰', nameEn: 'Tehran', lat: 35.7, lng: 51.4, pop: 'large' },
  // Europe
  { name: '莫斯科', nameEn: 'Moscow', lat: 55.8, lng: 37.6, pop: 'mega' },
  { name: '伦敦', nameEn: 'London', lat: 51.5, lng: -0.1, pop: 'mega' },
  { name: '巴黎', nameEn: 'Paris', lat: 48.9, lng: 2.3, pop: 'mega' },
  { name: '柏林', nameEn: 'Berlin', lat: 52.5, lng: 13.4, pop: 'large' },
  { name: '罗马', nameEn: 'Rome', lat: 41.9, lng: 12.5, pop: 'large' },
  { name: '马德里', nameEn: 'Madrid', lat: 40.4, lng: -3.7, pop: 'large' },
  { name: '阿姆斯特丹', nameEn: 'Amsterdam', lat: 52.4, lng: 4.9, pop: 'medium' },
  { name: '维也纳', nameEn: 'Vienna', lat: 48.2, lng: 16.4, pop: 'medium' },
  { name: '华沙', nameEn: 'Warsaw', lat: 52.2, lng: 21.0, pop: 'medium' },
  // Africa
  { name: '拉各斯', nameEn: 'Lagos', lat: 6.5, lng: 3.4, pop: 'mega' },
  { name: '开罗', nameEn: 'Cairo', lat: 30.0, lng: 31.2, pop: 'mega' },
  { name: '内罗毕', nameEn: 'Nairobi', lat: -1.3, lng: 36.8, pop: 'large' },
  { name: '约翰内斯堡', nameEn: 'Johannesburg', lat: -26.2, lng: 28.0, pop: 'large' },
  { name: '金沙萨', nameEn: 'Kinshasa', lat: -4.3, lng: 15.3, pop: 'large' },
  { name: '卡萨布兰卡', nameEn: 'Casablanca', lat: 33.6, lng: -7.6, pop: 'medium' },
  // North America
  { name: '纽约', nameEn: 'New York', lat: 40.7, lng: -74.0, pop: 'mega' },
  { name: '洛杉矶', nameEn: 'Los Angeles', lat: 34.1, lng: -118.2, pop: 'mega' },
  { name: '芝加哥', nameEn: 'Chicago', lat: 41.9, lng: -87.6, pop: 'large' },
  { name: '多伦多', nameEn: 'Toronto', lat: 43.7, lng: -79.4, pop: 'large' },
  { name: '墨西哥城', nameEn: 'Mexico City', lat: 19.4, lng: -99.1, pop: 'mega' },
  { name: '华盛顿', nameEn: 'Washington DC', lat: 38.9, lng: -77.0, pop: 'large' },
  { name: '旧金山', nameEn: 'San Francisco', lat: 37.8, lng: -122.4, pop: 'medium' },
  // South America
  { name: '圣保罗', nameEn: 'São Paulo', lat: -23.6, lng: -46.6, pop: 'mega' },
  { name: '布宜诺斯艾利斯', nameEn: 'Buenos Aires', lat: -34.6, lng: -58.4, pop: 'mega' },
  { name: '利马', nameEn: 'Lima', lat: -12.0, lng: -77.0, pop: 'large' },
  { name: '波哥大', nameEn: 'Bogotá', lat: 4.7, lng: -74.1, pop: 'large' },
  { name: '里约热内卢', nameEn: 'Rio de Janeiro', lat: -22.9, lng: -43.2, pop: 'large' },
  // Oceania
  { name: '悉尼', nameEn: 'Sydney', lat: -33.9, lng: 151.2, pop: 'large' },
  { name: '墨尔本', nameEn: 'Melbourne', lat: -37.8, lng: 145.0, pop: 'large' },
  { name: '奥克兰', nameEn: 'Auckland', lat: -36.8, lng: 174.8, pop: 'medium' },
  // Additional East Asia
  { name: '深圳', nameEn: 'Shenzhen', lat: 22.5, lng: 114.1, pop: 'mega' },
  { name: '广州', nameEn: 'Guangzhou', lat: 23.1, lng: 113.3, pop: 'mega' },
  { name: '大阪', nameEn: 'Osaka', lat: 34.7, lng: 135.5, pop: 'large' },
  { name: '成都', nameEn: 'Chengdu', lat: 30.6, lng: 104.1, pop: 'large' },
  { name: '武汉', nameEn: 'Wuhan', lat: 30.6, lng: 114.3, pop: 'large' },
  { name: '重庆', nameEn: 'Chongqing', lat: 29.6, lng: 106.5, pop: 'mega' },
  { name: '平壤', nameEn: 'Pyongyang', lat: 39.0, lng: 125.8, pop: 'large' },
  // Additional South/Southeast Asia
  { name: '胡志明市', nameEn: 'Ho Chi Minh City', lat: 10.8, lng: 106.6, pop: 'large' },
  { name: '河内', nameEn: 'Hanoi', lat: 21.0, lng: 105.9, pop: 'large' },
  { name: '达卡', nameEn: 'Dhaka', lat: 23.8, lng: 90.4, pop: 'mega' },
  { name: '卡拉奇', nameEn: 'Karachi', lat: 24.9, lng: 67.0, pop: 'mega' },
  { name: '仰光', nameEn: 'Yangon', lat: 16.9, lng: 96.2, pop: 'large' },
  // Additional Middle East
  { name: '巴格达', nameEn: 'Baghdad', lat: 33.3, lng: 44.4, pop: 'large' },
  { name: '耶路撒冷', nameEn: 'Jerusalem', lat: 31.8, lng: 35.2, pop: 'medium' },
  { name: '安卡拉', nameEn: 'Ankara', lat: 39.9, lng: 32.9, pop: 'large' },
  { name: '多哈', nameEn: 'Doha', lat: 25.3, lng: 51.5, pop: 'medium' },
  { name: '阿布扎比', nameEn: 'Abu Dhabi', lat: 24.5, lng: 54.7, pop: 'medium' },
  // Additional Europe
  { name: '基辅', nameEn: 'Kyiv', lat: 50.4, lng: 30.5, pop: 'large' },
  { name: '斯德哥尔摩', nameEn: 'Stockholm', lat: 59.3, lng: 18.1, pop: 'medium' },
  { name: '布鲁塞尔', nameEn: 'Brussels', lat: 50.8, lng: 4.4, pop: 'medium' },
  { name: '苏黎世', nameEn: 'Zurich', lat: 47.4, lng: 8.5, pop: 'medium' },
  { name: '里斯本', nameEn: 'Lisbon', lat: 38.7, lng: -9.1, pop: 'medium' },
  { name: '布拉格', nameEn: 'Prague', lat: 50.1, lng: 14.4, pop: 'medium' },
  { name: '雅典', nameEn: 'Athens', lat: 37.9, lng: 23.7, pop: 'medium' },
  { name: '赫尔辛基', nameEn: 'Helsinki', lat: 60.2, lng: 24.9, pop: 'medium' },
  // Additional Africa
  { name: '亚的斯亚贝巴', nameEn: 'Addis Ababa', lat: 9.0, lng: 38.7, pop: 'large' },
  { name: '达累斯萨拉姆', nameEn: 'Dar es Salaam', lat: -6.8, lng: 39.3, pop: 'large' },
  { name: '阿尔及尔', nameEn: 'Algiers', lat: 36.8, lng: 3.1, pop: 'large' },
  { name: '阿克拉', nameEn: 'Accra', lat: 5.6, lng: -0.2, pop: 'medium' },
  // Additional Americas
  { name: '休斯顿', nameEn: 'Houston', lat: 29.8, lng: -95.4, pop: 'large' },
  { name: '迈阿密', nameEn: 'Miami', lat: 25.8, lng: -80.2, pop: 'large' },
  { name: '温哥华', nameEn: 'Vancouver', lat: 49.3, lng: -123.1, pop: 'medium' },
  { name: '圣地亚哥', nameEn: 'Santiago', lat: -33.4, lng: -70.6, pop: 'large' },
  { name: '哈瓦那', nameEn: 'Havana', lat: 23.1, lng: -82.4, pop: 'medium' },
  { name: '巴拿马城', nameEn: 'Panama City', lat: 9.0, lng: -79.5, pop: 'medium' },
];

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

const SYSTEM_PROMPT = `你是一个全球时事推演分析师。请基于当前世界状态和提供的信息，推演接下来可能发生的全球重大事件。

你的任务是推演未来事件的发展，而不仅仅是描述当前状态。每次推演都应基于上一轮的世界状态进行推进。

**重要：事件之间必须有明确的因果关系**
- 每个新事件应当是由之前的事件或当前世界局势直接导致的结果
- related_events 必须指向有直接因果关系的事件索引（不是简单的地理相关或主题相似）
- cause_label 必须说明具体的因果逻辑（如"A国制裁→B国反制"而非泛泛的"局势升级"）
- 事件之间应形成清晰的因果链条，而不是孤立的事件列表
- 至少一半的事件应当有 related_events 关联

注意：你只需要预测事件内容和关联的城市名称，坐标信息将由系统根据城市名自动匹配。
城市名请使用以下列表中的中文名称（如果事件不在列表中的城市，请选择最近的城市）。

请生成5-8个不同地区的事件，涵盖政治、经济、冲突、环境、科技等领域。

请严格用以下JSON格式回复：
{
  "events": [{
    "text": "事件描述（必须包含该事件由什么原因导致的推演逻辑）",
    "region": "地区名称",
    "country": "国家",
    "city": "城市中文名（从城市列表中选择）",
    "category": "conflict|economy|politics|environment|technology|society|disaster",
    "impact": "low|medium|high",
    "related_events": [关联事件在本次列表中的索引（0=第一个事件），必须有直接因果关系],
    "cause_label": "具体因果说明（必须指出因→果，如：美联储加息→资金外流，10-20字）",
    "trend": "升级|缓和|持续|新兴",
    "source": "基于实时新闻|基于知识推断"
  }],
  "world_state_updates": {
    "tension_level": "低|中|高|极高",
    "economic_outlook": "衰退|低迷|稳定|增长|繁荣",
    "hot_regions": ["热点地区1", "热点地区2"],
    "summary": "当前世界状态一句话总结"
  },
  "analysis": "全球形势总体分析与推演逻辑（必须说明事件之间的因果关联）",
  "predictions": ["下一步推演预测1", "下一步推演预测2", "下一步推演预测3"],
  "key_trends": ["趋势1", "趋势2"]
}`;

/* ================================================================
   City name to coordinate lookup
   ================================================================ */

// Build a lookup map from city name (Chinese or English) to city data
const CITY_LOOKUP = (() => {
  const map = new Map();
  WORLD_CITIES.forEach((city) => {
    map.set(city.name, city);
    map.set(city.nameEn.toLowerCase(), city);
  });
  return map;
})();

// Country name → city name mapping for fallback coordinate resolution.
// Maps to the most prominent city available in WORLD_CITIES (not necessarily the political capital).
const COUNTRY_CAPITAL_MAP = {
  '中国': '北京', 'China': '北京',
  '日本': '东京', 'Japan': '东京',
  '韩国': '首尔', 'South Korea': '首尔', 'Korea': '首尔',
  '朝鲜': '平壤', 'North Korea': '平壤',
  '印度': '新德里', 'India': '新德里',
  '泰国': '曼谷', 'Thailand': '曼谷',
  '新加坡': '新加坡', 'Singapore': '新加坡',
  '印度尼西亚': '雅加达', 'Indonesia': '雅加达',
  '菲律宾': '马尼拉', 'Philippines': '马尼拉',
  '越南': '河内', 'Vietnam': '河内',
  '缅甸': '仰光', 'Myanmar': '仰光',
  '孟加拉国': '达卡', 'Bangladesh': '达卡',
  '巴基斯坦': '卡拉奇', 'Pakistan': '卡拉奇',
  '阿联酋': '迪拜', 'UAE': '迪拜', 'United Arab Emirates': '迪拜',
  '土耳其': '安卡拉', 'Turkey': '安卡拉', 'Türkiye': '安卡拉',
  '沙特阿拉伯': '利雅得', 'Saudi Arabia': '利雅得',
  '伊朗': '德黑兰', 'Iran': '德黑兰',
  '伊拉克': '巴格达', 'Iraq': '巴格达',
  '以色列': '耶路撒冷', 'Israel': '耶路撒冷',
  '卡塔尔': '多哈', 'Qatar': '多哈',
  '俄罗斯': '莫斯科', 'Russia': '莫斯科',
  '英国': '伦敦', 'UK': '伦敦', 'United Kingdom': '伦敦', 'Britain': '伦敦',
  '法国': '巴黎', 'France': '巴黎',
  '德国': '柏林', 'Germany': '柏林',
  '意大利': '罗马', 'Italy': '罗马',
  '西班牙': '马德里', 'Spain': '马德里',
  '荷兰': '阿姆斯特丹', 'Netherlands': '阿姆斯特丹',
  '奥地利': '维也纳', 'Austria': '维也纳',
  '波兰': '华沙', 'Poland': '华沙',
  '乌克兰': '基辅', 'Ukraine': '基辅',
  '瑞典': '斯德哥尔摩', 'Sweden': '斯德哥尔摩',
  '比利时': '布鲁塞尔', 'Belgium': '布鲁塞尔',
  '瑞士': '苏黎世', 'Switzerland': '苏黎世',
  '葡萄牙': '里斯本', 'Portugal': '里斯本',
  '捷克': '布拉格', 'Czech Republic': '布拉格', 'Czechia': '布拉格',
  '希腊': '雅典', 'Greece': '雅典',
  '芬兰': '赫尔辛基', 'Finland': '赫尔辛基',
  '尼日利亚': '拉各斯', 'Nigeria': '拉各斯',
  '埃及': '开罗', 'Egypt': '开罗',
  '肯尼亚': '内罗毕', 'Kenya': '内罗毕',
  '南非': '约翰内斯堡', 'South Africa': '约翰内斯堡',
  '刚果': '金沙萨', 'Congo': '金沙萨', 'DRC': '金沙萨',
  '摩洛哥': '卡萨布兰卡', 'Morocco': '卡萨布兰卡',
  '埃塞俄比亚': '亚的斯亚贝巴', 'Ethiopia': '亚的斯亚贝巴',
  '坦桑尼亚': '达累斯萨拉姆', 'Tanzania': '达累斯萨拉姆',
  '阿尔及利亚': '阿尔及尔', 'Algeria': '阿尔及尔',
  '加纳': '阿克拉', 'Ghana': '阿克拉',
  '美国': '华盛顿', 'USA': '华盛顿', 'United States': '华盛顿', 'US': '华盛顿',
  '加拿大': '多伦多', 'Canada': '多伦多',
  '墨西哥': '墨西哥城', 'Mexico': '墨西哥城',
  '古巴': '哈瓦那', 'Cuba': '哈瓦那',
  '巴拿马': '巴拿马城', 'Panama': '巴拿马城',
  '巴西': '圣保罗', 'Brazil': '圣保罗',
  '阿根廷': '布宜诺斯艾利斯', 'Argentina': '布宜诺斯艾利斯',
  '秘鲁': '利马', 'Peru': '利马',
  '哥伦比亚': '波哥大', 'Colombia': '波哥大',
  '智利': '圣地亚哥', 'Chile': '圣地亚哥',
  '澳大利亚': '悉尼', 'Australia': '悉尼',
  '新西兰': '奥克兰', 'New Zealand': '奥克兰',
};

/**
 * Resolve city name to lat/lng coordinates from WORLD_CITIES.
 * Tries exact match first, then partial match.
 * Returns { lat, lng, cityName } or null if not found.
 */
function resolveCityCoordinates(cityName) {
  if (!cityName) return null;

  // Exact match (Chinese name)
  const exact = CITY_LOOKUP.get(cityName);
  if (exact) return { lat: exact.lat, lng: exact.lng, cityName: exact.name };

  // Exact match (English name, case-insensitive)
  const exactEn = CITY_LOOKUP.get(cityName.toLowerCase());
  if (exactEn) return { lat: exactEn.lat, lng: exactEn.lng, cityName: exactEn.name };

  // Partial match: city name contains or is contained by a known city name
  for (const city of WORLD_CITIES) {
    if (city.name.includes(cityName) || cityName.includes(city.name)) {
      return { lat: city.lat, lng: city.lng, cityName: city.name };
    }
    if (city.nameEn.toLowerCase().includes(cityName.toLowerCase()) ||
        cityName.toLowerCase().includes(city.nameEn.toLowerCase())) {
      return { lat: city.lat, lng: city.lng, cityName: city.name };
    }
  }

  return null;
}

/**
 * Attempt to geocode a news item by matching its title/description against
 * known city and country names. Returns { lat, lng, cityName } or null.
 */
function geocodeNewsItem(news) {
  const text = `${news.title || ''} ${news.description || ''}`;
  // Try each city name (Chinese and English)
  for (const city of WORLD_CITIES) {
    if (text.includes(city.name) || text.toLowerCase().includes(city.nameEn.toLowerCase())) {
      return { lat: city.lat, lng: city.lng, cityName: city.name };
    }
  }
  // Try country name mapping
  for (const [country, cityName] of Object.entries(COUNTRY_CAPITAL_MAP)) {
    if (text.includes(country) || text.toLowerCase().includes(country.toLowerCase())) {
      const resolved = resolveCityCoordinates(cityName);
      if (resolved) return resolved;
    }
  }
  return null;
}

/* ================================================================
   Tile math helpers (Web Mercator EPSG:3857)
   ================================================================ */

function lngToTileX(lng, zoom) {
  return ((lng + 180) / 360) * Math.pow(2, zoom);
}

function latToTileY(lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * Math.pow(2, zoom);
}


// Convert lat/lng to pixel coordinates at a given zoom level
function latLngToPixel(lat, lng, zoom) {
  const x = lngToTileX(lng, zoom) * TILE_SIZE;
  const y = latToTileY(lat, zoom) * TILE_SIZE;
  return { x, y };
}

// Compute horizontal wrap offsets needed to cover the visible viewport.
// Instead of always using -1,0,+1 world copies, calculate the range dynamically
// based on the current pan position and canvas width so that nodes always appear
// no matter how far the user scrolls.
function getWrapOffsets(worldWidth, panX, canvasWidth) {
  const minCopy = Math.floor((panX - worldWidth) / worldWidth);
  const maxCopy = Math.ceil((panX + canvasWidth) / worldWidth);
  const offsets = [];
  for (let c = minCopy; c <= maxCopy; c++) {
    offsets.push(c * worldWidth);
  }
  return offsets;
}

/* ================================================================
   Tile cache (module-level singleton)
   ================================================================ */

const tileCache = new Map();

function getTileImage(z, x, y) {
  const maxTile = Math.pow(2, z);
  const wrappedX = ((x % maxTile) + maxTile) % maxTile;
  if (y < 0 || y >= maxTile) return null;

  const key = `${z}/${wrappedX}/${y}`;
  if (tileCache.has(key)) return tileCache.get(key);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.loaded = false;
  img.failed = false;
  img.onload = () => { img.loaded = true; };
  img.onerror = () => { img.failed = true; };
  img.src = `https://tile.openstreetmap.org/${z}/${wrappedX}/${y}.png`;
  tileCache.set(key, img);
  return img;
}

/* ================================================================
   Context
   ================================================================ */

const RealWorldPredictorContext = createContext(null);

/* ================================================================
   Provider: RealWorldPredictorProvider
   ================================================================ */

function RealWorldPredictorProvider({ settings, children }) {
  const [events, setEvents] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [autoMode, setAutoMode] = useState(false);
  const [analysis, setAnalysis] = useState('');
  const [predictions, setPredictions] = useState([]);
  const [keyTrends, setKeyTrends] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [hoveredEvent, setHoveredEvent] = useState(null);
  const [regionFilter, setRegionFilter] = useState('all');
  const [contextSummaries, setContextSummaries] = useState([]);
  const [log, setLog] = useState([]);

  // Event causal tracing state
  const [traceResult, setTraceResult] = useState(null);
  const [isTracing, setIsTracing] = useState(false);

  // Selected edge state (for viewing edge details)
  const [selectedEdge, setSelectedEdge] = useState(null);

  // Event animation state (for Plague Inc.-style animations)
  const [eventAnimations, setEventAnimations] = useState([]);

  // Online news fetching state
  const [latestNews, setLatestNews] = useState([]);
  const [isFetchingNews, setIsFetchingNews] = useState(false);

  // News source selection and count controls
  const [newsCount, setNewsCount] = useState(10);
  const [selectedNewsSources, setSelectedNewsSources] = useState(
    () => NEWS_SOURCES.map(s => s.key),
  );

  // Archive state
  const [archives, setArchives] = useState(() => {
    try {
      const saved = localStorage.getItem(ARCHIVES_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedArchive, setSelectedArchive] = useState(null);

  useEffect(() => {
    try {
      localStorage.setItem(ARCHIVES_STORAGE_KEY, JSON.stringify(archives));
    } catch {
      // localStorage full or unavailable
    }
  }, [archives]);

  // Event seed state
  const [eventSeed, setEventSeed] = useState('');

  // Country interview chat state
  const [chatTarget, setChatTarget] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [isChatting, setIsChatting] = useState(false);
  const chatInputRef = useRef(null);

  // World state tracking (updated each round)
  const [worldState, setWorldState] = useState({
    tension_level: '中',
    economic_outlook: '稳定',
    hot_regions: [],
    summary: '世界局势初始状态',
  });

  // News seed ref (fetched once, used as seed for all subsequent iterations)
  const newsSeedRef = useRef(null);

  const abortRef = useRef(null);
  const newsAbortRef = useRef(null);
  const eventIdCounter = useRef(0);

  /* --- Hierarchical Context Condensing --- */
  const condenseOldEvents = useCallback((currentEvents) => {
    if (currentEvents.length > CONTEXT_BATCH_SIZE) {
      const oldEvents = currentEvents.slice(0, currentEvents.length - CONTEXT_BATCH_SIZE);
      const summaries = [];
      for (let i = 0; i < oldEvents.length; i += CONTEXT_BATCH_SIZE) {
        const batch = oldEvents.slice(i, i + CONTEXT_BATCH_SIZE);
        const summary = batch.map((e) => `${e.region}:${e.text}`).join('；') + '。';
        summaries.push(summary);
      }
      setContextSummaries(summaries);
    }
  }, []);

  /* --- Fetch latest news from internet --- */
  const fetchLatestNews = useCallback(async () => {
    setIsFetchingNews(true);
    try {
      const controller = new AbortController();
      newsAbortRef.current = controller;
      const news = await fetchNewsFromRSS(controller.signal, {
        count: newsCount,
        sources: selectedNewsSources,
      });
      // Geocode each news item so it can be displayed on the map
      const geoNews = news.map((n) => {
        const coords = geocodeNewsItem(n);
        return coords ? { ...n, lat: coords.lat, lng: coords.lng, cityName: coords.cityName } : n;
      });
      setLatestNews(geoNews);
      const located = geoNews.filter((n) => n.lat != null);
      setLog((prev) => [`[联网] 获取到 ${geoNews.length} 条新闻，${located.length} 条已定位到地图`, ...prev].slice(0, 50));
      return geoNews;
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLog((prev) => [`[联网错误] ${err.message}`, ...prev].slice(0, 50));
      }
      return [];
    } finally {
      setIsFetchingNews(false);
    }
  }, [newsCount, selectedNewsSources]);

  /* --- Build messages for LLM --- */
  const buildMessages = useCallback((newsSeed) => {
    // Build available city list for the model
    const cityListStr = WORLD_CITIES.map(c => c.name).join('、');

    const systemContent = SYSTEM_PROMPT + `\n\n【可用城市列表】\n${cityListStr}`;
    const messages = [{ role: 'system', content: systemContent }];

    let contextStr = '';
    const hasSources = (newsSeed?.length || 0) > 0;

    // Include current world state
    contextStr += `【当前世界状态 (第${generation}轮)】\n`;
    contextStr += `- 紧张程度: ${worldState.tension_level}\n`;
    contextStr += `- 经济展望: ${worldState.economic_outlook}\n`;
    if (worldState.hot_regions.length > 0) {
      contextStr += `- 热点地区: ${worldState.hot_regions.join('、')}\n`;
    }
    contextStr += `- 总结: ${worldState.summary}\n\n`;

    // Include user event seed if provided
    const trimmedSeed = eventSeed ? eventSeed.trim() : '';
    if (trimmedSeed) {
      contextStr += `【用户设定的事件种子/关注焦点】\n${trimmedSeed}\n\n`;
    }

    // Include news seed (fetched once from real news, used as seed context)
    if (newsSeed && newsSeed.length > 0) {
      contextStr += '【新闻种子（来自真实新闻的初始信息，请基于此推演后续发展）】\n';
      newsSeed.forEach((point, i) => {
        contextStr += `${i + 1}. ${point}\n`;
      });
      contextStr += '\n';
    }

    if (contextSummaries.length > 0 || events.length > 0) {
      if (contextSummaries.length > 0) {
        contextStr += '之前的事件摘要：\n' + contextSummaries.join('\n') + '\n\n';
      }
      if (events.length > 0) {
        const recent = events.slice(-CONTEXT_BATCH_SIZE);
        contextStr +=
          '近期推演事件：\n' +
          recent
            .map((e) => `[${e.region}/${e.country}] ${e.text} (${e.category}, 影响:${e.impact}, 趋势:${e.trend})`)
            .join('\n');
      }
      if (analysis) {
        contextStr += '\n\n上次推演分析：' + analysis;
      }
      messages.push({
        role: 'user',
        content: contextStr + '\n\n请基于当前世界状态和已发生的事件，推演下一步全球事件发展。新事件必须与之前的事件有明确的因果关系，形成清晰的推演链条。注意：只需提供事件描述和城市名，坐标将自动匹配。' + (trimmedSeed ? `请特别关注用户设定的事件种子：${trimmedSeed}。` : ''),
      });
    } else {
      messages.push({
        role: 'user',
        content: contextStr + (hasSources
          ? '请基于以上新闻种子信息和世界状态，推演接下来可能发生的全球重大事件。事件之间必须有明确的因果关系。将每个事件关联到城市列表中的具体城市。'
          : '请基于当前世界状态，推演接下来可能发生的全球重大事件。事件之间必须有明确的因果关系。') + (trimmedSeed ? `请特别关注用户设定的事件种子：${trimmedSeed}。` : '') + '\n注意：只需提供事件描述和城市名，坐标将自动匹配。',
      });
    }

    return messages;
  }, [contextSummaries, events, analysis, eventSeed, generation, worldState]);

  /* --- Run Deduction Step --- */
  const runStep = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);

    try {
      // Use already-fetched news as seed for the first iteration
      if (generation === 0 && latestNews.length > 0 && (!newsSeedRef.current || newsSeedRef.current.length === 0)) {
        const seedPoints = latestNews.slice(0, 15).map(n => {
          let line = n.title;
          if (n.description) line += ` — ${n.description}`;
          return line;
        });
        newsSeedRef.current = seedPoints;
      }

      // Only use news seed for the first iteration; subsequent iterations use world state only
      const newsSeed = generation === 0 ? newsSeedRef.current : null;

      const messages = buildMessages(newsSeed);
      const controller = new AbortController();
      abortRef.current = controller;

      let fullContent = '';
      const result = await sendChatRequest(
        messages,
        settings,
        (chunk) => {
          if (chunk) fullContent += chunk;
        },
        controller.signal,
      );

      const content = stripThinkTags(result?.content || fullContent);
      if (!content) {
        setLog((prev) => [`[推演 ${generation + 1}] 无响应`, ...prev].slice(0, 50));
        return;
      }

      let data;
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        data = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        setLog((prev) => [`[推演 ${generation + 1}] JSON解析失败`, ...prev].slice(0, 50));
        return;
      }

      if (!data) return;

      if (data.events && Array.isArray(data.events)) {
        const newEvents = data.events.map((e, idx) => {
          // Resolve coordinates from city name, with country fallback
          const cityCoords = resolveCityCoordinates(e.city)
            || resolveCityCoordinates(COUNTRY_CAPITAL_MAP[e.city])
            || resolveCityCoordinates(e.country)
            || resolveCityCoordinates(COUNTRY_CAPITAL_MAP[e.country]);
          return {
            id: `rw${eventIdCounter.current++}`,
            text: e.text || '',
            region: e.region || '未知',
            country: e.country || '',
            city: cityCoords ? cityCoords.cityName : (e.city || ''),
            category: e.category || 'society',
            impact: e.impact || 'low',
            lat: cityCoords ? cityCoords.lat : 0,
            lng: cityCoords ? cityCoords.lng : 0,
            related_events: Array.isArray(e.related_events) ? e.related_events : [],
            cause_label: e.cause_label || '',
            trend: e.trend || '持续',
            timestamp: Date.now(),
            genIndex: idx,
            generation: generation + 1,
          };
        });

        setEvents((prev) => {
          const updated = [...prev, ...newEvents].slice(-MAX_EVENTS);
          condenseOldEvents(updated);
          return updated;
        });

        // Trigger Plague Inc.-style event animations for new events
        const now = Date.now();
        const newAnims = newEvents.map((e) => ({
          id: e.id,
          lat: e.lat,
          lng: e.lng,
          category: e.category,
          impact: e.impact,
          startTime: now,
          duration: e.impact === 'high' ? 3000 : e.impact === 'medium' ? 2000 : 1500,
          rings: e.impact === 'high' ? 4 : e.impact === 'medium' ? 3 : 2,
        }));
        // Clean up expired animations and add new ones
        setEventAnimations((prev) => [
          ...prev.filter((a) => now - a.startTime < a.duration),
          ...newAnims,
        ]);

        newEvents.forEach((e) => {
          setLog((prev) =>
            [`[推演 ${generation + 1}] ${CATEGORY_ICONS[e.category] || '📌'} ${e.region}: ${e.text}`, ...prev].slice(
              0,
              50,
            ),
          );
        });
      }

      if (data.analysis) setAnalysis(data.analysis);
      if (Array.isArray(data.predictions)) setPredictions(data.predictions);
      if (Array.isArray(data.key_trends)) setKeyTrends(data.key_trends);

      // Update world state from model response
      if (data.world_state_updates) {
        const wsu = data.world_state_updates;
        setWorldState((prev) => ({
          tension_level: wsu.tension_level || prev.tension_level,
          economic_outlook: wsu.economic_outlook || prev.economic_outlook,
          hot_regions: Array.isArray(wsu.hot_regions) ? wsu.hot_regions : prev.hot_regions,
          summary: wsu.summary || prev.summary,
        }));
        setLog((prev) => [`[世界状态更新] 紧张程度:${wsu.tension_level || '?'} 经济:${wsu.economic_outlook || '?'}`, ...prev].slice(0, 50));
      }

      setGeneration((prev) => prev + 1);

      // After the first prediction step, news items are no longer "news" —
      // convert geolocated news into historical seed events and clear the news layer.
      if (generation === 0 && latestNews.length > 0) {
        const newsEvents = latestNews
          .filter((n) => n.lat != null && n.lng != null)
          .map((n) => ({
            id: `rw-news-${eventIdCounter.current++}`,
            text: n.title + (n.description ? ` — ${n.description}` : ''),
            region: n.cityName || '全球',
            country: n.cityName || '',
            city: n.cityName || '',
            category: 'society',
            impact: 'low',
            lat: n.lat,
            lng: n.lng,
            related_events: [],
            cause_label: '',
            trend: '持续',
            timestamp: Date.now(),
            genIndex: 0,
            generation: 0,
            fromNews: true, // mark as news-sourced event
          }));
        if (newsEvents.length > 0) {
          setEvents((prev) => {
            const updated = [...newsEvents, ...prev].slice(-MAX_EVENTS);
            return updated;
          });
          setLog((prev) => [`[新闻转化] ${newsEvents.length} 条新闻已转化为历史事件`, ...prev].slice(0, 50));
        }
        // Clear news layer — they are now part of the events
        setLatestNews([]);
      }

      // Archive this iteration's results
      const archiveEntry = {
        id: Date.now(),
        generation: generation + 1,
        timestamp: new Date().toLocaleString(),
        events: data.events ? data.events.map((e, idx) => {
          const cityCoords = resolveCityCoordinates(e.city)
            || resolveCityCoordinates(COUNTRY_CAPITAL_MAP[e.city])
            || resolveCityCoordinates(e.country)
            || resolveCityCoordinates(COUNTRY_CAPITAL_MAP[e.country]);
          return {
            id: `rw-archive-${generation + 1}-${idx}`,
            text: e.text || '',
            region: e.region || '未知',
            country: e.country || '',
            city: cityCoords ? cityCoords.cityName : (e.city || ''),
            category: e.category || 'society',
            impact: e.impact || 'low',
            lat: cityCoords ? cityCoords.lat : 0,
            lng: cityCoords ? cityCoords.lng : 0,
            trend: e.trend || '持续',
          };
        }) : [],
        analysis: data.analysis || '',
        predictions: Array.isArray(data.predictions) ? data.predictions : [],
        keyTrends: Array.isArray(data.key_trends) ? data.key_trends : [],
        eventCount: data.events ? data.events.length : 0,
        worldState: data.world_state_updates || null,
      };
      setArchives(prev => [...prev, archiveEntry]);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setLog((prev) => [`[错误] ${err.message}`, ...prev].slice(0, 50));
      }
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, settings, generation, buildMessages, condenseOldEvents, latestNews]);

  /* --- Trace Event Cause (Causal Analysis) --- */
  const traceEventCause = useCallback(
    async (event) => {
      if (isTracing) return;
      setIsTracing(true);
      setTraceResult(null);

      const relatedContext = events
        .filter((e) => e.id !== event.id)
        .map((e) => `[${e.region}/${e.country}] ${e.text} (${e.category}, 影响:${e.impact}, 趋势:${e.trend})`)
        .join('\n');

      const prompt = `你是一个全球时事分析专家。请分析以下事件发生的根本原因和因果链条。

【目标事件】
${event.text}
- 地区: ${event.region} / ${event.country}
- 类别: ${event.category}
- 影响: ${event.impact}
- 趋势: ${event.trend}

${relatedContext ? `【相关事件背景】\n${relatedContext}\n` : ''}
请严格用JSON格式回复：
{
  "root_causes": ["根本原因1", "根本原因2"],
  "causal_chain": [
    {"step": 1, "event": "最初的触发因素", "time_frame": "时间范围"},
    {"step": 2, "event": "导致的中间事件", "time_frame": "时间范围"},
    {"step": 3, "event": "最终导致目标事件", "time_frame": "时间范围"}
  ],
  "key_actors": ["关键参与方1", "关键参与方2"],
  "summary": "因果关系总结"
}`;

      try {
        const controller = new AbortController();
        abortRef.current = controller;

        let fullContent = '';
        const result = await sendChatRequest(
          [
            { role: 'system', content: '你是一个全球时事分析专家，擅长事件因果分析和溯源。请严格用JSON格式回复。' },
            { role: 'user', content: prompt },
          ],
          settings,
          (chunk) => {
            if (chunk) fullContent += chunk;
          },
          controller.signal,
        );

        const content = stripThinkTags(result?.content || fullContent);
        if (content) {
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const data = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
            if (data) {
              setTraceResult(data);
            }
          } catch {
            setLog((prev) => ['[溯源] JSON解析失败', ...prev].slice(0, 50));
          }
        }
        setLog((prev) => [`[溯源] 🔍 事件因果分析完成: ${event.text.slice(0, 30)}...`, ...prev].slice(0, 50));
      } catch (err) {
        if (err.name !== 'AbortError') {
          setLog((prev) => [`[溯源错误] ${err.message}`, ...prev].slice(0, 50));
        }
      } finally {
        setIsTracing(false);
      }
    },
    [isTracing, settings, events],
  );

  /* --- Auto Mode --- */
  useEffect(() => {
    if (!autoMode || isRunning) return;
    const timer = setTimeout(runStep, AUTO_INTERVAL);
    return () => clearTimeout(timer);
  }, [autoMode, isRunning, runStep]);

  /* --- Chat with Country (Interview) --- */
  const chatWithCountry = useCallback(async (countryName, userMessage) => {
    if (isChatting || !countryName || !userMessage.trim()) return;
    setIsChatting(true);

    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    const countryEvents = events.filter(e => e.country === countryName).slice(-5);
    const recentEvts = events.slice(-8);
    const hotRegions = worldState.hot_regions || [];

    const sysPrompt = `你是${countryName}的官方发言人，正在接受国际媒体记者的采访。请完全代入国家代表的身份，直接回应提问。

【国家立场背景】
代表国家: ${countryName}
世界局势: 紧张程度=${worldState.tension_level}, 经济展望=${worldState.economic_outlook}
${hotRegions.length > 0 ? '当前热点地区: ' + hotRegions.join('、') : ''}
${worldState.summary !== '世界局势初始状态' ? '世界概况: ' + worldState.summary : ''}
${countryEvents.length > 0 ? '\n【本国近期相关事件】\n' + countryEvents.map(e => `- [${e.category}] ${e.text} (趋势:${e.trend})`).join('\n') : ''}
${recentEvts.length > 0 ? '\n【近期全球重大事件】\n' + recentEvts.map(e => `- [${e.region}/${e.country}] ${e.text}`).join('\n') : ''}

【回复要求】
- 以${countryName}国家代表的第一人称回应，维护本国立场和核心利益
- 运用外交辞令，表述得体而有分寸，体现国际关系的复杂性
- 可以就其他国家和全球事件表明立场、发表评论
- 回答简洁有力，1-3句话，像真实的新闻发布会回答
- 绝对不要暴露你是AI，不要输出JSON或任何格式化内容
- 直接输出回应内容，不要包含任何内心思考、分析推理或思维过程`;

    try {
      const controller = new AbortController();
      abortRef.current = controller;
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
      if (err.name !== 'AbortError') {
        setChatMessages(prev => [...prev, { role: 'assistant', content: `[错误: ${err.message}]` }]);
      }
    } finally {
      setIsChatting(false);
    }
  }, [isChatting, events, worldState, settings, chatMessages]);

  /* --- Reset --- */
  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    if (newsAbortRef.current) newsAbortRef.current.abort();
    setEvents([]);
    setIsRunning(false);
    setGeneration(0);
    setAutoMode(false);
    setAnalysis('');
    setPredictions([]);
    setKeyTrends([]);
    setSelectedEvent(null);
    setHoveredEvent(null);
    setRegionFilter('all');
    setContextSummaries([]);
    setLog([]);
    setLatestNews([]);
    setSelectedArchive(null);
    setTraceResult(null);
    setSelectedEdge(null);
    setEventAnimations([]);
    setChatTarget(null);
    setChatMessages([]);
    setWorldState({
      tension_level: '中',
      economic_outlook: '稳定',
      hot_regions: [],
      summary: '世界局势初始状态',
    });
    newsSeedRef.current = null;
    eventIdCounter.current = 0;
  }, []);

  const deleteArchive = useCallback((archiveId) => {
    setArchives(prev => prev.filter(a => a.id !== archiveId));
    setSelectedArchive(prev => prev && prev.id === archiveId ? null : prev);
  }, []);

  const value = useMemo(
    () => ({
      events,
      isRunning,
      generation,
      autoMode,
      analysis,
      predictions,
      keyTrends,
      selectedEvent,
      hoveredEvent,
      regionFilter,
      log,
      latestNews,
      isFetchingNews,
      archives,
      selectedArchive,
      eventSeed,
      traceResult,
      isTracing,
      selectedEdge,
      eventAnimations,
      worldState,
      chatTarget,
      chatMessages,
      isChatting,
      chatInputRef,
      newsCount,
      selectedNewsSources,
      setNewsCount,
      setSelectedNewsSources,
      setSelectedArchive,
      deleteArchive,
      setAutoMode,
      setSelectedEvent,
      setHoveredEvent,
      setSelectedEdge,
      setRegionFilter,
      setEventSeed,
      setChatTarget,
      setChatMessages,
      chatWithCountry,
      runStep,
      reset,
      traceEventCause,
      fetchLatestNews,
      settings,
    }),
    [
      events,
      isRunning,
      generation,
      autoMode,
      analysis,
      predictions,
      keyTrends,
      selectedEvent,
      hoveredEvent,
      regionFilter,
      log,
      latestNews,
      isFetchingNews,
      archives,
      selectedArchive,
      eventSeed,
      traceResult,
      isTracing,
      selectedEdge,
      eventAnimations,
      worldState,
      chatTarget,
      chatMessages,
      isChatting,
      newsCount,
      selectedNewsSources,
      runStep,
      reset,
      deleteArchive,
      traceEventCause,
      chatWithCountry,
      fetchLatestNews,
      settings,
    ],
  );

  return <RealWorldPredictorContext.Provider value={value}>{children}</RealWorldPredictorContext.Provider>;
}

/* ================================================================
   Canvas Component: RealWorldCanvas
   ================================================================ */

const RealWorldCanvas = memo(function RealWorldCanvas() {
  const ctx = useContext(RealWorldPredictorContext);
  const { events, selectedEvent, setSelectedEvent, hoveredEvent, setHoveredEvent, generation, analysis, keyTrends, eventAnimations, worldState, selectedEdge, setSelectedEdge, latestNews } = ctx;

  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);
  const sizeRef = useRef({ width: 800, height: 500 });
  const zoomRef = useRef(2);
  // panRef stores pixel offset of the top-left corner of the canvas in world-pixel space
  const panRef = useRef(null);
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, panStartX: 0, panStartY: 0 });
  const pulseRef = useRef(0);
  const hoveredCityRef = useRef(null);
  // Cached edge geometries for hit-testing (populated each frame by drawCausalLines)
  const edgeGeoRef = useRef([]);

  // State for map popup detail info shown near clicked items
  // Stores world coordinates (lat/lng) so popup can follow map pan/zoom
  const [mapPopup, setMapPopup] = useState(null); // { lat, lng, type, data }
  const mapPopupElRef = useRef(null); // ref to popup DOM element for direct position updates
  const mapPopupRef = useRef(null); // ref to track mapPopup data for animation frame access
  const [selectedNews, setSelectedNews] = useState(null);

  // Keep mapPopupRef in sync with mapPopup state for animation frame access
  useEffect(() => { mapPopupRef.current = mapPopup; }, [mapPopup]);

  // Initialize pan to center the world
  const initPan = useCallback(() => {
    const { width, height } = sizeRef.current;
    const zoom = zoomRef.current;
    const worldSize = Math.pow(2, zoom) * TILE_SIZE;
    panRef.current = {
      x: (worldSize - width) / 2,
      y: (worldSize - height) / 2,
    };
  }, []);

  // Clamp pan to keep viewport within map bounds (prevent blue areas at top/bottom)
  const clampPan = useCallback(() => {
    const zoom = zoomRef.current;
    const worldSize = Math.pow(2, zoom) * TILE_SIZE;
    const { height } = sizeRef.current;
    // Clamp Y: don't let viewport go above top or below bottom of the map
    if (panRef.current.y < 0) panRef.current.y = 0;
    if (panRef.current.y + height > worldSize) panRef.current.y = Math.max(0, worldSize - height);
  }, []);

  // Convert lat/lng to canvas screen coordinates
  const latLngToScreen = useCallback((lat, lng) => {
    const zoom = zoomRef.current;
    const px = latLngToPixel(lat, lng, zoom);
    const pan = panRef.current;
    return { x: px.x - pan.x, y: px.y - pan.y };
  }, []);

  /* --- Draw tiles --- */
  const drawTiles = useCallback((c2d, w, h) => {
    const zoom = zoomRef.current;
    const pan = panRef.current;
    const startTileX = Math.floor(pan.x / TILE_SIZE);
    const startTileY = Math.floor(pan.y / TILE_SIZE);
    const endTileX = Math.floor((pan.x + w) / TILE_SIZE);
    const endTileY = Math.floor((pan.y + h) / TILE_SIZE);

    for (let tx = startTileX; tx <= endTileX; tx++) {
      for (let ty = startTileY; ty <= endTileY; ty++) {
        const screenX = tx * TILE_SIZE - pan.x;
        const screenY = ty * TILE_SIZE - pan.y;
        const tile = getTileImage(zoom, tx, ty);

        if (tile && tile.loaded) {
          c2d.drawImage(tile, screenX, screenY, TILE_SIZE, TILE_SIZE);
        } else if (tile) {
          // Placeholder while tile is loading (tile exists but not yet loaded)
          c2d.fillStyle = '#1a3a5a';
          c2d.fillRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
          c2d.strokeStyle = 'rgba(255,255,255,0.05)';
          c2d.strokeRect(screenX, screenY, TILE_SIZE, TILE_SIZE);
        }
        // If tile is null (out of valid Y range), skip — background shows through
      }
    }
  }, []);

  /* --- Draw city markers --- */
  const drawCities = useCallback(
    (c2d, w, h, pulse) => {
      const zoom = zoomRef.current;
      const showLabels = zoom >= 2;
      const hCity = hoveredCityRef.current;
      const worldWidth = Math.pow(2, zoom) * TILE_SIZE;
      const wrapOffsets = getWrapOffsets(worldWidth, panRef.current.x, w);

      WORLD_CITIES.forEach((city) => {
        const pt = latLngToScreen(city.lat, city.lng);

        // Draw the city at wrapped horizontal positions to cover the full map
        for (const offsetX of wrapOffsets) {
          const sx = pt.x + offsetX;
          if (sx < -30 || sx > w + 30) continue;
          if (pt.y < -30 || pt.y > h + 30) continue;

          const isHovered = hCity && hCity.nameEn === city.nameEn;
          const baseRadius = city.pop === 'mega' ? 5 : city.pop === 'large' ? 4 : 3;
          const radius = isHovered ? baseRadius + 2 : baseRadius;

          // Glow
          c2d.beginPath();
          c2d.arc(sx, pt.y, radius + 3 + Math.sin(pulse * 0.03) * 1.5, 0, Math.PI * 2);
          c2d.fillStyle = isHovered ? 'rgba(255,200,50,0.25)' : 'rgba(255,255,255,0.1)';
          c2d.fill();

          // Dot
          c2d.beginPath();
          c2d.arc(sx, pt.y, radius, 0, Math.PI * 2);
          c2d.fillStyle = isHovered ? '#ffc832' : (CITY_DOT_COLORS[city.pop] || '#74c0fc');
          c2d.fill();
          c2d.strokeStyle = 'rgba(255,255,255,0.6)';
          c2d.lineWidth = 1;
          c2d.stroke();

          // Label
          if (showLabels) {
            const label = zoom >= 4 ? `${city.name} ${city.nameEn}` : city.name;
            c2d.font = isHovered ? 'bold 12px sans-serif' : '10px sans-serif';
            c2d.fillStyle = isHovered ? '#ffc832' : 'rgba(255,255,255,0.85)';
            c2d.strokeStyle = 'rgba(0,0,0,0.7)';
            c2d.lineWidth = 2.5;
            c2d.strokeText(label, sx + radius + 4, pt.y + 3);
            c2d.fillText(label, sx + radius + 4, pt.y + 3);
          }
        }
      });
    },
    [latLngToScreen],
  );

  /* --- Draw causal interaction lines (only for latest iteration) --- */
  const drawCausalLines = useCallback(
    (c2d, w, h) => {
      const geos = [];
      if (!events || events.length === 0 || generation <= 0) {
        edgeGeoRef.current = geos;
        return;
      }
      const zoom = zoomRef.current;
      const worldWidth = Math.pow(2, zoom) * TILE_SIZE;
      const wrapOffsets = getWrapOffsets(worldWidth, panRef.current.x, w);

      // Helper: convert hex color to rgba string
      const toRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
      };

      // Only show causal lines for the latest generation's events
      const latestEvents = events.filter((e) => e.generation === generation);
      if (latestEvents.length === 0) {
        edgeGeoRef.current = geos;
        return;
      }

      const pulse = pulseRef.current;

      c2d.save();
      latestEvents.forEach((evt) => {
        if (!evt.related_events || evt.related_events.length === 0) return;
        const toPt = latLngToScreen(evt.lat, evt.lng);
        const color = CATEGORY_COLORS[evt.category] || '#ffffff';

        evt.related_events.forEach((relIdx) => {
          const relEvt = latestEvents.find((e) => e.genIndex === relIdx);
          if (!relEvt) return;
          const fromPt = latLngToScreen(relEvt.lat, relEvt.lng);
          const isEdgeSelected =
            selectedEdge &&
            selectedEdge.fromId === relEvt.id &&
            selectedEdge.toId === evt.id;

          for (const offsetX of wrapOffsets) {
            const fx = fromPt.x + offsetX;
            const fy = fromPt.y;
            const tx = toPt.x + offsetX;
            const ty = toPt.y;

            // Skip off-screen lines
            if (fx < -100 && tx < -100) continue;
            if (fx > w + 100 && tx > w + 100) continue;
            if (fy < -100 && ty < -100) continue;
            if (fy > h + 100 && ty > h + 100) continue;

            const dx = tx - fx;
            const dy = ty - fy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 5) continue;

            // Compute Bézier control point (perpendicular offset for a nice curve)
            const perpX = -dy / dist;
            const perpY = dx / dist;
            const curvature = Math.min(dist * 0.25, 40);
            const cpx = (fx + tx) / 2 + perpX * curvature;
            const cpy = (fy + ty) / 2 + perpY * curvature;

            const relColor = CATEGORY_COLORS[relEvt.category] || '#ffffff';
            const edgeAlpha = isEdgeSelected ? 1.0 : 0.7;
            const edgeWidth = isEdgeSelected ? 3.5 : 2;

            // Glow effect behind the curve
            c2d.beginPath();
            c2d.moveTo(fx, fy);
            c2d.quadraticCurveTo(cpx, cpy, tx, ty);
            c2d.strokeStyle = toRgba(relColor, edgeAlpha * 0.2);
            c2d.lineWidth = edgeWidth + 4;
            c2d.setLineDash([]);
            c2d.stroke();

            // Main curved line with gradient
            const gradient = c2d.createLinearGradient(fx, fy, tx, ty);
            gradient.addColorStop(0, toRgba(relColor, edgeAlpha));
            gradient.addColorStop(1, toRgba(color, edgeAlpha));

            c2d.beginPath();
            c2d.moveTo(fx, fy);
            c2d.quadraticCurveTo(cpx, cpy, tx, ty);
            c2d.strokeStyle = gradient;
            c2d.lineWidth = edgeWidth;
            c2d.setLineDash([]);
            c2d.stroke();

            // Animated flow particles along the curve
            const particleCount = 3;
            for (let pi = 0; pi < particleCount; pi++) {
              const baseT = ((pulse * 0.008 + pi / particleCount) % 1);
              const t = baseT;
              // Quadratic Bézier point at parameter t
              const px = (1 - t) * (1 - t) * fx + 2 * (1 - t) * t * cpx + t * t * tx;
              const py = (1 - t) * (1 - t) * fy + 2 * (1 - t) * t * cpy + t * t * ty;
              const particleAlpha = Math.sin(t * Math.PI) * 0.8;
              const particleR = isEdgeSelected ? 3.5 : 2.5;

              c2d.beginPath();
              c2d.arc(px, py, particleR, 0, Math.PI * 2);
              c2d.fillStyle = `rgba(255,255,255,${particleAlpha})`;
              c2d.fill();
            }

            // Arrowhead (at the end of the curve, following curve tangent)
            // Tangent at t=1 for quadratic Bézier: 2*(1-t)*(cp-from) + 2*t*(to-cp)
            const tanX = tx - cpx;
            const tanY = ty - cpy;
            const tanAngle = Math.atan2(tanY, tanX);
            const arrowLen = isEdgeSelected ? 12 : 10;
            const arrowAngle = Math.PI / 6;
            const arrowX = tx - Math.cos(tanAngle) * 8;
            const arrowY = ty - Math.sin(tanAngle) * 8;
            c2d.beginPath();
            c2d.fillStyle = toRgba(color, edgeAlpha);
            c2d.moveTo(arrowX, arrowY);
            c2d.lineTo(arrowX - arrowLen * Math.cos(tanAngle - arrowAngle), arrowY - arrowLen * Math.sin(tanAngle - arrowAngle));
            c2d.lineTo(arrowX - arrowLen * Math.cos(tanAngle + arrowAngle), arrowY - arrowLen * Math.sin(tanAngle + arrowAngle));
            c2d.closePath();
            c2d.fill();

            // Cause label on the curve midpoint
            const label = evt.cause_label || '';
            // Midpoint on the quadratic Bézier at t=0.5
            const mx = 0.25 * fx + 0.5 * cpx + 0.25 * tx;
            const my = 0.25 * fy + 0.5 * cpy + 0.25 * ty;
            if (label && dist > 60) {
              c2d.font = isEdgeSelected ? 'bold 10px sans-serif' : '9px sans-serif';
              const textWidth = c2d.measureText(label).width;
              c2d.fillStyle = isEdgeSelected ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.75)';
              c2d.fillRect(mx - textWidth / 2 - 4, my - 9, textWidth + 8, 16);
              if (isEdgeSelected) {
                c2d.strokeStyle = toRgba(color, 0.6);
                c2d.lineWidth = 1;
                c2d.strokeRect(mx - textWidth / 2 - 4, my - 9, textWidth + 8, 16);
              }
              c2d.fillStyle = isEdgeSelected ? '#fff' : '#ffd54f';
              c2d.textAlign = 'center';
              c2d.fillText(label, mx, my + 3);
              c2d.textAlign = 'start';
            }

            // Store geometry for hit-testing
            geos.push({
              fx, fy, tx, ty, cpx, cpy, mx, my, dist,
              fromEvt: relEvt,
              toEvt: evt,
              label: label,
            });
          }
        });
      });
      c2d.restore();
      edgeGeoRef.current = geos;
    },
    [events, generation, latLngToScreen, selectedEdge],
  );

  /* --- Draw event markers --- */
  const drawEventMarkers = useCallback(
    (c2d, w, h, pulse) => {
      const evts = events;
      if (!evts || evts.length === 0) return;
      const zoom = zoomRef.current;
      const worldWidth = Math.pow(2, zoom) * TILE_SIZE;
      const wrapOffsets = getWrapOffsets(worldWidth, panRef.current.x, w);

      // Markers + labels (connection lines handled by drawCausalLines)
      evts.forEach((evt) => {
        const pt = latLngToScreen(evt.lat, evt.lng);

        const color = CATEGORY_COLORS[evt.category] || '#ffffff';
        const isSelected = selectedEvent && selectedEvent.id === evt.id;
        const isHovered = hoveredEvent && hoveredEvent.id === evt.id;
        const baseRadius = isSelected ? 8 : isHovered ? 7 : 5;
        const pulseRadius = baseRadius + Math.sin(pulse * 0.05) * 2;
        const isFromNews = evt.fromNews;

        for (const offsetX of wrapOffsets) {
          const sx = pt.x + offsetX;
          if (sx < -20 || sx > w + 20 || pt.y < -20 || pt.y > h + 20) continue;

          if (isFromNews) {
            // News-sourced events: diamond shape with dimmed color
            const size = isSelected ? 7 : isHovered ? 6 : 4;
            c2d.save();
            c2d.translate(sx, pt.y);
            c2d.rotate(Math.PI / 4);
            c2d.fillStyle = isSelected ? color : color.replace(')', ',0.5)').replace('rgb', 'rgba');
            c2d.fillRect(-size, -size, size * 2, size * 2);
            c2d.strokeStyle = 'rgba(255,255,255,0.4)';
            c2d.lineWidth = 1;
            c2d.strokeRect(-size, -size, size * 2, size * 2);
            c2d.restore();
          } else {
            c2d.beginPath();
            c2d.arc(sx, pt.y, pulseRadius + 4, 0, Math.PI * 2);
            c2d.fillStyle = color.replace(')', ',0.15)').replace('rgb', 'rgba');
            c2d.fill();

          c2d.beginPath();
          c2d.arc(sx, pt.y, pulseRadius, 0, Math.PI * 2);
          c2d.fillStyle = color.replace(')', ',0.4)').replace('rgb', 'rgba');
          c2d.fill();

          c2d.beginPath();
          c2d.arc(sx, pt.y, baseRadius * 0.6, 0, Math.PI * 2);
          c2d.fillStyle = color;
          c2d.fill();

          if (evt.impact === 'high') {
            c2d.beginPath();
            c2d.arc(sx, pt.y, pulseRadius + 8, 0, Math.PI * 2);
            c2d.strokeStyle = color.replace(')', ',0.3)').replace('rgb', 'rgba');
            c2d.lineWidth = 1;
            c2d.stroke();
          }
          } // end else (non-news markers)

          // Event label on map
          if (zoom >= 3 || isSelected || isHovered) {
            const icon = isFromNews ? '📰' : (CATEGORY_ICONS[evt.category] || '📌');
            const labelText = evt.text.length > 20 ? evt.text.slice(0, 20) + '…' : evt.text;
            const label = `${icon} ${labelText}`;
            c2d.font = (isSelected || isHovered) ? 'bold 11px sans-serif' : '10px sans-serif';
            c2d.fillStyle = 'rgba(0,0,0,0.75)';
            const textWidth = c2d.measureText(label).width;
            c2d.fillRect(sx + baseRadius + 4, pt.y - 8, textWidth + 8, 16);
            c2d.fillStyle = isSelected ? '#fff' : color;
            c2d.fillText(label, sx + baseRadius + 8, pt.y + 4);
          }
        }
      });
    },
    [events, selectedEvent, hoveredEvent, latLngToScreen],
  );

  /* --- Draw news markers on map --- */
  const drawNewsMarkers = useCallback(
    (c2d, w, h) => {
      if (!latestNews || latestNews.length === 0) return;
      const zoom = zoomRef.current;
      const worldWidth = Math.pow(2, zoom) * TILE_SIZE;
      const wrapOffsets = getWrapOffsets(worldWidth, panRef.current.x, w);

      latestNews.forEach((news) => {
        if (news.lat == null || news.lng == null) return;
        const pt = latLngToScreen(news.lat, news.lng);
        const isSelected = selectedNews && selectedNews.title === news.title;

        for (const offsetX of wrapOffsets) {
          const sx = pt.x + offsetX;
          if (sx < -20 || sx > w + 20 || pt.y < -20 || pt.y > h + 20) continue;

          // Diamond-shaped news marker
          const size = isSelected ? 7 : 5;
          c2d.save();
          c2d.translate(sx, pt.y);
          c2d.rotate(Math.PI / 4);
          c2d.fillStyle = isSelected ? '#4fc3f7' : 'rgba(79,195,247,0.7)';
          c2d.fillRect(-size, -size, size * 2, size * 2);
          c2d.strokeStyle = '#fff';
          c2d.lineWidth = 1;
          c2d.strokeRect(-size, -size, size * 2, size * 2);
          c2d.restore();

          // Label
          if (zoom >= 3 || isSelected) {
            const labelText = news.title.length > 18 ? news.title.slice(0, 18) + '…' : news.title;
            const label = `📰 ${labelText}`;
            c2d.font = isSelected ? 'bold 11px sans-serif' : '10px sans-serif';
            c2d.fillStyle = 'rgba(0,0,0,0.75)';
            const textWidth = c2d.measureText(label).width;
            c2d.fillRect(sx + size + 6, pt.y - 8, textWidth + 8, 16);
            c2d.fillStyle = isSelected ? '#fff' : '#4fc3f7';
            c2d.fillText(label, sx + size + 10, pt.y + 4);
          }
        }
      });
    },
    [latestNews, selectedNews, latLngToScreen],
  );

  /* --- Draw event animations (Plague Inc.-style ripples) --- */
  const drawEventAnimations = useCallback(
    (c2d, w, h) => {
      if (!eventAnimations || eventAnimations.length === 0) return;
      const now = Date.now();
      const worldWidth = Math.pow(2, zoomRef.current) * TILE_SIZE;
      const wrapOffsets = getWrapOffsets(worldWidth, panRef.current.x, w);

      eventAnimations.forEach((anim) => {
        const elapsed = now - anim.startTime;
        if (elapsed > anim.duration) return;

        const progress = elapsed / anim.duration;
        const color = CATEGORY_COLORS[anim.category] || '#ffffff';
        const pt = latLngToScreen(anim.lat, anim.lng);

        for (const offsetX of wrapOffsets) {
          const sx = pt.x + offsetX;
          if (sx < -100 || sx > w + 100 || pt.y < -100 || pt.y > h + 100) continue;

          // Draw expanding ripple rings
          for (let ring = 0; ring < anim.rings; ring++) {
            const ringDelay = ring * 0.15;
            const ringProgress = Math.max(0, (progress - ringDelay) / (1 - ringDelay));
            if (ringProgress <= 0 || ringProgress >= 1) continue;

            const maxRadius = anim.impact === 'high' ? 80 : anim.impact === 'medium' ? 60 : 40;
            const radius = ringProgress * maxRadius;
            const opacity = (1 - ringProgress) * 0.6;

            // Ripple ring
            c2d.beginPath();
            c2d.arc(sx, pt.y, radius, 0, Math.PI * 2);
            c2d.strokeStyle = color.replace(')', `,${opacity})`).replace('rgb', 'rgba');
            c2d.lineWidth = 2 * (1 - ringProgress);
            c2d.stroke();

            // Inner glow fill
            if (ringProgress < 0.5) {
              c2d.beginPath();
              c2d.arc(sx, pt.y, radius, 0, Math.PI * 2);
              c2d.fillStyle = color.replace(')', `,${opacity * 0.15})`).replace('rgb', 'rgba');
              c2d.fill();
            }
          }

          // Central flash effect
          if (progress < 0.3) {
            const flashOpacity = (1 - progress / 0.3) * 0.8;
            const flashRadius = 12 + progress * 20;
            c2d.beginPath();
            c2d.arc(sx, pt.y, flashRadius, 0, Math.PI * 2);
            c2d.fillStyle = `rgba(255,255,255,${flashOpacity})`;
            c2d.fill();
          }

          // Impact lines radiating outward (for high impact events)
          if (anim.impact === 'high' && progress < 0.6) {
            const lineProgress = progress / 0.6;
            const lineOpacity = (1 - lineProgress) * 0.5;
            const lineLen = lineProgress * 60;
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
              c2d.beginPath();
              c2d.moveTo(sx + Math.cos(angle) * 10, pt.y + Math.sin(angle) * 10);
              c2d.lineTo(sx + Math.cos(angle) * (10 + lineLen), pt.y + Math.sin(angle) * (10 + lineLen));
              c2d.strokeStyle = color.replace(')', `,${lineOpacity})`).replace('rgb', 'rgba');
              c2d.lineWidth = 1.5;
              c2d.stroke();
            }
          }
        }
      });
    },
    [eventAnimations, latLngToScreen],
  );

  /* --- World overview overlay is now an HTML element (see JSX below) --- */

  /* --- Main render loop --- */
  useEffect(() => {
    if (!panRef.current) initPan();

    const renderFn = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const c2d = canvas.getContext('2d');
      const { width, height } = sizeRef.current;

      canvas.width = width;
      canvas.height = height;

      // Clamp pan before rendering to prevent blue beyond map
      clampPan();

      // Background - use a dark grey instead of blue to reduce visual artifact when map edges barely show
      c2d.fillStyle = '#1a1a2e';
      c2d.fillRect(0, 0, width, height);

      // Tiles
      drawTiles(c2d, width, height);

      // Cities
      pulseRef.current += 1;
      drawCities(c2d, width, height, pulseRef.current);

      // Event markers
      drawEventMarkers(c2d, width, height, pulseRef.current);

      // News markers on map
      drawNewsMarkers(c2d, width, height);

      // Causal interaction lines (only latest iteration)
      drawCausalLines(c2d, width, height);

      // Event animations (Plague Inc.-style ripples)
      drawEventAnimations(c2d, width, height);

      // Zoom indicator
      c2d.fillStyle = 'rgba(0,0,0,0.5)';
      c2d.fillRect(8, height - 28, 80, 20);
      c2d.fillStyle = '#fff';
      c2d.font = '11px monospace';
      c2d.fillText(`Zoom: ${zoomRef.current}`, 14, height - 13);

      // Update popup position to follow map pan/zoom
      const popupEl = mapPopupElRef.current;
      const popupData = mapPopupRef.current;
      if (popupEl && popupData && popupData.lat != null && popupData.lng != null) {
        const pt = latLngToScreen(popupData.lat, popupData.lng);
        const popupW = 280, popupH = 220;
        let left = pt.x + 15, top = pt.y - popupH / 2;
        if (left + popupW > width) left = pt.x - popupW - 15;
        if (top < 10) top = 10;
        if (top + popupH > height - 10) top = height - popupH - 10;
        popupEl.style.left = left + 'px';
        popupEl.style.top = top + 'px';
      }

      animFrameRef.current = requestAnimationFrame(renderFn);
    };

    animFrameRef.current = requestAnimationFrame(renderFn);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [drawTiles, drawCities, drawEventMarkers, drawNewsMarkers, drawCausalLines, drawEventAnimations, initPan, clampPan, latLngToScreen]);

  /* --- ResizeObserver --- */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          sizeRef.current = { width, height };
        }
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  /* --- Hit testing --- */
  const findCityAtPos = useCallback(
    (mx, my) => {
      const worldWidth = Math.pow(2, zoomRef.current) * TILE_SIZE;
      const { width } = sizeRef.current;
      const wrapOffsets = getWrapOffsets(worldWidth, panRef.current.x, width);
      for (let i = WORLD_CITIES.length - 1; i >= 0; i--) {
        const city = WORLD_CITIES[i];
        const pt = latLngToScreen(city.lat, city.lng);
        const hitRadius = city.pop === 'mega' ? 10 : city.pop === 'large' ? 8 : 7;
        for (const offsetX of wrapOffsets) {
          const dx = mx - (pt.x + offsetX);
          const dy = my - pt.y;
          if (dx * dx + dy * dy < hitRadius * hitRadius) return city;
        }
      }
      return null;
    },
    [latLngToScreen],
  );

  const findEventAtPos = useCallback(
    (mx, my) => {
      const worldWidth = Math.pow(2, zoomRef.current) * TILE_SIZE;
      const { width } = sizeRef.current;
      const wrapOffsets = getWrapOffsets(worldWidth, panRef.current.x, width);
      for (let i = events.length - 1; i >= 0; i--) {
        const evt = events[i];
        const pt = latLngToScreen(evt.lat, evt.lng);
        for (const offsetX of wrapOffsets) {
          const dx = mx - (pt.x + offsetX);
          const dy = my - pt.y;
          if (dx * dx + dy * dy < 144) return evt;
        }
      }
      return null;
    },
    [events, latLngToScreen],
  );

  // Hit-test for edges using cached edge geometries
  const findEdgeAtPos = useCallback((mx, my) => {
    const geos = edgeGeoRef.current;
    const hitThreshold = 10; // pixels
    for (let i = geos.length - 1; i >= 0; i--) {
      const g = geos[i];
      // Sample points along the quadratic Bézier and check distance
      const steps = Math.max(8, Math.floor(g.dist / 15));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const px = (1 - t) * (1 - t) * g.fx + 2 * (1 - t) * t * g.cpx + t * t * g.tx;
        const py = (1 - t) * (1 - t) * g.fy + 2 * (1 - t) * t * g.cpy + t * t * g.ty;
        const dx = mx - px;
        const dy = my - py;
        if (dx * dx + dy * dy < hitThreshold * hitThreshold) {
          return {
            fromId: g.fromEvt.id,
            toId: g.toEvt.id,
            fromEvt: g.fromEvt,
            toEvt: g.toEvt,
            label: g.label,
          };
        }
      }
    }
    return null;
  }, []);

  // Hit-test for news markers
  const findNewsAtPos = useCallback(
    (mx, my) => {
      if (!latestNews || latestNews.length === 0) return null;
      const worldWidth = Math.pow(2, zoomRef.current) * TILE_SIZE;
      const { width } = sizeRef.current;
      const wrapOffsets = getWrapOffsets(worldWidth, panRef.current.x, width);
      for (let i = latestNews.length - 1; i >= 0; i--) {
        const news = latestNews[i];
        if (news.lat == null || news.lng == null) continue;
        const pt = latLngToScreen(news.lat, news.lng);
        for (const offsetX of wrapOffsets) {
          const dx = mx - (pt.x + offsetX);
          const dy = my - pt.y;
          if (dx * dx + dy * dy < 144) return news;
        }
      }
      return null;
    },
    [latestNews, latLngToScreen],
  );

  /* --- Mouse handlers --- */
  const handleMouseDown = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    dragRef.current = {
      dragging: true,
      startX: mx,
      startY: my,
      panStartX: panRef.current.x,
      panStartY: panRef.current.y,
    };
  }, []);

  const handleMouseMove = useCallback(
    (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (dragRef.current.dragging) {
        const dx = mx - dragRef.current.startX;
        const dy = my - dragRef.current.startY;
        panRef.current.x = dragRef.current.panStartX - dx;
        panRef.current.y = dragRef.current.panStartY - dy;
        clampPan();
      } else {
        const city = findCityAtPos(mx, my);
        hoveredCityRef.current = city;
        const evt = findEventAtPos(mx, my);
        setHoveredEvent(evt);
        const news = !city && !evt ? findNewsAtPos(mx, my) : null;
        const edge = !city && !evt && !news ? findEdgeAtPos(mx, my) : null;
        if (canvasRef.current) {
          canvasRef.current.style.cursor = city || evt || news || edge ? 'pointer' : 'grab';
        }
      }
    },
    [clampPan, findCityAtPos, findEventAtPos, findNewsAtPos, findEdgeAtPos, setHoveredEvent],
  );

  const handleMouseUp = useCallback(
    (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const wasDrag =
        dragRef.current.dragging &&
        (Math.abs(mx - dragRef.current.startX) > 3 || Math.abs(my - dragRef.current.startY) > 3);

      dragRef.current.dragging = false;

      if (!wasDrag) {
        // Helper to compute initial popup screen position from screen coords
        const computePopupPos = (px, py) => {
          const { width: cw, height: ch } = sizeRef.current;
          const popupW = 280, popupH = 220;
          let left = px + 15, top = py - popupH / 2;
          if (left + popupW > cw) left = px - popupW - 15;
          if (top < 10) top = 10;
          if (top + popupH > ch - 10) top = ch - popupH - 10;
          return { left, top };
        };
        const evt = findEventAtPos(mx, my);
        if (evt) {
          setSelectedEvent(evt);
          setSelectedEdge(null);
          setSelectedNews(null);
          const pt = latLngToScreen(evt.lat, evt.lng);
          const initPos = computePopupPos(pt.x, pt.y);
          setMapPopup({ lat: evt.lat, lng: evt.lng, type: 'event', data: evt, ...initPos });
        } else {
          const edge = findEdgeAtPos(mx, my);
          if (edge) {
            setSelectedEdge(edge);
            setSelectedEvent(null);
            setSelectedNews(null);
            const midLat = (edge.fromEvt.lat + edge.toEvt.lat) / 2;
            const midLng = (edge.fromEvt.lng + edge.toEvt.lng) / 2;
            const pt = latLngToScreen(midLat, midLng);
            const initPos = computePopupPos(pt.x, pt.y);
            setMapPopup({ lat: midLat, lng: midLng, type: 'edge', data: edge, ...initPos });
          } else {
            const news = findNewsAtPos(mx, my);
            if (news) {
              setSelectedNews(news);
              setSelectedEvent(null);
              setSelectedEdge(null);
              const pt = latLngToScreen(news.lat, news.lng);
              const initPos = computePopupPos(pt.x, pt.y);
              setMapPopup({ lat: news.lat, lng: news.lng, type: 'news', data: news, ...initPos });
            } else {
              setSelectedEvent(null);
              setSelectedEdge(null);
              setSelectedNews(null);
              setMapPopup(null);
            }
          }
        }
      }
    },
    [findEventAtPos, findEdgeAtPos, findNewsAtPos, latLngToScreen, setSelectedEvent, setSelectedEdge],
  );

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const oldZoom = zoomRef.current;
    const newZoom = e.deltaY > 0 ? Math.max(MIN_ZOOM, oldZoom - 1) : Math.min(MAX_ZOOM, oldZoom + 1);
    if (newZoom === oldZoom) return;

    // Zoom toward cursor: keep the world-coordinate under the cursor fixed
    const worldX = panRef.current.x + mx;
    const worldY = panRef.current.y + my;
    const scale = Math.pow(2, newZoom - oldZoom);
    panRef.current.x = worldX * scale - mx;
    panRef.current.y = worldY * scale - my;
    zoomRef.current = newZoom;
    clampPan();
  }, [clampPan]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleMouseLeave = useCallback(() => {
    dragRef.current.dragging = false;
    hoveredCityRef.current = null;
    setHoveredEvent(null);
  }, [setHoveredEvent]);

  // Whether the HTML overlay on the canvas is collapsed
  const [overlayCollapsed, setOverlayCollapsed] = useState(false);

  const hasOverlayContent = worldState || (keyTrends && keyTrends.length > 0) || analysis;

  return (
    <div className="real-world-container">
      <div className="real-world-header">
        <span className="real-world-title">🌐 现实世界推演</span>
        <span className="real-world-gen">第 {generation} 轮</span>
      </div>
      <div className="real-world-canvas-container" ref={containerRef} style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          className="real-world-canvas"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        />
        {/* HTML world overview overlay (top-left corner, scrollable) */}
        {hasOverlayContent && (
          <div className="novel-detail-overlay real-world-overlay-panel">
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: overlayCollapsed ? 0 : 6, cursor: 'pointer' }}
              onClick={() => setOverlayCollapsed(!overlayCollapsed)}
            >
              <span style={{ fontWeight: 'bold', fontSize: 12, color: '#fff' }}>🌍 世界状态</span>
              <span style={{ fontSize: 10, color: '#888' }}>{overlayCollapsed ? '▸' : '▾'}</span>
            </div>
            {!overlayCollapsed && (
              <div style={{ fontSize: 11 }}>
                {/* World state indicators */}
                {worldState && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ color: TENSION_COLORS[worldState.tension_level] || '#ff9800', fontWeight: 'bold' }}>
                        ⚡ 紧张程度: {worldState.tension_level}
                      </span>
                      <span style={{ color: ECON_COLORS[worldState.economic_outlook] || '#ffc107', fontWeight: 'bold' }}>
                        📊 经济展望: {worldState.economic_outlook}
                      </span>
                    </div>
                    {worldState.hot_regions && worldState.hot_regions.length > 0 && (
                      <div style={{ color: '#ff7043', marginBottom: 2 }}>
                        🔥 热点: {worldState.hot_regions.join('、')}
                      </div>
                    )}
                    {worldState.summary && worldState.summary !== '世界局势初始状态' && (
                      <div style={{ color: '#b0bec5', lineHeight: '1.4' }}>{worldState.summary}</div>
                    )}
                  </div>
                )}

                {/* Key trends */}
                {keyTrends && keyTrends.length > 0 && (
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ fontWeight: 'bold', color: '#9cdcfe', marginBottom: 4 }}>📈 关键趋势 ({keyTrends.length})</div>
                    {keyTrends.map((t, i) => (
                      <div key={i} style={{ color: '#aaa', padding: '1px 0' }}>• {t}</div>
                    ))}
                  </div>
                )}

                {/* Analysis summary */}
                {analysis && (
                  <div>
                    <div style={{ fontWeight: 'bold', color: '#ce9178', marginBottom: 4 }}>📊 分析摘要</div>
                    <div style={{ color: '#ccc', lineHeight: '1.4' }}>{analysis}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* Map popup overlay: detail info near clicked item */}
        {mapPopup && (
          <div
            ref={mapPopupElRef}
            className="real-world-map-popup"
            style={{ position: 'absolute', left: mapPopup.left || 0, top: mapPopup.top || 0, zIndex: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 'bold', fontSize: 12, color: '#fff' }}>
                {mapPopup.type === 'event' && (mapPopup.data.fromNews ? '📰 新闻事件' : '📌 事件详情')}
                {mapPopup.type === 'edge' && '🔗 关联详情'}
                {mapPopup.type === 'news' && '📰 新闻详情'}
              </span>
              <span
                style={{ cursor: 'pointer', color: '#888', fontSize: 14, lineHeight: 1 }}
                onClick={() => setMapPopup(null)}
              >✕</span>
            </div>
            {mapPopup.type === 'event' && (() => {
              const evt = mapPopup.data;
              return (
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: CATEGORY_COLORS[evt.category] || '#fff', marginBottom: 2 }}>
                    {CATEGORY_ICONS[evt.category] || '📌'} {evt.category} · {evt.region}/{evt.country}
                  </div>
                  <div style={{ color: '#ccc', lineHeight: '1.4', marginBottom: 4 }}>{evt.text}</div>
                  <div style={{ color: '#888', fontSize: 10 }}>
                    影响: <span style={{ color: IMPACT_COLORS[evt.impact] }}>{evt.impact}</span>
                    {' · '}趋势: {evt.trend}
                    {' · '}城市: {evt.city || '未知'}
                  </div>
                  {evt.cause_label && (
                    <div style={{ color: '#9cdcfe', fontSize: 10, marginTop: 2 }}>因果: {evt.cause_label}</div>
                  )}
                </div>
              );
            })()}
            {mapPopup.type === 'edge' && (() => {
              const edge = mapPopup.data;
              return (
                <div style={{ fontSize: 11 }}>
                  {edge.label && (
                    <div style={{ color: '#ff9800', marginBottom: 4 }}>🔗 {edge.label}</div>
                  )}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ color: '#aaa', fontSize: 10 }}>起始事件:</div>
                    <div style={{ color: '#ccc' }}>{CATEGORY_ICONS[edge.fromEvt.category] || '📌'} {edge.fromEvt.text.slice(0, 60)}{edge.fromEvt.text.length > 60 ? '…' : ''}</div>
                  </div>
                  <div>
                    <div style={{ color: '#aaa', fontSize: 10 }}>关联事件:</div>
                    <div style={{ color: '#ccc' }}>{CATEGORY_ICONS[edge.toEvt.category] || '📌'} {edge.toEvt.text.slice(0, 60)}{edge.toEvt.text.length > 60 ? '…' : ''}</div>
                  </div>
                </div>
              );
            })()}
            {mapPopup.type === 'news' && (() => {
              const news = mapPopup.data;
              return (
                <div style={{ fontSize: 11 }}>
                  <div style={{ color: '#4fc3f7', fontWeight: 'bold', marginBottom: 2 }}>{news.title}</div>
                  {news.description && (
                    <div style={{ color: '#ccc', lineHeight: '1.4', marginBottom: 4 }}>{news.description}</div>
                  )}
                  <div style={{ color: '#888', fontSize: 10 }}>
                    来源: {news.source}
                    {news.date && ` · ${news.date}`}
                    {news.cityName && ` · 📍 ${news.cityName}`}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
});

/* ================================================================
   Info Component: RealWorldInfo
   ================================================================ */

const RealWorldInfo = memo(function RealWorldInfo() {
  const ctx = useContext(RealWorldPredictorContext);
  const {
    events,
    isRunning,
    generation,
    autoMode,
    analysis,
    predictions,
    keyTrends,
    selectedEvent,
    selectedEdge,
    regionFilter,
    log,
    latestNews,
    isFetchingNews,
    archives,
    selectedArchive,
    eventSeed,
    traceResult,
    isTracing,
    worldState,
    chatTarget,
    chatMessages,
    isChatting,
    chatInputRef,
    newsCount,
    selectedNewsSources,
    setNewsCount,
    setSelectedNewsSources,
    setSelectedArchive,
    deleteArchive,
    setAutoMode,
    setSelectedEvent,
    setSelectedEdge,
    setRegionFilter,
    setEventSeed,
    setChatTarget,
    setChatMessages,
    chatWithCountry,
    runStep,
    reset,
    traceEventCause,
    fetchLatestNews,
  } = ctx;

  const regions = useMemo(() => {
    const set = new Set();
    events.forEach((e) => {
      if (e.region) set.add(e.region);
    });
    return Array.from(set);
  }, [events]);

  const countries = useMemo(() => {
    const set = new Set();
    events.forEach((e) => {
      if (e.country) set.add(e.country);
    });
    return Array.from(set);
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (regionFilter === 'all') return events;
    return events.filter((e) => e.region === regionFilter);
  }, [events, regionFilter]);

  const [expandedSections, setExpandedSections] = useState({
    worldState: true, newsSettings: false, news: false, events: true, eventDetail: true,
    trace: false, edgeDetail: true, analysis: false, trends: false,
    predictions: false, chat: true, log: false, archives: false, archiveDetail: false
  });
  const toggleSection = useCallback((key) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Toggle a single news source
  const toggleNewsSource = useCallback((key) => {
    setSelectedNewsSources(prev => {
      if (prev.includes(key)) {
        return prev.filter(s => s !== key);
      }
      return [...prev, key];
    });
  }, [setSelectedNewsSources]);

  return (
    <>
      {/* Controls */}
      <div className="real-world-controls">
        <button
          className={`real-world-btn primary ${isRunning ? 'running' : ''}`}
          onClick={() => runStep()}
          disabled={isRunning || isFetchingNews}
        >
          {isRunning ? '⏳ 推演中...' : '▶ 推演'}
        </button>
        <button className={`real-world-btn ${autoMode ? 'active' : ''}`} onClick={() => setAutoMode(!autoMode)}>
          🔄 自动
        </button>
        <button
          className={`real-world-btn ${isFetchingNews ? 'running' : ''} ${latestNews.length > 0 ? 'active' : ''}`}
          onClick={() => fetchLatestNews()}
          disabled={isRunning || isFetchingNews}
          title="获取最新新闻，获取后会显示在地图画布上，然后可手动点击推演"
        >
          {isFetchingNews ? '⏳ 获取中...' : '🌐 获取新闻'}
        </button>
        <button className="real-world-btn" onClick={reset}>
          🗑️ 清空
        </button>
        <span className="real-world-gen-counter">轮次: {generation}</span>
      </div>

      {/* Event Seed */}
      <div className="real-world-controls" style={{ paddingTop: 0 }}>
        <input
          type="text"
          placeholder="事件种子 (如: 中东冲突升级, AI技术突破...)"
          value={eventSeed}
          onChange={e => setEventSeed(e.target.value)}
          style={{
            flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 12, outline: 'none',
          }}
        />
      </div>

      {/* Region Filter */}
      <div className="real-world-filter">
        <select className="real-world-select" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
          <option value="all">🌍 所有地区</option>
          {regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      <div className="novel-scrollable-area">
        {/* World State */}
        {generation > 0 && worldState && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('worldState')}>
              <span className="novel-section-arrow">{expandedSections.worldState ? '▾' : '▸'}</span>
              <h4>🌍 世界状态</h4>
            </div>
            {expandedSections.worldState && (
              <div className="novel-section-body">
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11, padding: '4px 0' }}>
                  <span style={{ color: TENSION_COLORS[worldState.tension_level] || '#ff9800' }}>
                    ⚡{worldState.tension_level}
                  </span>
                  <span style={{ color: ECON_COLORS[worldState.economic_outlook] || '#ffc107' }}>
                    📊{worldState.economic_outlook}
                  </span>
                  {worldState.hot_regions.length > 0 && (
                    <span style={{ color: '#ff7043' }}>🔥{worldState.hot_regions.slice(0, 2).join('、')}</span>
                  )}
                </div>
                {worldState.summary !== '世界局势初始状态' && (
                  <div style={{ fontSize: 10, color: '#aaa', padding: '2px 0' }}>{worldState.summary}</div>
                )}
              </div>
            )}
          </>
        )}

        {/* News Settings */}
        <div className="novel-section-header" onClick={() => toggleSection('newsSettings')}>
          <span className="novel-section-arrow">{expandedSections.newsSettings ? '▾' : '▸'}</span>
          <h4>📰 新闻设置</h4>
        </div>
        {expandedSections.newsSettings && (
          <div className="novel-section-body">
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>
                每个源获取数量: {newsCount}
              </div>
              <input
                type="range"
                min={1}
                max={20}
                value={newsCount}
                onChange={e => setNewsCount(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#4fc3f7' }}
              />
            </div>
            <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>新闻源选择:</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {NEWS_SOURCES.map(src => (
                <label
                  key={src.key}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 3,
                    fontSize: 10, color: selectedNewsSources.includes(src.key) ? '#4fc3f7' : '#666',
                    cursor: 'pointer', padding: '2px 6px', borderRadius: 3,
                    background: selectedNewsSources.includes(src.key) ? 'rgba(79,195,247,0.1)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${selectedNewsSources.includes(src.key) ? 'rgba(79,195,247,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedNewsSources.includes(src.key)}
                    onChange={() => toggleNewsSource(src.key)}
                    style={{ width: 12, height: 12, accentColor: '#4fc3f7' }}
                  />
                  {src.label}
                </label>
              ))}
            </div>
          </div>
        )}

        {/* News Seed */}
        {latestNews.length > 0 && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('news')}>
              <span className="novel-section-arrow">{expandedSections.news ? '▾' : '▸'}</span>
              <h4>🌐 新闻种子</h4>
              <span className="novel-section-badge">{latestNews.length}</span>
            </div>
            {expandedSections.news && (
              <div className="novel-section-body">
                <div className="real-world-event-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {latestNews.map((n, i) => (
                    <div key={i} className="real-world-event-item" style={{ padding: '4px 8px' }}>
                      <div style={{ fontSize: 10, color: '#888' }}>[{n.source}]</div>
                      <div style={{ fontSize: 11, color: '#ccc' }}>{n.title}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Event List */}
        <div className="novel-section-header" onClick={() => toggleSection('events')}>
          <span className="novel-section-arrow">{expandedSections.events ? '▾' : '▸'}</span>
          <h4>📋 事件列表</h4>
          {filteredEvents.length > 0 && <span className="novel-section-badge">{filteredEvents.length}</span>}
        </div>
        {expandedSections.events && (
          <div className="novel-section-body">
            <div className="real-world-event-list">
              {filteredEvents.length === 0 ? (
                <div className="real-world-empty">点击&quot;推演&quot;按钮开始推演事件</div>
              ) : (
                filteredEvents
                  .slice()
                  .reverse()
                  .map((evt) => (
                    <div
                      key={evt.id}
                      className={`real-world-event-item ${selectedEvent && selectedEvent.id === evt.id ? 'selected' : ''}`}
                      onClick={() => setSelectedEvent(evt)}
                    >
                      <div className="real-world-event-header">
                        <span className="real-world-event-icon">{CATEGORY_ICONS[evt.category] || '📌'}</span>
                        <span className="real-world-event-region">
                          {evt.region}/{evt.country}
                        </span>
                        <span className="real-world-event-impact" style={{ color: IMPACT_COLORS[evt.impact] }}>
                          {evt.impact === 'high' ? '🔴' : evt.impact === 'medium' ? '🟡' : '🟢'}
                        </span>
                      </div>
                      <div className="real-world-event-text">{evt.text}</div>
                      <div className="real-world-event-meta">
                        <span className="real-world-event-category" style={{ color: CATEGORY_COLORS[evt.category] }}>
                          {evt.category}
                        </span>
                        <span className="real-world-event-trend">趋势: {evt.trend}</span>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>
        )}

        {/* Event Detail */}
        {selectedEvent && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('eventDetail')}>
              <span className="novel-section-arrow">{expandedSections.eventDetail ? '▾' : '▸'}</span>
              <h4>📍 事件详情</h4>
            </div>
            {expandedSections.eventDetail && (
              <div className="novel-section-body">
                <div className="real-world-detail">
                  <div className="real-world-detail-row">
                    <span className="real-world-detail-label">地区:</span>
                    <span>
                      {selectedEvent.region} / {selectedEvent.country}
                    </span>
                  </div>
                  <div className="real-world-detail-row">
                    <span className="real-world-detail-label">类别:</span>
                    <span style={{ color: CATEGORY_COLORS[selectedEvent.category] }}>
                      {CATEGORY_ICONS[selectedEvent.category]} {selectedEvent.category}
                    </span>
                  </div>
                  <div className="real-world-detail-row">
                    <span className="real-world-detail-label">影响:</span>
                    <span style={{ color: IMPACT_COLORS[selectedEvent.impact] }}>{selectedEvent.impact}</span>
                  </div>
                  <div className="real-world-detail-row">
                    <span className="real-world-detail-label">趋势:</span>
                    <span>{selectedEvent.trend}</span>
                  </div>
                  <div className="real-world-detail-row">
                    <span className="real-world-detail-label">坐标:</span>
                    <span>
                      {selectedEvent.lat.toFixed(1)}, {selectedEvent.lng.toFixed(1)}
                    </span>
                  </div>
                  <div className="real-world-detail-text">{selectedEvent.text}</div>
                  <button
                    className={`real-world-btn primary ${isTracing ? 'running' : ''}`}
                    onClick={() => traceEventCause(selectedEvent)}
                    disabled={isTracing}
                    style={{ marginTop: 8, width: '100%' }}
                  >
                    {isTracing ? '⏳ 溯源中...' : '🔍 事件溯源'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Trace Result */}
        {traceResult && selectedEvent && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('trace')}>
              <span className="novel-section-arrow">{expandedSections.trace ? '▾' : '▸'}</span>
              <h4>🔍 事件溯源</h4>
            </div>
            {expandedSections.trace && (
              <div className="novel-section-body">
                {traceResult.summary && (
                  <div className="real-world-analysis-text" style={{ marginBottom: 8 }}>{traceResult.summary}</div>
                )}
                {traceResult.root_causes && traceResult.root_causes.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: '#ff9800', fontWeight: 'bold', marginBottom: 4 }}>根本原因:</div>
                    {traceResult.root_causes.map((cause, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#ccc', padding: '2px 8px' }}>• {cause}</div>
                    ))}
                  </div>
                )}
                {traceResult.causal_chain && traceResult.causal_chain.length > 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 10, color: '#4fc3f7', fontWeight: 'bold', marginBottom: 4 }}>因果链条:</div>
                    {traceResult.causal_chain.map((step, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#ccc', padding: '3px 8px', borderLeft: '2px solid #4fc3f7', marginLeft: 4, marginBottom: 2 }}>
                        <span style={{ color: '#4fc3f7', fontWeight: 'bold' }}>第{step.step}步</span>
                        {step.time_frame && <span style={{ color: '#888', fontSize: 10 }}> ({step.time_frame})</span>}
                        <div style={{ marginTop: 2 }}>{step.event}</div>
                      </div>
                    ))}
                  </div>
                )}
                {traceResult.key_actors && traceResult.key_actors.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, color: '#9cdcfe', fontWeight: 'bold', marginBottom: 4 }}>关键参与方:</div>
                    <div style={{ fontSize: 11, color: '#ccc', padding: '2px 8px' }}>
                      {traceResult.key_actors.join('、')}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Edge Detail */}
        {selectedEdge && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('edgeDetail')}>
              <span className="novel-section-arrow">{expandedSections.edgeDetail ? '▾' : '▸'}</span>
              <h4>🔗 关联事件详情</h4>
              <button
                className="real-world-btn"
                style={{ padding: '1px 6px', fontSize: 10, lineHeight: '16px', marginLeft: 'auto' }}
                onClick={(e) => { e.stopPropagation(); setSelectedEdge(null); }}
              >✕</button>
            </div>
            {expandedSections.edgeDetail && (
              <div className="novel-section-body">
                <div className="real-world-detail">
                  {selectedEdge.label && (
                    <div style={{ padding: '6px 8px', background: 'rgba(255,213,79,0.1)', borderRadius: 4, marginBottom: 8, borderLeft: '3px solid #ffd54f' }}>
                      <div style={{ fontSize: 10, color: '#ffd54f', fontWeight: 'bold', marginBottom: 2 }}>关联原因</div>
                      <div style={{ fontSize: 12, color: '#fff' }}>{selectedEdge.label}</div>
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: '#9cdcfe', fontWeight: 'bold', marginBottom: 4 }}>起因事件</div>
                  <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4, marginBottom: 8 }}>
                    <div className="real-world-event-header" style={{ marginBottom: 2 }}>
                      <span className="real-world-event-icon">{CATEGORY_ICONS[selectedEdge.fromEvt.category] || '📌'}</span>
                      <span className="real-world-event-region">{selectedEdge.fromEvt.region}/{selectedEdge.fromEvt.country}</span>
                      <span className="real-world-event-impact" style={{ color: IMPACT_COLORS[selectedEdge.fromEvt.impact] }}>
                        {selectedEdge.fromEvt.impact === 'high' ? '🔴' : selectedEdge.fromEvt.impact === 'medium' ? '🟡' : '🟢'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#ccc' }}>{selectedEdge.fromEvt.text}</div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                      <span style={{ color: CATEGORY_COLORS[selectedEdge.fromEvt.category] }}>{selectedEdge.fromEvt.category}</span>
                      {' · '}趋势: {selectedEdge.fromEvt.trend}
                      {' · '}城市: {selectedEdge.fromEvt.city || '未知'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'center', fontSize: 14, color: '#666', margin: '2px 0' }}>⬇️</div>
                  <div style={{ fontSize: 10, color: '#ff9800', fontWeight: 'bold', marginBottom: 4 }}>结果事件</div>
                  <div style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 4, marginBottom: 4 }}>
                    <div className="real-world-event-header" style={{ marginBottom: 2 }}>
                      <span className="real-world-event-icon">{CATEGORY_ICONS[selectedEdge.toEvt.category] || '📌'}</span>
                      <span className="real-world-event-region">{selectedEdge.toEvt.region}/{selectedEdge.toEvt.country}</span>
                      <span className="real-world-event-impact" style={{ color: IMPACT_COLORS[selectedEdge.toEvt.impact] }}>
                        {selectedEdge.toEvt.impact === 'high' ? '🔴' : selectedEdge.toEvt.impact === 'medium' ? '🟡' : '🟢'}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#ccc' }}>{selectedEdge.toEvt.text}</div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                      <span style={{ color: CATEGORY_COLORS[selectedEdge.toEvt.category] }}>{selectedEdge.toEvt.category}</span>
                      {' · '}趋势: {selectedEdge.toEvt.trend}
                      {' · '}城市: {selectedEdge.toEvt.city || '未知'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                    <button
                      className="real-world-btn"
                      style={{ flex: 1, fontSize: 10 }}
                      onClick={() => { setSelectedEvent(selectedEdge.fromEvt); setSelectedEdge(null); }}
                    >
                      📍 查看起因事件
                    </button>
                    <button
                      className="real-world-btn"
                      style={{ flex: 1, fontSize: 10 }}
                      onClick={() => { setSelectedEvent(selectedEdge.toEvt); setSelectedEdge(null); }}
                    >
                      📍 查看结果事件
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Analysis */}
        {analysis && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('analysis')}>
              <span className="novel-section-arrow">{expandedSections.analysis ? '▾' : '▸'}</span>
              <h4>📊 推演分析</h4>
            </div>
            {expandedSections.analysis && (
              <div className="novel-section-body">
                <div className="real-world-analysis-text">{analysis}</div>
              </div>
            )}
          </>
        )}

        {/* Trends */}
        {keyTrends.length > 0 && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('trends')}>
              <span className="novel-section-arrow">{expandedSections.trends ? '▾' : '▸'}</span>
              <h4>📈 关键趋势</h4>
              <span className="novel-section-badge">{keyTrends.length}</span>
            </div>
            {expandedSections.trends && (
              <div className="novel-section-body">
                <div className="real-world-trends">
                  {keyTrends.map((trend, i) => (
                    <div key={i} className="real-world-trend-item">
                      • {trend}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Predictions */}
        {predictions.length > 0 && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('predictions')}>
              <span className="novel-section-arrow">{expandedSections.predictions ? '▾' : '▸'}</span>
              <h4>🔮 预测</h4>
              <span className="novel-section-badge">{predictions.length}</span>
            </div>
            {expandedSections.predictions && (
              <div className="novel-section-body">
                <div className="real-world-predictions">
                  {predictions.map((pred, i) => (
                    <div key={i} className="real-world-prediction-item">
                      {i + 1}. {pred}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Chat */}
        <div className="novel-section-header" onClick={() => toggleSection('chat')}>
          <span className="novel-section-arrow">{expandedSections.chat ? '▾' : '▸'}</span>
          <h4>🎤 国家采访</h4>
        </div>
        {expandedSections.chat && (
          <div className="novel-section-body">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              {chatTarget && (
                <button
                  className="real-world-btn"
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => { setChatTarget(null); setChatMessages([]); }}
                >✕ 结束采访</button>
              )}
            </div>
            {!chatTarget ? (
              <>
                <div style={{ fontSize: 11, color: '#888', padding: '4px 0' }}>
                  {countries.length > 0
                    ? '选择一个国家进行采访，了解其对当今世界局势的看法'
                    : '请先运行推演以生成事件，然后即可采访相关国家'}
                </div>
                {countries.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 0' }}>
                    {countries.map(c => (
                      <button
                        key={c}
                        className="real-world-btn"
                        style={{ fontSize: 10, padding: '2px 6px' }}
                        onClick={() => { setChatTarget(c); setChatMessages([]); }}
                      >🏳️ {c}</button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: '#9cdcfe', marginBottom: 4 }}>
                  正在采访 🏳️ {chatTarget} 代表
                </div>
                <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 6 }}>
                  {chatMessages.map((msg, i) => (
                    <div key={i} style={{
                      fontSize: 11, padding: '3px 6px', marginBottom: 2,
                      borderRadius: 4,
                      background: msg.role === 'user' ? 'rgba(33,150,243,0.15)' : 'rgba(156,39,176,0.15)',
                      color: msg.role === 'user' ? '#90caf9' : '#ce93d8',
                      textAlign: msg.role === 'user' ? 'right' : 'left',
                    }}>
                      {msg.role === 'user' ? '记者' : chatTarget}: {msg.content}
                      {msg.meta && <div style={{ fontSize: 9, color: '#888', marginTop: 2 }}>{msg.meta}</div>}
                    </div>
                  ))}
                  {isChatting && (
                    <div style={{
                      fontSize: 11, padding: '3px 6px', marginBottom: 2,
                      borderRadius: 4, background: 'rgba(156,39,176,0.10)',
                      color: '#ce93d8', textAlign: 'left',
                      animation: 'pulse 1.5s ease-in-out infinite',
                    }}>
                      {chatTarget}: 正在组织回应...
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    type="text"
                    ref={chatInputRef}
                    placeholder={`向${chatTarget}提问...`}
                    style={{
                      flex: 1, padding: '4px 8px', borderRadius: 4,
                      border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(255,255,255,0.06)', color: '#ccc', fontSize: 11, outline: 'none',
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        chatWithCountry(chatTarget, e.target.value.trim());
                        e.target.value = '';
                      }
                    }}
                    disabled={isChatting}
                  />
                  <button
                    className="real-world-btn primary"
                    style={{ fontSize: 10, padding: '3px 8px' }}
                    disabled={isChatting}
                    onClick={() => {
                      const input = chatInputRef.current;
                      if (input && input.value.trim()) {
                        chatWithCountry(chatTarget, input.value.trim());
                        input.value = '';
                      }
                    }}
                  >{isChatting ? '⏳' : '提问'}</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Log */}
        <div className="novel-section-header" onClick={() => toggleSection('log')}>
          <span className="novel-section-arrow">{expandedSections.log ? '▾' : '▸'}</span>
          <h4>📝 日志</h4>
          {log.length > 0 && <span className="novel-section-badge">{log.length}</span>}
        </div>
        {expandedSections.log && (
          <div className="novel-section-body">
            <div className="real-world-log-list">
              {log.length === 0 ? (
                <div className="real-world-empty">暂无日志</div>
              ) : (
                log.map((entry, i) => (
                  <div key={i} className="real-world-log-entry">
                    {entry}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Archives */}
        {archives.length > 0 && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('archives')}>
              <span className="novel-section-arrow">{expandedSections.archives ? '▾' : '▸'}</span>
              <h4>📦 存档</h4>
              <span className="novel-section-badge">{archives.length}</span>
            </div>
            {expandedSections.archives && (
              <div className="novel-section-body">
                <div className="real-world-event-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {archives.map((arch) => (
                    <div
                      key={arch.id}
                      className={`real-world-event-item ${selectedArchive && selectedArchive.id === arch.id ? 'selected' : ''}`}
                      onClick={() => setSelectedArchive(selectedArchive?.id === arch.id ? null : arch)}
                      style={{ cursor: 'pointer', display: 'flex', alignItems: 'flex-start' }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#4fc3f7', fontWeight: 'bold' }}>
                          🕐 第 {arch.generation} 代 — {arch.timestamp}
                        </div>
                        <div style={{ fontSize: 10, color: '#aaa' }}>
                          事件: {arch.eventCount} | 预测: {arch.predictions.length}
                        </div>
                      </div>
                      <button
                        className="real-world-btn"
                        style={{ padding: '2px 6px', fontSize: 10, marginLeft: 'auto' }}
                        onClick={(e) => { e.stopPropagation(); deleteArchive(arch.id); }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Archive Detail */}
        {selectedArchive && (
          <>
            <div className="novel-section-header" onClick={() => toggleSection('archiveDetail')}>
              <span className="novel-section-arrow">{expandedSections.archiveDetail ? '▾' : '▸'}</span>
              <h4>📜 存档详情 — 第 {selectedArchive.generation} 代</h4>
            </div>
            {expandedSections.archiveDetail && (
              <div className="novel-section-body">
                {selectedArchive.analysis && (
                  <div className="real-world-analysis-text" style={{ marginBottom: 8 }}>
                    {selectedArchive.analysis}
                  </div>
                )}
                {selectedArchive.events.length > 0 && (
                  <div className="real-world-event-list" style={{ maxHeight: 200, overflowY: 'auto' }}>
                    {selectedArchive.events.map((evt, i) => (
                      <div key={i} className="real-world-event-item">
                        <div className="real-world-event-header">
                          <span className="real-world-event-icon">{CATEGORY_ICONS[evt.category] || '📌'}</span>
                          <span className="real-world-event-region">{evt.region}/{evt.country}</span>
                          <span className="real-world-event-impact" style={{ color: IMPACT_COLORS[evt.impact] }}>
                            {evt.impact === 'high' ? '🔴' : evt.impact === 'medium' ? '🟡' : '🟢'}
                          </span>
                        </div>
                        <div className="real-world-event-text">{evt.text}</div>
                      </div>
                    ))}
                  </div>
                )}
                {selectedArchive.predictions.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>预测:</div>
                    {selectedArchive.predictions.map((p, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#ccc', padding: '2px 8px' }}>
                        {i + 1}. {p}
                      </div>
                    ))}
                  </div>
                )}
                {selectedArchive.keyTrends.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#aaa', marginBottom: 4 }}>趋势:</div>
                    {selectedArchive.keyTrends.map((t, i) => (
                      <div key={i} style={{ fontSize: 11, color: '#ccc', padding: '2px 8px' }}>
                        • {t}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
});

/* ================================================================
   Default Export: RealWorldPredictor
   ================================================================ */

export default function RealWorldPredictor({ settings, mode = 'canvas' }) {
  const ctx = useContext(RealWorldPredictorContext);

  // If already inside a provider, render based on mode
  if (ctx) {
    if (mode === 'canvas') return <RealWorldCanvas />;
    if (mode === 'info') return <RealWorldInfo />;
    return <RealWorldCanvas />;
  }

  // If not inside a provider, wrap with one (standalone usage)
  if (mode === 'info') {
    return (
      <RealWorldPredictorProvider settings={settings}>
        <RealWorldInfo />
      </RealWorldPredictorProvider>
    );
  }
  return (
    <RealWorldPredictorProvider settings={settings}>
      <RealWorldCanvas />
    </RealWorldPredictorProvider>
  );
}

export { RealWorldPredictorProvider };
