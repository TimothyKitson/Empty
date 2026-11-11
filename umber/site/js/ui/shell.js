export function mountShell(app, root) {
  const stage = document.createElement('div');
  stage.className = 'sh-stage';
  stage.style.cssText = 'position:fixed;inset:0';
  root.replaceChildren(stage);
  app.shell = {
    els: { menubar: null, optionsbar: null, toolbar: null, tabs: null, stage, statusbar: null, dock: null },
    setEmptyState() {},
    layout() {}
  };
}
