export interface MusicItem {
    title: string;
    artist: string;
    cover: string;
    url: string;
    lrc?: string;
    duration?: string;
}

/**
 * 此时歌曲数据源于 Meting API 自动生成的 './music.json'.
 * 可以通过修改 `scripts/fetch-music-duration.mjs` 中的 playlistId 切换歌单.
 * 或者在此处继续混入额外的静态音乐对象，格式如下:
 * {
 *   "title": "新歌歌名",
 *   "artist": "歌手",
 *   "cover": "封面链接",
 *   "url": "音频链接",
 *   "lrc": "歌词链接(可选)",
 *   "duration": "00:00(将会自动抓取)"
 * }
 * 
 * 运行 `pnpm prefetch:music` 即可自动更新 Meting 歌单数据。
 */
import musicData from './music.json';

export const musicList: MusicItem[] = musicData;
