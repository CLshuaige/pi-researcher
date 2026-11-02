import { Hint } from './ui/animated';
import { useEffect, useRef, useState } from 'react';
import { Download, Folder, PackageOpen, X } from 'lucide-react';
import { api } from '../api';
import { FileTree, flatten } from './FileTree';
import type { Artifact } from '../../shared/types';

export function Artifacts({
  artifacts,
  sessionId,
  workspaceDir,
  onPreviewFile,
  onClose,
}: {
  onClose: () => void;
  artifacts: Artifact[];
  sessionId: string;
  workspaceDir?: string;
  onPreviewFile: (path: string, name: string) => void;
}) {
  const [fresh, setFresh] = useState(new Set<string>());
  const prior = useRef<Map<string, number> | undefined>(undefined);
  const freshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const current = new Map(flatten(artifacts).map((a) => [a.path, a.updatedAt]));
    const changed = prior.current
      ? new Set(
          [...current]
            .filter(([path, timestamp]) => prior.current?.get(path) !== timestamp)
            .map(([path]) => path),
        )
      : new Set<string>();
    prior.current = current;
    if (changed.size) {
      setFresh(changed);
      clearTimeout(freshTimer.current);
      freshTimer.current = setTimeout(() => setFresh(new Set()), 1100);
    }
  }, [artifacts]);
  useEffect(() => () => clearTimeout(freshTimer.current), []);
  return (
    <>
      <section className="artifact-section">
        <div className="section-header">
          <h2>研究产物</h2>
          <div className="flow-header-controls">
            <a
              className="icon-button"
              href={api.download(sessionId)}
              download
              title="打包下载当前研究"
              aria-label="下载全部研究产物"
            >
              <Download size={17} />
            </a>
            <Hint label="关闭研究产物">
              <button className="icon-button" aria-label="关闭研究产物" onClick={onClose}>
                <X size={15} />
              </button>
            </Hint>
          </div>
        </div>
        {artifacts.length ? (
          <div className="file-tree" role="tree" aria-label="研究工作空间文件">
            <FileTree
              artifacts={artifacts}
              sessionId={sessionId}
              fresh={fresh}
              onPreview={(file) => onPreviewFile(file.path, file.name)}
            />
          </div>
        ) : (
          <div className="artifact-empty">
            <PackageOpen size={28} strokeWidth={1.2} />
            <strong>发现，会在这里留下痕迹</strong>
            <p>研究中生成的文件将呈现在这里</p>
          </div>
        )}
        <div className="artifact-footer">
          <Folder size={13} />
          <span title={workspaceDir ? `workspace/${workspaceDir}` : undefined}>
            {workspaceDir ? `workspace/${workspaceDir}` : '当前研究的工作空间'}
          </span>
          <span>{flatten(artifacts).length} 个文件</span>
        </div>
      </section>
    </>
  );
}
