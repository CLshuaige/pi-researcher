import { ToolResultCard, ToolCode } from './ToolResultCard';
import { Reveal, Disclosure } from './ui/animated';
import { FileIcon } from './FileIcon';
import { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Globe2,
  LoaderCircle,
  RotateCcw,
  X,
} from 'lucide-react';
import type { ChatMessage, SourceLink } from '../../shared/types';

export function toolTitle(m: ChatMessage) {
  const names: Record<string, string> = {
    'research-task': '任务解析',
    academic_search: '文献检索',
    web_search: '网页搜索',
    fetch_arxiv: '读取 arXiv 论文',
    fetch_content: '读取网页',
    get_search_content: '读取检索内容',
    research_checklist: '更新研究清单',
    research_job: '管理实验任务',
    download_pdf: '下载论文',
    subagent: '研究子任务',
    find: '查找文件',
    grep: '搜索内容',
    ls: '查看目录',
    paper_lookup: '核对论文',
    paper_citations: '检索引用',
    research_delegate: '研究子任务',
    research_workspace: '研究工作空间',
    engine_start: '实验执行',
    read: '读取文件',
    write: '写入文件',
    edit: '编辑文件',
    bash: '执行命令',
    ask_user: '等待你的决定',
  };
  const label = names[m.name || ''] || m.name || '工具调用';
  return m.status === 'completed'
    ? `${label}已完成`
    : m.status === 'failed'
      ? `${label}未完成`
      : m.status === 'cancelled'
        ? `${label}已停止`
        : `${label}进行中`;
}

/** Extract file paths from tool args that reference generated files. */
function extractFileRefs(m: ChatMessage): { path: string; name: string }[] {
  const refs: { path: string; name: string }[] = [];
  const args = m.args || {};
  // Common patterns: path, file, output, files, results
  const collect = (val: unknown) => {
    if (typeof val === 'string' && /\.[a-z0-9]+$/i.test(val) && !val.startsWith('http')) {
      const name = val.split(/[\/\\]/).pop() || val;
      if (!refs.some((r) => r.path === val)) refs.push({ path: val, name });
    }
  };
  for (const key of ['path', 'file', 'output', 'outputPath', 'resultPath']) {
    if (args[key]) collect(args[key]);
  }
  if (Array.isArray(args.files)) args.files.forEach(collect);
  if (Array.isArray(args.outputs)) args.outputs.forEach(collect);
  // Also parse from text content: lines that look like file paths
  if (m.text) {
    const lines = m.text.split('\n');
    for (const line of lines) {
      const match = line.match(
        /(?:^|\s)([\w\-./]+\.(?:md|txt|json|jsonl|csv|py|ts|js|html|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|svg|bib|tex|yaml|yml|toml|xml|sh|rs|go|java|c|cpp|h|hpp|cs|rb|php|sql|ipynb))(?:\s|$)/i,
      );
      if (match) {
        const p = match[1];
        const name = p.split('/').pop() || p;
        if (!refs.some((r) => r.path === p)) refs.push({ path: p, name });
      }
    }
  }
  return refs.slice(0, 5);
}

function SourceGroup({ host, links }: { host: string; links: SourceLink[] }) {
  const [open, setOpen] = useState(true);
  const label = host.includes('arxiv')
    ? 'arXiv'
    : host.includes('semanticscholar')
      ? 'Semantic Scholar'
      : host.includes('openalex')
        ? 'OpenAlex'
        : host;
  return (
    <div>
      <button className="source-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="source-symbol">
          <Globe2 size={13} />
        </span>
        <span className="source-label">在 {label} 中搜索</span>
        <span className="source-count">{links.length} 处资源</span>
        {open ? <ChevronDown className="icon" /> : <ChevronRight className="icon" />}
      </button>
      <Reveal open={open}>
        <div className="source-links">
          {links.map((link) => (
            <a key={link.url} href={link.url} title={link.url} target="_blank" rel="noreferrer">
              {link.title}
            </a>
          ))}
        </div>
      </Reveal>
    </div>
  );
}

export function ToolStep({
  message: m,
  onRetry,
  onPreviewFile,
}: {
  message: ChatMessage;
  onRetry: () => void;
  onPreviewFile?: (path: string, name: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const running = m.status === 'running';
  const completed = m.status === 'completed';
  const groups = new Map<string, SourceLink[]>();
  for (const link of m.links || []) {
    try {
      const url = new URL(link.url);
      if (!['http:', 'https:'].includes(url.protocol)) continue;
      const host = url.hostname;
      groups.set(host, [...(groups.get(host) || []), link]);
    } catch {
      /* malformed tool link */
    }
  }
  const fileRefs = extractFileRefs(m);
  const detail =
    m.description ||
    (typeof m.args?.query === 'string'
      ? m.args.query
      : typeof m.args?.path === 'string'
        ? m.args.path
        : typeof m.args?.objective === 'string'
          ? m.args.objective
          : running
            ? '正在处理，结果会持续更新'
            : completed
              ? '点击展开查看这一步的执行结果'
              : '可以展开查看详情，或重试这一步');
  return (
    <section className="tool-step" aria-label={toolTitle(m)}>
      <div className="tool-step-header">
        <span className={`step-status ${m.status || 'pending'}`}>
          {running ? (
            <LoaderCircle size={17} className="spin" />
          ) : completed ? (
            <Check size={17} />
          ) : (
            <X size={15} />
          )}
        </span>
        <button className="step-heading" aria-expanded={open} onClick={() => setOpen(!open)}>
          <strong className={running ? 'running-title' : ''}>
            {toolTitle(m)}
            {running && '…'}
          </strong>
          <span className="step-description">{detail}</span>
        </button>
        <time className="step-time">
          {new Date(m.timestamp).toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
        <div className="step-controls">
          <button
            className="icon-button step-retry-btn"
            aria-label={`重试${m.name}`}
            title="重试这一步"
            disabled={retrying}
            onClick={async () => {
              setRetrying(true);
              try {
                await onRetry();
              } finally {
                setRetrying(false);
              }
            }}
          >
            {retrying ? <LoaderCircle size={13} className="spin" /> : <RotateCcw size={13} />}
          </button>
          <button
            className="icon-button"
            aria-label={open ? '收起步骤详情' : '展开步骤详情'}
            title={open ? '收起详情' : '展开详情'}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>
      {/* File references below the step header */}
      {fileRefs.length > 0 && (
        <div className="tool-file-refs">
          {fileRefs.map((ref) => (
            <button
              key={ref.path}
              className="tool-file-card"
              onClick={() => onPreviewFile?.(ref.path, ref.name)}
              title={ref.path}
            >
              <span className="file-card-icon">
                <FileIcon name={ref.name} size={28} />
              </span>
              <span className="file-card-label">
                <strong>{ref.name}</strong>
                <small>{/\.(md|markdown)$/i.test(ref.name) ? 'Markdown 文档' : '研究文件'}</small>
              </span>
              <span className="file-card-open">
                预览 <ChevronRight size={14} />
              </span>
            </button>
          ))}
        </div>
      )}
      <Reveal open={open}>
        <ToolResultCard message={m} label={toolTitle(m)}>
          {groups.size > 0 ? (
            <>
              {[...groups].map(([host, links]) => (
                <SourceGroup key={host} host={host} links={links} />
              ))}
              <Disclosure className="raw-tool-output" title="执行详情">
                <div className="tool-output">
                  <ToolCode>{m.text}</ToolCode>
                </div>
              </Disclosure>
            </>
          ) : (
            <div className="tool-output">
              {!m.text && running ? (
                <span className="tool-summary">
                  <LoaderCircle size={13} className="spin" /> 等待工具返回结果…
                </span>
              ) : (
                <ToolCode>{m.text || '工具已结束，未返回文本。'}</ToolCode>
              )}
            </div>
          )}
        </ToolResultCard>
      </Reveal>
    </section>
  );
}
