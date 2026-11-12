import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { PresentationBoard, PresentationSource } from '../../shared/types';
import { LoaderCircle } from 'lucide-react';

export function PresentationLoading({ phase = '准备展板' }: { phase?: string }) {
  return (
    <div className="presentation-loading-mask" role="status" aria-live="polite">
      <span className="presentation-loading-label">
        <LoaderCircle size={15} className="presentation-spinner" />
        正在生成 {phase}
      </span>
    </div>
  );
}

export function PresentationView({
  sessionId,
  stageId,
  versionId,
  stage,
  facts,
  generating = false,
  phase,
  onPreviewFile,
}: {
  sessionId: string;
  stageId: string;
  versionId?: string;
  stage: PresentationBoard;
  facts: Record<string, string | number>;
  generating?: boolean;
  phase?: string;
  onPreviewFile: (path: string, name: string) => void;
}) {
  const flow = useReactFlow();
  const frame = useRef<HTMLIFrameElement>(null);
  const [document, setDocument] = useState<{
    html: string;
    token: string;
    digest: string;
    sources: PresentationSource[];
    key: string;
  }>();
  const [loadedDigest, setLoadedDigest] = useState('');
  const [error, setError] = useState('');
  const [height, setHeight] = useState(180);
  const key = JSON.stringify([sessionId, stageId, versionId]);
  const shown = document?.key === key ? document : undefined;
  const preview = generating && !!stage.previewDigest;
  const targetDigest = preview ? stage.previewDigest : stage.digest;
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setError('');
    const read = async (attempt = 0) => {
      try {
        const result = await api.presentationDocument(sessionId, stageId, versionId, preview);
        if (!cancelled) setDocument({ ...result, key });
      } catch (e) {
        if (cancelled) return;
        const error = e as Error & { status?: number };
        if ((error.status === 409 || error.status === 404) && attempt < 3) {
          timer = setTimeout(() => void read(attempt + 1), 250);
        } else setError(error.message);
      }
    };
    void read();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionId, stageId, versionId, key, targetDigest, preview]);
  useEffect(() => {
    setHeight(180);
    setLoadedDigest('');
  }, [key]);
  const update = () =>
    frame.current?.contentWindow?.postMessage(
      { type: 'presentation-facts', token: shown?.token, facts },
      '*',
    );
  useEffect(update, [shown, facts]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        !shown ||
        event.source !== frame.current?.contentWindow ||
        event.data?.token !== shown.token
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
      const source = (shown.sources || stage.sources).find((source) => source.id === event.data.id);
      if (source) onPreviewFile(source.path, source.title);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [shown, stage.sources, onPreviewFile, flow]);
  const loading = generating || (!error && (!shown || loadedDigest !== targetDigest));
  return (
    <div className="presentation-frame-wrap nodrag nopan" aria-busy={loading}>
      {error && (
        <p role="status" className="presentation-error">
          {error}
        </p>
      )}
      {shown && (
        <iframe
          key={key}
          ref={frame}
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
          style={{ height }}
          scrolling="no"
          title={`${stageId} 研究展板`}
          srcDoc={shown.html}
          onLoad={() => {
            update();
            setLoadedDigest(shown.digest);
          }}
          className="presentation-frame"
        />
      )}
      {!shown && (
        <div className="presentation-skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
      {loading && <PresentationLoading phase={generating ? phase : '读取展板'} />}
    </div>
  );
}
