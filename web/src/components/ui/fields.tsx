import type { InputHTMLAttributes } from 'react';
import { Select } from '@animate-ui/react/primitives/radix-ui/select';
import { Checkbox as CheckboxPrimitive } from '@animate-ui/react/primitives/radix-ui/checkbox';
import { Check, ChevronDown } from 'lucide-react';

export function SelectField({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger className="ui-select-trigger" aria-label={label}>
        <Select.Value />
        <Select.Icon>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="ui-menu ui-select-content" position="popper" sideOffset={5}>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item className="ui-select-item" key={option.value} value={option.value}>
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
export function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <CheckboxPrimitive.Root
      className="ui-checkbox"
      checked={checked}
      onCheckedChange={onChange}
      aria-label={label}
    >
      <CheckboxPrimitive.Indicator className="ui-checkbox-indicator">
        <Check size={12} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/** Preserve an empty edit and normalize leading zeros before React's numeric-value comparison. */
export function IntegerInput({
  value,
  onValueChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  onValueChange: (value: number) => void;
}) {
  return (
    <input
      {...props}
      type="number"
      step={1}
      value={Number.isFinite(value) ? value : ''}
      onChange={(event) => {
        const value = event.currentTarget.value.replace(/^(-?)0+(?=\d)/, '$1');
        event.currentTarget.value = value;
        onValueChange(value === '' ? Number.NaN : Number(value));
      }}
    />
  );
}
