import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, flip, hide, inline, offset, shift, useFloating } from '@floating-ui/react-dom';
import { Check, Copy, MessageSquareQuote } from 'lucide-react';
import { copyText } from '../lib/clipboard';
import { MAX_QUOTE_LENGTH, type MessageQuote } from '../../shared/types';

interface SelectedAnswer {
  quote: MessageQuote;
  range: Range;
  element: HTMLElement;
}

export function SelectionToolbar({
  scope,
  onQuote,
  reportError,
}: {
  scope: RefObject<HTMLDivElement | null>;
  onQuote: (quote: MessageQuote) => void;
  reportError: (message: string) => void;
}) {
  const [selected, setSelected] = useState<SelectedAnswer>();
  const [copied, setCopied] = useState(false);
  const { refs, floatingStyles, middlewareData, isPositioned } = useFloating({
    open: !!selected,
    placement: 'top',
    strategy: 'fixed',
    middleware: [inline(), offset(8), flip({ padding: 8 }), shift({ padding: 8 }), hide()],
    whileElementsMounted: autoUpdate,
  });
  const { setReference } = refs;
  const floatingElement = refs.floating;
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setCopied(false), [selected?.quote.text, selected?.quote.messageId]);
  useLayoutEffect(() => {
    setReference(
      selected
        ? {
            contextElement: selected.element,
            getBoundingClientRect: () => selected.range.getBoundingClientRect(),
            getClientRects: () => selected.range.getClientRects(),
          }
        : null,
    );
  }, [selected, setReference]);

  useEffect(() => {
    let frame = 0;
    let selecting = false;
    let startedInScope = false;
    const readSelection = () => {
      if (selecting || floatingElement.current?.contains(document.activeElement)) return;
      const selection = window.getSelection();
      if (
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount !== 1 ||
        !selection.toString().trim()
      ) {
        setSelected(undefined);
        return;
      }
      const range = selection.getRangeAt(0);
      const elementFor = (node: Node) => (node instanceof Element ? node : node.parentElement);
      const start = elementFor(range.startContainer)?.closest<HTMLElement>(
        '.assistant-body .markdown',
      );
      const end = elementFor(range.endContainer)?.closest<HTMLElement>('.assistant-body .markdown');
      const article = start?.closest<HTMLElement>('[data-message-id]');
      if (
        !start ||
        start !== end ||
        !scope.current?.contains(start) ||
        !article?.dataset.messageId
      ) {
        setSelected(undefined);
        return;
      }
      const bounds = range.getBoundingClientRect();
      if (!bounds.width && !bounds.height) {
        setSelected(undefined);
        return;
      }
      setSelected({
        quote: { messageId: article.dataset.messageId, text: selection.toString() },
        range: range.cloneRange(),
        element: start,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(readSelection);
    };
    const pointerDown = (event: PointerEvent) => {
      if (floatingElement.current?.contains(event.target as Node)) return;
      selecting = true;
      startedInScope = !!scope.current?.contains(event.target as Node);
      setSelected(undefined);
    };
    const pointerUp = () => {
      selecting = false;
      if (startedInScope) schedule();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelected(undefined);
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener('selectionchange', schedule);
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('pointerup', pointerUp);
    document.addEventListener('keydown', escape);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(copiedTimer.current);
      document.removeEventListener('selectionchange', schedule);
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('pointerup', pointerUp);
      document.removeEventListener('keydown', escape);
    };
  }, [scope, floatingElement]);

  if (!selected) return null;
  return createPortal(
    <div
      ref={refs.setFloating}
      className="selection-toolbar"
      role="toolbar"
      aria-label="选中文本操作"
      style={{
        ...floatingStyles,
        visibility: !isPositioned || middlewareData.hide?.referenceHidden ? 'hidden' : undefined,
      }}
      onPointerDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
        event.preventDefault();
      }}
    >
      <button
        type="button"
        aria-label="复制选中文字"
        onClick={async () => {
          try {
            await copyText(selected.quote.text);
            setCopied(true);
            clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 1400);
          } catch (error) {
            reportError((error as Error).message);
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        <span>{copied ? '已复制' : '复制'}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          if (selected.quote.text.length > MAX_QUOTE_LENGTH) {
            reportError(`最多引用 ${MAX_QUOTE_LENGTH} 字，请缩小选区`);
            return;
          }
          onQuote(selected.quote);
          setSelected(undefined);
          window.getSelection()?.removeAllRanges();
        }}
      >
        <MessageSquareQuote size={14} />
        <span>问问格物</span>
      </button>
    </div>,
    document.body,
  );
}
