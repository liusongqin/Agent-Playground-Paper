import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import MessageList from './components/MessageList';
import MessageInput from './components/MessageInput';
import SettingsPanel from './components/SettingsPanel';
import TerminalPanel from './components/TerminalPanel';
import FileExplorer from './components/FileExplorer';
import FileEditor from './components/FileEditor';
import ModelManager from './components/ModelManager';
import AgentTools from './components/AgentTools';
import PromptTemplates from './components/PromptTemplates';
import ExportImport from './components/ExportImport';
import WorkflowEditor from './components/WorkflowEditor';
import McpPanel from './components/McpPanel';
import TerminalAgent from './components/TerminalAgent';
import FsmDesigner from './components/FsmDesigner';
import FsmAgent from './components/FsmAgent';
import MemoryManager from './components/MemoryManager';
import DevMonitor from './components/DevMonitor';
import AdbGuiAgent from './components/AdbGuiAgent';
import WorldSimulator, { WorldSimulatorProvider, WorldSimulatorCanvas, WorldSimulatorInfo } from './components/WorldSimulator';
import MultiAgentSimulator, { MultiAgentSimulatorProvider, MultiAgentSimulatorCanvas, MultiAgentSimulatorInfo } from './components/MultiAgentSimulator';
import VoxelWorld, { VoxelWorldProvider, VoxelWorldCanvas, VoxelWorldInfo } from './components/VoxelWorld';
import RealWorldPredictor, { RealWorldPredictorProvider } from './components/RealWorldPredictor';
import { PhoneDetectorProvider, PhoneDetectorCanvas, PhoneDetectorInfo } from './components/PhoneDetector';
import { AutoLabelerProvider, AutoLabelerPanel, AutoLabelerWorkspace } from './components/AutoLabeler';
import { FlowchartProvider, FlowchartCanvas, FlowchartInfo } from './components/FlowchartDesigner';
import { useChat } from './hooks/useChat';
import { actionToCommand, isMcpAction, getMcpToolName } from './utils/agentActions';
import { BUILT_IN_SKILLS } from './utils/skills';
import { sendChatRequest } from './services/openai';
import { subscribeApiLogs } from './utils/apiMonitor';
import { listMcpTools, callMcpTool } from './services/mcp';
import {
  loadSettings,
  saveSettings,
  loadFiles,
  saveFiles,
  loadCustomTemplates,
  saveCustomTemplates,
  loadActiveAgent,
  saveActiveAgent,
  loadAgentSkills,
  saveAgentSkills,
  loadMcpServers,
  saveMcpServers,
} from './utils/storage';
import './App.css';

const DEFAULT_SIDEBAR_WIDTH = 300;
const MIN_SIDEBAR_WIDTH = 150;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_TERMINAL_HEIGHT = 250;
const MIN_TERMINAL_HEIGHT = 80;
const MAX_TERMINAL_HEIGHT_RATIO = 0.7;
const DEFAULT_CHAT_PANEL_WIDTH = 400;
const MIN_CHAT_PANEL_WIDTH = 250;
const MAX_CHAT_PANEL_WIDTH = 800;
const DEFAULT_FUNCTION_PANEL_WIDTH = 320;
const MIN_FUNCTION_PANEL_WIDTH = 200;
const MAX_FUNCTION_PANEL_WIDTH = 600;
const ACTIVITY_BAR_WIDTH = 48;

function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [activePanel, setActivePanel] = useState('files');
  const [files, setFiles] = useState(loadFiles);
  const [selectedFile, setSelectedFile] = useState(null);
  const [customTemplates, setCustomTemplates] = useState(loadCustomTemplates);
  const [activeAgent, setActiveAgent] = useState(loadActiveAgent);
  const [templateKey, setTemplateKey] = useState(0);
  const [templateText, setTemplateText] = useState('');
  const [terminalCwd, setTerminalCwd] = useState(null);
  const [agentSkills, setAgentSkills] = useState(loadAgentSkills);
  const [mcpServers, setMcpServers] = useState(loadMcpServers);
  const [mcpTools, setMcpTools] = useState([]);
  const [editorFile, setEditorFile] = useState(null);
  const terminalRef = useRef(null);

  // Code completion toggle state
  const [completionEnabled, setCompletionEnabled] = useState(false);

  // Right-side panel state (for model-related panels near chat)
  const [rightPanel, setRightPanel] = useState(null); // null | 'conversations' | 'skills' | 'memory' | 'templates' | 'models' | 'mcp' | 'data' | 'developer' | 'terminalAgent' | 'fsm' | 'voxelWorld'

  // FSM agent active state (for designer highlight)
  const [fsmActiveStateId, setFsmActiveStateId] = useState(null);

  // Developer monitor: global API logs from fetch interceptor
  const [apiLogs, setApiLogs] = useState([]);

  // Fetch available MCP tools from server
  useEffect(() => {
    listMcpTools()
      .then((tools) => setMcpTools(tools))
      .catch(() => setMcpTools([]));
  }, []);

  // Subscribe to global API log updates
  useEffect(() => {
    const unsubscribe = subscribeApiLogs((logs) => {
      setApiLogs(logs);
    });
    return unsubscribe;
  }, []);

  // Resizable panel state
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT);
  const [chatPanelWidth, setChatPanelWidth] = useState(DEFAULT_CHAT_PANEL_WIDTH);
  const [functionPanelWidth, setFunctionPanelWidth] = useState(DEFAULT_FUNCTION_PANEL_WIDTH);
  const sidebarDragging = useRef(false);
  const terminalDragging = useRef(false);
  const chatPanelDragging = useRef(false);
  const functionPanelDragging = useRef(false);
  const functionPanelDragStartRef = useRef({ mouseX: 0, width: DEFAULT_FUNCTION_PANEL_WIDTH });
  const mainAreaRef = useRef(null);

  // Sidebar resize handler
  const handleSidebarMouseDown = useCallback((e) => {
    e.preventDefault();
    sidebarDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Terminal resize handler
  const handleTerminalMouseDown = useCallback((e) => {
    e.preventDefault();
    terminalDragging.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Chat panel resize handler
  const handleChatPanelMouseDown = useCallback((e) => {
    e.preventDefault();
    chatPanelDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // Function panel resize handler
  const handleFunctionPanelMouseDown = useCallback((e) => {
    e.preventDefault();
    functionPanelDragging.current = true;
    functionPanelDragStartRef.current = { mouseX: e.clientX, width: functionPanelWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [functionPanelWidth]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (sidebarDragging.current) {
        // 48px for activity bar
        const newWidth = e.clientX - ACTIVITY_BAR_WIDTH;
        setSidebarWidth(Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, newWidth)));
      }
      if (terminalDragging.current && mainAreaRef.current) {
        const mainRect = mainAreaRef.current.getBoundingClientRect();
        const maxH = mainRect.height * MAX_TERMINAL_HEIGHT_RATIO;
        const newHeight = mainRect.bottom - e.clientY;
        setTerminalHeight(Math.min(maxH, Math.max(MIN_TERMINAL_HEIGHT, newHeight)));
      }
      if (chatPanelDragging.current && mainAreaRef.current) {
        const mainRect = mainAreaRef.current.getBoundingClientRect();
        const newWidth = mainRect.right - e.clientX;
        setChatPanelWidth(Math.min(MAX_CHAT_PANEL_WIDTH, Math.max(MIN_CHAT_PANEL_WIDTH, newWidth)));
      }
      if (functionPanelDragging.current && mainAreaRef.current) {
        const dx = functionPanelDragStartRef.current.mouseX - e.clientX;
        const newWidth = functionPanelDragStartRef.current.width + dx;
        setFunctionPanelWidth(Math.min(MAX_FUNCTION_PANEL_WIDTH, Math.max(MIN_FUNCTION_PANEL_WIDTH, newWidth)));
      }
    };

    const handleMouseUp = () => {
      if (sidebarDragging.current || terminalDragging.current || chatPanelDragging.current || functionPanelDragging.current) {
        sidebarDragging.current = false;
        terminalDragging.current = false;
        chatPanelDragging.current = false;
        functionPanelDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const effectiveSettings = useMemo(() => activeAgent
    ? { ...settings, systemPrompt: activeAgent.systemPrompt, _agentSkills: agentSkills, _terminalCwd: terminalCwd, _mcpTools: mcpTools }
    : { ...settings, _agentSkills: agentSkills, _terminalCwd: terminalCwd, _mcpTools: mcpTools },
    [settings, activeAgent, agentSkills, terminalCwd, mcpTools]);

  const {
    conversations,
    activeConversation,
    activeConversationId,
    isLoading,
    error,
    sendMessage,
    stopGeneration,
    createNewConversation,
    deleteConversation,
    renameConversation,
    switchConversation,
    clearMessages,
    importConversations,
    updateMessageAction,
    updateMultipleMessageActions,
  } = useChat(effectiveSettings);

  const handleSettingsChange = (newSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  // File editor management
  const handleFileContentOpen = useCallback((fileData) => {
    setEditorFile(fileData);
  }, []);

  const handleCloseEditor = useCallback(() => {
    setEditorFile(null);
  }, []);

  // Code completion via LLM - reads file context for better prediction
  const handleRequestCompletion = useCallback(async (textBefore, textAfter, lang) => {
    if (!settings.apiKey || !completionEnabled) return null;
    const prompt = `补全以下${lang}代码光标处，只输出1-15个必要的词或符号，不要解释。

前文:
${textBefore}
▏
后文:
${textAfter}

补全:`;

    const messages = [
      { role: 'system', content: '你是代码补全引擎。只输出需要插入光标位置的极简代码片段（1-15个词），不要解释，不要markdown，不要代码块标记，不要重复已有代码。' },
      { role: 'user', content: prompt },
    ];

    // Use very low maxTokens and temperature for precise, short completions
    // Force enableThinking: false for code completion
    const completionSettings = { ...settings, stream: false, maxTokens: 64, temperature: 0.05, enableThinking: false };
    let result = '';
    await sendChatRequest(messages, completionSettings, (chunk, isDone) => {
      if (!isDone) result += chunk;
    });
    return result.trim();
  }, [settings, completionEnabled]);

  // File management
  const handleFileUpload = useCallback((file) => {
    setFiles((prev) => {
      const updated = [...prev, file];
      saveFiles(updated);
      return updated;
    });
  }, []);

  const handleFileDelete = useCallback((fileId) => {
    setFiles((prev) => {
      const updated = prev.filter((f) => f.id !== fileId);
      saveFiles(updated);
      return updated;
    });
    setSelectedFile((prev) => (prev?.id === fileId ? null : prev));
  }, []);

  // Template management
  const handleUseTemplate = useCallback((template) => {
    setTemplateText(template.prompt);
    setTemplateKey((k) => k + 1);
    setRightPanel(null);
  }, []);

  const handleAddTemplate = useCallback((template) => {
    setCustomTemplates((prev) => {
      const updated = [...prev, template];
      saveCustomTemplates(updated);
      return updated;
    });
  }, []);

  const handleDeleteTemplate = useCallback((templateId) => {
    setCustomTemplates((prev) => {
      const updated = prev.filter((t) => t.id !== templateId);
      saveCustomTemplates(updated);
      return updated;
    });
  }, []);

  const handleUpdateTemplate = useCallback((template) => {
    setCustomTemplates((prev) => {
      const updated = prev.map((t) => (t.id === template.id ? template : t));
      saveCustomTemplates(updated);
      return updated;
    });
  }, []);

  // Import/Export
  const handleImportConversations = useCallback((importedConvs) => {
    importConversations(importedConvs);
  }, [importConversations]);

  const handleImportSettings = useCallback((importedSettings) => {
    const merged = { ...settings, ...importedSettings };
    handleSettingsChange(merged);
  }, [settings]);

  // Mode toggle
  const handleModeToggle = useCallback(() => {
    const newMode = settings.chatMode === 'agent' ? 'ask' : 'agent';
    const updated = { ...settings, chatMode: newMode };
    setSettings(updated);
    saveSettings(updated);
    // Auto-show terminal when entering agent mode
    if (newMode === 'agent' && !showTerminal) {
      setShowTerminal(true);
    }
  }, [settings, showTerminal]);

  // Skills management
  const handleAddSkill = useCallback((skill) => {
    setAgentSkills((prev) => {
      const updated = [...prev, skill];
      saveAgentSkills(updated);
      return updated;
    });
  }, []);

  const handleDeleteSkill = useCallback((skillId) => {
    setAgentSkills((prev) => {
      const updated = prev.filter((s) => s.id !== skillId);
      saveAgentSkills(updated);
      return updated;
    });
  }, []);

  const handleUpdateSkill = useCallback((skill) => {
    setAgentSkills((prev) => {
      const updated = prev.map((s) => (s.id === skill.id ? skill : s));
      saveAgentSkills(updated);
      return updated;
    });
  }, []);

  // MCP server management
  const handleAddMcpServer = useCallback((server) => {
    setMcpServers((prev) => {
      const updated = [...prev, server];
      saveMcpServers(updated);
      return updated;
    });
  }, []);

  const handleDeleteMcpServer = useCallback((serverId) => {
    setMcpServers((prev) => {
      const updated = prev.filter((s) => s.id !== serverId);
      saveMcpServers(updated);
      return updated;
    });
  }, []);

  const handleUpdateMcpServer = useCallback((server) => {
    setMcpServers((prev) => {
      const updated = prev.map((s) => (s.id === server.id ? server : s));
      saveMcpServers(updated);
      return updated;
    });
  }, []);

  // Helper: execute a single action (MCP or terminal) and return status updates
  const executeAction = useCallback(async (action) => {
    if (isMcpAction(action)) {
      const toolName = getMcpToolName(action);
      try {
        const result = await callMcpTool(toolName, action.params);
        return { status: 'executed', result: JSON.stringify(result, null, 2) };
      } catch (err) {
        return { status: 'error', error: err.message };
      }
    }
    const command = actionToCommand(action, agentSkills);
    if (!command) {
      return { status: 'error', error: `Unknown skill: ${action.action}` };
    }
    if (terminalRef.current && terminalRef.current.sendCommand(command)) {
      return { status: 'executed', command };
    }
    return { status: 'error', error: 'Terminal not connected. Please ensure the terminal server is running.', command };
  }, [agentSkills]);

  // Agent action confirmation/rejection
  const handleConfirmAction = useCallback(async (action) => {
    const msg = activeConversation?.messages?.find(
      (m) => m.actions?.some((a) => a.id === action.id)
    );
    if (!msg) return;

    if (isMcpAction(action)) {
      updateMessageAction(msg.id, action.id, { status: 'executing' });
    }
    const updates = await executeAction(action);
    updateMessageAction(msg.id, action.id, updates);
  }, [activeConversation, executeAction, updateMessageAction]);

  const handleRejectAction = useCallback((action) => {
    const msg = activeConversation?.messages?.find(
      (m) => m.actions?.some((a) => a.id === action.id)
    );
    if (!msg) return;
    updateMessageAction(msg.id, action.id, { status: 'rejected' });
  }, [activeConversation, updateMessageAction]);

  // Execute all pending actions in a message sequentially (batch state update)
  const handleConfirmAllActions = useCallback(async (message) => {
    if (!message?.actions) return;
    const pendingActions = message.actions.filter((a) => a.status === 'pending');
    const actionUpdates = [];
    for (const action of pendingActions) {
      const updates = await executeAction(action);
      actionUpdates.push({ actionId: action.id, updates });
      if (updates.status === 'error') break;
    }
    updateMultipleMessageActions(message.id, actionUpdates);
  }, [executeAction, updateMultipleMessageActions]);

  // Reject all pending actions in a message (batch state update)
  const handleRejectAllActions = useCallback((message) => {
    if (!message?.actions) return;
    const pendingActions = message.actions.filter((a) => a.status === 'pending');
    if (pendingActions.length === 0) return;
    const actionUpdates = pendingActions.map((a) => ({
      actionId: a.id,
      updates: { status: 'rejected' },
    }));
    updateMultipleMessageActions(message.id, actionUpdates);
  }, [updateMultipleMessageActions]);

  // Execute only the next pending action (step-by-step)
  const handleExecuteNextAction = useCallback(async (message) => {
    if (!message?.actions) return;
    const nextAction = message.actions.find((a) => a.status === 'pending');
    if (!nextAction) return;

    if (isMcpAction(nextAction)) {
      updateMessageAction(message.id, nextAction.id, { status: 'executing' });
    }
    const updates = await executeAction(nextAction);
    updateMessageAction(message.id, nextAction.id, updates);
  }, [executeAction, updateMessageAction]);

  // Auto-execute pending actions when confirm-before-execute is disabled
  useEffect(() => {
    if (settings.agentConfirmBeforeExecute !== false) return;
    const msgs = activeConversation?.messages || [];
    for (const msg of msgs) {
      if (!msg.actions) continue;
      for (const action of msg.actions) {
        if (action.status === 'pending') {
          // Execute directly (handleConfirmAction updates status to 'executed')
          handleConfirmAction(action);
        }
      }
    }
  }, [activeConversation?.messages, settings.agentConfirmBeforeExecute, handleConfirmAction]);

  const isConfigured = !!settings.apiKey;

  // Compute developer monitor: full system prompt
  // Sidebar content based on active panel (left side: files, ADB assistant, developer monitor)
  const renderSidebarContent = () => {
    switch (activePanel) {
      case 'files':
        return (
          <FileExplorer
            files={files}
            onUpload={handleFileUpload}
            onDelete={handleFileDelete}
            onSelect={setSelectedFile}
            selectedFile={selectedFile}
            terminalCwd={terminalCwd}
            onFileContentOpen={handleFileContentOpen}
          />
        );
      case 'adb':
        return (
          <WorkflowEditor
            settings={settings}
          />
        );
      case 'developer':
        return (
          <DevMonitor apiLogs={apiLogs} />
        );
      case 'autoLabel':
        return (
          <AutoLabelerPanel />
        );
      default:
        return (
          <FileExplorer
            files={files}
            onUpload={handleFileUpload}
            onDelete={handleFileDelete}
            onSelect={setSelectedFile}
            selectedFile={selectedFile}
            terminalCwd={terminalCwd}
            onFileContentOpen={handleFileContentOpen}
          />
        );
    }
  };

  // Select a conversation and close the function panel
  const handleConversationSelect = useCallback((id) => {
    switchConversation(id);
    setRightPanel(null);
  }, [switchConversation]);

  // Right panel content (model-related panels near the chat area)
  const renderRightPanelContent = () => {
    switch (rightPanel) {
      case 'conversations':
        return (
          <Sidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelect={handleConversationSelect}
            onCreate={createNewConversation}
            onDelete={deleteConversation}
            onRename={renameConversation}
            isCollapsed={false}
            onToggle={() => setRightPanel(null)}
          />
        );
      case 'skills':
        return (
          <AgentTools
            skills={agentSkills}
            onAddSkill={handleAddSkill}
            onDeleteSkill={handleDeleteSkill}
            onUpdateSkill={handleUpdateSkill}
          />
        );
      case 'memory':
        return (
          <div className="memory-manager">
            <div className="memory-manager-header">
              <h3>🧠 记忆管理</h3>
              <span className="form-hint">管理Agent的长期记忆数据</span>
            </div>
            <div className="memory-manager-body">
              <MemoryManager settings={settings} onSettingsChange={handleSettingsChange} />
            </div>
          </div>
        );
      case 'templates':
        return (
          <PromptTemplates
            onUseTemplate={handleUseTemplate}
            customTemplates={customTemplates}
            onAddTemplate={handleAddTemplate}
            onDeleteTemplate={handleDeleteTemplate}
            onUpdateTemplate={handleUpdateTemplate}
          />
        );
      case 'models':
        return (
          <ModelManager
            settings={settings}
            onSettingsChange={handleSettingsChange}
          />
        );
      case 'mcp':
        return (
          <McpPanel
            mcpServers={mcpServers}
            onAddServer={handleAddMcpServer}
            onDeleteServer={handleDeleteMcpServer}
            onUpdateServer={handleUpdateMcpServer}
          />
        );
      case 'terminalAgent':
        return (
          <TerminalAgent
            settings={settings}
            terminalCwd={terminalCwd}
            terminalRef={terminalRef}
            agentSkills={agentSkills}
            onClose={() => setRightPanel(null)}
          />
        );
      case 'fsm':
        return (
          <FsmAgent
            settings={settings}
            terminalCwd={terminalCwd}
            terminalRef={terminalRef}
            onClose={() => setRightPanel(null)}
            onActiveStateChange={setFsmActiveStateId}
          />
        );
      case 'adbGui':
        return (
          <AdbGuiAgent
            settings={settings}
            onClose={() => setRightPanel(null)}
          />
        );
      case 'phoneDetector':
        return (
          <PhoneDetectorInfo />
        );
      case 'voxelWorld':
        return (
          <VoxelWorldInfo />
        );
      case 'flowchart':
        return (
          <FlowchartInfo />
        );
      case 'worldSim':
        return (
          <WorldSimulatorInfo />
        );
      case 'multiAgent':
        return (
          <MultiAgentSimulatorInfo />
        );
      case 'realWorld':
        return (
          <RealWorldPredictor
            settings={settings}
            mode="info"
          />
        );
      case 'data':
        return (
          <ExportImport
            conversations={conversations}
            onImportConversations={handleImportConversations}
            settings={settings}
            onImportSettings={handleImportSettings}
          />
        );
      default:
        return null;
    }
  };

  return (
    <VoxelWorldProvider>
    <WorldSimulatorProvider settings={settings}>
    <MultiAgentSimulatorProvider settings={settings}>
    <RealWorldPredictorProvider settings={settings}>
    <PhoneDetectorProvider settings={settings}>
    <AutoLabelerProvider settings={settings}>
    <FlowchartProvider>
    <div className="app vscode-theme">
      {/* Activity Bar - file explorer, ADB assistant, terminal, settings */}
      <div className="activity-bar">
        <button
          className={`activity-bar-btn ${activePanel === 'files' ? 'active' : ''}`}
          onClick={() => {
            setActivePanel('files');
            setSidebarCollapsed(false);
          }}
          title="文件浏览器"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
          </svg>
        </button>

        <button
          className={`activity-bar-btn ${activePanel === 'adb' ? 'active' : ''}`}
          onClick={() => {
            setActivePanel('adb');
            setSidebarCollapsed(false);
          }}
          title="ADB助手"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24c-2.86-1.21-6.08-1.21-8.94 0L5.65 5.67c-.19-.29-.58-.38-.87-.2-.28.18-.37.54-.22.83L6.4 9.48C3.3 11.25 1.28 14.44 1 18h22c-.28-3.56-2.3-6.75-5.4-8.52zM7 15.25c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25zm10 0c-.69 0-1.25-.56-1.25-1.25s.56-1.25 1.25-1.25 1.25.56 1.25 1.25-.56 1.25-1.25 1.25z"/>
          </svg>
        </button>

        <button
          className={`activity-bar-btn ${activePanel === 'developer' ? 'active' : ''}`}
          onClick={() => {
            setActivePanel('developer');
            setSidebarCollapsed(false);
          }}
          title="开发者监控"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
          </svg>
        </button>

        <button
          className={`activity-bar-btn ${activePanel === 'autoLabel' ? 'active' : ''}`}
          onClick={() => {
            setActivePanel('autoLabel');
            setSidebarCollapsed(false);
          }}
          title="自动标注工具"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16zM16 17H5V7h11l3.55 5L16 17z"/>
            <circle cx="10" cy="12" r="2"/>
          </svg>
        </button>

        <button
          className={`activity-bar-btn ${showTerminal ? 'active' : ''}`}
          onClick={() => setShowTerminal(!showTerminal)}
          title="终端"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2 4.5A2.5 2.5 0 014.5 2h15A2.5 2.5 0 0122 4.5v15a2.5 2.5 0 01-2.5 2.5h-15A2.5 2.5 0 012 19.5v-15zm2.5-.5a.5.5 0 00-.5.5v15a.5.5 0 00.5.5h15a.5.5 0 00.5-.5v-15a.5.5 0 00-.5-.5h-15z"/>
            <path d="M6.75 8.5l3.25 3-3.25 3L8 15.75 12.5 11.5 8 7.25 6.75 8.5zM12 16h5v-1.5h-5V16z"/>
          </svg>
        </button>

        <div className="activity-bar-spacer" />
        <button
          className="activity-bar-btn"
          onClick={() => setShowSettings(true)}
          title="设置"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>
      </div>

      {/* Sidebar - file explorer and ADB assistant */}
      <div
        className={`sidebar-container ${sidebarCollapsed ? 'collapsed' : ''}`}
        style={!sidebarCollapsed ? { width: sidebarWidth } : undefined}
      >
        <div className="panel-sidebar">
          {renderSidebarContent()}
        </div>
      </div>

      {/* Sidebar resize handle */}
      {!sidebarCollapsed && (
        <div
          className="resize-handle resize-handle-horizontal"
          onMouseDown={handleSidebarMouseDown}
        />
      )}

      {/* Main Content */}
      <main className="main-area" ref={mainAreaRef}>
        {!isConfigured && (
          <div className="config-banner">
            ⚠️ 请在{' '}
            <button
              className="btn-link"
              onClick={() => setShowSettings(true)}
            >
              设置
            </button>{' '}
            中配置 API Key 以开始使用。
          </div>
        )}

        {error && (
          <div className="error-banner">
            ❌ {error}
          </div>
        )}

        {/* Main content split: Editor (center) + Toolbar + Function Panel + Chat (right) */}
        <div className="main-content-split">
          {/* Editor Panel (center) */}
          <div className="editor-panel">
            {rightPanel === 'fsm' ? (
              <FsmDesigner
                activeStateId={fsmActiveStateId}
              />
            ) : rightPanel === 'flowchart' ? (
              <FlowchartCanvas />
            ) : rightPanel === 'voxelWorld' ? (
              <VoxelWorldCanvas />
            ) : rightPanel === 'worldSim' ? (
              <WorldSimulatorCanvas />
            ) : rightPanel === 'multiAgent' ? (
              <MultiAgentSimulatorCanvas />
            ) : rightPanel === 'realWorld' ? (
              <RealWorldPredictor settings={settings} mode="canvas" />
            ) : rightPanel === 'phoneDetector' ? (
              <PhoneDetectorCanvas />
            ) : activePanel === 'autoLabel' ? (
              <AutoLabelerWorkspace />
            ) : (
              <FileEditor
                file={editorFile}
                onClose={handleCloseEditor}
                onRequestCompletion={handleRequestCompletion}
                completionEnabled={completionEnabled}
                onToggleCompletion={() => setCompletionEnabled(!completionEnabled)}
              />
            )}
          </div>

          {/* Vertical action toolbar — fixed position next to editor */}
          <div className="vertical-action-toolbar">
            <button
              className={`vertical-action-btn ${rightPanel === 'conversations' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'conversations' ? null : 'conversations')}
              title="对话列表"
            >
              💬
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'skills' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'skills' ? null : 'skills')}
              title="技能管理"
            >
              ⚡
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'memory' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'memory' ? null : 'memory')}
              title="记忆管理"
            >
              🧠
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'templates' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'templates' ? null : 'templates')}
              title="提示词模板"
            >
              📝
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'models' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'models' ? null : 'models')}
              title="模型管理"
            >
              ⭐
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'mcp' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'mcp' ? null : 'mcp')}
              title="MCP服务器"
            >
              🔗
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'terminalAgent' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'terminalAgent' ? null : 'terminalAgent')}
              title="终端Agent"
            >
              🖥️
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'fsm' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'fsm' ? null : 'fsm')}
              title="有限状态机Agent"
            >
              🔄
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'adbGui' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'adbGui' ? null : 'adbGui')}
              title="ADB截图Agent"
            >
              📱
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'worldSim' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'worldSim' ? null : 'worldSim')}
              title="虚拟世界推演"
            >
              🔮
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'multiAgent' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'multiAgent' ? null : 'multiAgent')}
              title="文档知识图谱"
            >
              📖
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'realWorld' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'realWorld' ? null : 'realWorld')}
              title="现实世界推演"
            >
              🌐
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'flowchart' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'flowchart' ? null : 'flowchart')}
              title="流程图设计"
            >
              📊
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'voxelWorld' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'voxelWorld' ? null : 'voxelWorld')}
              title="体素世界"
            >
              🏗️
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'phoneDetector' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'phoneDetector' ? null : 'phoneDetector')}
              title="实时目标检测"
            >
              🎯
            </button>
            <button
              className={`vertical-action-btn ${rightPanel === 'data' ? 'active' : ''}`}
              onClick={() => setRightPanel(rightPanel === 'data' ? null : 'data')}
              title="导入/导出"
            >
              📥
            </button>
          </div>

          {/* Function panel (shown when rightPanel is active) */}
          {rightPanel && (
            <>
              <div
                className="resize-handle resize-handle-horizontal"
                onMouseDown={handleFunctionPanelMouseDown}
              />
              <div className="function-panel" style={{ width: functionPanelWidth }}>
                <div className="function-panel-header">
                  <button className="btn-icon" onClick={() => setRightPanel(null)} title="关闭">✕</button>
                </div>
                {renderRightPanelContent()}
              </div>
            </>
          )}

          {/* Chat panel resize handle — always adjacent to chat panel */}
          <div
            className="resize-handle resize-handle-horizontal"
            onMouseDown={handleChatPanelMouseDown}
          />

          {/* Chat Panel (right) */}
          <div className="chat-panel" style={{ width: chatPanelWidth }}>
            {/* Chat toolbar with model-related buttons */}
            <div className="chat-panel-header">
              <span>💬 {activeConversation?.title || 'Chat'}</span>
              <div className="chat-panel-toolbar">
                <div className="mode-toggle" title={`当前模式: ${settings.chatMode === 'agent' ? 'Agent' : 'Ask'}`}>
                  <button
                    className={`mode-toggle-btn ${settings.chatMode === 'ask' ? 'active' : ''}`}
                    onClick={() => {
                      const updated = { ...settings, chatMode: 'ask' };
                      setSettings(updated);
                      saveSettings(updated);
                    }}
                  >
                    💬
                  </button>
                  <button
                    className={`mode-toggle-btn ${settings.chatMode === 'agent' ? 'active' : ''}`}
                    onClick={handleModeToggle}
                  >
                    🤖
                  </button>
                </div>
                <button
                  className="btn-tab-action"
                  onClick={clearMessages}
                  title="清空对话"
                >
                  🗑️
                </button>
              </div>
            </div>

            {/* Agent status banners in chat panel */}
            {settings.chatMode === 'agent' && (
              <div className="agent-mode-banner">
                <span>🤖 Agent Mode Active</span>
                <span className="agent-mode-banner-desc">
                  {settings.agentConfirmBeforeExecute !== false
                    ? ' 操作需确认后执行'
                    : ' 操作自动执行'}
                </span>
                {terminalCwd && (
                  <span className="agent-mode-cwd" title={terminalCwd}>
                    📂 {terminalCwd}
                  </span>
                )}
              </div>
            )}

            {activeAgent && (
              <div className="agent-banner">
                <span>{activeAgent.icon} Agent: <strong>{activeAgent.name}</strong></span>
                <span className="agent-banner-desc">{activeAgent.description}</span>
                <button
                  className="btn-icon"
                  onClick={() => { setActiveAgent(null); saveActiveAgent(null); }}
                  title="停用 Agent"
                  style={{ marginLeft: 'auto' }}
                >
                  ✕
                </button>
              </div>
            )}

            <div className="editor-area">
              <MessageList
                messages={activeConversation?.messages || []}
                isLoading={isLoading}
                onConfirmAction={handleConfirmAction}
                onRejectAction={handleRejectAction}
                onConfirmAllActions={handleConfirmAllActions}
                onRejectAllActions={handleRejectAllActions}
                onExecuteNextAction={handleExecuteNextAction}
              />

              <MessageInput
                key={templateKey}
                onSend={sendMessage}
                onStop={stopGeneration}
                isLoading={isLoading}
                disabled={!isConfigured}
                initialInput={templateText}
                enableThinking={settings.enableThinking !== false}
                onToggleThinking={() => {
                  const newSettings = { ...settings, enableThinking: !settings.enableThinking };
                  setSettings(newSettings);
                  saveSettings(newSettings);
                }}
              />
            </div>
          </div>
        </div>

        {/* Terminal resize handle */}
        {showTerminal && (
          <div
            className="resize-handle resize-handle-vertical"
            onMouseDown={handleTerminalMouseDown}
          />
        )}

        {/* Terminal Panel */}
        <TerminalPanel
          ref={terminalRef}
          isVisible={showTerminal}
          onCwdChange={setTerminalCwd}
          style={showTerminal ? { height: terminalHeight } : undefined}
        />

        {/* Status Bar */}
        <div className="status-bar">
          <div className="status-bar-left">
            <span className="status-item">
              🔌 {isConfigured ? 'Connected' : 'Not configured'}
            </span>
            <span className="status-item">
              📡 {settings.model}
            </span>
            <span className={`status-item ${settings.chatMode === 'agent' ? 'status-agent-mode' : ''}`}>
              {settings.chatMode === 'agent' ? '🤖 Agent' : '💬 Ask'}
            </span>
            {activeAgent && (
              <span className="status-item">
                {activeAgent.icon} {activeAgent.name}
              </span>
            )}
          </div>
          <div className="status-bar-right">
            <span className="status-item">
              📁 {files.length} files
            </span>
            <span className="status-item">
              💬 {activeConversation?.messages?.length || 0} messages
            </span>
            <span className="status-item">
              {isLoading ? '⏳ Generating...' : '✅ Ready'}
            </span>
          </div>
        </div>
      </main>

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
    </FlowchartProvider>
    </AutoLabelerProvider>
    </PhoneDetectorProvider>
    </RealWorldPredictorProvider>
    </MultiAgentSimulatorProvider>
    </WorldSimulatorProvider>
    </VoxelWorldProvider>
  );
}

export default App;
