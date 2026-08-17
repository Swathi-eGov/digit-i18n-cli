import readline from "readline";

// A real, blocking terminal confirmation — deliberately simple (yes/no via
// readline), used only by `apply` immediately before the one action in this
// entire tool that writes to the backend. Note: this requires an
// interactive stdin. If it's ever invoked somewhere without one (a
// non-interactive script, some IDE/GUI git integrations), this will hang
// or behave unpredictably — which is exactly why `apply` is a deliberately
// separate, manually-invoked command, never something a git hook triggers
// automatically.
export function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${question} (yes/no): `, (answer) => {
      rl.close();
      resolve(["y", "yes"].includes(answer.trim().toLowerCase()));
    });
  });
}
