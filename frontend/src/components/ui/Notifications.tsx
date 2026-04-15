import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
};

const COLORS = {
  success: 'border-green-700/50 bg-green-900/30 text-green-300',
  error: 'border-red-700/50 bg-red-900/30 text-red-300',
  info: 'border-blue-700/50 bg-blue-900/30 text-blue-300',
};

export default function Notifications() {
  const { notifications, removeNotification } = useStore();

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm w-full">
      <AnimatePresence>
        {notifications.map(n => {
          const Icon = ICONS[n.type];
          return (
            <motion.div
              key={n.id}
              initial={{ opacity: 0, x: 100, y: 0 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className={clsx('flex items-start gap-3 p-3 rounded-lg border shadow-xl', COLORS[n.type])}
            >
              <Icon size={16} className="flex-shrink-0 mt-0.5" />
              <span className="text-sm flex-1">{n.message}</span>
              <button onClick={() => removeNotification(n.id)} className="opacity-60 hover:opacity-100">
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
