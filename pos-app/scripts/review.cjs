// Spawn local Expo CLI only; never EAS, never a production backend.
const { spawn } = require("node:child_process");
const path = require("node:path");
const target = process.argv[2];
if (!["web", "android"].includes(target)) throw Error("Use web or android");
const cli = path.join(
  path.dirname(require.resolve("expo/package.json")),
  "bin/cli",
);
const child = spawn(
  process.execPath,
  [
    cli,
    "start",
    target === "web" ? "--web" : "--localhost",
    "--port",
    "8083",
    "--go",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      POS_ENV: "development",
      POS_REVIEW: "1",
      EXPO_PUBLIC_POS_API_URL: "http://127.0.0.1:3000",
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code || 0;
});
child.on("error", () => {
  console.error("Local Expo CLI could not start");
  process.exitCode = 1;
});
