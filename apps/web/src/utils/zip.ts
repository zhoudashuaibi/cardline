import { strToU8, zipSync } from 'fflate';

/** 一个待打包的文件 */
export interface ZipEntry {
  /** 压缩包内的文件名，含扩展名 */
  name: string;
  /** 文本内容，按 UTF-8 编码写入 */
  content: string;
}

/**
 * 把若干文本文件打成一个 zip。
 *
 * 用途：CPA 交付没有「合并成一份」的形态 —— 下游要的是一个个独立的 Codex auth
 * 文件，所以多张卡密改为打包 zip（每张卡一个 `.cpa.json`）。
 *
 * 单张卡密的文件名由服务端给出（`<卡密>.cpa.json`），正常情况下不会重名；
 * 万一同名，这里补 `-2` / `-3` 后缀，避免后写入的把先写入的覆盖掉。
 */
export function buildZipBlob(entries: ZipEntry[]): Blob {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();

  entries.forEach((entry, index) => {
    const fallback = `card-${index + 1}.json`;
    const base = entry.name?.trim() || fallback;
    let name = base;
    let suffix = 2;
    while (used.has(name)) {
      const dot = base.lastIndexOf('.');
      name = dot > 0 ? `${base.slice(0, dot)}-${suffix}${base.slice(dot)}` : `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(name);
    files[name] = strToU8(entry.content);
  });

  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}
