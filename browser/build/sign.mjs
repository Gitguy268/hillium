// electron-builder leaves the app unsigned (no Developer ID), and changing Info.plist breaks
// Electron's own ad-hoc signature, which Apple Silicon refuses to launch. Sign it ad hoc again.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("../dist/mac-arm64/Hillium.app", import.meta.url));
execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
console.log(`Signed ad hoc: ${app}`);
