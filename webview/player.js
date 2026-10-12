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

  // Record a test: the story restarts, and the commands typed until Stop
  // are added to the project's source as a "Test ... with" sentence.
  const record = document.createElement("button");
  record.type = "button";
  let recording = false;
  const showRecording = (on, count) => {
    recording = on;
    record.textContent = on ? `Stop (${count})` : "Record";
    record.title = on
      ? "Stop recording and save the commands as a test"
      : "Restart the story and record the commands you type as a test";
    record.classList.toggle("ie-recording", on);
  };
  showRecording(false, 0);
  record.addEventListener("click", () =>
    vscode.postMessage({ type: "record", on: !recording }),
  );
  toolbar.appendChild(record);
  document.body.appendChild(toolbar);

  // Each turn, from Parchment's transcript recorder (see the page's options).
  window.__informTurn = (turn) =>
    vscode.postMessage({
      type: "turn",
      input: String((turn && turn.input) || ""),
      output: String((turn && turn.output) || ""),
    });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message && message.type === "recording") {
      showRecording(!!message.on, message.count || 0);
    } else if (message && message.type === "focus") {
      const input = document.querySelector("#windowport input");
      if (input) {
        input.focus();
      }
    }
  });

  vscode.postMessage({ type: "ready" });
})();
