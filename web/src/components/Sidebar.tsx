import { Button } from './ui/Button';
import { DropdownMenu as Menu } from '@animate-ui/react/primitives/radix-ui/dropdown-menu';
import { SettingsDialog } from './SettingsDialog';
import {
  Plus,
  PanelLeftClose,
  House,
  History,
  FlaskConical,
  Settings,
  LogOut,
  Circle,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Logo } from './Logo';
import type { SessionSummary } from '../../shared/types';
import { useState, useRef } from 'react';

function HistoryItem({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  session: SessionSummary;
  active: boolean;
  onSelect: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const renameRequested = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(session.title);

  return (
    <div className={`history-item-wrapper${active ? ' active' : ''}`}>
      <button
        className={`history-item${active ? ' active' : ''}`}
        onClick={onSelect}
        title={session.title}
      >
        <span className="history-title">{session.title}</span>
        {session.status === 'running' ? (
          <Circle size={7} fill="currentColor" />
        ) : (
          <time>
            {new Date(session.updatedAt).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        )}
      </button>
      <div className="history-item-actions">
        <Menu.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger asChild>
            <button
              ref={menuTrigger}
              className="icon-button history-more"
              aria-label="更多操作"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className="history-menu ui-menu"
              align="end"
              sideOffset={6}
              onCloseAutoFocus={(event) => {
                if (renameRequested.current) {
                  event.preventDefault();
                  renameRequested.current = false;
                  menuTrigger.current?.focus();
                  setEditTitle(session.title);
                  setEditing(true);
                }
              }}
            >
              <Menu.Item asChild>
                <button
                  role="menuitem"
                  onClick={() => {
                    renameRequested.current = true;
                    setMenuOpen(false);
                  }}
                >
                  <Pencil size={13} /> 重命名
                </button>
              </Menu.Item>
              <Menu.Item asChild>
                <button
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false);
                    onDelete(session.id);
                  }}
                >
                  <Trash2 size={13} /> 删除
                </button>
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {editing && (
        <SettingsDialog
          title="重命名研究"
          size="compact"
          returnFocusTarget={menuTrigger.current}
          onClose={() => setEditing(false)}
        >
          <div className="rename-content">
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && editTitle.trim()) {
                  onRename(session.id, editTitle.trim());
                  setEditing(false);
                }
              }}
            />
            <div className="history-rename-actions">
              <button onClick={() => setEditing(false)}>取消</button>
              <button
                className="primary"
                disabled={!editTitle.trim()}
                onClick={() => {
                  onRename(session.id, editTitle.trim());
                  setEditing(false);
                }}
              >
                确定
              </button>
            </div>
          </div>
        </SettingsDialog>
      )}
    </div>
  );
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  creating,
  onCollapse,
  onRename,
  onDelete,
  onOpenSettings,
  onLogout,
  profile,
}: {
  sessions: SessionSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  creating: boolean;
  onCollapse: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  profile: { name: string; avatar: string };
}) {
  const real = sessions.filter((s) => s.mode === 'pi');
  const userTrigger = useRef<HTMLButtonElement>(null);
  const settingsRequested = useRef(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const groups = [
    {
      label: '今天',
      items: real.filter((s) => new Date(s.updatedAt).toDateString() === new Date().toDateString()),
    },
    {
      label: '更早',
      items: real.filter((s) => new Date(s.updatedAt).toDateString() !== new Date().toDateString()),
    },
  ];
  return (
    <aside className="sidebar" aria-label="研究会话">
      <div className="brand-row">
        <div className="brand">
          <Logo />
          <span className="brand-title">格悟科研工坊</span>
        </div>
        <button
          className="icon-button sidebar-collapse-btn"
          aria-label="收起会话边栏"
          title="收起会话边栏"
          onClick={onCollapse}
        >
          <PanelLeftClose size={20} />
        </button>
      </div>
      <Button className="new-research" onClick={onNew} disabled={creating} aria-busy={creating}>
        <Plus size={18} />
        <span>新建研究</span>
      </Button>
      <nav className="sidebar-nav" aria-label="导航">
        <button
          className="nav-item"
          onClick={() => onSelect(sessions.find((s) => s.mode === 'pi')?.id || 'demo')}
        >
          <House size={18} />
          首页
        </button>
        <button
          className="nav-item active"
          onClick={() =>
            document.querySelector('.history-list')?.scrollIntoView({ block: 'nearest' })
          }
        >
          <History size={18} />
          研究历史
        </button>
      </nav>
      <div className="history-list">
        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <div key={group.label}>
                <div className="history-group-label">{group.label}</div>
                {group.items.map((s) => (
                  <HistoryItem
                    key={s.id}
                    session={s}
                    active={activeId === s.id}
                    onSelect={() => onSelect(s.id)}
                    onRename={onRename}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            ),
        )}

        <div className="history-group-label">探索格悟</div>
        <button
          className={`history-item${activeId === 'demo' ? ' active' : ''}`}
          onClick={() => onSelect('demo')}
        >
          <FlaskConical size={15} />
          <span className="history-title">交互演示</span>
          <span className="demo-label">示例</span>
        </button>
      </div>
      <div className="sidebar-footer">
        <Menu.Root modal={false} open={userMenuOpen} onOpenChange={setUserMenuOpen}>
          <Menu.Trigger asChild>
            <button ref={userTrigger} className="user-section" aria-label="用户菜单">
              <span className="avatar">
                {profile.avatar ? (
                  <img src={profile.avatar} alt="头像" />
                ) : (
                  Array.from(profile.name.trim())[0] || '?'
                )}
              </span>
              <span className="profile-copy">
                <strong>{profile.name}</strong>
                <span className="role-badge">Basic</span>
              </span>
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content
              className="user-menu ui-menu"
              onCloseAutoFocus={(event) => {
                if (settingsRequested.current) {
                  event.preventDefault();
                  settingsRequested.current = false;
                  userTrigger.current?.focus();
                  onOpenSettings();
                }
              }}
              side="top"
              align="start"
              sideOffset={10}
              collisionPadding={12}
            >
              <Menu.Item asChild>
                <button
                  onClick={() => {
                    settingsRequested.current = true;
                    setUserMenuOpen(false);
                  }}
                >
                  <Settings size={14} />
                  设置
                </button>
              </Menu.Item>
              <Menu.Item asChild>
                <button
                  className="danger"
                  onClick={() => {
                    setUserMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut size={14} />
                  登出
                </button>
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </aside>
  );
}
