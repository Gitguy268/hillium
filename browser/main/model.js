// MiniCPM-V 4.7 1B for the assistant: the Q4_K_M language model and its image projector,
// from openbmb's GGUF repo at a pinned revision. Each file arrives in 64 MiB ranges, every
// range checked against minicpm-v.json's SHA-256 before it is kept, so a stopped download
// resumes and a tampered range never lands. Downloads go through the default session, so
// Tor and proxy mode cover them.
//
// The int4 checkpoint (openbmb/MiniCPM-V-4.7-1B-int4) is bitsandbytes NF4, which needs CUDA;
// this is the same model in llama.cpp's format, which runs on any Mac.
import { app, session } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, linkSync, mkdirSync, statSync, writeFileSync, openSync, writeSync, closeSync, renameSync, unlinkSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const MANIFEST = JSON.parse(readFileSync(new URL("./minicpm-v.json", import.meta.url), "utf8"));
export const MODEL_NAME = "MiniCPM-V 4.7 1B";
export const FILES = Object.keys(MANIFEST.files); // language model first, then the projector
export const TOTAL_BYTES = FILES.reduce((n, f) => n + MANIFEST.files[f].totalSize, 0);

// Copies already on this Mac (other projects' downloads). Hard-linked when the hash matches.
// HILLIUM_NO_LOCAL_MODEL=1 skips them, so tests can exercise the download.
const LOCAL_COPIES = process.env.HILLIUM_NO_LOCAL_MODEL ? [] : [join(homedir(), "minimind-mermaid", "gguf")];

export const modelDir = () => join(app.getPath("userData"), "models", `minicpm-v-${MANIFEST.revision.slice(0, 8)}`);
const fileUrl = (name) => `https://huggingface.co/${MANIFEST.repo}/resolve/${MANIFEST.revision}/${name}`;
const verifiedMark = (path) => `${path}.verified`;

export function isModelReady() {
  return FILES.every((f) => existsSync(verifiedMark(join(modelDir(), f))));
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function tryLocalCopy(name, target) {
  const { totalSize, sha256 } = MANIFEST.files[name];
  for (const dir of LOCAL_COPIES) {
    const source = join(dir, name);
    try {
      if (statSync(source).size !== totalSize) continue;
      if ((await sha256File(source)) !== sha256) continue;
      if (existsSync(target)) unlinkSync(target);
      linkSync(source, target); // same disk: no second copy
      return true;
    } catch {
      // Not there, or another volume: download instead.
    }
  }
  return false;
}

// Appends each verified 64 MiB range to <file>.part; the part file's length says where to resume.
async function download(name, target, report, signal) {
  const { chunks } = MANIFEST.files[name];
  const part = `${target}.part`;
  let done = existsSync(part) ? statSync(part).size : 0;
  let start = 0;
  let index = 0;
  // Resume only on a range boundary; anything past it is dropped and fetched again.
  while (index < chunks.length && start + chunks[index].size <= done) start += chunks[index++].size;
  const fd = openSync(part, existsSync(part) ? "r+" : "w");
  try {
    for (; index < chunks.length; index++) {
      signal?.throwIfAborted();
      const { size, sha256 } = chunks[index];
      const res = await session.defaultSession.fetch(fileUrl(name), {
        headers: { Range: `bytes=${start}-${start + size - 1}` },
        signal,
      });
      if (res.status !== 206 && res.status !== 200) throw new Error(`Hugging Face answered HTTP ${res.status}`);
      const pieces = [];
      let got = 0;
      for await (const piece of res.body) {
        pieces.push(piece);
        got += piece.byteLength;
        report(start + got);
      }
      const bytes = Buffer.concat(pieces);
      if (bytes.length !== size) throw new Error(`Part ${index + 1} of ${name} came back as ${bytes.length} bytes, expected ${size}`);
      if (createHash("sha256").update(bytes).digest("hex") !== sha256) {
        throw new Error(`Part ${index + 1} of ${name} failed its integrity check`);
      }
      writeSync(fd, bytes, 0, bytes.length, start);
      start += size;
    }
  } finally {
    closeSync(fd);
  }
  renameSync(part, target);
}

// Makes both files present and verified. onProgress({ loaded, total, phase }).
export async function ensureModel(onProgress = () => {}, signal) {
  mkdirSync(modelDir(), { recursive: true });
  let before = 0;
  for (const name of FILES) {
    const target = join(modelDir(), name);
    const size = MANIFEST.files[name].totalSize;
    if (!existsSync(verifiedMark(target))) {
      onProgress({ loaded: before, total: TOTAL_BYTES, phase: "checking" });
      if (!(await tryLocalCopy(name, target))) {
        await download(name, target, (n) => onProgress({ loaded: before + n, total: TOTAL_BYTES, phase: "downloading" }), signal);
      }
      writeFileSync(verifiedMark(target), MANIFEST.files[name].sha256);
    }
    before += size;
    onProgress({ loaded: before, total: TOTAL_BYTES, phase: "ready" });
  }
}
