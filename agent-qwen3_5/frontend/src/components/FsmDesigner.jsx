import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { loadFsm, saveFsm } from '../utils/storage';

/**
 * FsmDesigner: Visual finite state machine designer for the center panel.
 *
 * Features:
 * - Create, edit, and delete states
 * - Define transitions between states with conditions
 * - Define commands each state can execute
 * - Canvas pan (drag background), zoom in/out, reset view
 * - White connection lines with arrows at line midpoints
 * - Right-click context menu for add/delete/modify
 * - Visually see the current active state during agent execution
 */

const STATE_TYPES = {
  start: { label: '开始', color: '#4caf50', icon: '▶' },
  action: { label: '动作', color: '#2196f3', icon: '⚡' },
  end: { label: '结束', color: '#f44336', icon: '⏹' },
};

const STATE_WIDTH = 160;
const STATE_HEIGHT = 80;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;
const ARROW_POSITION_T = 0.6;

function generateStateId() {
  return 'state-' + crypto.randomUUID().slice(0, 8);
}

const MAX_UNDO_HISTORY = 50;

export default function FsmDesigner({ activeStateId }) {
  const [fsm, setFsm] = useState(() => loadFsm());
  const [selectedStateId, setSelectedStateId] = useState(null);
  const [draggingId, setDraggingId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showAddState, setShowAddState] = useState(false);
  const [newStateName, setNewStateName] = useState('');
  const [newStateType, setNewStateType] = useState('action');
  const canvasRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 400 });

  // Canvas pan & zoom state
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panOffsetStartRef = useRef({ x: 0, y: 0 });

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState(null); // { x, y, stateId? }

  // Undo history
  const undoStackRef = useRef([]);
  const fsmRef = useRef(fsm);
  useEffect(() => { fsmRef.current = fsm; }, [fsm]);

  // Push current FSM state to undo stack (call before mutating)
  const pushUndo = useCallback(() => {
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(MAX_UNDO_HISTORY - 1)),
      JSON.parse(JSON.stringify(fsmRef.current)),
    ];
  }, []);

  // Undo: restore the previous FSM state
  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const stack = [...undoStackRef.current];
    const prev = stack.pop();
    undoStackRef.current = stack;
    setFsm(prev);
  }, []);

  // Keyboard shortcut for undo (Ctrl+Z / Cmd+Z)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo]);

  // Persist FSM changes
  useEffect(() => {
    saveFsm(fsm);
  }, [fsm]);

  // Track canvas size
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setCanvasSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Compute content bounds to cover all nodes (for SVG overlay)
  const contentSize = useMemo(() => {
    let maxX = canvasSize.width;
    let maxY = canvasSize.height;
    for (const state of fsm.states) {
      maxX = Math.max(maxX, state.position.x + STATE_WIDTH + 60);
      maxY = Math.max(maxY, state.position.y + STATE_HEIGHT + 60);
    }
    return { width: maxX, height: maxY };
  }, [fsm.states, canvasSize]);

  const selectedState = fsm.states.find((s) => s.id === selectedStateId);

  // Drag state nodes (accounting for zoom)
  const handleMouseDown = useCallback((e, stateId) => {
    e.stopPropagation();
    const state = fsm.states.find((s) => s.id === stateId);
    if (!state) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDraggingId(stateId);
    setDragOffset({
      x: (e.clientX - rect.left) / zoom - panOffset.x - state.position.x,
      y: (e.clientY - rect.top) / zoom - panOffset.y - state.position.y,
    });
    setSelectedStateId(stateId);
  }, [fsm.states, zoom, panOffset]);

  const handleMouseMove = useCallback((e) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPanOffset({
        x: panOffsetStartRef.current.x + dx / zoom,
        y: panOffsetStartRef.current.y + dy / zoom,
      });
      return;
    }
    if (!draggingId) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(0, (e.clientX - rect.left) / zoom - panOffset.x - dragOffset.x);
    const y = Math.max(0, (e.clientY - rect.top) / zoom - panOffset.y - dragOffset.y);
    setFsm((prev) => ({
      ...prev,
      states: prev.states.map((s) =>
        s.id === draggingId ? { ...s, position: { x, y } } : s
      ),
    }));
  }, [draggingId, dragOffset, isPanning, zoom, panOffset]);

  const handleMouseUp = useCallback(() => {
    setDraggingId(null);
    setIsPanning(false);
  }, []);

  // Canvas background drag for panning
  const handleCanvasMouseDown = useCallback((e) => {
    // Only left-click on canvas background initiates pan
    if (e.button !== 0) return;
    if (e.target !== canvasRef.current && !e.target.classList.contains('fsm-canvas-inner')) return;
    setIsPanning(true);
    panStartRef.current = { x: e.clientX, y: e.clientY };
    panOffsetStartRef.current = { ...panOffset };
  }, [panOffset]);

  // Mouse wheel for zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setZoom((prev) => {
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta));
    });
  }, []);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
  }, []);

  // Reset view (zoom and pan)
  const handleResetView = useCallback(() => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
  }, []);

  // Add a new state (optionally at a specific canvas position from context menu)
  const handleAddState = useCallback((posOverride) => {
    if (!newStateName.trim()) return;
    pushUndo();
    const pos = posOverride || { x: 200, y: 200 };
    const newState = {
      id: generateStateId(),
      name: newStateName.trim(),
      type: newStateType,
      commands: newStateType === 'action' ? [{ type: 'ls', paramName: '-la', description: '列出目录内容' }] : [],
      transitions: [],
      position: pos,
    };
    setFsm((prev) => ({
      ...prev,
      states: [...prev.states, newState],
    }));
    setNewStateName('');
    setShowAddState(false);
    setContextMenu(null);
  }, [newStateName, newStateType, pushUndo]);

  // Right-click context menu handler
  const handleContextMenu = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Convert screen coords to canvas coords (account for scroll)
    const scrollLeft = canvasRef.current.scrollLeft || 0;
    const scrollTop = canvasRef.current.scrollTop || 0;
    const canvasX = (e.clientX - rect.left + scrollLeft) / zoom - panOffset.x;
    const canvasY = (e.clientY - rect.top + scrollTop) / zoom - panOffset.y;
    // Check if a state node is under the cursor
    const targetState = fsm.states.find((s) =>
      canvasX >= s.position.x && canvasX <= s.position.x + STATE_WIDTH &&
      canvasY >= s.position.y && canvasY <= s.position.y + STATE_HEIGHT
    );
    setContextMenu({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      canvasX,
      canvasY,
      stateId: targetState?.id || null,
    });
  }, [fsm.states, zoom, panOffset]);

  // Close context menu
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Context menu: add state at clicked position
  const handleContextAddState = useCallback(() => {
    if (!contextMenu) return;
    setShowAddState(true);
    // Store position for when the form is submitted
    setContextMenu((prev) => prev ? { ...prev, addingState: true } : null);
  }, [contextMenu]);

  // Context menu: select state for editing
  const handleContextEditState = useCallback(() => {
    if (!contextMenu?.stateId) return;
    setSelectedStateId(contextMenu.stateId);
    setContextMenu(null);
  }, [contextMenu]);

  // Delete a state
  const handleDeleteState = useCallback((stateId) => {
    pushUndo();
    setFsm((prev) => ({
      ...prev,
      states: prev.states
        .filter((s) => s.id !== stateId)
        .map((s) => ({
          ...s,
          transitions: s.transitions.filter((t) => t.to !== stateId),
        })),
    }));
    if (selectedStateId === stateId) setSelectedStateId(null);
  }, [selectedStateId, pushUndo]);

  // Update state properties
  const handleUpdateState = useCallback((stateId, updates) => {
    setFsm((prev) => ({
      ...prev,
      states: prev.states.map((s) =>
        s.id === stateId ? { ...s, ...updates } : s
      ),
    }));
  }, []);

  // Add transition to a state
  const handleAddTransition = useCallback((stateId) => {
    const otherStates = fsm.states.filter((s) => s.id !== stateId);
    if (otherStates.length === 0) return;
    pushUndo();
    setFsm((prev) => ({
      ...prev,
      states: prev.states.map((s) =>
        s.id === stateId
          ? {
              ...s,
              transitions: [
                ...s.transitions,
                { to: otherStates[0].id, condition: '条件描述' },
              ],
            }
          : s
      ),
    }));
  }, [fsm.states, pushUndo]);

  // Update a transition
  const handleUpdateTransition = useCallback((stateId, transIndex, updates) => {
    setFsm((prev) => ({
      ...prev,
      states: prev.states.map((s) => {
        if (s.id !== stateId) return s;
        const transitions = [...s.transitions];
        transitions[transIndex] = { ...transitions[transIndex], ...updates };
        return { ...s, transitions };
      }),
    }));
  }, []);

  // Delete a transition
  const handleDeleteTransition = useCallback((stateId, transIndex) => {
    pushUndo();
    setFsm((prev) => ({
      ...prev,
      states: prev.states.map((s) => {
        if (s.id !== stateId) return s;
        return {
          ...s,
          transitions: s.transitions.filter((_, i) => i !== transIndex),
        };
      }),
    }));
  }, [pushUndo]);

  // Add command to a state
  const handleAddCommand = useCallback((stateId) => {
    pushUndo();
    setFsm((prev) => ({
      ...prev,
      states: prev.states.map((s) => {
        if (s.id !== stateId) return s;
        return {
          ...s,
          commands: [
            ...s.commands,
            { type: 'ls', paramName: '-la', description: '列出目录内容' },
          ],
        };
      }),
    }));
  }, [pushUndo]);

  // Update a command
  const handleUpdateCommand = useCallback((stateId, cmdIndex, updates) => {
    setFsm((prev) => ({
      ...prev,
      states: prev.states.map((s) => {
        if (s.id !== stateId) return s;
        const commands = [...s.commands];
        commands[cmdIndex] = { ...commands[cmdIndex], ...updates };
        return { ...s, commands };
      }),
    }));
  }, []);

  // Delete a command
  const handleDeleteCommand = useCallback((stateId, cmdIndex) => {
    pushUndo();
    setFsm((prev) => ({
      ...prev,
      states: prev.states.map((s) => {
        if (s.id !== stateId) return s;
        return {
          ...s,
          commands: s.commands.filter((_, i) => i !== cmdIndex),
        };
      }),
    }));
  }, [pushUndo]);

  // Context menu: delete state (declared after handleDeleteState)
  const handleContextDeleteState = useCallback(() => {
    if (!contextMenu?.stateId) return;
    handleDeleteState(contextMenu.stateId);
    setContextMenu(null);
  }, [contextMenu, handleDeleteState]);

  // Context menu: add transition to state (declared after handleAddTransition)
  const handleContextAddTransition = useCallback(() => {
    if (!contextMenu?.stateId) return;
    handleAddTransition(contextMenu.stateId);
    setSelectedStateId(contextMenu.stateId);
    setContextMenu(null);
  }, [contextMenu, handleAddTransition]);

  // Context menu: add command to state (declared after handleAddCommand)
  const handleContextAddCommand = useCallback(() => {
    if (!contextMenu?.stateId) return;
    handleAddCommand(contextMenu.stateId);
    setSelectedStateId(contextMenu.stateId);
    setContextMenu(null);
  }, [contextMenu, handleAddCommand]);

  // Draw transition arrows (SVG) – white lines with arrows at midpoints
  const renderTransitions = () => {
    const arrows = [];
    for (const state of fsm.states) {
      for (let ti = 0; ti < state.transitions.length; ti++) {
        const trans = state.transitions[ti];
        const target = fsm.states.find((s) => s.id === trans.to);
        if (!target) continue;

        const fromX = state.position.x + STATE_WIDTH / 2;
        const fromY = state.position.y + STATE_HEIGHT;
        const toX = target.position.x + STATE_WIDTH / 2;
        const toY = target.position.y;

        // Self-transition
        if (state.id === trans.to) {
          const cx = state.position.x + STATE_WIDTH + 30;
          const cy = state.position.y + STATE_HEIGHT / 2;
          arrows.push(
            <g key={`${state.id}-${ti}`}>
              <path
                d={`M ${state.position.x + STATE_WIDTH} ${state.position.y + STATE_HEIGHT / 2 - 10} C ${cx} ${cy - 30}, ${cx} ${cy + 30}, ${state.position.x + STATE_WIDTH} ${state.position.y + STATE_HEIGHT / 2 + 10}`}
                fill="none"
                stroke="#fff"
                strokeWidth="1.5"
                opacity="0.7"
              />
              {/* Arrow at midpoint of self-loop */}
              <polygon
                points={`${cx + 2} ${cy - 3}, ${cx + 2} ${cy + 3}, ${cx - 4} ${cy}`}
                fill="#fff"
                opacity="0.7"
              />
            </g>
          );
          continue;
        }

        // Curved path
        const midX = (fromX + toX) / 2;
        const midY = (fromY + toY) / 2;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const offset = ti * 15;
        const cx1 = midX - dy * 0.2 + offset;
        const cy1 = midY + dx * 0.2 + offset;

        // Calculate arrow position and direction on the quadratic bezier.
        // Use a point slightly towards the end so arrow points along the line direction.
        const t = ARROW_POSITION_T;
        const oneMinusT = 1 - t;
        const arrowX = oneMinusT * oneMinusT * fromX + 2 * oneMinusT * t * cx1 + t * t * toX;
        const arrowY = oneMinusT * oneMinusT * fromY + 2 * oneMinusT * t * cy1 + t * t * toY;
        // Tangent direction at t for Q curve: B'(t)=2(1-t)(P1-P0)+2t(P2-P1)
        const tangentX = 2 * oneMinusT * (cx1 - fromX) + 2 * t * (toX - cx1);
        const tangentY = 2 * oneMinusT * (cy1 - fromY) + 2 * t * (toY - cy1);
        const tangentLen = Math.sqrt(tangentX * tangentX + tangentY * tangentY) || 1;
        const nx = tangentX / tangentLen;
        const ny = tangentY / tangentLen;
        // Perpendicular
        const px = -ny;
        const py = nx;
        const arrowSize = 6;

        arrows.push(
          <g key={`${state.id}-${ti}`}>
            <path
              d={`M ${fromX} ${fromY} Q ${cx1} ${cy1} ${toX} ${toY}`}
              fill="none"
              stroke="#fff"
              strokeWidth="1.5"
              opacity="0.7"
            />
            {/* Arrow at midpoint */}
            <polygon
              points={`${arrowX + nx * arrowSize} ${arrowY + ny * arrowSize}, ${arrowX - nx * arrowSize + px * arrowSize * 0.6} ${arrowY - ny * arrowSize + py * arrowSize * 0.6}, ${arrowX - nx * arrowSize - px * arrowSize * 0.6} ${arrowY - ny * arrowSize - py * arrowSize * 0.6}`}
              fill="#fff"
              opacity="0.8"
            />
            <text
              x={cx1}
              y={cy1}
              fill="#ccc"
              fontSize="10"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {trans.condition.length > 12 ? trans.condition.slice(0, 12) + '...' : trans.condition}
            </text>
          </g>
        );
      }
    }
    return arrows;
  };

  return (
    <div className="fsm-designer" onClick={closeContextMenu}>
      <div className="fsm-designer-toolbar">
        <span className="fsm-designer-title">🔄 状态机设计器</span>
        <span className="fsm-designer-name">{fsm.name}</span>
        <div className="fsm-designer-actions">
          <button className="btn-icon" onClick={handleZoomOut} title="缩小">➖</button>
          <span className="fsm-zoom-label">{Math.round(zoom * 100)}%</span>
          <button className="btn-icon" onClick={handleZoomIn} title="放大">➕</button>
          <button className="btn-icon" onClick={handleResetView} title="复位视图">🎯</button>
          <button
            className="btn-icon"
            onClick={handleUndo}
            title="撤回 (Ctrl+Z)"
          >
            ↩️
          </button>
          <button
            className="btn-icon fsm-add-btn"
            onClick={() => setShowAddState(!showAddState)}
            title="添加状态"
          >
            ➕
          </button>
          <button
            className="btn-icon"
            onClick={() => setSelectedStateId(null)}
            title="取消选择"
          >
            ✖️
          </button>
        </div>
      </div>

      {showAddState && (
        <div className="fsm-add-state-form">
          <input
            value={newStateName}
            onChange={(e) => setNewStateName(e.target.value)}
            placeholder="状态名称"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const pos = contextMenu?.addingState ? { x: contextMenu.canvasX, y: contextMenu.canvasY } : undefined;
                handleAddState(pos);
              }
            }}
          />
          <select value={newStateType} onChange={(e) => setNewStateType(e.target.value)}>
            {Object.entries(STATE_TYPES).map(([key, val]) => (
              <option key={key} value={key}>{val.icon} {val.label}</option>
            ))}
          </select>
          <button className="btn-primary" onClick={() => {
            const pos = contextMenu?.addingState ? { x: contextMenu.canvasX, y: contextMenu.canvasY } : undefined;
            handleAddState(pos);
          }}>添加</button>
          <button className="btn-secondary" onClick={() => { setShowAddState(false); setContextMenu(null); }}>取消</button>
        </div>
      )}

      {/* Canvas area */}
      <div
        className={`fsm-canvas ${isPanning ? 'fsm-canvas-panning' : ''}`}
        ref={canvasRef}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
        onClick={() => {
          setSelectedStateId(null);
          closeContextMenu();
        }}
      >
        {/* Transformed inner layer for zoom & pan */}
        <div
          className="fsm-canvas-inner"
          style={{
            transform: `scale(${zoom}) translate(${panOffset.x}px, ${panOffset.y}px)`,
            transformOrigin: '0 0',
          }}
        >
          {/* SVG layer for arrows */}
          <svg className="fsm-svg-layer" width={contentSize.width} height={contentSize.height}>
            {renderTransitions()}
          </svg>

          {/* State nodes */}
          {fsm.states.map((state) => {
            const typeInfo = STATE_TYPES[state.type] || STATE_TYPES.action;
            const isActive = state.id === activeStateId;
            const isSelected = state.id === selectedStateId;

            return (
              <div
                key={state.id}
                className={`fsm-state-node ${isActive ? 'fsm-active' : ''} ${isSelected ? 'fsm-selected' : ''}`}
                style={{
                  left: state.position.x,
                  top: state.position.y,
                  width: STATE_WIDTH,
                  minHeight: STATE_HEIGHT,
                  borderColor: typeInfo.color,
                }}
                onMouseDown={(e) => handleMouseDown(e, state.id)}
                onClick={(e) => { e.stopPropagation(); setSelectedStateId(state.id); }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const rect = canvasRef.current?.getBoundingClientRect();
                  if (!rect) return;
                  setContextMenu({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    canvasX: state.position.x,
                    canvasY: state.position.y,
                    stateId: state.id,
                  });
                }}
              >
                <div className="fsm-state-header" style={{ background: typeInfo.color }}>
                  <span>{typeInfo.icon} {state.name}</span>
                </div>
                <div className="fsm-state-body">
                  {state.commands.length > 0 && (
                    <div className="fsm-state-commands-preview">
                      {state.commands.map((cmd, i) => (
                        <span key={i} className="fsm-cmd-tag">{cmd.type}</span>
                      ))}
                    </div>
                  )}
                  {state.transitions.length > 0 && (
                    <div className="fsm-state-trans-count">
                      → {state.transitions.length} 个转换
                    </div>
                  )}
                </div>
                {isActive && <div className="fsm-active-indicator">🔄 当前</div>}
              </div>
            );
          })}
        </div>

        {/* Right-click context menu (positioned in screen coords, outside transform) */}
        {contextMenu && (
          <div
            className="fsm-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.stateId ? (
              <>
                <div className="fsm-context-menu-header">
                  {fsm.states.find((s) => s.id === contextMenu.stateId)?.name || '状态'}
                </div>
                <button onClick={handleContextEditState}>📝 编辑属性</button>
                <button onClick={handleContextAddTransition}>🔗 添加转换</button>
                <button onClick={handleContextAddCommand}>⚡ 添加指令</button>
                {fsm.states.find((s) => s.id === contextMenu.stateId)?.type !== 'start' && (
                  <button className="fsm-context-delete" onClick={handleContextDeleteState}>🗑️ 删除状态</button>
                )}
              </>
            ) : (
              <>
                <button onClick={handleContextAddState}>➕ 在此添加状态</button>
                <button onClick={handleResetView}>🎯 复位视图</button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Properties panel for selected state */}
      {selectedState && (
        <div className="fsm-properties">
          <div className="fsm-properties-header">
            <h4>📝 状态属性: {selectedState.name}</h4>
            {selectedState.type !== 'start' && (
              <button
                className="btn-icon fsm-delete-btn"
                onClick={() => handleDeleteState(selectedState.id)}
                title="删除状态"
              >
                🗑️
              </button>
            )}
          </div>

          <div className="fsm-prop-group">
            <label>名称</label>
            <input
              value={selectedState.name}
              onChange={(e) => handleUpdateState(selectedState.id, { name: e.target.value })}
            />
          </div>

          <div className="fsm-prop-group">
            <label>类型</label>
            <select
              value={selectedState.type}
              onChange={(e) => handleUpdateState(selectedState.id, { type: e.target.value })}
            >
              {Object.entries(STATE_TYPES).map(([key, val]) => (
                <option key={key} value={key}>{val.icon} {val.label}</option>
              ))}
            </select>
          </div>

          {/* Commands */}
          <div className="fsm-prop-group">
            <label>
              可执行指令
              <button className="btn-icon" onClick={() => handleAddCommand(selectedState.id)} title="添加指令">➕</button>
            </label>
            {selectedState.commands.map((cmd, i) => (
              <div key={i} className="fsm-cmd-editor">
                <input
                  value={cmd.type}
                  onChange={(e) => handleUpdateCommand(selectedState.id, i, { type: e.target.value })}
                  placeholder="指令类型 (如: cd, ls)"
                />
                <input
                  value={cmd.paramName}
                  onChange={(e) => handleUpdateCommand(selectedState.id, i, { paramName: e.target.value })}
                  placeholder="参数名"
                />
                <input
                  value={cmd.description}
                  onChange={(e) => handleUpdateCommand(selectedState.id, i, { description: e.target.value })}
                  placeholder="描述"
                />
                <button className="btn-icon" onClick={() => handleDeleteCommand(selectedState.id, i)} title="删除">✕</button>
              </div>
            ))}
          </div>

          {/* Transitions */}
          <div className="fsm-prop-group">
            <label>
              状态转换
              <button className="btn-icon" onClick={() => handleAddTransition(selectedState.id)} title="添加转换">➕</button>
            </label>
            {selectedState.transitions.map((trans, i) => (
              <div key={i} className="fsm-trans-editor">
                <select
                  value={trans.to}
                  onChange={(e) => handleUpdateTransition(selectedState.id, i, { to: e.target.value })}
                >
                  {fsm.states.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <input
                  value={trans.condition}
                  onChange={(e) => handleUpdateTransition(selectedState.id, i, { condition: e.target.value })}
                  placeholder="转换条件描述"
                />
                <button className="btn-icon" onClick={() => handleDeleteTransition(selectedState.id, i)} title="删除">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
