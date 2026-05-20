import express from 'express';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, execSync } from 'child_process';

const app = express();
const PORT = 8080;

// USB Mount directory check, fallback to local ./music
const USB_DIR = '/mnt/usb';
const MUSIC_DIR = fs.existsSync(USB_DIR) ? USB_DIR : path.resolve('./music');
console.log(`[System] Using music directory: ${MUSIC_DIR}`);

const YT_DLP_PATH = fs.existsSync('/home/wavr/.local/bin/yt-dlp') 
    ? '/home/wavr/.local/bin/yt-dlp' 
    : (fs.existsSync('/usr/local/bin/yt-dlp') ? '/usr/local/bin/yt-dlp' : 'yt-dlp');

// Ensure directory exists
if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

// CLI Player Auto-Detection
let playerCmd = 'mpv';
try {
    execSync('which mpv 2>/dev/null');
    playerCmd = 'mpv';
} catch (e) {
    try {
        execSync('which ffplay 2>/dev/null');
        playerCmd = 'ffplay';
    } catch (e2) {
        try {
            execSync('which mpg123 2>/dev/null');
            playerCmd = 'mpg123';
        } catch (e3) {
            playerCmd = 'none';
        }
    }
}
console.log(`[Player] Detected backend player: ${playerCmd}`);

app.use(express.json());
app.use(express.static('.'));
app.use('/music', express.static(MUSIC_DIR));

// Helper to secure paths and prevent path traversal
function getSafePath(relativePath) {
    if (!relativePath) return MUSIC_DIR;
    const resolved = path.resolve(MUSIC_DIR, relativePath);
    if (!resolved.startsWith(MUSIC_DIR)) {
        throw new Error('Access denied: Path traversal detected');
    }
    return resolved;
}

// Recursive finder to check if a song by ID exists anywhere in the library
function findSongById(id, dir = MUSIC_DIR) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
            const found = findSongById(id, fullPath);
            if (found) return found;
        } else if (item.isFile() && item.name.includes(`_[${id}].mp3`)) {
            return fullPath;
        }
    }
    return null;
}

// Helper to get network IPs
function getNetworkIPs() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push({ name, address: iface.address });
            }
        }
    }
    return addresses;
}

// ==========================================
// SERVER-SIDE AUDIO STATE ENGINE
// ==========================================
let playbackProcess = null;
let progressInterval = null;

let playerState = {
    isPlaying: false,
    isPaused: false,
    currentTrack: null,
    currentTime: 0,
    duration: 0,
    isShuffle: false,
    queue: [],
    queueIndex: -1,
    volume: 100
};

function startProgressTimer() {
    clearInterval(progressInterval);
    progressInterval = setInterval(() => {
        if (playerState.isPlaying && !playerState.isPaused) {
            playerState.currentTime += 1;
            if (playerState.currentTime >= playerState.duration) {
                clearInterval(progressInterval);
                // Track finished naturally -> Auto play next
                console.log(`[Player] Track finished naturally. Skipped to next.`);
                serverNext();
            }
        }
    }, 1000);
}

function serverPlay(track, queue = [], index = -1, startOffset = 0) {
    serverStop(); // Stop any active playback

    if (track) {
        playerState.currentTrack = track;
        playerState.duration = track.duration || 180; // default duration fallback
    }
    if (queue.length > 0) {
        playerState.queue = queue;
        playerState.queueIndex = index;
    }
    
    playerState.currentTime = startOffset;

    if (!playerState.currentTrack) {
        console.error('[Player] No track to play');
        return;
    }

    // Resolve file path
    let relativePath = playerState.currentTrack.path;
    if (relativePath.startsWith('/music/')) {
        relativePath = relativePath.substring(7);
    }
    const fullPath = path.resolve(MUSIC_DIR, decodeURIComponent(relativePath));

    if (!fs.existsSync(fullPath)) {
        console.error(`[Player] File not found: ${fullPath}`);
        playerState.isPlaying = false;
        return;
    }

    console.log(`[Player] Playing: ${fullPath} from offset: ${startOffset}s using: ${playerCmd}`);

    if (playerCmd === 'none') {
        console.warn('[Player] No CLI audio player installed on system. Playback simulated.');
        playerState.isPlaying = true;
        playerState.isPaused = false;
        startProgressTimer();
        return;
    }

    // Spawn player child process
    try {
        if (playerCmd === 'mpv') {
            const args = [
                '--no-video',
                `--volume=${playerState.volume}`,
                `--start=${startOffset}`,
                fullPath
            ];
            playbackProcess = spawn('mpv', args);
        } else if (playerCmd === 'ffplay') {
            const args = [
                '-nodisp',
                '-autoexit',
                '-ss', String(startOffset),
                '-volume', String(playerState.volume),
                fullPath
            ];
            playbackProcess = spawn('ffplay', args);
        } else if (playerCmd === 'mpg123') {
            const args = [];
            if (startOffset > 0) {
                // Approximate starting frame for mpg123 (-k option skips frames, ~38 frames per sec)
                args.push('-k', String(Math.floor(startOffset * 38)));
            }
            args.push(fullPath);
            playbackProcess = spawn('mpg123', args);
        }

        playerState.isPlaying = true;
        playerState.isPaused = false;
        startProgressTimer();

        playbackProcess.on('close', (code) => {
            console.log(`[Player] Process exited with code ${code}`);
            // If the process exited naturally (code 0) and we were playing, auto-next is triggered by timer
            // but if the timer didn't fire, we can check it here
            playbackProcess = null;
        });

        playbackProcess.on('error', (err) => {
            console.error('[Player] Spawning error:', err);
            playbackProcess = null;
        });

    } catch (err) {
        console.error('[Player] Execution error:', err);
        playerState.isPlaying = false;
    }
}

function serverStop() {
    clearInterval(progressInterval);
    playerState.isPlaying = false;
    playerState.isPaused = false;
    if (playbackProcess) {
        try {
            // Kill player process
            playbackProcess.kill('SIGKILL');
        } catch (e) {}
        playbackProcess = null;
    }
}

function serverPause() {
    if (playbackProcess && playerState.isPlaying && !playerState.isPaused) {
        console.log(`[Player] Suspending process via SIGSTOP`);
        try {
            playbackProcess.kill('SIGSTOP');
            playerState.isPaused = true;
        } catch (e) {
            console.error('[Player] Pause signal failed:', e);
        }
    } else if (playerCmd === 'none' && playerState.isPlaying) {
        // simulation fallback
        playerState.isPaused = true;
    }
}

function serverResume() {
    if (playbackProcess && playerState.isPlaying && playerState.isPaused) {
        console.log(`[Player] Resuming process via SIGCONT`);
        try {
            playbackProcess.kill('SIGCONT');
            playerState.isPaused = false;
            startProgressTimer();
        } catch (e) {
            console.error('[Player] Resume signal failed, restarting track at position...');
            serverPlay(null, [], -1, playerState.currentTime);
        }
    } else if (playerCmd === 'none' && playerState.isPlaying) {
        // simulation fallback
        playerState.isPaused = false;
        startProgressTimer();
    }
}

function serverNext() {
    if (playerState.queue.length === 0) {
        serverStop();
        return;
    }
    let index = playerState.queueIndex;
    if (playerState.isShuffle) {
        index = Math.floor(Math.random() * playerState.queue.length);
    } else {
        index = (playerState.queueIndex + 1) % playerState.queue.length;
    }
    serverPlay(playerState.queue[index], playerState.queue, index);
}

function serverPrev() {
    if (playerState.queue.length === 0) {
        serverStop();
        return;
    }
    let index = playerState.queueIndex;
    if (playerState.isShuffle) {
        index = Math.floor(Math.random() * playerState.queue.length);
    } else {
        index = (playerState.queueIndex - 1 + playerState.queue.length) % playerState.queue.length;
    }
    serverPlay(playerState.queue[index], playerState.queue, index);
}

// Cleanup player process on exit
process.on('exit', () => {
    serverStop();
});

// ==========================================
// AUDIO PLAYER API ENDPOINTS
// ==========================================

// Get player state
app.get('/api/player/status', (req, res) => {
    res.json({
        isPlaying: playerState.isPlaying,
        isPaused: playerState.isPaused,
        currentTrack: playerState.currentTrack,
        currentTime: playerState.currentTime,
        duration: playerState.duration,
        isShuffle: playerState.isShuffle,
        volume: playerState.volume,
        hasQueue: playerState.queue.length > 0
    });
});

// Play / Resume
app.post('/api/player/play', (req, res) => {
    const { track, queue, index } = req.body;
    
    if (track) {
        serverPlay(track, queue || [], index !== undefined ? index : -1);
    } else {
        // Toggle play/pause or resume
        if (playerState.isPlaying) {
            if (playerState.isPaused) {
                serverResume();
            } else {
                serverPause();
            }
        } else {
            // Nothing loaded, try resuming or play first song in library
            res.status(400).json({ error: 'No active track loaded. Play from library.' });
            return;
        }
    }
    res.json({ status: 'success', state: playerState });
});

// Pause
app.post('/api/player/pause', (req, res) => {
    serverPause();
    res.json({ status: 'success', state: playerState });
});

// Next
app.post('/api/player/next', (req, res) => {
    serverNext();
    res.json({ status: 'success', state: playerState });
});

// Prev
app.post('/api/player/prev', (req, res) => {
    serverPrev();
    res.json({ status: 'success', state: playerState });
});

// Seek
app.post('/api/player/seek', (req, res) => {
    const { time } = req.body;
    if (time === undefined) return res.status(400).json({ error: 'Time parameter is required' });
    
    let targetTime = Math.max(0, Math.min(playerState.duration, Math.floor(time)));
    serverPlay(null, [], -1, targetTime);
    res.json({ status: 'success', state: playerState });
});

// Set Volume
app.post('/api/player/volume', (req, res) => {
    const { volume } = req.body;
    if (volume === undefined) return res.status(400).json({ error: 'Volume parameter is required' });
    
    playerState.volume = Math.max(0, Math.min(100, volume));
    console.log(`[Player] Volume set to: ${playerState.volume}`);
    
    // If playing, we have to respawn or adjust volume (easier to just apply to next track or respawn)
    if (playerState.isPlaying && !playerState.isPaused) {
        serverPlay(null, [], -1, playerState.currentTime);
    }
    
    res.json({ status: 'success', state: playerState });
});

// Toggle Shuffle
app.post('/api/player/shuffle', (req, res) => {
    playerState.isShuffle = !playerState.isShuffle;
    res.json({ status: 'success', state: playerState });
});

// ==========================================
// SEARCH & DOWNLOAD & LIBRARY APIS
// ==========================================

// API: Search songs
app.get('/api/search', async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: 'Query parameter "q" is required' });
    }

    console.log(`[Search] Query: "${query}"`);
    try {
        const child = spawn(YT_DLP_PATH, [
            `ytsearch5:${query}`,
            '--dump-json',
            '--flat-playlist'
        ]);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => { stdout += data; });
        child.stderr.on('data', (data) => { stderr += data; });

        child.on('close', (code) => {
            if (code !== 0) {
                console.error(`yt-dlp search failed with code ${code}:`, stderr);
                return res.status(500).json({ error: 'Search command failed' });
            }

            const lines = stdout.trim().split('\n');
            const tracks = lines.map(line => {
                if (!line.trim()) return null;
                try {
                    const data = JSON.parse(line);
                    return {
                        id: data.id,
                        title: data.title,
                        artist: data.uploader || data.channel || 'Unknown Artist',
                        duration: data.duration || 0,
                        duration_string: data.duration_string || '0:00',
                        url: data.url || `https://www.youtube.com/watch?v=${data.id}`
                    };
                } catch (e) {
                    return null;
                }
            }).filter(Boolean);

            res.json(tracks);
        });
    } catch (err) {
        console.error('Search error:', err);
        res.status(500).json({ error: 'Internal server error during search' });
    }
});

// API: Download song
app.post('/api/download', async (req, res) => {
    const { id, url, title } = req.body;
    if (!id || !url) {
        return res.status(400).json({ error: 'id and url are required' });
    }

    console.log(`[Download] Request for ID: ${id}, Title: "${title || 'Unknown'}"`);

    // 1. Check if song already exists in the library
    const existingFilePath = findSongById(id);
    if (existingFilePath) {
        const relativeToMusic = path.relative(MUSIC_DIR, existingFilePath);
        console.log(`[Download] Song already exists at: ${relativeToMusic}`);
        return res.json({
            status: 'success',
            path: `/music/${relativeToMusic}`,
            filename: path.basename(existingFilePath),
            message: 'Already downloaded'
        });
    }

    // 2. Download via yt-dlp to MUSIC_DIR
    const targetTemplate = path.join(MUSIC_DIR, '%(title)s_[%(id)s].temp.%(ext)s');

    try {
        console.log(`[Download] Running yt-dlp for url: ${url}`);
        const child = spawn(YT_DLP_PATH, [
            '-x',
            '--audio-format', 'mp3',
            '--audio-quality', '0',
            '--postprocessor-args', 'ExtractAudio:-ac 2', // Downmix to stereo
            '--restrict-filenames',
            '-o', targetTemplate,
            url
        ]);

        let stderr = '';
        child.stderr.on('data', (data) => { stderr += data; });
        
        child.on('close', (code) => {
            if (code !== 0) {
                console.error(`yt-dlp download failed with code ${code}:`, stderr);
                return res.status(500).json({ error: 'Download failed' });
            }

            // Find the downloaded temp file
            const files = fs.readdirSync(MUSIC_DIR);
            const tempFile = files.find(f => f.includes(`_[${id}].temp.mp3`));
            if (!tempFile) {
                console.error(`Downloaded file not found with pattern: _[${id}].temp.mp3`);
                return res.status(500).json({ error: 'Downloaded file not found on disk' });
            }

            const oldPath = path.join(MUSIC_DIR, tempFile);
            const newFile = tempFile.replace('.temp.mp3', '.mp3');
            const newPath = path.join(MUSIC_DIR, newFile);

            fs.renameSync(oldPath, newPath);
            console.log(`[Download] Complete! Saved to: ${newFile}`);

            res.json({
                status: 'success',
                path: `/music/${newFile}`,
                filename: newFile,
                message: 'Downloaded successfully'
            });
        });
    } catch (err) {
        console.error('Download execution error:', err);
        res.status(500).json({ error: 'Internal server error during download' });
    }
});

// API: List library contents
app.get('/api/library', (req, res) => {
    try {
        const items = fs.readdirSync(MUSIC_DIR, { withFileTypes: true });
        const folders = [];
        const rootSongs = [];

        for (const item of items) {
            const fullPath = path.join(MUSIC_DIR, item.name);
            if (item.isDirectory()) {
                const subItems = fs.readdirSync(fullPath, { withFileTypes: true });
                const songs = subItems
                    .filter(sub => sub.isFile() && (sub.name.endsWith('.mp3') || sub.name.endsWith('.flac')))
                    .map(sub => {
                        const idMatch = sub.name.match(/_\[([^\]]+)\]\.(mp3|flac)$/);
                        const id = idMatch ? idMatch[1] : null;
                        const displayTitle = sub.name
                            .replace(/_\[([^\]]+)\]\.(mp3|flac)$/, '')
                            .replace(/_/g, ' ');
                        return {
                            id,
                            title: displayTitle,
                            filename: sub.name,
                            path: `/music/${item.name}/${sub.name}`
                        };
                    });
                
                folders.push({
                    name: item.name,
                    songs
                });
            } else if (item.isFile() && (item.name.endsWith('.mp3') || item.name.endsWith('.flac'))) {
                const idMatch = item.name.match(/_\[([^\]]+)\]\.(mp3|flac)$/);
                const id = idMatch ? idMatch[1] : null;
                const displayTitle = item.name
                    .replace(/_\[([^\]]+)\]\.(mp3|flac)$/, '')
                    .replace(/_/g, ' ');
                rootSongs.push({
                    id,
                    title: displayTitle,
                    filename: item.name,
                    path: `/music/${item.name}`
                });
            }
        }

        res.json({ folders, songs: rootSongs });
    } catch (err) {
        console.error('Library listing error:', err);
        res.status(500).json({ error: 'Failed to read library' });
    }
});

// API: Create new folder
app.post('/api/library/folder', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    const sanitizedName = name.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
    if (!sanitizedName) return res.status(400).json({ error: 'Invalid folder name' });

    try {
        const targetPath = getSafePath(sanitizedName);
        if (fs.existsSync(targetPath)) {
            return res.status(400).json({ error: 'Folder already exists' });
        }
        fs.mkdirSync(targetPath);
        console.log(`[Library] Created folder: ${sanitizedName}`);
        res.json({ status: 'success', message: 'Folder created' });
    } catch (err) {
        console.error('Folder creation error:', err);
        res.status(500).json({ error: err.message || 'Failed to create folder' });
    }
});

// API: Delete folder (move songs inside to root first)
app.delete('/api/library/folder', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    try {
        const targetPath = getSafePath(name);
        if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        const items = fs.readdirSync(targetPath);
        for (const item of items) {
            const oldFilePath = path.join(targetPath, item);
            const newFilePath = path.join(MUSIC_DIR, item);
            
            if (fs.existsSync(newFilePath)) {
                fs.unlinkSync(oldFilePath);
            } else {
                fs.renameSync(oldFilePath, newFilePath);
            }
        }

        fs.rmdirSync(targetPath);
        console.log(`[Library] Deleted folder: ${name} (moved files to root)`);
        res.json({ status: 'success', message: 'Folder deleted, files moved to root' });
    } catch (err) {
        console.error('Folder deletion error:', err);
        res.status(500).json({ error: err.message || 'Failed to delete folder' });
    }
});

// API: Move song
app.post('/api/library/move', (req, res) => {
    const { sourcePath, targetFolder } = req.body;
    if (!sourcePath) return res.status(400).json({ error: 'sourcePath is required' });

    try {
        let relativeSource = sourcePath;
        if (sourcePath.startsWith('/music/')) {
            relativeSource = sourcePath.substring(7);
        }

        const resolvedSource = getSafePath(relativeSource);
        if (!fs.existsSync(resolvedSource)) {
            return res.status(404).json({ error: 'Source file not found' });
        }

        const filename = path.basename(resolvedSource);
        let resolvedTarget;

        if (!targetFolder) {
            resolvedTarget = path.join(MUSIC_DIR, filename);
        } else {
            const sanitizedFolder = targetFolder.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim();
            const folderPath = getSafePath(sanitizedFolder);
            if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
                return res.status(404).json({ error: 'Target folder not found' });
            }
            resolvedTarget = path.join(folderPath, filename);
        }

        if (resolvedSource === resolvedTarget) {
            return res.json({ status: 'success', message: 'File is already in target location' });
        }

        fs.renameSync(resolvedSource, resolvedTarget);
        console.log(`[Library] Moved file from ${relativeSource} to target`);
        
        // If the moved file was currently playing, update backend playState path
        if (playerState.currentTrack && playerState.currentTrack.path === sourcePath) {
            const newPath = targetFolder ? `/music/${targetFolder}/${filename}` : `/music/${filename}`;
            playerState.currentTrack.path = newPath;
            console.log(`[Player] Updated active playing track path to: ${newPath}`);
        }

        res.json({ status: 'success', message: 'File moved successfully' });
    } catch (err) {
        console.error('File move error:', err);
        res.status(500).json({ error: err.message || 'Failed to move file' });
    }
});

// API: Delete song
app.delete('/api/library/song', (req, res) => {
    const { path: songPath } = req.body;
    if (!songPath) return res.status(400).json({ error: 'path is required' });

    try {
        let relativeSource = songPath;
        if (songPath.startsWith('/music/')) {
            relativeSource = songPath.substring(7);
        }

        const resolvedSource = getSafePath(relativeSource);
        if (!fs.existsSync(resolvedSource)) {
            return res.status(404).json({ error: 'File not found' });
        }

        fs.unlinkSync(resolvedSource);
        console.log(`[Library] Deleted file: ${relativeSource}`);
        
        // If deleted song was currently playing, stop player
        if (playerState.currentTrack && playerState.currentTrack.path === songPath) {
            serverStop();
            playerState.currentTrack = null;
            playerState.currentTime = 0;
            playerState.duration = 0;
        }

        res.json({ status: 'success', message: 'File deleted' });
    } catch (err) {
        console.error('File deletion error:', err);
        res.status(500).json({ error: err.message || 'Failed to delete file' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(`Retro Terminal Player backend running at:`);
    console.log(`- Local: http://localhost:${PORT}`);
    
    const ips = getNetworkIPs();
    if (ips.length > 0) {
        console.log(`- Network:`);
        ips.forEach(ip => {
            console.log(`   * http://${ip.address}:${PORT} (interface: ${ip.name})`);
        });
    }
    console.log(`=================================================`);
});
