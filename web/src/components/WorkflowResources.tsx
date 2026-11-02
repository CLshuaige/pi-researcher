import { useEffect, useRef } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { FileTree } from './FileTree';
import type { Artifact, WorkflowNode } from '../../shared/types';

export function resourcesForStage(stage: WorkflowNode, artifacts: Artifact[]): Artifact[] {
  const all: Artifact[] = [];
  const walk = (items: Artifact[]) =>
    items.forEach((item) => {
      all.push(item);
      if (item.children) walk(item.children);
    });
  walk(artifacts);
  const evidence = (stage.evidence || [])
    .filter((path) => !/^https?:/.test(path))
    .map((path) => path.replace(/^\.\//, '').replace(/\/$/, ''));
  const roots: string[] = [];
  for (const [pattern, paths] of [
    [/任务|task/i, ['task.md']],
    [/文献|综述|literature/i, ['literature.md', 'literature', 'literature-review.md']],
    [/假设|hypothesis/i, ['hypothese', 'hypothesis', 'hypothesis.md']],
    [/方法|method/i, ['method', 'method.md']],
    [/实验|experiment/i, ['experiment', 'result.md']],
    [/论文|报告|report/i, ['report']],
    [/评审|review/i, ['review', 'review.md']],
  ] as [RegExp, string[]][])
    if (pattern.test(stage.label + ' ' + stage.id)) roots.push(...paths);
  const selected = all.filter(
    (item) =>
      evidence.some((path) => path === item.path || path.endsWith('/' + item.path)) ||
      roots.some((root) => root === item.path || (root.includes('.') && root === item.name)),
  );
  return selected.filter(
    (item) =>
      !selected.some(
        (parent) => parent.kind === 'directory' && item.path.startsWith(parent.path + '/'),
      ),
  );
}
export type ResourceData = {
  stageId: string;
  resources: Artifact[];
  onPreview: (path: string, name: string) => void;
  onSize: (id: string, height: number) => void;
} & Record<string, unknown>;
export type ResourceFlowNode = Node<ResourceData, 'resources'>;
export function WorkflowResources({ data }: NodeProps<ResourceFlowNode>) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver((entries) =>
      data.onSize(data.stageId, entries[0].contentRect.height),
    );
    observer.observe(root.current);
    return () => observer.disconnect();
  }, [data.onSize, data.stageId]);
  return (
    <div
      ref={root}
      className="workflow-resource-tree nodrag nopan nowheel"
      role="tree"
      aria-label="节点相关文件"
    >
      <Handle type="target" position={Position.Left} />
      <FileTree
        artifacts={data.resources}
        compact
        limit={2}
        onPreview={(file) => data.onPreview(file.path, file.name)}
      />
    </div>
  );
}
