import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";

interface VirtualWindowOptions {
  total: number;
  rowHeight: number;
  overscan?: number;
  fallbackHeight?: number;
}

export const useVirtualWindow = ({
  total,
  rowHeight,
  overscan = 6,
  fallbackHeight = 640
}: VirtualWindowOptions) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(fallbackHeight);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateHeight = () => {
      setHeight(node.clientHeight || fallbackHeight);
    };
    updateHeight();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallbackHeight]);

  const window = useMemo(() => {
    const visibleCount = Math.ceil(height / rowHeight);
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(total, start + visibleCount + overscan * 2);
    return {
      start,
      end,
      topPadding: start * rowHeight,
      bottomPadding: Math.max(0, (total - end) * rowHeight),
      renderedCount: Math.max(0, end - start)
    };
  }, [height, overscan, rowHeight, scrollTop, total]);

  return {
    containerRef,
    onScroll: (event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop),
    ...window
  };
};
