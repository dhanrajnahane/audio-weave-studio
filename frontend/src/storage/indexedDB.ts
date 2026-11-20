import { AudioAsset } from '../types/audio';
import { ProjectState, ProjectSummary } from '../types/project';

const DB_NAME = 'AudioWeaveStudioDB';
const DB_VERSION = 2;

const STORE_ASSETS = 'audio_assets';
const STORE_BINARIES = 'audio_binaries';
const STORE_PROJECTS = 'projects';
const STORE_AUTOSAVE = 'autosave';

class IndexedDBManager {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_ASSETS)) {
          db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_BINARIES)) {
          db.createObjectStore(STORE_BINARIES);
        }
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_AUTOSAVE)) {
          db.createObjectStore(STORE_AUTOSAVE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  // -------------------------------------------------------------
  // Audio Assets & Raw Binaries Storage
  // -------------------------------------------------------------

  async saveAsset(asset: AudioAsset, rawBytes?: ArrayBuffer): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_ASSETS, STORE_BINARIES], 'readwrite');
      const assetStore = tx.objectStore(STORE_ASSETS);
      const binaryStore = tx.objectStore(STORE_BINARIES);

      const assetToSave = { ...asset };
      delete assetToSave.rawArrayBuffer;
      assetStore.put(assetToSave);

      if (rawBytes) {
        binaryStore.put(rawBytes, asset.id);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAllAssets(): Promise<AudioAsset[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const store = tx.objectStore(STORE_ASSETS);
      const request = store.getAll();

      request.onsuccess = () => {
        const assets: AudioAsset[] = request.result || [];
        assets.sort((a, b) => b.createdAt - a.createdAt);
        resolve(assets);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAsset(assetId: string): Promise<AudioAsset | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ASSETS, 'readonly');
      const store = tx.objectStore(STORE_ASSETS);
      const request = store.get(assetId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAssetBinary(assetId: string): Promise<ArrayBuffer | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BINARIES, 'readonly');
      const store = tx.objectStore(STORE_BINARIES);
      const request = store.get(assetId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async hasAssetBinary(assetId: string): Promise<boolean> {
    const binary = await this.getAssetBinary(assetId);
    return binary !== null && binary.byteLength > 0;
  }

  async saveAssetBinary(assetId: string, rawBytes: ArrayBuffer): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BINARIES, 'readwrite');
      const store = tx.objectStore(STORE_BINARIES);
      store.put(rawBytes, assetId);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteAsset(assetId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_ASSETS, STORE_BINARIES], 'readwrite');
      tx.objectStore(STORE_ASSETS).delete(assetId);
      tx.objectStore(STORE_BINARIES).delete(assetId);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // -------------------------------------------------------------
  // Versioned Project Management Storage
  // -------------------------------------------------------------

  async saveProject(project: ProjectState): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const toSave = {
        ...project,
        id: project.metadata.id,
      };
      store.put(toSave);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getProject(projectId: string): Promise<ProjectState | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const request = store.get(projectId);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllProjects(): Promise<ProjectSummary[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const request = store.getAll();

      request.onsuccess = () => {
        const rawList: ProjectState[] = request.result || [];
        const summaries: ProjectSummary[] = rawList.map((p) => ({
          id: p.metadata.id,
          name: p.metadata.name,
          schemaVersion: p.metadata.schemaVersion,
          updatedAt: p.metadata.updatedAt,
          createdAt: p.metadata.createdAt,
          clipCount: p.clips.length,
          trackCount: p.tracks.length,
          duration: p.metadata.duration,
        }));
        summaries.sort((a, b) => b.updatedAt - a.updatedAt);
        resolve(summaries);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteProject(projectId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      store.delete(projectId);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // -------------------------------------------------------------
  // Auto-Save & Crash Recovery
  // -------------------------------------------------------------

  async saveAutoSave(project: ProjectState): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUTOSAVE, 'readwrite');
      const store = tx.objectStore(STORE_AUTOSAVE);
      store.put({
        id: 'current_autosave',
        project,
        savedAt: Date.now(),
      });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAutoSave(): Promise<{ project: ProjectState; savedAt: number } | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUTOSAVE, 'readonly');
      const store = tx.objectStore(STORE_AUTOSAVE);
      const request = store.get('current_autosave');

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async clearAutoSave(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_AUTOSAVE, 'readwrite');
      const store = tx.objectStore(STORE_AUTOSAVE);
      store.delete('current_autosave');

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [STORE_ASSETS, STORE_BINARIES, STORE_PROJECTS, STORE_AUTOSAVE],
        'readwrite'
      );
      tx.objectStore(STORE_ASSETS).clear();
      tx.objectStore(STORE_BINARIES).clear();
      tx.objectStore(STORE_PROJECTS).clear();
      tx.objectStore(STORE_AUTOSAVE).clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const assetStorage = new IndexedDBManager();
