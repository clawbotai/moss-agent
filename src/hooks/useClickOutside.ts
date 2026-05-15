import { useEffect, type RefObject } from "react";

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  excludeRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    function handle(event: MouseEvent) {
      const target = event.target as Node;
      if (ref.current && !ref.current.contains(target)) {
        if (excludeRef?.current && excludeRef.current.contains(target)) return;
        onClose();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [ref, onClose, excludeRef]);
}
