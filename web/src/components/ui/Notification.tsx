import { Toast } from 'radix-ui';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CircleAlert, X } from 'lucide-react';

export function Notification({ message, onClose }: { message: string; onClose: () => void }) {
  const reduced = useReducedMotion();
  return (
    <Toast.Provider duration={4000} swipeDirection="right">
      <AnimatePresence>
        {message && (
          <Toast.Root
            key={message}
            asChild
            forceMount
            open
            onOpenChange={(open) => {
              if (!open) onClose();
            }}
          >
            <motion.li
              className="toast"
              initial={{ opacity: 0, y: reduced ? 0 : -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduced ? 0 : -4 }}
              transition={{ duration: reduced ? 0 : 0.14 }}
            >
              <CircleAlert size={16} aria-hidden="true" />
              <Toast.Title>{message}</Toast.Title>
              <Toast.Close className="icon-button" aria-label="关闭提示">
                <X size={15} />
              </Toast.Close>
            </motion.li>
          </Toast.Root>
        )}
      </AnimatePresence>
      <Toast.Viewport className="toast-viewport" />
    </Toast.Provider>
  );
}
