import { WaveformData } from '../types/audio';

export class WaveformExtractor {
  /**
   * Generates real waveform peak data from decoded Web Audio API AudioBuffer.
   * Computes min and max amplitude values per time bucket.
   */
  static extractPeaksFromBuffer(audioBuffer: AudioBuffer, numBins: number = 1200): WaveformData {
    const numChannels = audioBuffer.numberOfChannels;
    const totalSamples = audioBuffer.length;

    if (totalSamples === 0) {
      return { peaks: [], rms: [], num_bins: 0, max_peak: 0 };
    }

    // Downmix channels to mono for display envelope
    const channelData: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      channelData.push(audioBuffer.getChannelData(c));
    }

    const binSize = Math.max(1, Math.floor(totalSamples / numBins));
    const actualBins = Math.min(numBins, Math.ceil(totalSamples / binSize));
    const peaks: [number, number][] = [];
    const rmsList: number[] = [];
    let overallMax = 0;

    for (let i = 0; i < actualBins; i++) {
      const start = i * binSize;
      const end = Math.min(totalSamples, start + binSize);
      if (start >= totalSamples) break;

      let min = 0;
      let max = 0;
      let sumSquares = 0;
      const count = end - start;

      for (let s = start; s < end; s++) {
        // Average across channels
        let sample = 0;
        for (let c = 0; c < numChannels; c++) {
          sample += channelData[c][s];
        }
        sample /= numChannels;

        if (sample < min) min = sample;
        if (sample > max) max = sample;
        sumSquares += sample * sample;
      }

      peaks.push([Number(min.toFixed(4)), Number(max.toFixed(4))]);
      const rms = Math.sqrt(sumSquares / count);
      rmsList.push(Number(rms.toFixed(4)));

      if (Math.abs(min) > overallMax) overallMax = Math.abs(min);
      if (Math.abs(max) > overallMax) overallMax = Math.abs(max);
    }

    return {
      peaks,
      rms: rmsList,
      num_bins: peaks.length,
      max_peak: Number(overallMax.toFixed(4))
    };
  }
}
