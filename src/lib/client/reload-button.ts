export function installReloadButtons(
  root: Document = document,
  reload: () => void = () => window.location.reload(),
): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-reload-page]")) return;
    event.preventDefault();
    reload();
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
