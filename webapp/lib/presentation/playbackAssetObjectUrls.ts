import type { ResolvedPlaybackAsset } from './derivedMediaTypes';
import { getBlobUrlId, recordMediaTrace } from './mediaTrace';

function isUrlLikePath(path: string | null | undefined): boolean {
  return typeof path === 'string' && /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(path);
}

export function buildPlaybackAssetLeaseKey(asset: ResolvedPlaybackAsset | null): string | null {
  if (!asset) {
    return null;
  }
  return [
    asset.assetId,
    asset.filePath ?? '',
    asset.objectUrl ?? '',
  ].join('|');
}

export function detachVideoElementIfUsingUrl(
  element: Pick<HTMLVideoElement, 'currentSrc' | 'getAttribute' | 'pause' | 'removeAttribute' | 'load'> | null,
  url: string | null,
): boolean {
  if (!element || !url) {
    return false;
  }
  if (element.currentSrc !== url && element.getAttribute('src') !== url) {
    return false;
  }
  try {
    element.pause();
  } catch {}
  try {
    element.removeAttribute('src');
    element.load();
  } catch {}
  return true;
}

export interface PlaybackAssetObjectUrlRegistry {
  acquireLease: (asset: ResolvedPlaybackAsset) => () => void;
  ensureObjectUrl: (asset: ResolvedPlaybackAsset) => Promise<string | null>;
  invalidateObjectUrl: (asset: ResolvedPlaybackAsset, expectedUrl?: string | null) => boolean;
  dispose: () => void;
}

type PlaybackAssetObjectUrlRegistryEntry = {
  filePath: string | null;
  objectUrl: string | null;
  ownsObjectUrl: boolean;
  retiredOwnedObjectUrls: string[];
  leaseCount: number;
  loadPromise: Promise<string | null> | null;
  pendingRevoke: boolean;
};

function revokeOwnedObjectUrl(url: string) {
  try {
    URL.revokeObjectURL(url);
  } catch {}
}

function revokeObjectUrl(entry: PlaybackAssetObjectUrlRegistryEntry) {
  if (!entry.objectUrl) return;
  if (entry.ownsObjectUrl) {
    revokeOwnedObjectUrl(entry.objectUrl);
  }
  entry.objectUrl = null;
  entry.ownsObjectUrl = false;
}

function revokeRetiredOwnedObjectUrls(entry: PlaybackAssetObjectUrlRegistryEntry) {
  if (entry.retiredOwnedObjectUrls.length === 0) {
    return;
  }
  entry.retiredOwnedObjectUrls.forEach((url) => {
    revokeOwnedObjectUrl(url);
  });
  entry.retiredOwnedObjectUrls = [];
}

function updateEntrySource(
  entry: PlaybackAssetObjectUrlRegistryEntry,
  nextFilePath: string | null,
  nextObjectUrl: string | null,
  asset: ResolvedPlaybackAsset,
  registryGeneration: number,
) {
  const currentDirectObjectUrl = entry.ownsObjectUrl ? null : entry.objectUrl;
  if (entry.filePath === nextFilePath && currentDirectObjectUrl === nextObjectUrl) {
    return;
  }
  recordMediaTrace('asset_source_changed', {
    assetId: asset.assetId,
    assetClass: asset.assetClass,
    generationKey: asset.generationKey ?? null,
    oldFilePath: entry.filePath,
    newFilePath: nextFilePath,
    oldBlobUrlId: getBlobUrlId(entry.objectUrl),
    newDirectBlobUrlId: getBlobUrlId(nextObjectUrl),
    leaseCount: entry.leaseCount,
    registryGeneration,
  }, 'warn');
  if (entry.objectUrl) {
    if (entry.ownsObjectUrl) {
      if (entry.leaseCount === 0) {
        recordMediaTrace('blob_revoked', {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          generationKey: asset.generationKey ?? null,
          filePath: entry.filePath,
          blobUrl: entry.objectUrl,
          reason: 'source_changed',
          leaseCount: entry.leaseCount,
          pendingRevoke: entry.pendingRevoke,
          registryGeneration,
        }, 'warn');
        revokeOwnedObjectUrl(entry.objectUrl);
      } else {
        recordMediaTrace('blob_retired', {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          generationKey: asset.generationKey ?? null,
          filePath: entry.filePath,
          blobUrl: entry.objectUrl,
          reason: 'retired_after_source_change',
          leaseCount: entry.leaseCount,
          registryGeneration,
        }, 'warn');
        entry.retiredOwnedObjectUrls = [...entry.retiredOwnedObjectUrls, entry.objectUrl];
      }
    }
    entry.objectUrl = null;
    entry.ownsObjectUrl = false;
  }
  entry.filePath = nextFilePath;
  if (nextObjectUrl) {
    entry.objectUrl = nextObjectUrl;
    entry.ownsObjectUrl = false;
  }
  if (entry.leaseCount === 0) {
    revokeRetiredOwnedObjectUrls(entry);
    entry.pendingRevoke = false;
  }
}

export function createPlaybackAssetObjectUrlRegistry({
  projectDir,
  getFileForPath,
}: {
  projectDir: FileSystemDirectoryHandle;
  getFileForPath: (projectDir: FileSystemDirectoryHandle, path: string) => Promise<File>;
}): PlaybackAssetObjectUrlRegistry {
  const entries = new Map<string, PlaybackAssetObjectUrlRegistryEntry>();
  let registryGeneration = 0;

  const getOrCreateEntry = (asset: ResolvedPlaybackAsset): PlaybackAssetObjectUrlRegistryEntry => {
    const nextFilePath = asset.filePath && !isUrlLikePath(asset.filePath) ? asset.filePath : null;
    const nextObjectUrl = asset.objectUrl ?? (asset.filePath && isUrlLikePath(asset.filePath) ? asset.filePath : null);
    const existing = entries.get(asset.assetId);
    if (existing) {
      updateEntrySource(existing, nextFilePath, nextObjectUrl, asset, registryGeneration);
      return existing;
    }
    const created: PlaybackAssetObjectUrlRegistryEntry = {
      filePath: nextFilePath,
      objectUrl: nextObjectUrl,
      ownsObjectUrl: false,
      retiredOwnedObjectUrls: [],
      leaseCount: 0,
      loadPromise: null,
      pendingRevoke: false,
    };
    entries.set(asset.assetId, created);
    return created;
  };

  const maybeRevokeEntry = (assetId: string, entry: PlaybackAssetObjectUrlRegistryEntry) => {
    if (entry.leaseCount > 0) {
      return;
    }
    revokeRetiredOwnedObjectUrls(entry);
    if (!entry.pendingRevoke) {
      return;
    }
    revokeObjectUrl(entry);
    entry.pendingRevoke = false;
  };

  return {
    acquireLease(asset) {
      const entry = getOrCreateEntry(asset);
      const previousLeaseCount = entry.leaseCount;
      entry.leaseCount += 1;
      recordMediaTrace('lease_acquired', {
        assetId: asset.assetId,
        assetClass: asset.assetClass,
        generationKey: asset.generationKey ?? null,
        filePath: entry.filePath,
        blobUrl: entry.objectUrl,
        leaseCountBefore: previousLeaseCount,
        leaseCountAfter: entry.leaseCount,
        registryGeneration,
      });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const leaseCountBefore = entry.leaseCount;
        entry.leaseCount = Math.max(0, entry.leaseCount - 1);
        recordMediaTrace('lease_released', {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          generationKey: asset.generationKey ?? null,
          filePath: entry.filePath,
          blobUrl: entry.objectUrl,
          leaseCountBefore,
          leaseCountAfter: entry.leaseCount,
          registryGeneration,
        });
        maybeRevokeEntry(asset.assetId, entry);
      };
    },
    async ensureObjectUrl(asset) {
      const generationAtStart = registryGeneration;
      const entry = getOrCreateEntry(asset);
      if (entry.objectUrl) {
        recordMediaTrace('blob_reused', {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          generationKey: asset.generationKey ?? null,
          filePath: entry.filePath,
          blobUrl: entry.objectUrl,
          leaseCount: entry.leaseCount,
          registryGeneration,
        });
        return entry.objectUrl;
      }
      if (!entry.filePath) {
        recordMediaTrace('blob_missing_file_source', {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          generationKey: asset.generationKey ?? null,
          filePath: asset.filePath ?? null,
          objectUrl: asset.objectUrl ?? null,
          registryGeneration,
        }, 'warn');
        console.warn('[PlaybackAssetObjectUrls] Asset has no file-backed source to resolve', {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          filePath: asset.filePath ?? null,
          objectUrl: asset.objectUrl ?? null,
        });
        return null;
      }
      if (!entry.loadPromise) {
        entry.loadPromise = (async () => {
          const expectedFilePath = entry.filePath;
          try {
            const file = await getFileForPath(projectDir, expectedFilePath as string);
            const objectUrl = URL.createObjectURL(file);
            if (
              generationAtStart !== registryGeneration
              || entries.get(asset.assetId) !== entry
              || entry.filePath !== expectedFilePath
            ) {
              recordMediaTrace('blob_discarded_stale_load_result', {
                assetId: asset.assetId,
                assetClass: asset.assetClass,
                generationKey: asset.generationKey ?? null,
                filePath: expectedFilePath,
                blobUrl: objectUrl,
                generationAtStart,
                registryGeneration,
                entryStillCurrent: entries.get(asset.assetId) === entry,
                filePathStillCurrent: entry.filePath === expectedFilePath,
              }, 'warn');
              try {
                URL.revokeObjectURL(objectUrl);
              } catch {}
              console.warn('[PlaybackAssetObjectUrls] Discarding stale playback URL result', {
                assetId: asset.assetId,
                assetClass: asset.assetClass,
                filePath: expectedFilePath,
                generationAtStart,
                registryGeneration,
                entryStillCurrent: entries.get(asset.assetId) === entry,
                filePathStillCurrent: entry.filePath === expectedFilePath,
              });
              return null;
            }
            entry.objectUrl = objectUrl;
            entry.ownsObjectUrl = true;
            recordMediaTrace('blob_created', {
              assetId: asset.assetId,
              assetClass: asset.assetClass,
              generationKey: asset.generationKey ?? null,
              filePath: expectedFilePath,
              blobUrl: objectUrl,
              fileSize: file.size,
              leaseCount: entry.leaseCount,
              registryGeneration,
            });
            return objectUrl;
          } catch (error) {
            recordMediaTrace('blob_create_failed', {
              assetId: asset.assetId,
              assetClass: asset.assetClass,
              generationKey: asset.generationKey ?? null,
              filePath: entry.filePath,
              registryGeneration,
              error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
            }, 'error');
            console.error('[PlaybackAssetObjectUrls] Failed resolving playback asset URL', {
              assetId: asset.assetId,
              assetClass: asset.assetClass,
              filePath: entry.filePath,
              error,
            });
            throw error;
          }
        })().finally(() => {
          if (entries.get(asset.assetId) === entry) {
            entry.loadPromise = null;
          }
          maybeRevokeEntry(asset.assetId, entry);
        });
      }
      return await entry.loadPromise;
    },
    invalidateObjectUrl(asset, expectedUrl = null) {
      const entry = getOrCreateEntry(asset);
      if (!entry.objectUrl || !entry.ownsObjectUrl) {
        recordMediaTrace('blob_invalidate_skipped', {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          generationKey: asset.generationKey ?? null,
          expectedBlobUrlId: getBlobUrlId(expectedUrl),
          currentBlobUrlId: getBlobUrlId(entry.objectUrl),
          ownsObjectUrl: entry.ownsObjectUrl,
          registryGeneration,
        }, 'warn');
        return false;
      }
      if (expectedUrl && entry.objectUrl !== expectedUrl) {
        recordMediaTrace('blob_invalidate_mismatch', {
          assetId: asset.assetId,
          assetClass: asset.assetClass,
          generationKey: asset.generationKey ?? null,
          expectedBlobUrlId: getBlobUrlId(expectedUrl),
          currentBlobUrlId: getBlobUrlId(entry.objectUrl),
          registryGeneration,
        }, 'warn');
        return false;
      }
      recordMediaTrace('blob_revoked', {
        assetId: asset.assetId,
        assetClass: asset.assetClass,
        generationKey: asset.generationKey ?? null,
        filePath: entry.filePath,
        blobUrl: entry.objectUrl,
        reason: 'invalidate_after_media_error',
        leaseCount: entry.leaseCount,
        pendingRevoke: entry.pendingRevoke,
        registryGeneration,
      }, 'warn');
      revokeOwnedObjectUrl(entry.objectUrl);
      entry.objectUrl = null;
      entry.ownsObjectUrl = false;
      return true;
    },
    dispose() {
      recordMediaTrace('registry_disposed', {
        entryCount: entries.size,
        registryGeneration,
      }, 'warn');
      registryGeneration += 1;
      entries.forEach((entry, assetId) => {
        if (entry.objectUrl && entry.ownsObjectUrl) {
          recordMediaTrace('blob_revoked', {
            assetId,
            blobUrl: entry.objectUrl,
            reason: 'dispose',
            leaseCount: entry.leaseCount,
            pendingRevoke: entry.pendingRevoke,
            registryGeneration,
          }, 'warn');
        }
        revokeRetiredOwnedObjectUrls(entry);
        if (entry.leaseCount > 0) {
          entry.pendingRevoke = true;
        } else {
          revokeObjectUrl(entry);
          entry.pendingRevoke = false;
        }
      });
      entries.clear();
    },
  };
}
