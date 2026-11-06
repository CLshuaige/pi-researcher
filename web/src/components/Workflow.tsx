import { presentationRole } from '../../shared/types';
import { PresentationView } from './PresentationView';
import { Dialog } from '@animate-ui/react/primitives/radix-ui/dialog';
import { WorkflowResources, resourcesForStage, type ResourceFlowNode } from './WorkflowResources';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronLeft,
  ChevronRight,
  Target,
  LibraryBig,
  Lightbulb,
  Compass,
  FlaskConical,
  FileText,
  ScanSearch,
  RefreshCw,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Scan,
  X,
} from 'lucide-react';
import type {
  PresentationState,
  PresentationStage,
  Workflow as WorkflowData,
  WorkflowNode,
  Artifact,
  ChatMessage,
} from '../../shared/types';
import { ResearchActivity } from './ResearchActivity';
import { getStageStartMessages } from '../lib/research-navigation';

type StageNode = Node<WorkflowNode & Record<string, unknown>, 'stage'>;
const STAGE_GAP = 72;
const RESOURCE_GAP = 28;
const ROLE_ICONS = {
  task: Target,
  literature: LibraryBig,
  hypothesis: Lightbulb,
  method: Compass,
  experiment: FlaskConical,
  report: FileText,
  review: ScanSearch,
};
function Stage({ data }: NodeProps<StageNode>) {
  const navigate = data.onNavigate as (() => void) | undefined;
  const board = data.board as PresentationStage | undefined;
  const busy = board?.status === 'queued' || board?.status === 'rendering';
  const preview = data.onPreviewFile as (path: string, name: string) => void;
  const theme = presentationRole(data.label),
    Icon = ROLE_ICONS[theme.role];
  const element = useRef<HTMLDivElement>(null);
  const reportHeight = data.onHeight as (id: string, height: number) => void;
  useEffect(() => {
    if (!element.current) return;
    const observer = new ResizeObserver(([entry]) =>
      reportHeight(
        data.id,
        Math.ceil(entry.borderBoxSize[0]?.blockSize || entry.contentRect.height),
      ),
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [data.id, reportHeight]);
  return (
    <div
      ref={element}
      className="flow-node presentation-node nodrag"
      style={{ '--stage-color': theme.color } as React.CSSProperties}
      data-status={data.status}
      data-optional={!!data.optional}
      aria-label={data.label}
    >
      <Handle type="target" position={Position.Left} id="left" />
      <div className="presentation-node-label">
        <Icon size={15} strokeWidth={1.7} />
        <button
          className="node-navigate"
          disabled={!navigate}
          onClick={navigate}
          title="定位阶段会话"
        >
          {data.label}
        </button>
        <button
          className="presentation-generate nodrag nopan"
          disabled={busy}
          aria-label={board?.digest ? `重新设计${data.label}展板` : `生成${data.label}展板`}
          title={busy ? '正在设计' : board?.digest ? '重新设计展板' : '生成展板'}
          onClick={() => (data.onRetry as () => void)?.()}
        >
          {busy ? (
            <LoaderCircle size={13} className="presentation-spinner" />
          ) : (
            <RefreshCw size={13} />
          )}
          {!board?.digest && !busy ? '生成展板' : null}
        </button>
      </div>
      <article className="presentation-sheet">
        <Icon
          className="presentation-watermark"
          data-role={theme.role}
          size={105}
          strokeWidth={0.8}
        />
        {board?.digest ? (
          <PresentationView
            sessionId={data.sessionId as string}
            stageId={data.id}
            stage={board}
            facts={data.facts as Record<string, string | number>}
            onPreviewFile={preview}
          />
        ) : (
          <div
            className="presentation-pending"
            aria-label={busy ? '正在绘制研究内容' : '尚未生成展板'}
          >
            {busy ? (
              <LoaderCircle size={22} className="presentation-spinner" />
            ) : (
              <section className="presentation-fallback" aria-label="阶段摘要">
                <p>{data.description}</p>
                {!!data.criteria?.length && (
                  <ul>
                    {data.criteria.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
        {board?.error && (
          <p className="presentation-error" role="status">
            {board.error}
          </p>
        )}
      </article>
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </div>
  );
}
const nodeTypes = { stage: Stage, resources: WorkflowResources };
type FlowNode = StageNode | ResourceFlowNode;
function FlowCanvas({
  workflow,
  sessionId,
  presentation,
  onPresentationRetry,
  stageStarts,
  onNavigateToMessage,
  full = false,
  stageWidth,
  running = false,
  onInit,
  artifacts = [],
  onPreviewFile,
}: {
  workflow: WorkflowData;
  sessionId: string;
  presentation?: PresentationState;
  onPresentationRetry: (stage?: string) => void;
  stageStarts: Map<string, string>;
  onNavigateToMessage: (messageId: string) => void;
  full?: boolean;
  stageWidth?: number;
  running?: boolean;
  onInit?: (inst: ReactFlowInstance<FlowNode>) => void;
  artifacts?: Artifact[];
  onPreviewFile: (path: string, name: string) => void;
}) {
  const [instance, setInstance] = useState<ReactFlowInstance<FlowNode> | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const focused = useRef<string | undefined>(undefined);
  const [focusIndex, setFocusIndex] = useState(0);
  const width = stageWidth ?? Math.max(250, size.width - 48);
  const [heights, setHeights] = useState<Record<string, number>>({});
  const reportHeight = useCallback((id: string, height: number) => {
    setHeights((old) => (Math.abs((old[id] || 0) - height) < 2 ? old : { ...old, [id]: height }));
  }, []);
  const handleInit = (inst: ReactFlowInstance<FlowNode>) => {
    setInstance(inst);
    onInit?.(inst);
  };
  useEffect(() => {
    if (!element.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  const focus = (index: number) => {
    const stage = workflow.nodes[index];
    if (!stage || !instance) return;
    focused.current = stage.id;
    setFocusIndex(index);
    void instance.setViewport(
      { x: 4 - index * (width + STAGE_GAP), y: 32, zoom: 1 },
      { duration: 180 },
    );
  };
  useEffect(() => {
    if (!focused.current && instance && workflow.nodes.length && size.width > 0)
      focus(
        Math.max(
          0,
          workflow.nodes.findIndex((node) => node.status === 'running'),
        ),
      );
  }, [instance, workflow.nodes, size.width]);
  const nodes: FlowNode[] = useMemo(() => {
    const result: FlowNode[] = [];
    for (const [index, node] of workflow.nodes.entries()) {
      const x = 20 + index * (width + STAGE_GAP);
      const resources = resourcesForStage(node, artifacts);
      result.push({
        id: node.id,
        type: 'stage',
        position: { x, y: 0 },
        style: { width },
        data: {
          ...node,
          sessionId,
          board: presentation?.stages[node.id],
          facts: presentation?.facts[node.id] || {},
          onHeight: reportHeight,
          onPreviewFile,
          onRetry: () => onPresentationRetry(node.id),
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
            width,
          },
          position: { x, y: (heights[node.id] || 214) + RESOURCE_GAP },
          data: { stageId: node.id, resources, onPreview: onPreviewFile },
        });
    }
    return result;
  }, [
    workflow,
    artifacts,
    onPreviewFile,
    width,
    heights,
    reportHeight,
    sessionId,
    presentation,
    onPresentationRetry,
    stageStarts,
    onNavigateToMessage,
  ]);
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
  return (
    <div className="flow-canvas" ref={element} data-testid="flow-canvas">
      {!nodes.length && (
        <div className="artifact-empty">
          <p>研究计划生成后，将在这里显示实际研究节点。</p>
        </div>
      )}
      {!!workflow.nodes.length && (
        <div className="presentation-stage-nav nodrag nopan">
          <button
            aria-label="上一个研究阶段"
            disabled={focusIndex === 0}
            onClick={() => focus(focusIndex - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <span>{workflow.nodes[focusIndex]?.label}</span>
          <button
            aria-label="下一个研究阶段"
            disabled={focusIndex >= workflow.nodes.length - 1}
            onClick={() => focus(focusIndex + 1)}
          >
            <ChevronRight size={14} />
          </button>
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
        defaultViewport={{ x: 28, y: 24, zoom: 1 }}
        fitViewOptions={{ padding: full ? 0.2 : 0.12, minZoom: 0.25, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={2.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        panOnScroll
        panOnScrollSpeed={1}
        zoomOnScroll={false}
        zoomOnPinch
      >
        <Background gap={18} size={0.7} color="#dfe5ee" />
      </ReactFlow>
    </div>
  );
}
export function Workflow({
  workflow,
  sessionId,
  presentation,
  onPresentationRetry,
  onClose,
  artifacts,
  onPreviewFile,
  running,
  messages,
  onNavigateToMessage,
}: {
  sessionId: string;
  presentation?: PresentationState;
  onPresentationRetry: (stage?: string) => void;
  running: boolean;
  messages: ChatMessage[];
  onNavigateToMessage: (messageId: string) => void;
  workflow: WorkflowData;
  onClose: () => void;
  artifacts: Artifact[];
  onPreviewFile: (path: string, name: string) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenWidth, setFullscreenWidth] = useState<number>();
  const instanceRef = useRef<ReactFlowInstance<FlowNode> | null>(null);
  const fullscreenInstanceRef = useRef<ReactFlowInstance<FlowNode> | null>(null);
  const stageStarts = useMemo(
    () => getStageStartMessages(workflow, messages),
    [workflow, messages],
  );
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
              onClick={() => {
                const node = instanceRef.current?.getNodes().find((node) => node.type === 'stage');
                setFullscreenWidth(
                  typeof node?.style?.width === 'number' ? node.style.width : node?.measured?.width,
                );
                setFullscreen(true);
              }}
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
          sessionId={sessionId}
          presentation={presentation}
          onPresentationRetry={onPresentationRetry}
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
                <div className="flow-header-controls">
                  <button
                    className="icon-button"
                    aria-label="全屏缩小流程图"
                    onClick={() => void fullscreenInstanceRef.current?.zoomOut({ duration: 150 })}
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="全屏放大流程图"
                    onClick={() => void fullscreenInstanceRef.current?.zoomIn({ duration: 150 })}
                  >
                    <Plus size={14} />
                  </button>
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
              </div>
              <FlowCanvas
                sessionId={sessionId}
                presentation={presentation}
                onPresentationRetry={onPresentationRetry}
                workflow={workflow}
                stageStarts={stageStarts}
                onNavigateToMessage={navigate}
                artifacts={artifacts}
                onPreviewFile={preview}
                full
                stageWidth={fullscreenWidth}
                onInit={(inst) => {
                  fullscreenInstanceRef.current = inst;
                }}
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
