import { lazy, Suspense } from 'react';
export const preloadMarkdown = () => import('./MarkdownRenderer');
const Renderer = lazy(preloadMarkdown);
export function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  streaming?: boolean;
}) {
  return (
    <Suspense fallback={<div className="markdown markdown-loading">{children}</div>}>
      <Renderer streaming={streaming}>{children}</Renderer>
    </Suspense>
  );
}
