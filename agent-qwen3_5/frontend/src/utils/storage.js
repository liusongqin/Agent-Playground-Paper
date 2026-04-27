const STORAGE_KEYS = {
  SETTINGS: 'agent-chat-settings',
  CONVERSATIONS: 'agent-chat-conversations',
  ACTIVE_CONVERSATION: 'agent-chat-active-conversation',
  FILES: 'agent-chat-files',
  CUSTOM_AGENTS: 'agent-chat-custom-agents',
  CUSTOM_TEMPLATES: 'agent-chat-custom-templates',
  ACTIVE_AGENT: 'agent-chat-active-agent',
  CUSTOM_WORKFLOWS: 'agent-chat-custom-workflows',
  ACTIVE_WORKFLOW: 'agent-chat-active-workflow',
  AGENT_SKILLS: 'agent-chat-agent-skills',
  MCP_SERVERS: 'agent-chat-mcp-servers',
  FSM: 'agent-chat-fsm',
};

const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'Qwen3.5-0.8B',
  systemPrompt: '你是一个有用的AI助手。请使用中文回答问题。',
  temperature: 0.1,
  maxTokens: 1024,
  topP: 1.0,
  presencePenalty: 2.0,
  topK: 20,
  stream: true,
  chatMode: 'ask',
  agentConfirmBeforeExecute: true,
  customAgentPrompt: '',
  terminalAgentPrompt: '',
  fsmAgentPrompt: '',
  enableThinking: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore parse errors
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(settings));
}

export function loadConversations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CONVERSATIONS);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

export function saveConversations(conversations) {
  localStorage.setItem(STORAGE_KEYS.CONVERSATIONS, JSON.stringify(conversations));
}

export function loadActiveConversationId() {
  return localStorage.getItem(STORAGE_KEYS.ACTIVE_CONVERSATION) || null;
}

export function saveActiveConversationId(id) {
  if (id) {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_CONVERSATION, id);
  } else {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_CONVERSATION);
  }
}

export function generateId() {
  return crypto.randomUUID();
}

// Files storage
export function loadFiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FILES);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

export function saveFiles(files) {
  localStorage.setItem(STORAGE_KEYS.FILES, JSON.stringify(files));
}

// Custom agents storage
export function loadCustomAgents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_AGENTS);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

export function saveCustomAgents(agents) {
  localStorage.setItem(STORAGE_KEYS.CUSTOM_AGENTS, JSON.stringify(agents));
}

// Custom templates storage
export function loadCustomTemplates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_TEMPLATES);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

export function saveCustomTemplates(templates) {
  localStorage.setItem(STORAGE_KEYS.CUSTOM_TEMPLATES, JSON.stringify(templates));
}

// Active agent storage
export function loadActiveAgent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_AGENT);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export function saveActiveAgent(agent) {
  if (agent) {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_AGENT, JSON.stringify(agent));
  } else {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_AGENT);
  }
}

// Custom workflows storage
export function loadCustomWorkflows() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_WORKFLOWS);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

export function saveCustomWorkflows(workflows) {
  localStorage.setItem(STORAGE_KEYS.CUSTOM_WORKFLOWS, JSON.stringify(workflows));
}

// Active workflow storage
export function loadActiveWorkflow() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_WORKFLOW);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

export function saveActiveWorkflow(workflow) {
  if (workflow) {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_WORKFLOW, JSON.stringify(workflow));
  } else {
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_WORKFLOW);
  }
}

// Agent skills storage
export function loadAgentSkills() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AGENT_SKILLS);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

export function saveAgentSkills(skills) {
  localStorage.setItem(STORAGE_KEYS.AGENT_SKILLS, JSON.stringify(skills));
}

// Default MCP server configurations for local use
const DEFAULT_MCP_SERVERS = [
  {
    id: 'mcp-filesystem',
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/home'],
    env: {},
    description: '文件系统访问 - 允许模型读写本地文件',
    enabled: false,
  },
  {
    id: 'mcp-fetch',
    name: 'Fetch',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    env: {},
    description: '网络请求 - 允许模型访问网页和API',
    enabled: false,
  },
  {
    id: 'mcp-memory',
    name: 'Memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
    description: '知识图谱记忆 - 持久化存储和检索信息',
    enabled: false,
  },
];

// MCP servers storage
export function loadMcpServers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MCP_SERVERS);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length > 0) {
        return saved;
      }
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_MCP_SERVERS;
}

export function saveMcpServers(servers) {
  localStorage.setItem(STORAGE_KEYS.MCP_SERVERS, JSON.stringify(servers));
}

// Skill tree storage
const DEFAULT_SKILL_TREE = {
  id: 'root',
  name: '技能树',
  description: '根节点',
  children: [
    {
      id: 'file-ops',
      name: '文件操作',
      description: '文件和目录相关操作',
      children: [
        { id: 'file-create', name: '创建文件', description: '创建新文件', skillId: 'create-file', children: [] },
        { id: 'file-read', name: '读取文件', description: '读取文件内容', skillId: 'read-file', children: [] },
        { id: 'folder-create', name: '创建目录', description: '创建新目录', skillId: 'create-folder', children: [] },
        { id: 'file-list', name: '列出文件', description: '列出目录内容', skillId: 'list-files', children: [] },
      ],
    },
    {
      id: 'cmd-ops',
      name: '命令执行',
      description: '终端命令相关操作',
      children: [
        { id: 'cmd-run', name: '执行命令', description: '运行Shell命令', skillId: 'run-command', children: [] },
      ],
    },
  ],
};

export function loadSkillTree() {
  try {
    const raw = localStorage.getItem('agent-chat-skill-tree');
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_SKILL_TREE;
}

export function saveSkillTree(tree) {
  localStorage.setItem('agent-chat-skill-tree', JSON.stringify(tree));
}

// FSM (Finite State Machine) storage
const DEFAULT_FSM = {
  id: 'default-fsm',
  name: '终端状态机',
  states: [
    // ===== 入口 =====
    {
      id: 'start',
      name: '开始',
      type: 'start',
      commands: [],
      transitions: [
        { to: 'navigate', condition: '需要文件或目录操作' },
        { to: 'sys-info', condition: '需要查看系统状态' },
        { to: 'git-basic', condition: '需要Git版本控制' },
      ],
      position: { x: 450, y: 30 },
    },
    // ===== 文件与目录操作 =====
    {
      id: 'navigate',
      name: '目录导航',
      type: 'action',
      commands: [
        { type: 'cd', paramName: 'path', description: '切换到指定目录' },
        { type: 'ls', paramName: 'options path', description: '列出目录内容' },
        { type: 'pwd', paramName: '', description: '显示当前工作目录' },
      ],
      transitions: [
        { to: 'file-browse', condition: '需要浏览或搜索文件' },
        { to: 'file-view', condition: '需要查看文件内容' },
        { to: 'dir-manage', condition: '需要创建或管理目录' },
      ],
      position: { x: 100, y: 180 },
    },
    {
      id: 'file-browse',
      name: '文件浏览',
      type: 'action',
      commands: [
        { type: 'ls', paramName: '-la path', description: '查看详细文件列表' },
        { type: 'find', paramName: 'path -name pattern', description: '按名称搜索文件' },
        { type: 'du', paramName: '-sh path', description: '查看文件或目录大小' },
      ],
      transitions: [
        { to: 'file-view', condition: '找到目标文件需要查看' },
        { to: 'file-search', condition: '需要搜索文件内容' },
        { to: 'file-manage', condition: '需要复制移动或删除文件' },
      ],
      position: { x: 0, y: 340 },
    },
    {
      id: 'file-view',
      name: '文件查看',
      type: 'action',
      commands: [
        { type: 'cat', paramName: 'file', description: '显示文件完整内容' },
        { type: 'head', paramName: '-n number file', description: '查看文件前几行' },
        { type: 'tail', paramName: '-n number file', description: '查看文件后几行' },
      ],
      transitions: [
        { to: 'file-search', condition: '需要搜索文件中的内容' },
        { to: 'file-edit', condition: '需要修改文件内容' },
        { to: 'navigate', condition: '需要切换到其他目录' },
      ],
      position: { x: 200, y: 340 },
    },
    {
      id: 'file-search',
      name: '文件搜索',
      type: 'action',
      commands: [
        { type: 'grep', paramName: '-rn pattern path', description: '搜索文件内容' },
        { type: 'find', paramName: 'path -type f -name pattern', description: '按条件查找文件' },
        { type: 'wc', paramName: '-l file', description: '统计文件行数' },
      ],
      transitions: [
        { to: 'file-view', condition: '需要查看搜索到的文件' },
        { to: 'file-edit', condition: '需要修改搜索到的内容' },
        { to: 'navigate', condition: '需要切换目录继续搜索' },
      ],
      position: { x: 0, y: 500 },
    },
    {
      id: 'file-edit',
      name: '文件编辑',
      type: 'action',
      commands: [
        { type: 'echo', paramName: 'text >> file', description: '追加内容到文件' },
        { type: 'sed', paramName: '-i expression file', description: '替换文件中的内容' },
        { type: 'tee', paramName: 'file', description: '写入内容到文件' },
      ],
      transitions: [
        { to: 'file-view', condition: '需要确认修改后的内容' },
        { to: 'verify', condition: '需要验证修改结果' },
        { to: 'file-manage', condition: '需要备份或管理文件' },
      ],
      position: { x: 200, y: 500 },
    },
    {
      id: 'dir-manage',
      name: '目录管理',
      type: 'action',
      commands: [
        { type: 'mkdir', paramName: '-p path', description: '创建目录' },
        { type: 'touch', paramName: 'file', description: '创建空文件' },
        { type: 'rmdir', paramName: 'path', description: '删除空目录' },
      ],
      transitions: [
        { to: 'navigate', condition: '需要进入新建的目录' },
        { to: 'file-manage', condition: '需要复制移动文件' },
        { to: 'verify', condition: '需要验证创建结果' },
      ],
      position: { x: 400, y: 340 },
    },
    {
      id: 'file-manage',
      name: '文件管理',
      type: 'action',
      commands: [
        { type: 'cp', paramName: '-r source dest', description: '复制文件或目录' },
        { type: 'mv', paramName: 'source dest', description: '移动或重命名文件' },
        { type: 'rm', paramName: '-r path', description: '删除文件或目录（慎用）' },
      ],
      transitions: [
        { to: 'navigate', condition: '需要切换目录' },
        { to: 'perm-manage', condition: '需要修改文件权限' },
        { to: 'verify', condition: '需要验证操作结果' },
      ],
      position: { x: 400, y: 500 },
    },
    {
      id: 'perm-manage',
      name: '权限管理',
      type: 'action',
      commands: [
        { type: 'chmod', paramName: 'mode file', description: '修改文件权限' },
        { type: 'chown', paramName: 'user:group file', description: '修改文件所有者' },
        { type: 'ls', paramName: '-la file', description: '查看文件权限详情' },
      ],
      transitions: [
        { to: 'file-manage', condition: '权限修改后继续管理文件' },
        { to: 'navigate', condition: '需要切换到其他目录' },
        { to: 'verify', condition: '需要验证权限修改' },
      ],
      position: { x: 100, y: 660 },
    },
    {
      id: 'archive',
      name: '压缩解压',
      type: 'action',
      commands: [
        { type: 'tar', paramName: '-czf archive.tar.gz files', description: '打包压缩文件' },
        { type: 'tar', paramName: '-xzf archive.tar.gz', description: '解压tar.gz文件' },
        { type: 'zip', paramName: '-r archive.zip files', description: '创建zip压缩包' },
      ],
      transitions: [
        { to: 'file-manage', condition: '需要管理压缩后的文件' },
        { to: 'navigate', condition: '需要切换目录' },
        { to: 'verify', condition: '需要验证压缩解压结果' },
      ],
      position: { x: 300, y: 660 },
    },
    // ===== 系统操作 =====
    {
      id: 'sys-info',
      name: '系统信息',
      type: 'action',
      commands: [
        { type: 'uname', paramName: '-a', description: '查看系统版本信息' },
        { type: 'df', paramName: '-h', description: '查看磁盘使用情况' },
        { type: 'free', paramName: '-h', description: '查看内存使用情况' },
      ],
      transitions: [
        { to: 'proc-manage', condition: '需要管理系统进程' },
        { to: 'net-ops', condition: '需要进行网络操作' },
        { to: 'env-config', condition: '需要配置环境变量' },
      ],
      position: { x: 450, y: 180 },
    },
    {
      id: 'proc-manage',
      name: '进程管理',
      type: 'action',
      commands: [
        { type: 'ps', paramName: 'aux', description: '查看运行中的进程' },
        { type: 'kill', paramName: 'pid', description: '终止指定进程（先尝试SIGTERM）' },
        { type: 'top', paramName: '-bn1', description: '查看系统资源占用' },
      ],
      transitions: [
        { to: 'sys-info', condition: '需要查看更多系统信息' },
        { to: 'error-handle', condition: '进程异常需要处理' },
        { to: 'verify', condition: '需要验证进程状态' },
      ],
      position: { x: 620, y: 340 },
    },
    {
      id: 'net-ops',
      name: '网络操作',
      type: 'action',
      commands: [
        { type: 'curl', paramName: '-s url', description: '发送HTTP请求' },
        { type: 'ping', paramName: '-c 4 host', description: '测试网络连通性' },
        { type: 'wget', paramName: 'url', description: '下载网络文件' },
      ],
      transitions: [
        { to: 'verify', condition: '需要验证网络操作结果' },
        { to: 'error-handle', condition: '网络请求出错' },
        { to: 'sys-info', condition: '需要查看系统网络配置' },
      ],
      position: { x: 830, y: 340 },
    },
    {
      id: 'env-config',
      name: '环境配置',
      type: 'action',
      commands: [
        { type: 'export', paramName: 'KEY=value', description: '设置环境变量' },
        { type: 'echo', paramName: '$VARIABLE', description: '查看环境变量值' },
        { type: 'which', paramName: 'command', description: '查找命令安装路径' },
      ],
      transitions: [
        { to: 'pkg-manage', condition: '需要安装软件包' },
        { to: 'sys-info', condition: '需要查看系统信息' },
        { to: 'navigate', condition: '配置完成继续操作' },
      ],
      position: { x: 620, y: 500 },
    },
    {
      id: 'pkg-manage',
      name: '包管理',
      type: 'action',
      commands: [
        { type: 'npm', paramName: 'install package', description: '安装Node.js依赖' },
        { type: 'pip', paramName: 'install package', description: '安装Python依赖' },
        { type: 'apt', paramName: 'install -y package', description: '安装系统软件包' },
      ],
      transitions: [
        { to: 'verify', condition: '需要验证安装结果' },
        { to: 'error-handle', condition: '安装失败需要处理' },
        { to: 'env-config', condition: '需要配置环境' },
      ],
      position: { x: 830, y: 500 },
    },
    // ===== Git操作 =====
    {
      id: 'git-basic',
      name: 'Git基础',
      type: 'action',
      commands: [
        { type: 'git', paramName: 'status', description: '查看仓库当前状态' },
        { type: 'git', paramName: 'add files', description: '添加文件到暂存区' },
        { type: 'git', paramName: 'log --oneline -10', description: '查看最近提交记录' },
      ],
      transitions: [
        { to: 'git-commit', condition: '需要提交或推送代码' },
        { to: 'git-branch', condition: '需要管理分支' },
        { to: 'navigate', condition: '需要切换到项目目录' },
      ],
      position: { x: 800, y: 180 },
    },
    {
      id: 'git-commit',
      name: 'Git提交',
      type: 'action',
      commands: [
        { type: 'git', paramName: 'commit -m "message"', description: '提交暂存的更改' },
        { type: 'git', paramName: 'push origin branch', description: '推送到远程仓库' },
        { type: 'git', paramName: 'pull origin branch', description: '拉取远程更新' },
      ],
      transitions: [
        { to: 'git-basic', condition: '需要查看提交后的状态' },
        { to: 'verify', condition: '需要验证提交结果' },
        { to: 'error-handle', condition: '提交或推送出错' },
      ],
      position: { x: 1040, y: 340 },
    },
    {
      id: 'git-branch',
      name: 'Git分支',
      type: 'action',
      commands: [
        { type: 'git', paramName: 'branch name', description: '创建新分支' },
        { type: 'git', paramName: 'checkout branch', description: '切换到指定分支' },
        { type: 'git', paramName: 'merge branch', description: '合并指定分支' },
      ],
      transitions: [
        { to: 'git-basic', condition: '需要查看分支操作结果' },
        { to: 'git-commit', condition: '需要提交代码' },
        { to: 'error-handle', condition: '分支操作出现冲突' },
      ],
      position: { x: 1040, y: 500 },
    },
    // ===== 通用状态 =====
    {
      id: 'verify',
      name: '结果验证',
      type: 'action',
      commands: [
        { type: 'echo', paramName: '$?', description: '检查上条命令返回值' },
        { type: 'ls', paramName: '-la path', description: '验证文件是否存在' },
        { type: 'cat', paramName: 'file', description: '验证文件内容正确' },
      ],
      transitions: [
        { to: 'error-handle', condition: '验证发现问题需要处理' },
        { to: 'navigate', condition: '验证通过继续操作' },
        { to: 'end', condition: '所有操作已完成' },
      ],
      position: { x: 500, y: 660 },
    },
    {
      id: 'error-handle',
      name: '错误处理',
      type: 'action',
      commands: [
        { type: 'echo', paramName: '"error message"', description: '输出错误诊断信息' },
        { type: 'cat', paramName: '/var/log/syslog', description: '查看系统日志' },
        { type: 'history', paramName: '', description: '查看命令执行历史' },
      ],
      transitions: [
        { to: 'navigate', condition: '修正路径后重新操作' },
        { to: 'env-config', condition: '需要修正环境配置' },
        { to: 'end', condition: '错误无法解决结束任务' },
      ],
      position: { x: 700, y: 660 },
    },
    // ===== 终点 =====
    {
      id: 'end',
      name: '完成',
      type: 'end',
      commands: [],
      transitions: [],
      position: { x: 600, y: 820 },
    },
  ],
};

export function loadFsm() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FSM);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_FSM;
}

export function saveFsm(fsm) {
  localStorage.setItem(STORAGE_KEYS.FSM, JSON.stringify(fsm));
}
