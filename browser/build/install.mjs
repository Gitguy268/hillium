// Copies the built Hillium.app into /Applications (replacing an older copy) and registers it
// with Launch Services, so it shows up under System Settings › Default web browser.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const built = fileURLToPath(new URL("../dist/mac-arm64/Hillium.app", import.meta.url));
const target = "/Applications/Hillium.app";
if (!existsSync(built)) throw new Error("Build it first: npm run dist");
rmSync(target, { recursive: true, force: true });
execFileSync("ditto", [built, target], { stdio: "inherit" });
execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", target], { stdio: "inherit" });
console.log(`Installed ${target}`);
