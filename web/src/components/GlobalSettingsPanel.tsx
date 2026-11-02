import { Button } from './ui/Button';
import { Tabs } from '@animate-ui/react/primitives/radix-ui/tabs';
import { SelectField } from './ui/fields';
import { applyTheme } from '../lib/theme';
import { useEffect, useState } from 'react';
import { User, Globe, Key, LoaderCircle, Camera, Eye, EyeOff } from 'lucide-react';
import { api, type UserSettings } from '../api';
import { SettingsDialog } from './SettingsDialog';

export function GlobalSettingsPanel({
  onClose,
  reportError,
  onProfileChange,
  initialTab = 'profile',
}: {
  initialTab?: 'profile' | 'general' | 'apikey';
  onClose: () => void;
  reportError: (text: string) => void;
  onProfileChange: (profile: UserSettings['profile']) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState<UserSettings>();
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    api
      .userSettings()
      .then(setSettings)
      .catch((error) => reportError(error.message));
  }, [reportError]);
  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const result = await api.saveUserSettings({
        profile: settings.profile,
        general: settings.general,
        apiKeys: keys,
      });
      onProfileChange(result.profile);
      applyTheme(result.general.theme);
      onClose();
    } catch (error) {
      reportError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <SettingsDialog title="用户设置" onClose={onClose}>
      <Tabs.Root
        value={tab}
        onValueChange={(value) => setTab(value as typeof tab)}
        orientation="vertical"
        asChild
      >
        <div className="settings-body">
          <Tabs.List asChild>
            <nav className="settings-nav" aria-label="用户设置分类">
              {[
                { id: 'profile' as const, label: '个人资料', icon: User },
                { id: 'general' as const, label: '通用', icon: Globe },
                { id: 'apikey' as const, label: 'API Key', icon: Key },
              ].map((item) => (
                <Tabs.Trigger key={item.id} value={item.id} asChild>
                  <button
                    className={`settings-nav-item${tab === item.id ? ' active' : ''}`}
                    onClick={() => setTab(item.id)}
                  >
                    <item.icon size={16} />
                    {item.label}
                  </button>
                </Tabs.Trigger>
              ))}
            </nav>
          </Tabs.List>
          <Tabs.Content value={tab} asChild>
            <div className="settings-content">
              {!settings ? (
                <div className="settings-loading">
                  <LoaderCircle className="spin" />
                </div>
              ) : (
                <div className="settings-form user-settings-form">
                  {tab === 'profile' && (
                    <div className="profile-settings">
                      <label className="profile-avatar-input">
                        <span className="avatar large">
                          {settings.profile.avatar ? (
                            <img src={settings.profile.avatar} alt="头像" />
                          ) : (
                            Array.from(settings.profile.name.trim())[0] || '?'
                          )}
                        </span>
                        <span className="profile-avatar-overlay">
                          <Camera size={20} />
                        </span>
                        <input
                          className="sr-only"
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          aria-label="上传头像"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            if (file.size > 512 * 1024) {
                              reportError('头像请小于 512 KB');
                              return;
                            }
                            const reader = new FileReader();
                            reader.onload = () =>
                              setSettings((old) =>
                                old
                                  ? {
                                      ...old,
                                      profile: { ...old.profile, avatar: String(reader.result) },
                                    }
                                  : old,
                              );
                            reader.readAsDataURL(file);
                          }}
                        />
                      </label>
                      <label className="user-setting-field profile-name-field">
                        <span className="sr-only">显示名称</span>
                        <input
                          placeholder="显示名称"
                          value={settings.profile.name}
                          maxLength={40}
                          onChange={(event) =>
                            setSettings({
                              ...settings,
                              profile: { ...settings.profile, name: event.target.value },
                            })
                          }
                        />
                      </label>
                    </div>
                  )}
                  {tab === 'general' && (
                    <>
                      <label className="user-setting-field">
                        外观
                        <SelectField
                          label="外观"
                          value={settings.general.theme}
                          onChange={(value) =>
                            setSettings({
                              ...settings,
                              general: { theme: value as 'light' | 'dark' | 'system' },
                            })
                          }
                          options={[
                            { value: 'light', label: '浅色' },
                            { value: 'dark', label: '深色' },
                            { value: 'system', label: '跟随系统' },
                          ]}
                        />
                      </label>
                      <p className="form-hint">界面语言：简体中文</p>
                    </>
                  )}
                  {tab === 'apikey' && (
                    <>
                      <Button className="settings-btn secondary" onClick={() => setShow(!show)}>
                        {show ? <EyeOff size={14} /> : <Eye size={14} />}
                        {show ? '隐藏密钥' : '显示密钥'}
                      </Button>
                      {settings.providers.map((provider) => (
                        <label key={provider.id} className="user-setting-field">
                          {provider.name || provider.id}
                          <input
                            type={show ? 'text' : 'password'}
                            autoComplete="new-password"
                            value={keys[provider.id] || ''}
                            placeholder={
                              provider.configured ? '已配置，输入新 Key 以替换' : '输入 API Key'
                            }
                            onChange={(event) =>
                              setKeys({ ...keys, [provider.id]: event.target.value })
                            }
                          />
                        </label>
                      ))}
                    </>
                  )}
                </div>
              )}
              <div className="settings-actions">
                <Button className="settings-btn secondary" onClick={onClose}>
                  取消
                </Button>
                <Button
                  className="settings-btn primary"
                  disabled={!settings || saving}
                  onClick={() => void save()}
                >
                  {saving ? '保存中…' : '保存'}
                </Button>
              </div>
            </div>
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </SettingsDialog>
  );
}
