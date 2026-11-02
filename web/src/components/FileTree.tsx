import { Reveal } from './ui/animated';
import { useState } from 'react';
import { ChevronDown, ChevronRight, Download, Trash2, Plus, Minus } from 'lucide-react';
import { api } from '../api';
import { FileIcon } from './FileIcon';
import type { Artifact } from '../../shared/types';

export function flatten(items: Artifact[]): Artifact[] {
  return items.flatMap((item) =>
    item.kind === 'directory' ? flatten(item.children || []) : [item],
  );
}
const descriptions: Record<string, string> = {
  'task.md': '研究任务描述',
  'literature.md': '文献调研结果',
  'literature-review.md': '文献综述',
  'method.md': '方法设计',
  'result.md': '实验结果',
  'papers.jsonl': '论文来源索引',
  'BRIEF.md': '研究目标',
  'STATE.md': '研究状态',
};
interface TreeProps {
  artifacts: Artifact[];
  onPreview: (artifact: Artifact) => void;
  sessionId?: string;
  fresh?: Set<string>;
  compact?: boolean;
  limit?: number;
}
export function FileTree({
  artifacts,
  onPreview,
  sessionId,
  fresh,
  compact = false,
  limit,
}: TreeProps) {
  const [all, setAll] = useState(false);
  const visible = all || !limit ? artifacts : artifacts.slice(0, limit);
  return (
    <>
      {visible.map((artifact) => (
        <TreeRow
          key={artifact.path}
          artifact={artifact}
          onPreview={onPreview}
          sessionId={sessionId}
          fresh={fresh}
          compact={compact}
          limit={limit}
        />
      ))}
      {!!limit && artifacts.length > limit && (
        <button
          className="file-tree-more nodrag nopan"
          aria-label={all ? '收起更多文件' : `展开其余 ${artifacts.length - limit} 个文件`}
          onClick={() => setAll(!all)}
        >
          {all ? <Minus size={13} /> : <Plus size={13} />}
          {all ? '收起' : artifacts.length - limit}
        </button>
      )}
    </>
  );
}
function TreeRow({
  artifact: item,
  onPreview,
  sessionId,
  fresh,
  compact,
  limit,
}: Omit<TreeProps, 'artifacts'> & { artifact: Artifact }) {
  const [expanded, setExpanded] = useState(!compact);
  const directory = item.kind === 'directory';
  const [error, setError] = useState('');
  return (
    <>
      <div
        className={`file-row${compact ? ' compact' : ''}${fresh?.has(item.path) ? ' fresh' : ''}`}
      >
        <button
          className="file-main nodrag nopan"
          title={item.path}
          aria-label={
            directory
              ? `${expanded ? '收起' : '展开'}${compact ? '节点目录' : '文件夹'} ${item.name}`
              : `${compact ? '预览节点文件' : '查看文件'} ${item.name}`
          }
          aria-expanded={directory ? expanded : undefined}
          onClick={() => (directory ? setExpanded(!expanded) : onPreview(item))}
        >
          {directory ? (
            expanded ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : (
            <span className="file-chevron-space" />
          )}
          <span className="file-icon">
            <FileIcon
              name={item.name}
              directory={directory}
              expanded={expanded}
              size={compact ? 18 : 22}
            />
          </span>
          <span className="file-copy">
            <span className="file-name">{item.name}</span>
            {!compact && (
              <span className="file-description">
                {directory
                  ? `${flatten(item.children || []).length} 项文件`
                  : descriptions[item.name] || '研究文件'}
              </span>
            )}
          </span>
          {!compact && !directory && (
            <time className="file-meta">
              {new Date(item.updatedAt).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          )}
        </button>
        {!compact && sessionId && (
          <span className="file-actions">
            <a
              className="file-download icon-button"
              href={api.download(sessionId, item.path)}
              download
              aria-label={`下载${directory ? '文件夹' : '文件'} ${item.name}`}
            >
              <Download size={14} />
            </a>
            <button
              className="file-delete icon-button"
              aria-label={`删除 ${item.name}`}
              onClick={async () => {
                if (!confirm(`确定删除 ${item.name} 吗？`)) return;
                try {
                  const result = await fetch(`/api/sessions/${sessionId}/files/delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: item.path }),
                  });
                  if (!result.ok) throw new Error((await result.json()).error || '删除失败');
                  setError('');
                } catch (error) {
                  setError((error as Error).message);
                }
              }}
            >
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </div>
      {error && <small role="alert">{error}</small>}
      {directory && (
        <Reveal open={expanded}>
          <div className="file-children" role="group">
            <FileTree
              artifacts={item.children || []}
              onPreview={onPreview}
              sessionId={sessionId}
              fresh={fresh}
              compact={compact}
              limit={limit}
            />
          </div>
        </Reveal>
      )}
    </>
  );
}
