import {
  SeparationJob,
  SongAnalysisResult,
  StemActivityMap,
  StemSetInfo,
  UploadResponse,
} from '../types/audio';

/**
 * AudioWeave Studio Centralized API Service.
 * Single source of truth for all communication between React frontend and FastAPI backend.
 * Uses consistent API_BASE (/api) proxied by Vite in dev and served directly in prod.
 */
export const API_BASE = '/api';

/**
 * Fetch wrapper with configurable timeout using AbortController.
 * Ensures long-running requests or dead connections do not hang the UI.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return res;
  } catch (err: any) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      throw new Error(`Request to '${url}' timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

/**
 * Parses JSON error payload or returns status text.
 */
async function parseErrorResponse(res: Response, defaultMessage: string): Promise<string> {
  try {
    const errData = await res.json();
    return errData.detail || errData.message || `${defaultMessage} (HTTP ${res.status})`;
  } catch {
    return `${defaultMessage} (HTTP ${res.status}: ${res.statusText || 'Unknown'})`;
  }
}

/**
 * 1. Health Check
 * Verifies backend availability, target processing device (CPU/CUDA), and supported formats.
 */
export async function checkHealth(timeoutMs: number = 6000): Promise<{
  status: string;
  app: string;
  device: string;
  supported_formats: string[];
}> {
  const res = await fetchWithTimeout(`${API_BASE}/health`, {}, timeoutMs);
  if (!res.ok) {
    const errorText = await parseErrorResponse(res, 'Backend health check failed');
    throw new Error(errorText);
  }
  return await res.json();
}

/**
 * 2. Upload Audio File
 * Ingests a new WAV, MP3, or FLAC file, extracts real technical metadata,
 * generates a 1200-bucket waveform envelope, and stores the file in backend uploads.
 */
export async function uploadAudioFile(file: File, timeoutMs: number = 30000): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetchWithTimeout(
    `${API_BASE}/audio/upload`,
    {
      method: 'POST',
      body: formData,
    },
    timeoutMs
  );

  if (!res.ok) {
    const errorText = await parseErrorResponse(res, 'Audio file upload failed');
    throw new Error(errorText);
  }

  return await res.json();
}

/**
 * 3. Fetch Available Stem Sets
 * Retrieves all separated Demucs stem sets available in backend storage.
 */
export async function getAvailableStemSets(timeoutMs: number = 8000): Promise<StemSetInfo[]> {
  const res = await fetchWithTimeout(`${API_BASE}/audio/stems/available`, {}, timeoutMs);
  if (!res.ok) {
    const errorText = await parseErrorResponse(res, 'Failed to fetch available stems');
    throw new Error(errorText);
  }
  const data = await res.json();
  return data.stem_sets || [];
}

/**
 * 4. Fetch Audio Binary Stream
 * Downloads raw audio bytes (ArrayBuffer) for Web Audio API decoding.
 * Works for both original files (/api/audio/stream/...) and stems (/api/audio/stems/...).
 */
export async function fetchAudioBuffer(url: string, timeoutMs: number = 30000): Promise<ArrayBuffer> {
  const resolvedUrl = url.startsWith('/') ? url : `${API_BASE}/${url}`;
  const res = await fetchWithTimeout(resolvedUrl, {}, timeoutMs);
  if (!res.ok) {
    const errorText = await parseErrorResponse(res, `Failed to stream audio from ${url}`);
    throw new Error(errorText);
  }
  return await res.arrayBuffer();
}

/**
 * 5. Start AI Stem Separation Job
 * Initiates an asynchronous Demucs separation job.
 * Returns HTTP 202 with job_id or returns cached stems immediately.
 */
export async function startStemSeparation(
  storedFilename: string,
  timeoutMs: number = 15000
): Promise<SeparationJob> {
  const res = await fetchWithTimeout(
    `${API_BASE}/audio/separate/${encodeURIComponent(storedFilename)}`,
    { method: 'POST' },
    timeoutMs
  );

  if (!res.ok && res.status !== 202) {
    const errorText = await parseErrorResponse(res, 'Separation request rejected');
    throw new Error(errorText);
  }

  const data = await res.json();
  if (data.status === 'success' && data.stems) {
    // Cache hit returned immediately
    return {
      job_id: data.id || 'cached-job',
      stored_filename: storedFilename,
      status: 'completed',
      progress: 100,
      stage: 'Stems retrieved from storage cache',
      result: data,
    };
  }

  return data as SeparationJob;
}

/**
 * 6. Poll Separation Job
 * Polls status of active separation job until completion or error.
 * Emits real-time progress percentages and stage updates to caller.
 */
export async function pollSeparationJob(
  jobId: string,
  onProgress: (job: SeparationJob) => void,
  intervalMs: number = 1000,
  maxConsecutiveErrors: number = 10
): Promise<any> {
  let consecutiveErrors = 0;

  while (true) {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/audio/jobs/${encodeURIComponent(jobId)}`, {}, 6000);
      if (!res.ok) {
        const errorText = await parseErrorResponse(res, 'Job poll failed');
        throw new Error(errorText);
      }

      const job: SeparationJob = await res.json();
      consecutiveErrors = 0;
      onProgress(job);

      if (job.status === 'completed') {
        if (!job.result) {
          throw new Error('Separation job marked completed but returned empty stems payload.');
        }
        return job.result;
      }

      if (job.status === 'error') {
        throw new Error(job.error || job.stage || 'Demucs separation failed on backend.');
      }
    } catch (err: any) {
      consecutiveErrors++;
      console.warn(`Separation polling warning (${consecutiveErrors}/${maxConsecutiveErrors}):`, err.message);
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(`Separation failed: Lost communication with backend job (${err.message})`);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 7. Acoustic Song Analysis
 * Performs Librosa analysis (BPM, beats, silence regions, RMS dBFS, acoustic sections, stem activity).
 */
export async function analyzeAudioFile(
  storedFilename: string,
  force: boolean = false,
  timeoutMs: number = 25000
): Promise<SongAnalysisResult> {
  const url = `${API_BASE}/audio/analyze/${encodeURIComponent(storedFilename)}?force=${force}`;
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res.ok) {
    const errorText = await parseErrorResponse(res, 'Acoustic analysis failed');
    throw new Error(errorText);
  }
  return await res.json();
}

/**
 * 8. Stem Activity Map
 * Retrieves independent energy distribution and time-sliced activity buckets.
 */
export async function getStemActivity(
  storedFilename: string,
  timeoutMs: number = 15000
): Promise<StemActivityMap | { has_stems: false; message: string }> {
  const url = `${API_BASE}/audio/analyze/stem-activity/${encodeURIComponent(storedFilename)}`;
  const res = await fetchWithTimeout(url, {}, timeoutMs);
  if (!res.ok) {
    const errorText = await parseErrorResponse(res, 'Failed to retrieve stem activity');
    throw new Error(errorText);
  }
  return await res.json();
}

/**
 * 9. Convert WAV to MP3
 * Sends rendered 16/24-bit WAV Blob to backend FFmpeg libmp3lame for MP3 encoding.
 */
export async function convertWavToMp3(
  wavBlob: Blob,
  bitrate: '128k' | '192k' | '256k' | '320k' = '320k',
  timeoutMs: number = 60000
): Promise<Blob> {
  const formData = new FormData();
  formData.append('file', wavBlob, 'temp_render.wav');

  const res = await fetchWithTimeout(
    `${API_BASE}/audio/export/mp3?bitrate=${bitrate}`,
    {
      method: 'POST',
      body: formData,
    },
    timeoutMs
  );

  if (!res.ok) {
    const errorText = await parseErrorResponse(res, 'MP3 conversion failed on backend');
    throw new Error(errorText);
  }

  return await res.blob();
}

/**
 * 10. Fetch Backend Storage Library
 * Retrieves list of audio assets stored on the backend disk.
 */
export async function getBackendLibrary(timeoutMs: number = 8000): Promise<{
  assets: Array<{
    id: string;
    filename: string;
    stored_filename: string;
    stream_url: string;
    metadata: any;
  }>;
}> {
  const res = await fetchWithTimeout(`${API_BASE}/audio/library`, {}, timeoutMs);
  if (!res.ok) {
    const errorText = await parseErrorResponse(res, 'Failed to fetch backend library');
    throw new Error(errorText);
  }
  return await res.json();
}
