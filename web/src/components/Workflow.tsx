import { presentationRole } from '../../shared/types';
import { PresentationView, PresentationLoading } from './PresentationView';
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
  Target,
  LibraryBig,
  Lightbulb,
  Compass,
  FlaskConical,
  FileText,
  ScanSearch,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Scan,
  RotateCw,
  X,
} from 'lucide-react';
import type {
  PresentationState,
  PresentationBoard,
  PresentationStage,
  Workflow as WorkflowData,
  WorkflowNode,
  Artifact,
  ChatMessage,
} from '../../shared/types';
import { ResearchActivity } from './ResearchActivity';
import { getStageStartMessages } from '../lib/research-navigation';
import { RESEARCH_STAGE_LABELS } from '../../shared/research';
import { Tooltip } from '@animate-ui/react/primitives/radix-ui/tooltip';

type StageNode = Node<WorkflowNode & Record<string, unknown>, 'stage'>;
const STAGE_GAP = 72;
const RESOURCE_GAP = 28;
const PRESENTATION_CONTENT_HEIGHT = 1280;
const RESEARCH_STAGES = Object.entries(RESEARCH_STAGE_LABELS).map(([id, label]) => ({
  id,
  label,
  Icon: [Target, LibraryBig, Lightbulb, Compass, FlaskConical, FileText, ScanSearch][
    Object.keys(RESEARCH_STAGE_LABELS).indexOf(id)
  ],
}));
const ROLE_ICONS = {
  task: Target,
  literature: LibraryBig,
  hypothesis: Lightbulb,
  method: Compass,
  experiment: FlaskConical,
  report: FileText,
  review: ScanSearch,
};
function stageMatches(node: WorkflowNode, stageId: string, label: string) {
  const id = node.id.toLowerCase();
  if (id === stageId || id === stageId.replace(/^research-/, '')) return true;
  if (node.label.toLowerCase().includes(label.toLowerCase())) return true;
  const patterns: Record<string, RegExp> = {
    'research-task': /任务|解析|\btask\b|\bscope\b/i,
    'research-literature': /文献|检索|\bliterature\b|\bpapers\b/i,
    'research-hypothesis': /假设|\bhypothes/i,
    'research-method': /方法|设计|\bmethod\b/i,
    'research-experiment': /实验|试验|\bexperiment\b/i,
    'research-report': /报告|论文|写作|\breport\b/i,
    'research-review': /评估|反馈|评审|审查|\breview\b|\bevaluation\b/i,
  };
  return patterns[stageId].test(node.label);
}
function Stage({ data }: NodeProps<StageNode>) {
  const navigate = data.onNavigate as (() => void) | undefined;
  const board = data.board as PresentationBoard | undefined;
  const holder = data.presentationStage as PresentationStage | undefined;
  const activity = holder?.activity;
  const choices = (data.versions || []).filter(
    (version) => version.accepted || holder?.versions?.[version.id]?.digest,
  );
  const selectedVersion = data.selectedVersion as string;
  const selectVersion = data.onSelectVersion as (version: string) => void;
  const busy = activity?.status === 'queued' || activity?.status === 'rendering';
  const failed =
    activity?.status === 'failed' ||
    holder?.status === 'failed' ||
    !!holder?.error ||
    board?.status === 'failed' ||
    !!board?.error;
  const [retrying, setRetrying] = useState(false);
  const retry = data.onRetry as (() => Promise<void>) | undefined;
  const boardBusy =
    busy &&
    (activity.versionId === selectedVersion ||
      (!!data.followCurrent && activity.versionId === data.currentVersionId));
  const preview = data.onPreviewFile as (path: string, name: string) => void;
  const theme = presentationRole(data.label),
    Icon = ROLE_ICONS[theme.role];
  const element = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [contentExpanded, setContentExpanded] = useState(false);
  const [contentOverflows, setContentOverflows] = useState(false);
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
  useEffect(() => {
    setContentExpanded(false);
  }, [board?.digest, selectedVersion]);
  useEffect(() => {
    const inner = content.current;
    if (!inner) return;
    const measure = () => {
      const overflows = inner.scrollHeight > PRESENTATION_CONTENT_HEIGHT + 1;
      setContentOverflows(overflows);
      if (!overflows) setContentExpanded(false);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    measure();
    return () => observer.disconnect();
  }, [board?.digest, board?.previewDigest, selectedVersion, data.description, data.criteria]);
  return (
    <div
      ref={element}
      className="flow-node presentation-node nodrag"
      style={{ '--stage-color': theme.color } as React.CSSProperties}
      data-status={data.status}
      data-optional={!!data.optional}
      aria-label={data.label}
    >
      <Handle type="target" position={Position.Left} id="left" style={{ top: 130 }} />
      <div className="presentation-node-header">
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
        </div>
        <div className="presentation-node-meta">
          {!!choices.length && (
            <div className="presentation-versions nodrag nopan" aria-label="展板版本">
              {choices.map((version) => (
                <button
                  key={version.id}
                  className={version.id === selectedVersion ? 'selected' : ''}
                  aria-pressed={version.id === selectedVersion}
                  title={`${version.objective}${version.id === data.currentVersionId ? ' · 当前有效' : ''}`}
                  onClick={() => selectVersion(version.id)}
                >
                  {version.kind === 'analysis' ? '补充' : `V${version.versionNumber || 1}`}
                  {version.id === data.currentVersionId && (
                    <span className="presentation-current" aria-label="当前有效">
                      {' '}
                      · 当前
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
          {!!data.needsReview?.length && (
            <span className="presentation-review" title="上游已修订，当前成果需复核">
              需复核
            </span>
          )}
          {activity && (
            <span
              className="presentation-update"
              role="status"
              title={activity.phase || '展板更新'}
            >
              {busy ? <LoaderCircle size={12} className="presentation-spinner" /> : null}
              {activity.status === 'failed'
                ? '更新失败'
                : activity.status === 'queued'
                  ? '待更新'
                  : '更新中'}
            </span>
          )}
          {failed && !busy && (
            <button
              className="presentation-generate nodrag nopan"
              type="button"
              disabled={retrying}
              onClick={async () => {
                if (!retry || retrying) return;
                setRetrying(true);
                try {
                  await retry();
                } finally {
                  setRetrying(false);
                }
              }}
            >
              {retrying ? (
                <LoaderCircle size={12} className="presentation-spinner" />
              ) : (
                <RotateCw size={12} />
              )}
              重新生成
            </button>
          )}
        </div>
      </div>
      <div className="presentation-stack" data-stacked={choices.length > 1}>
        <article className="presentation-sheet" aria-busy={boardBusy}>
          <Icon
            className="presentation-watermark"
            data-role={theme.role}
            size={105}
            strokeWidth={0.8}
          />
          <div
            className="presentation-content-viewport"
            data-expanded={contentExpanded}
            data-overflow={contentOverflows}
            style={
              {
                '--presentation-content-height': `${PRESENTATION_CONTENT_HEIGHT}px`,
              } as React.CSSProperties
            }
          >
            <div className="presentation-content-inner" ref={content}>
              {board && (board.digest || board.previewDigest) ? (
                <PresentationView
                  sessionId={data.sessionId as string}
                  stageId={data.id}
                  stage={board}
                  versionId={board.versionId || selectedVersion}
                  facts={data.facts as Record<string, string | number>}
                  generating={boardBusy}
                  phase={activity?.status === 'queued' ? '等待开始' : activity?.phase}
                  onPreviewFile={preview}
                />
              ) : (
                <div
                  className="presentation-pending"
                  aria-label={boardBusy ? '正在绘制研究内容' : '尚未生成展板'}
                >
                  {boardBusy ? (
                    <>
                      <div className="presentation-skeleton" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                        <i />
                      </div>
                      <PresentationLoading
                        phase={activity?.status === 'queued' ? '等待开始' : activity?.phase}
                      />
                    </>
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
            </div>
            {contentOverflows && (
              <button
                className="presentation-content-toggle nodrag nopan"
                type="button"
                aria-expanded={contentExpanded}
                onClick={() => setContentExpanded((expanded) => !expanded)}
              >
                {contentExpanded ? '收起内容' : '展开内容'}
              </button>
            )}
          </div>
          {board?.error && (
            <p className="presentation-error" role="status" title={board.error}>
              更新失败
            </p>
          )}
        </article>
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" style={{ top: 130 }} />
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
  selectedVersions,
  selectVersion,
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
  onPresentationRetry: (stage?: string) => Promise<void>;
  selectedVersions: Record<string, string>;
  selectVersion: (stage: string, version: string) => void;
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
  const [selectedStage, setSelectedStage] = useState<string>();
  const previousIndex = useRef(-1);
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
    previousIndex.current = index;
    setFocusIndex(index);
    void instance.setViewport(
      { x: 4 - index * (width + STAGE_GAP), y: 32, zoom: 1 },
      { duration: 180 },
    );
  };
  const previousWidth = useRef(0);
  const previousSession = useRef(sessionId);
  useEffect(() => {
    if (previousSession.current !== sessionId) {
      previousSession.current = sessionId;
      focused.current = undefined;
      setSelectedStage(undefined);
      previousIndex.current = -1;
      previousWidth.current = 0;
    }
    if (!instance || !workflow.nodes.length || size.width <= 0) return;
    const currentIndex = workflow.nodes.findIndex((node) => node.id === focused.current);
    const runningIndex = workflow.nodes.findIndex((node) => node.status === 'running');
    const availableIndex = workflow.nodes.findIndex((node) => node.status !== 'cancelled');
    const targetIndex = currentIndex >= 0
      ? currentIndex
      : runningIndex >= 0 ? runningIndex : Math.max(0, availableIndex);
    const changedStage = workflow.nodes[targetIndex]?.id !== focused.current;
    const changedIndex = previousIndex.current !== targetIndex;
    const changedWidth = previousWidth.current !== size.width;
    previousWidth.current = size.width;
    if (changedStage || changedIndex || changedWidth) focus(targetIndex);
    else if (focusIndex !== targetIndex) setFocusIndex(targetIndex);
  }, [instance, workflow.nodes, size.width, focusIndex, sessionId]);
  const nodes: FlowNode[] = useMemo(() => {
    const result: FlowNode[] = [];
    for (const [index, node] of workflow.nodes.entries()) {
      const x = 20 + index * (width + STAGE_GAP);
      const holder = presentation?.enabled ? presentation.stages[node.id] : undefined;
      const requested = selectedVersions[node.id] || node.currentVersionId || node.id;
      let board: PresentationBoard | undefined =
        holder?.versions?.[requested] ||
        (holder && (!holder.versions || holder.versionId === requested) ? holder : undefined);
      if (!selectedVersions[node.id] && !board?.digest && !board?.previewDigest && holder?.digest)
        board = holder;
      const selectedVersion =
        board?.digest || board?.previewDigest ? board.versionId || node.id : requested;
      const version = node.versions?.find((version) => version.id === selectedVersion);
      const resources = resourcesForStage(
        {
          ...node,
          evidence: version?.evidence || node.evidence,
          currentVersionId: selectedVersion,
        },
        artifacts,
      );
      result.push({
        id: node.id,
        type: 'stage',
        position: { x, y: 0 },
        style: { width },
        data: {
          ...node,
          description: version?.objective || node.description,
          sessionId,
          board,
          presentationStage: holder,
          selectedVersion,
          followCurrent: !selectedVersions[node.id],
          onSelectVersion: (version: string) => selectVersion(node.id, version),
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
    selectedVersions,
    selectVersion,
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
  const edges = useMemo(() => {
    const researchRunning = workflow.control
      ? ['running', 'waiting'].includes(workflow.control.state)
      : running;
    return [
      ...workflow.edges.map((e, i) => {
        const source = workflow.nodes.find((n) => n.id === e.source);
        const target = workflow.nodes.find((n) => n.id === e.target);
        const activeEdge = source?.status === 'completed' && target?.status === 'running';
        const animated = activeEdge && researchRunning;
        const color = activeEdge
          ? researchRunning
            ? '#1769ff'
            : '#c9d0dc'
          : source?.status === 'completed'
            ? '#33bb7a'
            : '#c9d0dc';
        return {
          id: `edge-${i}`,
          source: e.source,
          target: e.target,
          type: 'straight',
          sourceHandle: 'right',
          targetHandle: 'left',
          animated,
          style: {
            stroke: color,
            strokeWidth: 1.5,
            strokeDasharray: animated || (!activeEdge && e.optional) ? '5 4' : undefined,
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
    ];
  }, [workflow, nodes, running]);
  return (
    <div className="flow-canvas-shell">
      <div className="presentation-stage-nav nodrag nopan" role="group" aria-label="研究阶段">
        {RESEARCH_STAGES.map(({ id, label, Icon }) => {
            const focusedNode = workflow.nodes[focusIndex];
            const inferredFocusedStage = focusedNode && RESEARCH_STAGES.find((stage) =>
              stageMatches(focusedNode, stage.id, stage.label),
            )?.id;
            const activeStage = selectedStage && focusedNode && RESEARCH_STAGES.some((stage) =>
              stage.id === selectedStage && stageMatches(focusedNode, stage.id, stage.label),
            ) ? selectedStage : inferredFocusedStage;
            const matches = workflow.nodes
              .map((node, index) => ({ node, index }))
              .filter(({ node }) => stageMatches(node, id, label));
            const activeMatches = matches.filter(({ node }) => node.status !== 'cancelled');
            const selectedMatch = activeMatches.find(({ node }) => node.id === focused.current);
            const target = selectedMatch || activeMatches.find(({ node }) => node.status === 'running') || activeMatches[0] || matches[0];
            const unavailable = !target || target.node.status === 'cancelled';
            return (
              <Tooltip.Root key={id}>
                <Tooltip.Trigger asChild>
                  <span className="stage-nav-tooltip-trigger">
                    <button
                      className="stage-nav-button"
                      aria-label={label}
                      aria-pressed={!!target && target.node.id === focusedNode?.id && activeStage === id}
                      disabled={unavailable}
                      onClick={() => {
                        if (!target) return;
                        setSelectedStage(id);
                        focus(target.index);
                      }}
                    >
                      <Icon size={12} aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content className="ui-tooltip stage-nav-tooltip" sideOffset={7}>
                    {unavailable ? '不涉及' : label}
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            );
        })}
      </div>
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
  onPresentationRetry: (stage?: string) => Promise<void>;
  running: boolean;
  messages: ChatMessage[];
  onNavigateToMessage: (messageId: string) => void;
  workflow: WorkflowData;
  onClose: () => void;
  artifacts: Artifact[];
  onPreviewFile: (path: string, name: string) => void;
}) {
  const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>({});
  const selectVersion = useCallback((stage: string, version: string) => {
    setSelectedVersions((previous) => ({ ...previous, [stage]: version }));
  }, []);
  useEffect(() => {
    setSelectedVersions({});
  }, [sessionId]);
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
          selectedVersions={selectedVersions}
          selectVersion={selectVersion}
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
          <span className="flow-pan-hint">点击上方阶段切换节点</span>
        </div>
        <ResearchActivity messages={messages} presentation={presentation} workflow={workflow} />
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
                selectedVersions={selectedVersions}
                selectVersion={selectVersion}
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
              <div className="flow-legend">滚轮或拖动画布平移，捏合或点击加减缩放</div>
              <ResearchActivity
                messages={messages}
                presentation={presentation}
                workflow={workflow}
              />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
