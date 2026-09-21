import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface Props {
  count: number;
  /** The element that scrolls. The list may sit anywhere inside it, below a header say. */
  scroller: HTMLElement;
  rowHeight: number;
  getKey: (index: number) => string;
  renderRow: (index: number) => ReactNode;
  className?: string;
}

/**
 * Renders only the rows near the viewport, so a liked-songs list of thousands
 * costs what a screenful does. Rows are one fixed height, which is what lets
 * the list skip measuring them.
 */
export function VirtualList({ count, scroller, rowHeight, getKey, renderRow, className }: Props) {
  const list = useRef<HTMLUListElement>(null);
  // Where the list starts inside the scrolled content. It moves when anything
  // above it changes height, such as a description being expanded.
  const [offset, setOffset] = useState(0);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () =>
      setOffset(
        element.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller.firstElementChild ?? scroller);
    return () => observer.disconnect();
  }, [scroller]);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    overscan: 8,
    scrollMargin: offset,
    getItemKey: getKey,
  });

  return (
    <ul
      ref={list}
      className={className}
      style={{ position: "relative", height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <li
          key={item.key}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: item.size,
            transform: `translateY(${item.start - offset}px)`,
          }}
        >
          {renderRow(item.index)}
        </li>
      ))}
    </ul>
  );
}
