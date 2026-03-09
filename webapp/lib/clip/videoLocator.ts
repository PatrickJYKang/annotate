export interface SidecarVideoLocator {
  videoRef?: string;
  videoPath?: string;
}

export function toAbsoluteVideoPath(videoPath?: string): string | undefined {
  if (!videoPath) return undefined;
  const isAbsolute = videoPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(videoPath);
  return isAbsolute ? videoPath : undefined;
}

export function getSidecarVideoLocator(
  videoRef?: string | null,
  videoPath?: string,
): SidecarVideoLocator {
  const locator: SidecarVideoLocator = {};
  if (videoRef) locator.videoRef = videoRef;

  const absolutePath = toAbsoluteVideoPath(videoPath);
  if (absolutePath) locator.videoPath = absolutePath;

  return locator;
}

export function hasSidecarVideoSource(locator: SidecarVideoLocator): boolean {
  return !!locator.videoRef || !!locator.videoPath;
}

export function isTrackableAnnotationType(type?: string | null): boolean {
  return type === 'box' || type === 'circle' || type === 'highlight';
}

export function canShowTrackButton(args: {
  sidecarConnected: boolean;
  capabilities: string[];
  locator: SidecarVideoLocator;
  selectedType?: string | null;
}): boolean {
  const { sidecarConnected, capabilities, locator, selectedType } = args;
  return (
    sidecarConnected &&
    capabilities.includes('tracking') &&
    hasSidecarVideoSource(locator) &&
    isTrackableAnnotationType(selectedType)
  );
}
