// Copy text to the clipboard, including where the async Clipboard API is missing. Browsers only
// expose navigator.clipboard on secure origins (https, localhost), so a server reached over plain
// http (e.g. a LAN IP) needs the old hidden-textarea + execCommand("copy") route.

export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Denied (permissions, document not focused): the legacy route may still work.
    }
  }
  return legacyCopy(text);
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  // Keep it out of sight and out of the layout, without display:none (which can't be selected).
  // 16px: iOS zooms the page in when it focuses a smaller input.
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;font-size:16px;opacity:0;pointer-events:none";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.({ preventScroll: true });
  return ok;
}
