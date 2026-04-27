import { BUILT_IN_SKILLS } from './skills';

/** Regex to match agent action code blocks in model output. */
export const AGENT_ACTION_REGEX = /```agent-action\s*\n?([\s\S]*?)```/g;

/**
 * The default (built-in) agent mode instructions.
 * Redesigned: minimal and precise prompts for the skill tree approach.
 * The model receives only the current skill tree level for classification,
 * then drills down step by step.
 */
export const DEFAULT_AGENT_INSTRUCTIONS = `你是Agent。用ReAct方式：思考→行动→观察。

执行操作用以下格式：
\`\`\`agent-action
{"action":"工具ID","params":{"参数名":"值"}}
\`\`\`

规则：
1. 先说意图，再输出代码块。
2. JSON用英文双引号。
3. 一次可输出多个代码块。
4. 优先使用MCP工具（mcp_开头），它们直接在服务器端执行。`;

/**
 * Build the agent mode system prompt with available skills and MCP tools.
 * @param {string} basePrompt - The base system prompt
 * @param {Array} skills - Custom skills to include
 * @param {string|null} cwd - Current working directory of the terminal
 * @param {string|null} customAgentPrompt - User's custom agent prompt additions
 * @param {string|null} terminalAgentPrompt - User's custom terminal agent instructions
 * @param {Array|null} mcpTools - Available MCP tools from server
 */
export function buildAgentSystemPrompt(basePrompt, skills, cwd, customAgentPrompt, terminalAgentPrompt, mcpTools) {
  const allSkills = [...BUILT_IN_SKILLS, ...(skills || [])];

  // Compact skill list: ID + param names only
  const skillDescriptions = allSkills.map((s) => {
    const params = (s.params || []).map((p) => p.name).join(', ');
    return `  ${s.id}(${params}): ${s.description}`;
  }).join('\n');

  // MCP tool descriptions
  let mcpSection = '';
  if (mcpTools && mcpTools.length > 0) {
    const mcpDescriptions = mcpTools.map((t) => {
      const params = Object.keys(t.parameters || {}).join(', ');
      return `  mcp_${t.name}(${params}): ${t.description}`;
    }).join('\n');
    mcpSection = `\nMCP工具（服务器端直接执行）：\n${mcpDescriptions}`;
  }

  const envSection = cwd ? `\n工作目录：${cwd}` : '';

  const customSection = customAgentPrompt
    ? `\n${customAgentPrompt}`
    : '';

  const agentInstructions = (terminalAgentPrompt && terminalAgentPrompt.trim())
    ? terminalAgentPrompt.trim()
    : DEFAULT_AGENT_INSTRUCTIONS;

  return `${basePrompt}

${agentInstructions}
${envSection}
终端技能：
${skillDescriptions}${mcpSection}${customSection}`;
}

/**
 * Remove agent action blocks from content for display.
 */
export function stripAgentActions(content) {
  if (!content) return '';
  return content.replace(new RegExp(AGENT_ACTION_REGEX.source, 'g'), '').trim();
}

/**
 * Try to parse a JSON string and extract an action object.
 * Also handles Python-style values: True -> true, False -> false, None -> null
 * Returns an action object or null.
 */
function tryParseAction(jsonStr) {
  let str = jsonStr.trim();
  // Fix Python-style values that are not valid JSON
  str = str.replace(/:\s*True\b/g, ': true')
           .replace(/:\s*False\b/g, ': false')
           .replace(/:\s*None\b/g, ': null');
  try {
    const parsed = JSON.parse(str);
    if (parsed.action) {
      return {
        id: crypto.randomUUID(),
        action: parsed.action,
        params: parsed.params || {},
        status: 'pending',
      };
    }
  } catch {
    // skip malformed JSON
  }
  return null;
}

/**
 * Parse agent actions from a model response.
 * Supports multiple formats to handle limited model capabilities:
 *   1. Standard ```agent-action ... ``` blocks
 *   2. Generic ``` ... ``` code blocks containing action JSON
 *   3. Raw JSON objects with "action" field in the response text
 * Returns array of { id, action, params } objects.
 */
export function parseAgentActions(content) {
  if (!content) return [];

  const actions = [];

  // 1. Standard ```agent-action ... ``` blocks
  const regex = new RegExp(AGENT_ACTION_REGEX.source, 'g');
  let match;

  while ((match = regex.exec(content)) !== null) {
    const action = tryParseAction(match[1]);
    if (action) {
      actions.push(action);
    }
  }

  // If standard blocks found actions, return them
  if (actions.length > 0) return actions;

  // 2. Try generic ```json ... ``` or ``` ... ``` code blocks
  const genericCodeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
  while ((match = genericCodeBlockRegex.exec(content)) !== null) {
    const action = tryParseAction(match[1]);
    if (action) {
      actions.push(action);
    }
  }

  if (actions.length > 0) return actions;

  // 3. Try to find raw JSON objects with "action" field in the text
  // Use a balanced-brace matching approach for nested objects
  const rawJsonActions = extractRawJsonActions(content);
  for (const jsonStr of rawJsonActions) {
    const action = tryParseAction(jsonStr);
    if (action) {
      actions.push(action);
    }
  }

  return actions;
}

/**
 * Extract raw JSON objects containing "action" field from text.
 * Uses simple brace-counting to handle nested structures.
 */
function extractRawJsonActions(text) {
  const results = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      let depth = 1;
      let j = i + 1;
      let inString = false;
      let escape = false;
      while (j < text.length && depth > 0) {
        const ch = text[j];
        if (escape) {
          escape = false;
        } else if (ch === '\\' && inString) {
          escape = true;
        } else if (ch === '"') {
          inString = !inString;
        } else if (!inString) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        j++;
      }
      if (depth === 0) {
        const candidate = text.slice(i, j);
        if (/"action"\s*:/.test(candidate)) {
          results.push(candidate);
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return results;
}

/**
 * Check if an action is an MCP tool call (prefixed with mcp_).
 */
export function isMcpAction(action) {
  return action && typeof action.action === 'string' && action.action.startsWith('mcp_');
}

/**
 * Get the MCP tool name from an action (strips 'mcp_' prefix).
 */
export function getMcpToolName(action) {
  if (!isMcpAction(action)) return null;
  return action.action.slice(4); // remove 'mcp_' prefix
}

/**
 * Escape a string for safe inclusion in single-quoted shell arguments.
 */
function shellEscapeValue(str) {
  if (str == null) return '';
  return String(str).replace(/'/g, "'\\''");
}

/**
 * Convert an action to a terminal command.
 * Returns null for MCP actions (they are handled differently).
 */
export function actionToCommand(action, customSkills) {
  // MCP actions are not terminal commands
  if (isMcpAction(action)) {
    return null;
  }

  const allSkills = [...BUILT_IN_SKILLS, ...(customSkills || [])];
  const skill = allSkills.find((s) => s.id === action.action);

  if (!skill) {
    return null;
  }

  if (skill.toCommand) {
    return skill.toCommand(action.params);
  }

  // Custom skill: use command template with escaped values
  if (skill.commandTemplate) {
    let cmd = skill.commandTemplate;
    for (const [key, value] of Object.entries(action.params)) {
      const escaped = shellEscapeValue(value);
      cmd = cmd.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), escaped);
    }
    return cmd;
  }

  return null;
}
