import { Dialog } from '@animate-ui/react/primitives/radix-ui/dialog';
import { WorkflowResources, resourcesForStage, type ResourceFlowNode } from './WorkflowResources';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  ReactFlow,
  Handle,
  Position,
  MarkerType,
  type NodeProps,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react';
import { Check, Maximize2, Minimize2, Minus, Plus, X } from 'lucide-react';
import type { Workflow as WorkflowData, WorkflowNode, Artifact } from '../../shared/types';

type StageNode = Node<WorkflowNode & Record<string, unknown>, 'stage'>;
function Stage({ data }: NodeProps<StageNode>) {
  return (
    <div
      className="flow-node"
      data-status={data.status}
      data-optional={!!data.optional}
      data-with-resources={!!data.hasResources}
      aria-label={`${data.label}，${{ pending: '等待中', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已停止' }[data.status]}`}
    >
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <span className="node-dot">{data.status === 'completed' && <Check size={9} />}</span>
      <strong>{data.label}</strong>
      <p title={data.description}>{data.description}</p>
      {data.statusLabel && <small>{data.statusLabel}</small>}
      {!!data.criteria?.length && (
        <small title={data.criteria.join('\n')}>
          验收条件 {data.criteria.length} 项，证据 {data.evidence?.length || 0} 项
        </small>
      )}
      {data.reason && (
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
  full = false,
  running = false,
  onInit,
  artifacts = [],
  onPreviewFile,
}: {
  workflow: WorkflowData;
  full?: boolean;
  running?: boolean;
  onInit?: (inst: ReactFlowInstance<FlowNode>) => void;
  artifacts?: Artifact[];
  onPreviewFile: (path: string, name: string) => void;
}) {
  const [instance, setInstance] = useState<ReactFlowInstance<FlowNode> | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const handleInit = (inst: ReactFlowInstance<FlowNode>) => {
    setInstance(inst);
    onInit?.(inst);
  };
  const [heights, setHeights] = useState<Record<string, number>>({});
  const onSize = useCallback((id: string, height: number) => {
    const rounded = Math.ceil(height);
    setHeights((old) => (old[id] === rounded ? old : { ...old, [id]: rounded }));
  }, []);
  const nodes: FlowNode[] = useMemo(() => {
    const result: FlowNode[] = [];
    let y = 0;
    for (const node of workflow.nodes) {
      const resources = resourcesForStage(node, artifacts);
      result.push({
        id: node.id,
        type: 'stage',
        position: { x: 20, y },
        data: { ...node, hasResources: resources.length > 0 },
      });
      if (resources.length)
        result.push({
          id: `resources-${node.id}`,
          type: 'resources',
          style: { pointerEvents: 'all' },
          position: { x: 234, y: y + 20 },
          data: { stageId: node.id, resources, onPreview: onPreviewFile, onSize },
        });
      y += Math.max(210, (heights[node.id] || 0) + 70);
    }
    return result;
  }, [workflow, artifacts, heights, onPreviewFile, onSize]);
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
          sourceHandle: e.optional ? 'right' : 'bottom',
          targetHandle: e.optional ? 'left' : 'top',
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
          sourceHandle: 'right',
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
        {running ? '进行' : '就位'}
      </div>
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={handleInit}
        fitView={full}
        defaultViewport={{ x: 28, y: 24, zoom: 0.85 }}
        fitViewOptions={{ padding: full ? 0.3 : 0.12, minZoom: full ? 0.3 : 0.75, maxZoom: 1 }}
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
}: {
  running: boolean;
  workflow: WorkflowData;
  onClose: () => void;
  artifacts: Artifact[];
  onPreviewFile: (path: string, name: string) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const instanceRef = useRef<ReactFlowInstance<FlowNode> | null>(null);
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
        </div>
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
                artifacts={artifacts}
                onPreviewFile={preview}
                full
                running={running}
              />
              <div className="flow-legend">拖动画布平移，滚轮缩放，点击适应画布查看完整流程</div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
