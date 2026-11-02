import { readableError } from '../../shared/errors';
import { Progress } from '@animate-ui/react/primitives/radix-ui/progress';
import { Info } from 'lucide-react';
import { Popover } from '@animate-ui/react/primitives/radix-ui/popover';
import type { ResearchSession } from '../../shared/types';

export function ResearchControls({ session }: { session: ResearchSession }) {
  const control = session.workflow.control;
  const controlLabels = {
    running: '研究进行中',
    waiting: '等待任务或输入',
    paused: '研究已暂停',
    stopped: '研究已停止',
    completed: '本轮已完成',
  };
  const label = session.question
    ? '等待你的回复'
    : session.status === 'running'
      ? '研究进行中'
      : session.status === 'stopping'
        ? '正在停止'
        : session.status === 'interrupted'
          ? '运行已中断'
          : control
            ? controlLabels[control.state]
            : session.workflow.nodes.length &&
                session.workflow.nodes.every(
                  (n) => n.status === 'completed' || n.status === 'cancelled',
                )
              ? '本轮已完成'
              : session.notice?.includes('暂停')
                ? '研究已暂停'
                : '等待输入';
  const complete = session.workflow.nodes.filter((n) => n.status === 'completed').length;
  const active = session.workflow.nodes.filter((n) => n.status === 'running');
  const children = session.subSessions.filter((s) => s.status === 'running').length;
  return (
    <Popover.Root>
      <Popover.Trigger className="toolbar-button research-status-trigger" aria-label="查看研究状态">
        <Info size={16} />
        <span>{label}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="ui-popover research-status-panel"
          align="end"
          sideOffset={8}
          aria-label="研究状态"
        >
          <strong>{label}</strong>
          {!!session.workflow.nodes.length && (
            <Progress.Root
              className="status-progress"
              value={complete}
              max={session.workflow.nodes.length}
              aria-label="已完成研究节点"
            >
              <Progress.Indicator
                style={{ width: `${(complete / session.workflow.nodes.length) * 100}%` }}
              />
            </Progress.Root>
          )}
          <dl>
            <div>
              <dt>研究节点</dt>
              <dd>
                {complete} / {session.workflow.nodes.length} 已完成
              </dd>
            </div>
            <div>
              <dt>当前环节</dt>
              <dd>{active.map((n) => n.label).join('、') || '暂无进行中的节点'}</dd>
            </div>
            <div>
              <dt>运行子会话</dt>
              <dd>{children}</dd>
            </div>
          </dl>
          {control?.wakeAt && (
            <p className="form-hint">
              下次检查：{new Date(control.wakeAt).toLocaleTimeString('zh-CN')}
            </p>
          )}
          {session.error && <p className="status-error">{readableError(session.error)}</p>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
