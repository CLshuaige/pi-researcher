import type { ReactNode } from 'react';
import { Content as CodeContent } from '@animate-ui/react/primitives/code-block';
import { CopyButton, CopyButtonIcon } from '@animate-ui/react/primitives/buttons/copy';
import { Check, Copy, TerminalSquare } from 'lucide-react';
import type { ChatMessage } from '../../shared/types';
import { Disclosure } from './ui/animated';

export function isProgramTool(name = '') {
  return /^(bash|exec|exec_command|run_command|engine_start|engine_run|research_job)$/.test(name);
}

export function ToolCode({ children }: { children: string }) {
  return (
    <CodeContent data-slot="code-block-content" data-wrap writing={false} cursor={false}>
      <code data-slot="code-block-code">{children}</code>
    </CodeContent>
  );
}

export function ToolResultCard({
  message,
  label,
  children,
}: {
  message: ChatMessage;
  label: string;
  children: ReactNode;
}) {
  const program = isProgramTool(message.name);
  const command =
    program && typeof message.args?.command === 'string' ? message.args.command : undefined;
  return (
    <div
      className={`tool-result-card${program ? ' execution-card' : ''}`}
      data-status={message.status}
    >
      {program && (
        <div className="execution-card-header">
          <TerminalSquare size={15} aria-hidden="true" />
          <span>程序输出</span>
          <span className={`execution-state ${message.status || 'pending'}`}>
            {
              {
                running: '运行中',
                completed: '已结束',
                failed: '执行失败',
                cancelled: '已停止',
                pending: '等待中',
              }[message.status || 'pending']
            }
          </span>
          <CopyButton
            type="button"
            className="icon-button execution-copy"
            content={message.text}
            disabled={!message.text}
            hoverScale={1}
            tapScale={0.95}
            aria-label="复制程序输出"
            title="复制程序输出"
          >
            <CopyButtonIcon icon={<Copy size={13} />} copiedIcon={<Check size={13} />} />
          </CopyButton>
        </div>
      )}
      <div className="tool-detail" role="region" aria-label={`${label}执行结果`} tabIndex={0}>
        {command && (
          <div className="execution-command">
            <span aria-hidden="true">$</span>
            <code>{command}</code>
          </div>
        )}
        <div className="tool-result-content">{children}</div>
        {message.args && Object.keys(message.args).length > 0 && (
          <Disclosure className="tool-parameters" title="调用参数" defaultOpen={false}>
            <ToolCode>{JSON.stringify(message.args, null, 2)}</ToolCode>
          </Disclosure>
        )}
      </div>
    </div>
  );
}
