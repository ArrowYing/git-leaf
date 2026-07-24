export function attachHorizontalPointerResize({
  resizer,
  classTarget,
  activeClass = "is-resizing",
  onResize,
} = {}) {
  if (!resizer?.addEventListener || typeof onResize !== "function") {
    return { destroy() {} };
  }

  const startResize = (event) => {
    event.preventDefault();
    classTarget?.classList?.add(activeClass);
    resizer.setPointerCapture?.(event.pointerId);
    onResize(event.clientX);

    const handlePointerMove = (moveEvent) => {
      onResize(moveEvent.clientX);
    };
    const finishResize = (endEvent) => {
      if (resizer.hasPointerCapture?.(endEvent.pointerId)) {
        resizer.releasePointerCapture?.(endEvent.pointerId);
      }
      classTarget?.classList?.remove(activeClass);
      resizer.removeEventListener("pointermove", handlePointerMove);
      resizer.removeEventListener("pointerup", finishResize);
      resizer.removeEventListener("pointercancel", finishResize);
    };

    resizer.addEventListener("pointermove", handlePointerMove);
    resizer.addEventListener("pointerup", finishResize);
    resizer.addEventListener("pointercancel", finishResize);
  };

  resizer.addEventListener("pointerdown", startResize);
  return {
    destroy() {
      resizer.removeEventListener("pointerdown", startResize);
    },
  };
}
