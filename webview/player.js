/*
  Inform Ecosystem player: glue between the VS Code webview and Parchment.
  Parchment itself is configured by the window.parchment_options object the
  extension writes into the page; this script only adds the toolbar and
  relays messages.
*/
(function () {
  const vscode = acquireVsCodeApi();

  const toolbar = document.createElement("div");
  toolbar.id = "ie-player-toolbar";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.title = "Restart the story from the compiled file";
  reload.textContent = "Restart";
  reload.addEventListener("click", () => vscode.postMessage({ type: "reload" }));
  toolbar.appendChild(reload);
  document.body.appendChild(toolbar);

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "focus") {
      const input = document.querySelector("#windowport input");
      if (input) {
        input.focus();
      }
    }
  });
})();
