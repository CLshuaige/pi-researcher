import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ComponentProps,
} from 'react';
import { Streamdown, type AnimateOptions, type Components } from 'streamdown';

// Keep the plugin and renderers stable across token updates so old text keeps its place.
const reveal: AnimateOptions = {
  animation: 'gewuReveal',
  duration: 380,
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  sep: 'char',
  stagger: 10,
  maxBacklogMs: 180,
};
type RevealStyle = CSSProperties & {
  '--sd-duration'?: string;
  '--sd-delay'?: string;
  '--sd-animation'?: string;
};
function RevealSpan({ node: _node, style, ...props }: ComponentProps<'span'> & { node?: unknown }) {
  const next = style as RevealStyle | undefined;
  const bornTiming = useRef<RevealStyle | undefined>(undefined);
  if (next?.['--sd-animation'] && !bornTiming.current) {
    bornTiming.current = {
      '--sd-duration': next['--sd-duration'],
      '--sd-delay': next['--sd-delay'],
    };
  }
  // Later token commits mark old spans as already visible. Preserve an in-flight
  // fade's original clock instead of cutting it short on the very next delta.
  return (
    <span {...props} style={bornTiming.current ? { ...style, ...bornTiming.current } : style} />
  );
}
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  img: ({ alt }) => <span className="image-reference">[图片：{alt || '请下载查看'}]</span>,
  span: RevealSpan,
};
const motionQuery = '(prefers-reduced-motion: reduce)';
const motionSnapshot = () => window.matchMedia(motionQuery).matches;
function subscribeMotion(onChange: () => void) {
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

export default function MarkdownRenderer({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  const reducedMotion = useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
  const [settling, setSettling] = useState(streaming);
  useEffect(() => {
    if (reducedMotion) {
      setSettling(false);
      return;
    }
    if (streaming) {
      setSettling(true);
      return;
    }
    // Let the last token's fade finish even if Pi settles in the same update.
    const timer = setTimeout(() => setSettling(false), 600);
    return () => clearTimeout(timer);
  }, [streaming, reducedMotion]);
  const animate = !reducedMotion && (streaming || settling);
  return (
    <div
      className="markdown-surface"
      data-stream-state={streaming ? 'streaming' : animate ? 'settling' : 'complete'}
      aria-busy={streaming}
    >
      <Streamdown
        className="markdown"
        mode={animate ? 'streaming' : 'static'}
        isAnimating={animate}
        animated={reveal}
        controls={false}
        components={components}
      >
        {children}
      </Streamdown>
    </div>
  );
}
