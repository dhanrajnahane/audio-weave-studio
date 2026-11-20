import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  GitBranch,
  Plus,
  Trash2,
  Power,
  RotateCcw,
  Info,
  Sliders,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { audioGraphModel } from '../audio/routing/AudioGraphModel';
import { audioGraphProcessor } from '../audio/routing/AudioGraphProcessor';
import { AudioNodeData, AudioNodeType, NODE_PARAM_DEFINITIONS } from '../audio/routing/types';
import { audioEngine } from '../audio/AudioEngine';

export const AudioRoutingGraph: React.FC = () => {
  const [nodes, setNodes] = useState<AudioNodeData[]>([]);
  const [connections, setConnections] = useState(audioGraphModel.getAllConnections());
  const [topologicalOrder, setTopologicalOrder] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Connecting cable drag state
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Canvas pan / drag node state
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);

  // Refresh state from graph model
  const refreshGraph = useCallback(() => {
    setNodes(audioGraphModel.getAllNodes());
    setConnections(audioGraphModel.getAllConnections());
    const topo = audioGraphModel.getTopologicalOrder();
    setTopologicalOrder(topo.topologicalOrder || []);
  }, []);

  useEffect(() => {
    // Ensure processor is connected to AudioEngine
    audioGraphProcessor.setGraphModel(audioGraphModel);
    audioEngine.connectGraphProcessor(audioGraphProcessor);

    refreshGraph();
    const unsub = audioGraphModel.subscribe(refreshGraph);
    return () => unsub();
  }, [refreshGraph]);

  // Handle adding a new node
  const handleAddNode = (type: AudioNodeType) => {
    setErrorMessage(null);
    const existing = audioGraphModel.getAllNodes();
    const newX = 250 + (existing.length % 4) * 80;
    const newY = 140 + (existing.length % 3) * 60;
    const node = audioGraphModel.addNode(type, newX, newY);
    setSelectedNodeId(node.id);
  };

  // Node Dragging
  const handleMouseDownNode = (e: React.MouseEvent, nodeId: string) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') {
      return;
    }
    const node = audioGraphModel.getNode(nodeId);
    if (!node || !containerRef.current) return;

    setSelectedNodeId(nodeId);
    setDraggingNodeId(nodeId);
    setDragOffset({
      x: e.clientX - node.x,
      y: e.clientY - node.y,
    });
  };

  // Global Mouse Move & Mouse Up for Wiring and Node Dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const currentMouse = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      if (connectingFromId) {
        setMousePos(currentMouse);
      }

      if (draggingNodeId) {
        const newX = Math.max(20, e.clientX - dragOffset.x);
        const newY = Math.max(20, e.clientY - dragOffset.y);
        audioGraphModel.updateNodePosition(draggingNodeId, newX, newY);
      }
    };

    const handleMouseUp = () => {
      if (connectingFromId) {
        setConnectingFromId(null);
        setMousePos(null);
      }
      if (draggingNodeId) {
        setDraggingNodeId(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [connectingFromId, draggingNodeId, dragOffset]);

  // Start drag connection from Output Port
  const handleStartConnection = (e: React.MouseEvent, fromId: string) => {
    e.stopPropagation();
    setErrorMessage(null);
    setConnectingFromId(fromId);
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  };

  // Drop connection onto Input Port
  const handleDropConnection = (e: React.MouseEvent, toId: string) => {
    e.stopPropagation();
    if (!connectingFromId) return;

    const res = audioGraphModel.connect(connectingFromId, toId);
    if (!res.success) {
      setErrorMessage(res.reason || 'Invalid connection');
      setTimeout(() => setErrorMessage(null), 5000);
    } else {
      setErrorMessage(null);
    }
    setConnectingFromId(null);
    setMousePos(null);
  };

  // Node parameter change (immediately updates live Web Audio node!)
  const handleParamChange = (nodeId: string, paramName: string, val: number) => {
    audioGraphModel.updateNodeParam(nodeId, paramName, val);
    audioGraphProcessor.updateParam(nodeId, paramName, val);
  };

  // Node bypass toggle
  const handleToggleBypass = (nodeId: string) => {
    const bypassed = audioGraphModel.toggleBypass(nodeId);
    audioGraphProcessor.setBypass(nodeId, bypassed);
  };

  // Node deletion
  const handleDeleteNode = (nodeId: string) => {
    audioGraphModel.removeNode(nodeId);
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  };

  // Connection deletion
  const handleDeleteConnection = (connId: string) => {
    audioGraphModel.disconnect(connId);
  };

  const selectedNode = selectedNodeId ? audioGraphModel.getNode(selectedNodeId) : null;
  const paramConfigs = selectedNode ? NODE_PARAM_DEFINITIONS[selectedNode.type] || [] : [];

  return (
    <div className="h-full flex flex-col bg-[#0a0c10] text-zinc-100 select-none overflow-hidden relative">
      {/* 1. Toolbar */}
      <div className="h-12 px-4 bg-[#11141c] border-b border-[#1f2533] flex items-center justify-between text-xs shrink-0 z-20">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-zinc-200">
            <GitBranch className="w-4 h-4 text-blue-400" />
            <span>Audio Routing DAG</span>
          </div>
          <span className="text-zinc-500 font-mono text-[11px]">|</span>

          {/* Add Node Dropdown / Buttons */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-zinc-400 font-medium">Add Node:</span>
            {(
              [
                ['gain', 'Gain'],
                ['eq', 'EQ'],
                ['compressor', 'Comp'],
                ['delay', 'Delay'],
                ['reverb', 'Reverb'],
                ['lowpass', 'LowPass'],
                ['highpass', 'HighPass'],
                ['pan', 'Pan'],
              ] as [AudioNodeType, string][]
            ).map(([type, label]) => (
              <button
                key={type}
                onClick={() => handleAddNode(type)}
                className="px-2 py-1 rounded bg-[#1a202c] hover:bg-[#252e3f] text-zinc-200 border border-[#2b3548] text-[11px] font-medium transition-colors flex items-center gap-1"
                title={`Add ${label} node to graph`}
              >
                <Plus className="w-3 h-3 text-cyan-400" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Presets & Reset */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-400">Presets:</span>
          <button
            onClick={() => audioGraphModel.loadPreset('direct')}
            className="px-2 py-1 rounded bg-[#161a24] hover:bg-[#222838] text-zinc-300 border border-[#2b3348] text-[11px]"
          >
            Direct
          </button>
          <button
            onClick={() => audioGraphModel.loadPreset('vocal_warmth')}
            className="px-2 py-1 rounded bg-[#161a24] hover:bg-[#222838] text-amber-300 border border-amber-500/30 text-[11px]"
          >
            Vocal Chain
          </button>
          <button
            onClick={() => audioGraphModel.loadPreset('space_echo')}
            className="px-2 py-1 rounded bg-[#161a24] hover:bg-[#222838] text-cyan-300 border border-cyan-500/30 text-[11px]"
          >
            Space Echo
          </button>
          <button
            onClick={() => audioGraphModel.loadPreset('lofi_filter')}
            className="px-2 py-1 rounded bg-[#161a24] hover:bg-[#222838] text-purple-300 border border-purple-500/30 text-[11px]"
          >
            Lo-Fi Filter
          </button>

          <button
            onClick={() => audioGraphModel.initDefaultGraph()}
            className="p-1.5 rounded hover:bg-[#222838] text-zinc-400 hover:text-zinc-200"
            title="Reset to default graph"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Error / Cycle Banner */}
      {errorMessage && (
        <div className="bg-red-950/80 border-b border-red-500/40 text-red-200 px-4 py-2 text-xs flex items-center justify-between shrink-0 z-20 animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="font-medium">{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-300 hover:text-white text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 2. Main Workspace: Canvas + Parameters Sidebar */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Graph Canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden bg-[#07090d] cursor-crosshair"
          style={{
            backgroundImage:
              'radial-gradient(#1c2230 1px, transparent 1px), radial-gradient(#141924 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            backgroundPosition: '0 0, 12px 12px',
          }}
          onClick={() => setSelectedNodeId(null)}
        >
          {/* SVG Connection Cables */}
          <svg className="w-full h-full absolute inset-0 pointer-events-none z-10">
            <defs>
              <linearGradient id="cableGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>

            {/* Existing Connections */}
            {connections.map((conn) => {
              const fromNode = audioGraphModel.getNode(conn.fromNodeId);
              const toNode = audioGraphModel.getNode(conn.toNodeId);
              if (!fromNode || !toNode) return null;

              // Output port position: node.x + 180, node.y + 40
              const x1 = fromNode.x + 180;
              const y1 = fromNode.y + 36;
              // Input port position: node.x, node.y + 40
              const x2 = toNode.x;
              const y2 = toNode.y + 36;

              const dx = Math.abs(x2 - x1) * 0.5;
              const pathData = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

              return (
                <g key={conn.id} className="cursor-pointer pointer-events-auto group">
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#1e293b"
                    strokeWidth="8"
                    strokeLinecap="round"
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConnection(conn.id);
                    }}
                  />
                  <path
                    d={pathData}
                    fill="none"
                    stroke="url(#cableGrad)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className="drop-shadow-[0_0_8px_rgba(6,182,212,0.4)]"
                  />
                  {/* Midpoint Delete Dot on hover */}
                  <circle
                    cx={(x1 + x2) / 2}
                    cy={(y1 + y2) / 2}
                    r="6"
                    fill="#ef4444"
                    className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConnection(conn.id);
                    }}
                  />
                </g>
              );
            })}

            {/* Currently Dragging Connection Cable */}
            {connectingFromId && mousePos && (
              (() => {
                const fromNode = audioGraphModel.getNode(connectingFromId);
                if (!fromNode) return null;
                const x1 = fromNode.x + 180;
                const y1 = fromNode.y + 36;
                const x2 = mousePos.x;
                const y2 = mousePos.y;
                const dx = Math.abs(x2 - x1) * 0.5;
                const pathData = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;

                return (
                  <path
                    d={pathData}
                    fill="none"
                    stroke="#22d3ee"
                    strokeWidth="3"
                    strokeDasharray="6 3"
                    className="animate-pulse drop-shadow-[0_0_12px_rgba(34,211,238,0.7)]"
                  />
                );
              })()
            )}
          </svg>

          {/* Nodes */}
          {nodes.map((node) => {
            const isSelected = selectedNodeId === node.id;
            const isBoundary = node.type === 'input' || node.type === 'output';
            const isInput = node.type === 'input';
            const isOutput = node.type === 'output';

            const typeColorMap: Record<AudioNodeType, string> = {
              input: 'from-blue-600 to-indigo-600',
              output: 'from-emerald-600 to-teal-600',
              gain: 'from-zinc-700 to-zinc-800',
              eq: 'from-amber-600 to-yellow-600',
              compressor: 'from-rose-600 to-red-600',
              reverb: 'from-indigo-600 to-purple-600',
              delay: 'from-cyan-600 to-blue-600',
              lowpass: 'from-orange-600 to-amber-600',
              highpass: 'from-sky-600 to-cyan-600',
              pan: 'from-violet-600 to-fuchsia-600',
            };

            return (
              <div
                key={node.id}
                onMouseDown={(e) => handleMouseDownNode(e, node.id)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNodeId(node.id);
                }}
                style={{
                  transform: `translate(${node.x}px, ${node.y}px)`,
                }}
                className={`absolute w-44 rounded-xl border transition-shadow cursor-move z-10 ${
                  isSelected
                    ? 'border-cyan-400/90 shadow-[0_0_16px_rgba(6,182,212,0.3)] bg-[#121622]'
                    : node.bypassed
                    ? 'border-zinc-700/40 bg-[#0d0f14]/80 opacity-60'
                    : 'border-[#222a3b] bg-[#111520] hover:border-[#333e54] shadow-lg'
                }`}
              >
                {/* Node Header */}
                <div
                  className={`px-3 py-2 rounded-t-xl bg-gradient-to-r ${
                    typeColorMap[node.type]
                  } flex items-center justify-between text-xs font-semibold text-white shadow-sm`}
                >
                  <span className="truncate">{node.name}</span>
                  <div className="flex items-center gap-1">
                    {!isBoundary && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleBypass(node.id);
                        }}
                        className={`p-0.5 rounded transition-colors ${
                          node.bypassed
                            ? 'text-zinc-400 hover:text-white'
                            : 'text-emerald-300 hover:text-white'
                        }`}
                        title={node.bypassed ? 'Node Bypassed (Click to Enable)' : 'Bypass Node'}
                      >
                        <Power className="w-3 h-3" />
                      </button>
                    )}
                    {!isBoundary && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteNode(node.id);
                        }}
                        className="p-0.5 rounded text-white/70 hover:text-white hover:bg-black/20"
                        title="Delete node"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Node Body with Quick Value Display */}
                <div className="p-2.5 text-[11px] text-zinc-300 space-y-1">
                  <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono">
                    <span>TYPE: {node.type.toUpperCase()}</span>
                    {node.bypassed && <span className="text-amber-400 font-bold">BYPASS</span>}
                  </div>

                  {/* Primary Parameter Preview */}
                  {Object.entries(node.params).slice(0, 2).map(([key, val]) => (
                    <div key={key} className="flex justify-between font-mono text-[11px] text-zinc-300">
                      <span className="text-zinc-500 capitalize">{key}:</span>
                      <span>{typeof val === 'number' ? val.toFixed(1) : val}</span>
                    </div>
                  ))}
                </div>

                {/* Input Connection Port (Left) */}
                {!isInput && (
                  <div
                    onMouseUp={(e) => handleDropConnection(e, node.id)}
                    className="absolute -left-2.5 top-[30px] w-5 h-5 rounded-full bg-[#182030] border-2 border-cyan-400 hover:bg-cyan-500 hover:scale-125 transition-all cursor-pointer flex items-center justify-center shadow-md"
                    title={`Connect input to ${node.name}`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-300" />
                  </div>
                )}

                {/* Output Connection Port (Right) */}
                {!isOutput && (
                  <div
                    onMouseDown={(e) => handleStartConnection(e, node.id)}
                    className="absolute -right-2.5 top-[30px] w-5 h-5 rounded-full bg-[#182030] border-2 border-blue-400 hover:bg-blue-500 hover:scale-125 transition-all cursor-pointer flex items-center justify-center shadow-md"
                    title={`Drag output cable from ${node.name}`}
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-300" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 3. Right Sidebar: Node Parameters & Topological Dependency Inspector */}
        <div className="w-72 bg-[#0e1118] border-l border-[#1f2533] p-4 flex flex-col justify-between shrink-0 overflow-y-auto">
          {selectedNode ? (
            <div className="space-y-4">
              <div className="border-b border-[#222a3a] pb-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                  <Sliders className="w-4 h-4 text-cyan-400" />
                  <span>Node Parameters</span>
                </div>
                <h3 className="text-sm font-bold text-white mt-1">{selectedNode.name}</h3>
                <span className="text-[11px] text-zinc-400 font-mono uppercase">
                  Type: {selectedNode.type}
                </span>
              </div>

              {/* Parameter Sliders */}
              <div className="space-y-3">
                {paramConfigs.length === 0 ? (
                  <p className="text-xs text-zinc-500 italic">No adjustable parameters for this node.</p>
                ) : (
                  paramConfigs.map((cfg) => {
                    const currentVal = selectedNode.params[cfg.name] ?? cfg.defaultValue;

                    return (
                      <div key={cfg.name} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-zinc-300">{cfg.label}</span>
                          <span className="font-mono text-cyan-400">
                            {currentVal.toFixed(cfg.step < 0.1 ? 2 : 1)} {cfg.unit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={cfg.min}
                          max={cfg.max}
                          step={cfg.step}
                          value={currentVal}
                          onChange={(e) =>
                            handleParamChange(selectedNode.id, cfg.name, parseFloat(e.target.value))
                          }
                          className="w-full accent-cyan-400 h-1.5 bg-[#1b2230] rounded cursor-pointer"
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="text-center py-10 text-zinc-500 text-xs space-y-2">
              <Info className="w-6 h-6 mx-auto text-zinc-600" />
              <p>Select any node in the graph to inspect and tweak its live audio parameters.</p>
            </div>
          )}

          {/* Topological Dependency Chain Inspector */}
          <div className="border-t border-[#1f2533] pt-3 mt-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>DAG Processing Order</span>
            </div>
            <p className="text-[11px] text-zinc-500">
              Calculated via Kahn's Topological Sorting algorithm:
            </p>
            <div className="bg-[#090b10] border border-[#1b212e] rounded-lg p-2 font-mono text-[10px] text-zinc-300 space-y-1">
              {topologicalOrder.map((nodeId, idx) => {
                const n = audioGraphModel.getNode(nodeId);
                return (
                  <div key={nodeId} className="flex items-center gap-1">
                    <span className="text-zinc-500 w-4">{idx + 1}.</span>
                    <span className="text-cyan-300 font-medium truncate">{n?.name || nodeId}</span>
                    <span className="text-zinc-600 text-[9px]">({n?.type})</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
