interface NativeFileInfo { id: string; url: string; register(): Promise<{ videoRef: string; filename: string; sizeBytes: number }> }
const nativeFiles = new WeakMap<File, NativeFileInfo>();
export function bindNativeFile(file: File, info: NativeFileInfo): void { nativeFiles.set(file, info); }
export function nativeFileInfo(file: File): NativeFileInfo | undefined { return nativeFiles.get(file); }
export function createMediaUrl(file: File): string { return nativeFiles.get(file)?.url ?? URL.createObjectURL(file); }
export function releaseMediaUrl(url: string): void { if (url.startsWith('blob:')) URL.revokeObjectURL(url); }
