import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { PresentationStage } from '../../shared/types';
export function PresentationView({
  sessionId,
  stageId,
  stage,
  facts,
  onPreviewFile,
}: {
  sessionId: string;
  stageId: string;
  stage: PresentationStage;
  facts: Record<string, string | number>;
  onPreviewFile: (path: string, name: string) => void;
}) {
  const flow = useReactFlow();
  const frame = useRef<HTMLIFrameElement>(null);
  const [document, setDocument] = useState<{ html: string; token: string }>();
  const [error, setError] = useState('');
  const [height, setHeight] = useState(180);
  useEffect(() => {
    let cancelled = false;
    setError('');
    api
      .presentationDocument(sessionId, stageId)
      .then((result) => {
        if (!cancelled) setDocument(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, stageId, stage.digest]);
  const update = () =>
    frame.current?.contentWindow?.postMessage(
      { type: 'presentation-facts', token: document?.token, facts },
      '*',
    );
  useEffect(update, [document, facts]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        !document ||
        event.source !== frame.current?.contentWindow ||
        event.data?.token !== document.token
      )
        return;
      if (event.data.type === 'presentation-zoom') {
        const { dy, x, y } = event.data;
        if (![dy, x, y].every(Number.isFinite)) return;
        const viewport = flow.getViewport(),
          frameRect = frame.current!.getBoundingClientRect(),
          canvasRect = frame.current!.closest('.react-flow')?.getBoundingClientRect();
        if (!canvasRect) return;
        const zoom = Math.max(
          0.25,
          Math.min(2.5, viewport.zoom * Math.exp(-Math.max(-100, Math.min(100, dy)) * 0.01)),
        );
        const focalX = frameRect.left + x * viewport.zoom - canvasRect.left,
          focalY = frameRect.top + y * viewport.zoom - canvasRect.top;
        void flow.setViewport({
          zoom,
          x: focalX - ((focalX - viewport.x) * zoom) / viewport.zoom,
          y: focalY - ((focalY - viewport.y) * zoom) / viewport.zoom,
        });
        return;
      }
      if (event.data.type === 'presentation-pan') {
        const { dx, dy } = event.data;
        if (
          Number.isFinite(dx) &&
          Number.isFinite(dy) &&
          Math.abs(dx) < 5000 &&
          Math.abs(dy) < 5000
        ) {
          const viewport = flow.getViewport();
          void flow.setViewport({ ...viewport, x: viewport.x - dx, y: viewport.y - dy });
        }
        return;
      }
      if (event.data.type === 'presentation-size') {
        const size = event.data.height;
        if (Number.isFinite(size) && size > 0 && size <= 50000) setHeight(Math.ceil(size));
        return;
      }
      if (event.data.type !== 'presentation-source') return;
      const source = stage.sources.find((source) => source.id === event.data.id);
      if (source) onPreviewFile(source.path, source.title);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [document, stage.sources, onPreviewFile, flow]);
  return (
    <div className="presentation-frame-wrap nodrag nopan">
      {error && (
        <p role="status" className="presentation-error">
          {error}
        </p>
      )}
      {document && (
        <iframe
          ref={frame}
          sandbox="allow-scripts"
          style={{ height }}
          scrolling="no"
          title={`${stageId} 研究展板`}
          srcDoc={document.html}
          onLoad={update}
          className="presentation-frame"
        />
      )}
      {!document && !error && <p>正在读取展板…</p>}
    </div>
  );
}
