
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBuffer } from 'music-metadata';
import yaml from 'js-yaml';

const MUSIC_DATA_PATH = path.resolve('src/data/music.json');
const CONFIG_PATH = path.resolve('ryuchan.config.yaml');

// Helper to format duration in MM:SS
function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

async function fetchMetingApi() {
  console.log('🎵 Fetching playlist from Meting API...');
  let playlistId = '8900628861';
  let server = 'netease';
  let br = '320';
  let trans = true;

  try {
      const configStr = await fs.readFile(CONFIG_PATH, 'utf-8');
      const config = yaml.load(configStr);
      if (config?.site?.meting) {
          playlistId = config.site.meting.id || playlistId;
          server = config.site.meting.server || server;
          br = config.site.meting.br || br;
          trans = config.site.meting.trans !== false;
      }
  } catch (e) {
      console.log('Could not load meting config from yaml, using defaults');
  }

  const apiUrl = `https://163.hyc.moe?server=${server}&type=playlist&id=${playlistId}`;
  try {
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`Meting API failed: ${res.statusText}`);
      const data = await res.json();
      
      return data.map(item => {
          let songUrl = item.url?.replace(/http:\/\//g, 'https://');
          let lrcUrl = item.lrc?.replace(/http:\/\//g, 'https://');

          if (br && songUrl) {
              songUrl += `&br=${br}`;
          }
          if (trans && lrcUrl) {
              lrcUrl += `&trans=true`;
          }

          return {
              title: item.name,
              artist: item.artist || item.artist_name || 'Unknown',
              cover: item.pic?.replace(/http:\/\//g, 'https://'),
              url: songUrl,
              lrc: lrcUrl,
              duration: ""
          };
      });
  } catch(e) {
      console.error('Failed to fetch Meting API', e);
      return null;
  }
}

async function fetchMusicDuration() {
  try {
    let musicList = [];
    const metingData = await fetchMetingApi();

    if (metingData && metingData.length > 0) {
        musicList = metingData;
        console.log(`✅ Loaded ${musicList.length} songs from Meting API.`);

        // recover existing durations if any to prevent re-fetching
        try {
            const existingData = await fs.readFile(MUSIC_DATA_PATH, 'utf-8');
            const existingList = JSON.parse(existingData);
            const durationMap = new Map();
            existingList.forEach(item => {
                if (item.url && item.duration) durationMap.set(item.url, item.duration);
            });
            musicList.forEach(item => {
                if (durationMap.has(item.url)) {
                    item.duration = durationMap.get(item.url);
                }
            });
        } catch(e) { /* ignore */ }
    } else {
        const data = await fs.readFile(MUSIC_DATA_PATH, 'utf-8');
        musicList = JSON.parse(data);
    }
    
    let hasChanges = true; // Always save since Meting API might have updated

    console.log('🎵 Starting music duration fetch...');

    for (const item of musicList) {
      if (item.url && !item.duration) {
        // Skip Meting API urls for duration fetch to avoid 429 rate limit
        if (item.url.includes('163.hyc.moe')) {
            continue;
        }

        console.log(`Processing: ${item.title} - ${item.artist}`);
        try {
            // Fetch only the first 500KB - typically enough for metadata
            // Adjust range if metadata is at the end (like some ID3v1), but many valid FLAC/MP3 have it at start or we read enough.
            // For remote files, we can use Range header to be efficient.
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(item.url, {
                headers: {
                    'Range': 'bytes=0-500000', // First 500KB
                    'User-Agent': 'RyuChan-Build-Script/1.0' 
                },
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!response.ok && response.status !== 206) {
                console.warn(`Failed to fetch ${item.url}: ${response.status} ${response.statusText}`);
                continue;
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Using parseBuffer since we have a chunk. 
            // Note: If metadata is outside this chunk, this might fail or return undefined.
            // For reliable results on variable inputs, we might need a tokenizer that can read from a web stream.
            // But parseBuffer is simplest for a script.
            const metadata = await parseBuffer(buffer, { mimeType: response.headers.get('content-type') });
            
            if (metadata && metadata.format && metadata.format.duration) {
                const durationStr = formatDuration(metadata.format.duration);
                item.duration = durationStr;
                hasChanges = true;
                console.log(`  -> Duration: ${durationStr}`);
            } else {
                console.warn(`  -> Could not determine duration from first 500KB`);
            }

        } catch (error) {
           console.error(`  -> Error processing ${item.title}:`, error.message);
        }
      }
    }

    if (hasChanges) {
      await fs.writeFile(MUSIC_DATA_PATH, JSON.stringify(musicList, null, 4), 'utf-8');
      console.log('✅ Music data updated with durations.');
    } else {
      console.log('✨ No changes needed.');
    }

  } catch (error) {
    console.error('Fatal error in music script:', error);
    process.exit(1);
  }
}

fetchMusicDuration();
