import { useRef, type ReactNode } from 'react';
import { Dialog } from '@animate-ui/react/primitives/radix-ui/dialog';
import { X } from 'lucide-react';

export function SettingsDialog({
  title,
  onClose,
  children,
  size = 'default',
  returnFocusTarget,
}: {
  size?: 'default' | 'compact';
  returnFocusTarget?: HTMLElement | null;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const returnFocus = useRef(returnFocusTarget ?? (document.activeElement as HTMLElement | null));
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="settings-overlay" />
        <Dialog.Content
          className={`settings-dialog${size === 'compact' ? ' compact' : ''}`}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (returnFocus.current?.isConnected) {
              event.preventDefault();
              returnFocus.current.focus();
            }
          }}
        >
          <div className="settings-header">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="关闭设置">
              <X size={18} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
