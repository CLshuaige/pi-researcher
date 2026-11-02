import { useEffect, useRef, useState } from 'react';
import boxClosed from '../assets/skill-box-closed.png';
import boxOpen from '../assets/skill-box-open.png';

type Skill = {
  id: string;
  label: string;
};

const SKILLS: Skill[] = [
  { id: 'rf-chip', label: '射频芯片设计' },
  { id: 'turbine', label: '航发涡轮叶片设计' },
  { id: 'scientific-computing', label: '科学计算' },
  { id: 'scientific-qa', label: '科学问答' },
  { id: 'ai-mathematician', label: 'AI数学家' },
  { id: 'ai-geologist', label: 'AI地质学家' },
  { id: 'ai-cytologist', label: 'AI细胞学家' },
  { id: 'literature-survey', label: '文献调研' },
];

const STORAGE_KEY = 'gewu-skill-box';
const BOX_SIZE = 180;
const DRAG_THRESHOLD = 6;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

// Float near the lower-right area, but visibly away from the corner
function defaultPosition() {
  return {
    x: Math.max(12, window.innerWidth * 0.86 - BOX_SIZE / 2),
    y: Math.max(12, window.innerHeight * 0.82 - BOX_SIZE / 2),
  };
}

function loadState(): { x: number; y: number; skills: string[] } {
  const fallback = { ...defaultPosition(), skills: [] as string[] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<typeof fallback>;
    return {
      x: typeof parsed.x === 'number' ? parsed.x : fallback.x,
      y: typeof parsed.y === 'number' ? parsed.y : fallback.y,
      skills: Array.isArray(parsed.skills)
        ? parsed.skills.filter((s) => typeof s === 'string')
        : [],
    };
  } catch {
    return fallback;
  }
}

type Burst = {
  key: number;
  angle: number;
  distance: number;
  size: number;
  delay: number;
  duration: number;
};

function StarBurst({ origin = 'label' }: { origin?: 'label' | 'corner' }) {
  const [bursts] = useState<Burst[]>(() =>
    Array.from({ length: 8 }, (_, i) => ({
      key: i,
      angle: (i / 8) * Math.PI * 2 + Math.random() * 0.7,
      distance: 20 + Math.random() * 18,
      size: 7 + Math.random() * 6,
      delay: Math.random() * 0.08,
      duration: 0.65 + Math.random() * 0.3,
    })),
  );
  return (
    <span className={`star-burst ${origin}`} aria-hidden="true">
      {bursts.map((b) => (
        <i
          key={b.key}
          style={
            {
              '--tx': `${Math.cos(b.angle) * b.distance}px`,
              '--ty': `${Math.sin(b.angle) * b.distance}px`,
              '--sz': `${b.size}px`,
              '--dur': `${b.duration}s`,
              animationDelay: `${b.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
    </span>
  );
}

export function SkillBox() {
  const initial = useRef(loadState());
  const [pos, setPos] = useState({ x: initial.current.x, y: initial.current.y });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial.current.skills));
  const [bursts, setBursts] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);
  const drag = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x: pos.x, y: pos.y, skills: [...selected] }),
      );
    } catch {}
  }, [pos, selected]);

  function clampToViewport(p: { x: number; y: number }) {
    const bounds = document.querySelector('.conversation')?.getBoundingClientRect();
    const width = window.innerWidth <= 700 ? 140 : BOX_SIZE;
    const left = (bounds?.left || 0) + 8;
    const top = (bounds?.top || 0) + 8;
    return {
      x: clamp(p.x, left, Math.max(left, (bounds?.right || window.innerWidth) - width - 8)),
      y: clamp(p.y, top, Math.max(top, (bounds?.bottom || window.innerHeight) - width - 8)),
    };
  }

  useEffect(() => {
    const onResize = () => setPos((p) => clampToViewport(p));
    const frame = requestAnimationFrame(onResize);
    const observer = new ResizeObserver(onResize);
    const conversation = document.querySelector('.conversation');
    if (conversation) observer.observe(conversation);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    drag.current = {
      pointerId: e.pointerId,
      offsetX: e.clientX - pos.x,
      offsetY: e.clientY - pos.y,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > DRAG_THRESHOLD) {
      d.moved = true;
    }
    if (d.moved) {
      setPos(clampToViewport({ x: e.clientX - d.offsetX, y: e.clientY - d.offsetY }));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      // Snap gently inside the viewport after dragging
      setPos((p) => clampToViewport(p));
    } else {
      setOpen((o) => !o);
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function toggleSkill(skill: Skill) {
    const isSelected = selected.has(skill.id);
    setSelected((old) => {
      const next = new Set(old);
      if (isSelected) next.delete(skill.id);
      else next.add(skill.id);
      return next;
    });
    if (!isSelected) {
      setBursts((old) => ({ ...old, [skill.id]: Date.now() }));
    }
  }

  const panelSide = pos.x + BOX_SIZE + 260 > window.innerWidth ? 'left' : 'right';
  // Open downward when there isn't enough room above the box
  const panelVertical = pos.y < 460 ? 'below' : 'above';

  return (
    <div
      className="skill-box"
      data-open={open}
      data-dragging={drag.current?.moved ? 'true' : undefined}
      style={{ left: pos.x, top: pos.y }}
    >
      <div className={`skill-panel ${panelSide} ${panelVertical}`} role="menu" aria-label="技能箱">
        <p className="skill-panel-banner">技能箱</p>
        <div className="skill-list">
          {SKILLS.map((skill, i) => {
            const active = selected.has(skill.id);
            return (
              <button
                key={skill.id}
                role="menuitemcheckbox"
                aria-checked={active}
                className={`skill-card${active ? ' active' : ''}`}
                style={{ '--i': i } as React.CSSProperties}
                onClick={() => toggleSkill(skill)}
              >
                <span className="skill-label">{skill.label}</span>
                {bursts[skill.id] ? (
                  <StarBurst key={bursts[skill.id]} origin={active ? 'label' : 'corner'} />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <button
        className="skill-box-button"
        style={ready ? undefined : { transition: 'none' }}
        aria-expanded={open}
        aria-label={open ? '收起技能箱' : '打开技能箱'}
        title="技能箱（可拖动）"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      >
        <img className="skill-box-img" src={open ? boxOpen : boxClosed} alt="" draggable={false} />
      </button>
    </div>
  );
}
