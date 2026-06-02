import React from "react";
import { X } from "lucide-react";

interface PackageInsightModalProps {
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ size?: number }>;
  onClose: () => void;
  children: React.ReactNode;
}

export const PackageInsightModal: React.FC<PackageInsightModalProps> = ({
  title, subtitle, Icon, onClose, children
}) => (
  <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-md z-[80] flex items-center justify-center p-8 animate-in fade-in duration-200">
    <div className="vo-surface w-full max-w-2xl max-h-[80vh] rounded-[2rem] border shadow-2xl overflow-hidden flex flex-col">
      <div className="vo-panel p-5 border-b flex items-center justify-between bg-blue-50/40 dark:bg-blue-900/10">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600 text-white rounded-2xl shadow-lg shadow-blue-600/30"><Icon size={18} /></div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest">{title}</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{subtitle}</p>
          </div>
        </div>
        <button onClick={onClose} className="vo-icon-button p-2 rounded-2xl">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {children}
      </div>
    </div>
  </div>
);
