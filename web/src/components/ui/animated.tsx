import type { ReactNode, ReactElement } from 'react';
import { Collapsible } from '@animate-ui/react/primitives/radix-ui/collapsible';
import { Tooltip } from '@animate-ui/react/primitives/radix-ui/tooltip';
import { Switch as SwitchPrimitive } from '@animate-ui/react/primitives/radix-ui/switch';

export function Reveal({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Collapsible.Root open={open}>
      <Collapsible.Content className={className}>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
export function Disclosure({
  title,
  children,
  className,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} className={className}>
      <Collapsible.Trigger className="disclosure-trigger" aria-label={title}>
        {title}
      </Collapsible.Trigger>
      <Collapsible.Content>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
export function Hint({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="ui-tooltip" sideOffset={7}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export function Switch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <SwitchPrimitive.Root
      className={`toggle-switch${checked ? ' on' : ''}`}
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
    >
      <SwitchPrimitive.Thumb className="toggle-knob" />
    </SwitchPrimitive.Root>
  );
}
