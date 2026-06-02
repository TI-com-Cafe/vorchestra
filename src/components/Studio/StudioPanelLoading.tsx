import React from "react";
import { Loader2 } from "lucide-react";

export const StudioPanelLoading: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
    <Loader2 size={28} className="animate-spin text-blue-600" />
    <p className="text-[10px] font-black uppercase tracking-widest">{label}</p>
  </div>
);
