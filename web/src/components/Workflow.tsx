import { Dialog } from '@animate-ui/react/primitives/radix-ui/dialog';
import { WorkflowResources, resourcesForStage, type ResourceFlowNode } from './WorkflowResources';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  ReactFlow,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  type NodeProps,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Scan,
  X,
} from 'lucide-react';
import type {
  Workflow as WorkflowData,
  WorkflowNode,
  Artifact,
  ChatMessage,
} from '../../shared/types';
import { ResearchActivity } from './ResearchActivity';
import { getStageStartMessages } from '../lib/research-navigation';

type StageNode = Node<WorkflowNode & Record<string, unknown>, 'stage'>;
const STAGE_WIDTH = 280;
const STAGE_HEIGHT = 152;
const STAGE_GAP = 72;
const RESOURCE_GAP = 28;

function Stage({ data }: NodeProps<StageNode>) {
  const expanded = !!data.expanded;
  const navigate = data.onNavigate as (() => void) | undefined;
  const done = data.status === 'completed';
  const failed = data.status === 'failed' || data.status === 'cancelled';
  return (
    <div
      className={`flow-node nodrag${expanded ? ' expanded' : ''}`}
      data-status={data.status}
      data-optional={!!data.optional}
      data-navigable={!!navigate}
      title={navigate ? '点击定位到该阶段的起始会话' : '该阶段暂无会话记录'}
      onClick={navigate}
      aria-label={`${data.label}，${{ pending: '等待中', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已停止' }[data.status]}`}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <span className="node-dot">{done && <Check size={9} />}</span>
      <div className="node-header">
        <button
          className="node-navigate"
          aria-label={`定位${data.label}阶段的起始会话`}
          disabled={!navigate}
          onClick={(event) => {
            event.stopPropagation();
            navigate?.();
          }}
        >
          <strong>{data.label}</strong>
        </button>
        <button
          className="node-expand"
          aria-label={expanded ? '收起详情' : '展开详情'}
          onClick={(event) => {
            event.stopPropagation();
            (data.onToggleExpand as () => void)?.();
          }}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>
      <p className="node-desc" title={data.description}>
        {data.description}
      </p>
      {expanded && (
        <div className="node-detail">
          {!!data.criteria?.length && (
            <div className="node-section">
              <span className="node-section-title">验收条件</span>
              <ul className="node-criteria-list">
                {data.criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          {data.reason && (
            <div className="node-section">
              <span className="node-section-title">{failed ? '阻塞原因' : '说明'}</span>
              <p className="node-reason">{data.reason}</p>
            </div>
          )}
        </div>
      )}
      {!expanded && data.reason && (
        <p className="node-reason" title={data.reason}>
          {data.reason}
        </p>
      )}
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}
const nodeTypes = { stage: Stage, resources: WorkflowResources };
type FlowNode = StageNode | ResourceFlowNode;
function FlowCanvas({
  workflow,
  stageStarts,
  onNavigateToMessage,
  full = false,
  running = false,
  onInit,
  artifacts = [],
  onPreviewFile,
}: {
  workflow: WorkflowData;
  stageStarts: Map<string, string>;
  onNavigateToMessage: (messageId: string) => void;
  full?: boolean;
  running?: boolean;
  onInit?: (inst: ReactFlowInstance<FlowNode>) => void;
  artifacts?: Artifact[];
  onPreviewFile: (path: string, name: string) => void;
}) {
  const [instance, setInstance] = useState<ReactFlowInstance<FlowNode> | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const handleInit = (inst: ReactFlowInstance<FlowNode>) => {
    setInstance(inst);
    onInit?.(inst);
  };
  const toggleExpand = (id: string) => {
    setExpandedNodes((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const nodes: FlowNode[] = useMemo(() => {
    const result: FlowNode[] = [];
    for (const [index, node] of workflow.nodes.entries()) {
      const x = 20 + index * (STAGE_WIDTH + STAGE_GAP);
      const resources = resourcesForStage(node, artifacts);
      const isExpanded = expandedNodes.has(node.id);
      result.push({
        id: node.id,
        type: 'stage',
        position: { x, y: 0 },
        style: { width: STAGE_WIDTH, minHeight: STAGE_HEIGHT },
        data: {
          ...node,
          expanded: isExpanded,
          onToggleExpand: () => toggleExpand(node.id),
          onNavigate: stageStarts.has(node.id)
            ? () => onNavigateToMessage(stageStarts.get(node.id)!)
            : undefined,
        },
      });
      if (resources.length)
        result.push({
          id: `resources-${node.id}`,
          type: 'resources',
          style: {
            pointerEvents: 'all',
            width: STAGE_WIDTH,
            display: isExpanded ? 'none' : undefined,
          },
          position: { x, y: STAGE_HEIGHT + RESOURCE_GAP },
          data: { stageId: node.id, resources, onPreview: onPreviewFile },
        });
    }
    return result;
  }, [workflow, artifacts, onPreviewFile, expandedNodes, stageStarts, onNavigateToMessage]);
  const [renderedNodes, setRenderedNodes, onNodesChange] = useNodesState<FlowNode>([]);
  useEffect(() => {
    setRenderedNodes((previous) => {
      const measurements = new Map(previous.map((node) => [node.id, node.measured]));
      return nodes.map((node) => ({ ...node, measured: measurements.get(node.id) }));
    });
  }, [nodes, setRenderedNodes]);
  const edges = useMemo(
    () => [
      ...workflow.edges.map((e, i) => {
        const source = workflow.nodes.find((n) => n.id === e.source);
        const target = workflow.nodes.find((n) => n.id === e.target);
        const color =
          source?.status === 'completed'
            ? target?.status === 'running'
              ? '#1769ff'
              : '#33bb7a'
            : '#c9d0dc';
        return {
          id: `edge-${i}`,
          source: e.source,
          target: e.target,
          type: 'smoothstep',
          sourceHandle: 'right',
          targetHandle: 'left',
          animated: target?.status === 'running',
          style: {
            stroke: color,
            strokeWidth: 1.5,
            strokeDasharray: e.optional ? '5 4' : undefined,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        };
      }),
      ...nodes
        .filter((node) => node.type === 'resources')
        .map((node) => ({
          id: `resource-edge-${node.id}`,
          source: node.data.stageId as string,
          target: node.id,
          type: 'smoothstep',
          sourceHandle: 'bottom',
          targetHandle: undefined,
          animated: false,
          style: { stroke: '#a8b9d2', strokeWidth: 1.3, strokeDasharray: undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#a8b9d2', width: 12, height: 12 },
        })),
    ],
    [workflow, nodes],
  );
  useEffect(() => {
    if (!instance || !element.current || !full) return;
    let timer: ReturnType<typeof setTimeout>;
    let initial = true;
    const observer = new ResizeObserver(() => {
      if (initial) {
        initial = false;
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          void instance.fitView({
            padding: full ? 0.3 : 0.12,
            minZoom: full ? 0.3 : 0.75,
            maxZoom: 1,
            duration: 160,
          }),
        180,
      );
    });
    observer.observe(element.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [instance, full]);
  return (
    <div className="flow-canvas" ref={element} data-testid="flow-canvas">
      {!nodes.length && (
        <div className="artifact-empty">
          <p>研究计划生成后，将在这里显示实际研究节点。</p>
        </div>
      )}
      {/* Top-right status pill */}
      <div className={`canvas-status${running ? ' active' : ''}`}>
        <span className="status-dot" />
        {running ? '运行中' : '就位'}
      </div>
      <ReactFlow<FlowNode>
        nodes={renderedNodes}
        onNodesChange={onNodesChange}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={handleInit}
        fitView={full}
        defaultViewport={{ x: 28, y: 24, zoom: 0.85 }}
        fitViewOptions={{ padding: full ? 0.2 : 0.12, minZoom: 0.25, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={2.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
      >
        <Background gap={18} size={0.7} color="#dfe5ee" />
      </ReactFlow>
    </div>
  );
}
export function Workflow({
  workflow,
  onClose,
  artifacts,
  onPreviewFile,
  running,
  messages,
  onNavigateToMessage,
}: {
  running: boolean;
  messages: ChatMessage[];
  onNavigateToMessage: (messageId: string) => void;
  workflow: WorkflowData;
  onClose: () => void;
  artifacts: Artifact[];
  onPreviewFile: (path: string, name: string) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const instanceRef = useRef<ReactFlowInstance<FlowNode> | null>(null);
  const stageStarts = useMemo(() => getStageStartMessages(workflow, messages), [workflow, messages]);
  const navigate = (messageId: string) => {
    setFullscreen(false);
    onNavigateToMessage(messageId);
  };
  const preview = (path: string, name: string) => {
    setFullscreen(false);
    onPreviewFile(path, name);
  };
  const header = (
    <>
      <h2>研究节点</h2>
    </>
  );
  return (
    <>
      <section className="flow-section">
        <div className="section-header">
          {header}
          <div className="flow-header-controls">
            <button
              className="icon-button"
              aria-label="适应流程图"
              title="查看完整流程"
              onClick={() =>
                void instanceRef.current?.fitView({
                  padding: 0.12,
                  minZoom: 0.25,
                  maxZoom: 1,
                  duration: 160,
                })
              }
            >
              <Scan size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="缩小流程图"
              onClick={() => void instanceRef.current?.zoomOut({ duration: 150 })}
            >
              <Minus size={14} />
            </button>
            <button
              className="icon-button"
              aria-label="放大流程图"
              onClick={() => void instanceRef.current?.zoomIn({ duration: 150 })}
            >
              <Plus size={14} />
            </button>
            <button
              className="icon-button"
              title="全屏查看"
              aria-label="全屏查看研究节点"
              onClick={() => setFullscreen(true)}
            >
              <Maximize2 size={14} />
            </button>
            <button
              className="icon-button"
              title="关闭研究节点"
              aria-label="关闭研究节点"
              onClick={onClose}
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <FlowCanvas
          workflow={workflow}
          stageStarts={stageStarts}
          onNavigateToMessage={navigate}
          artifacts={artifacts}
          onPreviewFile={preview}
          running={running}
          onInit={(inst) => (instanceRef.current = inst)}
        />
        <div className="flow-legend">
          <span>
            <i className="legend-dot completed" />
            完成
          </span>
          <span>
            <i className="legend-dot running" />
            进行
          </span>
          <span>
            <i className="legend-dot pending" />
            计划
          </span>
          <span>
            <i className="legend-dot optional" />
            可选
          </span>
          <span className="flow-pan-hint">左右拖动查看后续节点</span>
        </div>
        <ResearchActivity messages={messages} />
      </section>
      {fullscreen && (
        <Dialog.Root open onOpenChange={setFullscreen}>
          <Dialog.Portal>
            <Dialog.Overlay className="settings-overlay" />
            <Dialog.Content
              className="flow-fullscreen"
              aria-describedby={undefined}
              aria-label="研究节点全屏画布"
            >
              <Dialog.Title className="sr-only">研究节点全屏画布</Dialog.Title>
              <div className="section-header">
                {header}
                <button
                  className="icon-button"
                  aria-label="退出全屏"
                  onClick={() => {
                    setFullscreen(false);
                  }}
                >
                  <Minimize2 size={18} />
                </button>
              </div>
              <FlowCanvas
                workflow={workflow}
                stageStarts={stageStarts}
                onNavigateToMessage={navigate}
                artifacts={artifacts}
                onPreviewFile={preview}
                full
                running={running}
              />
              <div className="flow-legend">拖动画布平移，滚轮缩放，点击适应画布查看完整流程</div>
              <ResearchActivity messages={messages} />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
