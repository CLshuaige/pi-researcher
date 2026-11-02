import { useState, useRef } from 'react';
import { ChevronDown, Settings } from 'lucide-react';
import { Popover } from '@animate-ui/react/primitives/radix-ui/popover';
import { Slider } from '@animate-ui/react/primitives/radix-ui/slider';
import { Reveal } from './ui/animated';
import type { ModelOption, ThinkingLevel } from '../../shared/types';

const LEVELS: { id: ThinkingLevel; label: string }[] = [
  { id: 'off', label: '关闭' },
  { id: 'minimal', label: '极简' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '极高' },
  { id: 'max', label: '最大' },
];
export function ModelSelector({
  models,
  currentModel,
  thinkingLevel,
  onModelChange,
  onThinkingLevelChange,
  onOpenSettings,
  disabled,
}: {
  models: ModelOption[];
  currentModel: string;
  thinkingLevel: ThinkingLevel;
  onModelChange: (model: string) => void;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  onOpenSettings?: () => void;
  disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false),
    [showModels, setShowModels] = useState(false);
  const model = models.find((m) => `${m.provider}/${m.id}` === currentModel);
  const index = Math.max(
    0,
    LEVELS.findIndex((t) => t.id === thinkingLevel),
  );
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          ref={trigger}
          className="model-selector-trigger"
          disabled={disabled}
          aria-label="模型和思考强度设置"
        >
          <span className="model-name">{model?.name || currentModel}</span>
          <span className="thinking-label">{LEVELS[index].label}</span>
          <ChevronDown size={12} className={open ? 'rotate-180' : ''} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="model-panel ui-popover"
          side="top"
          align="end"
          sideOffset={12}
          collisionPadding={12}
          aria-label="模型设置"
        >
          <div className="model-section">
            <button
              className="model-section-header"
              aria-expanded={showModels}
              onClick={() => setShowModels(!showModels)}
            >
              <span className="model-section-title">{model?.name || currentModel}</span>
              <ChevronDown size={12} />
            </button>
            <Reveal open={showModels}>
              <div className="model-list">
                {models.map((m) => (
                  <button
                    key={`${m.provider}/${m.id}`}
                    className={`model-item${`${m.provider}/${m.id}` === currentModel ? ' active' : ''}`}
                    onClick={() => {
                      onModelChange(`${m.provider}/${m.id}`);
                      setShowModels(false);
                    }}
                  >
                    <span className="model-item-name">{m.name}</span>
                    <span className="model-item-provider">{m.provider}</span>
                    {m.reasoning && <span className="model-badge">推理</span>}
                  </button>
                ))}
              </div>
            </Reveal>
          </div>
          <div className="thinking-section">
            <div className="thinking-header">
              <span>思考强度</span>
              <span className="thinking-value">{LEVELS[index].label}</span>
            </div>
            <Slider.Root
              className="ui-slider"
              min={0}
              max={LEVELS.length - 1}
              step={1}
              value={[index]}
              onValueChange={(value) => onThinkingLevelChange(LEVELS[value[0]].id)}
            >
              <Slider.Track className="ui-slider-track">
                <Slider.Range className="ui-slider-range" />
              </Slider.Track>
              <Slider.Thumb
                className="ui-slider-thumb"
                aria-label="思考强度"
                aria-valuetext={LEVELS[index].label}
              />
            </Slider.Root>
            <div className="thinking-labels">
              {LEVELS.map((level) => (
                <span
                  key={level.id}
                  className={`thinking-tick${level.id === thinkingLevel ? ' active' : ''}`}
                >
                  {level.label}
                </span>
              ))}
            </div>
          </div>
          <button
            className="model-item settings-link"
            onClick={() => {
              setOpen(false);
              trigger.current?.focus();
              onOpenSettings?.();
            }}
          >
            <Settings size={13} />
            <span>更多模型设置</span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
