import { useState, useRef, useEffect, useCallback } from "react";
import { ToastMessage } from "../types";

export function useToastMessages() {
  const [statusText, setStatusText] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const pushMessage = useCallback((text: string) => {
    const tone: ToastMessage["tone"] = text.toLowerCase().includes("error") ? "error" : "success";
    const toast = { id: Date.now() + Math.floor(Math.random() * 1000), text, tone };
    setStatusText(text);
    setToasts(prev => [...prev.slice(-3), toast]);
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      setToasts(prev => prev.filter(t => t.id !== toast.id));
    }, 3500);
  }, []);

  return { statusText, toasts, pushMessage, mountedRef };
}
