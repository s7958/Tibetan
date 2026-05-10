
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseBuffer } from 'music-metadata';
import yaml from 'js-yaml';

const MUSIC_DATA_PATH = path.resolve('src/data/music.json');
const CONFIG_PATH = path.resolve('ryuchan.config.yaml');

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

async function fetchPlaylistSongs(playlistId, trans) {
  const apiUrl = `https://163.hyc.moe?server=netease&type=playlist&id=${playlistId}`;
  console.log(`  🎵 Fetching playlist ${playlistId}...`);
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`Meting API failed: ${res.statusText}`);
    const data = await res.json();
    return data.map(item => {
      let songUrl = item.url?.replace(/http:\/\//g, 'https://');
      let lrcUrl = item.lrc?.replace(/http:\/\//g, 'https://');
      if (songUrl) songUrl += `&br=320`;
      if (trans && lrcUrl) lrcUrl += `&trans=true`;
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
    console.error(`  ❌ Failed to fetch playlist ${playlistId}:`, e.message);
    return [];
  }
}

async function fetchMusicDuration() {
  try {
    let config = {};
    try {
      const configStr = await fs.readFile(CONFIG_PATH, 'utf-8');
      config = yaml.load(configStr) || {};
    } catch (e) {
      console.log('Could not load config, using defaults');
    }

    const trans = config?.site?.meting?.trans !== false;
    const playlists = config?.music?.playlists || [];

    if (playlists.length === 0) {
      // fallback to single meting id
      const singleId = config?.site?.meting?.id || '8900628861';
      playlists.push({ id: singleId, name: '默认歌单', server: 'netease' });
    }

    console.log(`🎵 Fetching ${playlists.length} playlist(s)...`);

    // Load existing data for duration caching
    let existingData = { songs: [], playlistCounts: {} };
    const urlToDuration = new Map();
    try {
      const raw = await fs.readFile(MUSIC_DATA_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        existingData = { songs: parsed, playlistCounts: {} };
      } else {
        existingData = parsed;
      }
      existingData.songs.forEach(s => {
        if (s.url && s.duration) urlToDuration.set(s.url, s.duration);
      });
    } catch(e) { /* no existing data */ }

    // Fetch all playlists
    const playlistCounts = {};
    const playlistSongs = {};
    const allSongs = [];
    const seenUrls = new Set();
    const urlToSong = new Map(); // url → song object reference in allSongs

    for (const pl of playlists) {
      const songs = await fetchPlaylistSongs(pl.id, trans);
      console.log(`  ✅ ${pl.name || pl.id}: ${songs.length} 首`);
      playlistCounts[pl.id] = songs.length;
      playlistSongs[pl.id] = [];

      for (const song of songs) {
        if (!seenUrls.has(song.url)) {
          seenUrls.add(song.url);
          if (urlToDuration.has(song.url)) {
            song.duration = urlToDuration.get(song.url);
          }
          allSongs.push(song);
          urlToSong.set(song.url, song);
          playlistSongs[pl.id].push(song);
        } else {
          // reuse existing song object so durations propagate
          playlistSongs[pl.id].push(urlToSong.get(song.url));
        }
      }
    }

    console.log(`📊 Total unique songs: ${allSongs.length}`);

    // Fetch durations for new songs
    let hasChanges = allSongs.some(s => s.url && !s.duration);
    if (hasChanges) {
      console.log('🎵 Fetching durations...');
      for (const item of allSongs) {
        if (!item.url || item.duration) continue;

        if (item.url.includes('163.hyc.moe')) {
          try {
            const parsedUrl = new URL(item.url);
            const id = parsedUrl.searchParams.get('id');
            if (id) {
              const res = await fetch(`https://music.163.com/api/song/detail/?id=${id}&ids=[${id}]`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
              });
              const data = await res.json();
              if (data.songs?.[0]?.duration) {
                item.duration = formatDuration(data.songs[0].duration / 1000);
                console.log(`  -> ${item.duration} (${item.title})`);
              }
            }
          } catch(e) { console.warn(`  -> Duration failed: ${item.title}`); }
          continue;
        }

        // fallback: parse buffer
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 10000);
          const response = await fetch(item.url, {
            headers: { 'Range': 'bytes=0-500000' },
            signal: controller.signal
          });
          clearTimeout(timeoutId);
          if (!response.ok && response.status !== 206) continue;
          const buffer = Buffer.from(await response.arrayBuffer());
          const metadata = await parseBuffer(buffer, { mimeType: response.headers.get('content-type') });
          if (metadata?.format?.duration) {
            item.duration = formatDuration(metadata.format.duration);
            console.log(`  -> ${item.duration} (${item.title})`);
          }
        } catch(e) { console.warn(`  -> Duration failed: ${item.title}`); }
      }
    }

    const output = { songs: allSongs, playlistCounts, playlistSongs };
    await fs.writeFile(MUSIC_DATA_PATH, JSON.stringify(output, null, 4), 'utf-8');
    console.log('✅ Music data updated.');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

fetchMusicDuration();
