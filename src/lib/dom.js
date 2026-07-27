const KEYBOARD_INTERACTIVE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='button']",
  "[role='combobox']",
  "[role='menuitem']",
  "[role='option']",
  "[role='slider']",
  "[role='switch']",
].join(",");

function isKeyboardInteractiveTarget(target) {
  return typeof target?.closest === "function" && Boolean(target.closest(KEYBOARD_INTERACTIVE_SELECTOR));
}

export function shouldIgnoreGlobalKeydown(event) {
  if (event.defaultPrevented || event.isComposing) return true;

  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  return path.some(isKeyboardInteractiveTarget);
}
