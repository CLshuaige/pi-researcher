const assets = import.meta.glob('../assets/file-icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const extensions: Record<string, string> = {
  pdf: 'pdf',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  pyw: 'python',
  ipynb: 'jupyter',
  json: 'json',
  jsonl: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'settings',
  ini: 'settings',
  csv: 'table',
  tsv: 'table',
  xls: 'table',
  xlsx: 'table',
  parquet: 'database',
  sqlite: 'database',
  db: 'database',
  ts: 'typescript',
  tsx: 'react',
  js: 'javascript',
  jsx: 'react',
  html: 'html',
  css: 'css',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  zip: 'zip',
  gz: 'zip',
  tar: 'zip',
  sh: 'console',
  bash: 'console',
  tex: 'tex',
  bib: 'tex',
  doc: 'word',
  docx: 'word',
  txt: 'document',
  log: 'document',
  mp4: 'video',
  mp3: 'audio',
  wav: 'audio',
};
export function FileIcon({
  name,
  directory = false,
  expanded = false,
  size = 20,
}: {
  name: string;
  directory?: boolean;
  expanded?: boolean;
  size?: number;
}) {
  const key = directory
    ? expanded
      ? 'folder-open'
      : 'folder'
    : extensions[name.split('.').at(-1)?.toLowerCase() || ''] || 'file';
  return (
    <img
      className="material-file-icon"
      src={assets[`../assets/file-icons/${key}.svg`] || assets['../assets/file-icons/file.svg']}
      alt=""
      aria-hidden="true"
      data-filetype={key}
      width={size}
      height={size}
      draggable={false}
    />
  );
}
