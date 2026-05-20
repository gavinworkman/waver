// Grab elements from the DOM
const playBtn = document.getElementById('btn-play');
const prevBtn = document.getElementById('btn-prev');
const nextBtn = document.getElementById('btn-next');
const shuffleBtn = document.getElementById('btn-shuffle');
const addBtn = document.getElementById('btn-add');

const canvas = document.getElementById('waveform-canvas');
const ctx = canvas.getContext('2d');

// Nav Tabs
const tabPlaying = document.getElementById('tab-playing');
const tabSearch = document.getElementById('tab-search');
const tabLibrary = document.getElementById('tab-library');

// View Panes
const viewPlaying = document.getElementById('view-playing');
const viewSearch = document.getElementById('view-search');
const viewLibrary = document.getElementById('view-library');

// Search elements
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchStatus = document.getElementById('search-status');
const searchResults = document.getElementById('search-results');

// Library elements
const libraryContent = document.getElementById('library-content');
const btnCreateFolder = document.getElementById('btn-create-folder');

// Progress Timeline
const progressBarContainer = document.getElementById('progress-bar-container');
const progressBar = document.getElementById('progress-bar');
const timeCurrent = document.getElementById('time-current');
const timeDuration = document.getElementById('time-duration');

// Track Metadata
const trackName = document.getElementById('track-name');
const artistName = document.getElementById('artist-name');
const albumName = document.getElementById('album-name');

// Modal Elements
const modalOverlay = document.getElementById('folder-modal');
const modalFolderList = document.getElementById('modal-folder-list');
const btnCloseModal = document.getElementById('btn-close-modal');

// Create Folder Modal Elements
const createFolderModal = document.getElementById('create-folder-modal');
const newFolderInput = document.getElementById('new-folder-input');
const btnCancelFolder = document.getElementById('btn-cancel-folder');
const btnSubmitFolder = document.getElementById('btn-submit-folder');

// Application State (Synced from Server)
let isPlaying = false;
let isPaused = false;
let currentTrack = null;
let currentTime = 0;
let duration = 0;
let isShuffle = false;

let cachedLibraryData = null;
let songToMove = null;
let animationFrameId = null;
let simulatedHeights = [];

// Navigation Router (SPA)
function switchView(viewName) {
    tabPlaying.classList.remove('active');
    tabSearch.classList.remove('active');
    tabLibrary.classList.remove('active');
    
    viewPlaying.classList.remove('active');
    viewSearch.classList.remove('active');
    viewLibrary.classList.remove('active');
    
    if (viewName === 'playing') {
        tabPlaying.classList.add('active');
        viewPlaying.classList.add('active');
        resizeCanvas();
    } else if (viewName === 'search') {
        tabSearch.classList.add('active');
        viewSearch.classList.add('active');
    } else if (viewName === 'library') {
        tabLibrary.classList.add('active');
        viewLibrary.classList.add('active');
        loadLibrary();
    }
}

// Bind Navigation Clicks
tabPlaying.addEventListener('click', () => switchView('playing'));
tabSearch.addEventListener('click', () => switchView('search'));
tabLibrary.addEventListener('click', () => switchView('library'));

// Canvas Resize
function resizeCanvas() {
    if (canvas && canvas.clientWidth) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// Simulated Web Audio Visualizer
function drawWaveform() {
    if (!isPlaying || isPaused) {
        // Draw flat center line
        ctx.fillStyle = '#050505';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#666';
        ctx.fillRect(0, canvas.height / 2 - 1, canvas.width, 2);
        animationFrameId = null;
        return;
    }

    animationFrameId = requestAnimationFrame(drawWaveform);

    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const numBars = 36;
    const barWidth = canvas.width / numBars;
    
    if (simulatedHeights.length !== numBars) {
        simulatedHeights = Array(numBars).fill(0);
    }

    for (let i = 0; i < numBars; i++) {
        // Calculate a target using random noise
        const target = Math.random() * canvas.height * 0.75;
        // Interpolate for smooth transitions
        simulatedHeights[i] = (simulatedHeights[i] * 0.7) + (target * 0.3);

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 4;
        
        const y = (canvas.height / 2) - (simulatedHeights[i] / 2);
        ctx.fillRect(i * barWidth, y, barWidth - 2, simulatedHeights[i]);
    }
    ctx.shadowBlur = 0;
}

// Format seconds into MM:SS
function formatTime(seconds) {
    if (isNaN(seconds) || seconds === Infinity) return '00:00';
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

// Playback Scrubbing Interaction
progressBarContainer.addEventListener('click', async (e) => {
    if (duration <= 0) return;
    const rect = progressBarContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;
    const targetTime = percentage * duration;

    try {
        await fetch('/api/player/seek', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ time: targetTime })
        });
        syncPlayerState(); // Immediate update
    } catch (err) {
        console.error(err);
    }
});

// Control API Helpers
async function playTrack(track, queue, index) {
    try {
        const res = await fetch('/api/player/play', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ track, queue, index })
        });
        if (!res.ok) throw new Error('Play failed');
        syncPlayerState();
    } catch (err) {
        console.error(err);
    }
}

async function togglePlay() {
    if (!currentTrack) {
        playFirstInLibrary();
        return;
    }

    try {
        await fetch('/api/player/play', { method: 'POST' });
        syncPlayerState();
    } catch (err) {
        console.error(err);
    }
}

async function nextTrack() {
    try {
        await fetch('/api/player/next', { method: 'POST' });
        syncPlayerState();
    } catch (err) {
        console.error(err);
    }
}

async function prevTrack() {
    try {
        await fetch('/api/player/prev', { method: 'POST' });
        syncPlayerState();
    } catch (err) {
        console.error(err);
    }
}

async function toggleShuffle() {
    try {
        await fetch('/api/player/shuffle', { method: 'POST' });
        syncPlayerState();
    } catch (err) {
        console.error(err);
    }
}

// Button Bindings
playBtn.addEventListener('click', togglePlay);
nextBtn.addEventListener('click', nextTrack);
prevBtn.addEventListener('click', prevTrack);
shuffleBtn.addEventListener('click', toggleShuffle);

// Play First Song in Library Fallback
async function playFirstInLibrary() {
    try {
        const res = await fetch('/api/library');
        const data = await res.json();
        let allSongs = [];
        data.songs.forEach(s => allSongs.push(s));
        data.folders.forEach(f => f.songs.forEach(s => allSongs.push(s)));
        
        if (allSongs.length > 0) {
            playTrack(allSongs[0], allSongs, 0);
        } else {
            alert('No tracks found in library. Go to SEARCH to download songs!');
        }
    } catch (e) {
        console.error('Failed to play first song:', e);
    }
}

// Player Status Sync Engine (1s Polling)
async function syncPlayerState() {
    try {
        const res = await fetch('/api/player/status');
        if (!res.ok) return;
        const data = await res.json();

        // Save states
        const oldPlaying = isPlaying;
        const oldPaused = isPaused;

        isPlaying = data.isPlaying;
        isPaused = data.isPaused;
        currentTrack = data.currentTrack;
        currentTime = data.currentTime;
        duration = data.duration;
        isShuffle = data.isShuffle;

        // 1. Update Playback Button text
        if (isPlaying && !isPaused) {
            playBtn.innerText = '[PAUS]';
            // Start canvas loop if not already running
            if (!animationFrameId) {
                drawWaveform();
            }
        } else {
            playBtn.innerText = '[PLAY]';
        }

        // 2. Shuffle Styling
        if (isShuffle) {
            shuffleBtn.classList.add('active-mode');
        } else {
            shuffleBtn.classList.remove('active-mode');
        }

        // 3. Metadata and Info Panels
        if (currentTrack) {
            trackName.innerText = currentTrack.title.toUpperCase();
            artistName.innerText = (currentTrack.artist || 'UNKNOWN ARTIST').toUpperCase();

            let albumStr = 'LIBRARY ROOT';
            const parts = currentTrack.path.split('/');
            if (parts.length > 3) {
                albumStr = `PLAYLIST: ${decodeURIComponent(parts[2]).toUpperCase()}`;
            } else if (currentTrack.isSearch) {
                albumStr = 'STREAM (SEARCH)';
            }
            albumName.innerText = albumStr;

            // Update time stamps
            timeCurrent.innerText = formatTime(currentTime);
            timeDuration.innerText = formatTime(duration);

            // Progress bar size
            const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
            progressBar.style.width = `${percent}%`;
        } else {
            trackName.innerText = 'NO TRACK PLAYING';
            artistName.innerText = 'CHOOSE A SONG';
            albumName.innerText = 'FROM LIBRARY OR SEARCH';
            timeCurrent.innerText = '00:00';
            timeDuration.innerText = '00:00';
            progressBar.style.width = '0%';
        }

        // 4. Style active list rows in Library
        document.querySelectorAll('.song-row').forEach(row => {
            row.classList.remove('active');
            if (currentTrack && row.getAttribute('data-path') === currentTrack.path) {
                row.classList.add('active');
            }
        });

    } catch (err) {
        console.error('Error syncing status:', err);
    }
}

// Start polling
setInterval(syncPlayerState, 1000);
syncPlayerState();

// SEARCH VIEW LOGIC
searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;

    searchStatus.innerText = 'SEARCHING...';
    searchStatus.classList.add('blink');
    searchResults.innerHTML = '<div class="placeholder-text">WAIT: SEARCHING DATABASE...</div>';

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Search failed');
        const tracks = await response.json();

        searchStatus.classList.remove('blink');
        searchStatus.innerText = `FOUND ${tracks.length} RESULTS`;

        if (tracks.length === 0) {
            searchResults.innerHTML = '<div class="placeholder-text">NO RESULTS FOUND</div>';
            return;
        }

        searchResults.innerHTML = '';
        tracks.forEach((track) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `
                <div class="list-item-main">
                    <div class="list-item-title">${track.title.toUpperCase()}</div>
                    <div class="list-item-artist">${track.artist.toUpperCase()}</div>
                </div>
                <div class="list-item-meta">
                    <div>${track.duration_string}</div>
                    <div class="mini-btn" style="margin-top:4px; border-color:#555;">PLAY</div>
                </div>
            `;

            item.addEventListener('click', () => {
                downloadAndPlay(track);
            });

            searchResults.appendChild(item);
        });
    } catch (err) {
        console.error(err);
        searchStatus.classList.remove('blink');
        searchStatus.innerText = 'SEARCH ERROR';
        searchResults.innerHTML = '<div class="placeholder-text">SEARCH FAILED. TRY AGAIN.</div>';
    }
});

// Download and start playing search track
async function downloadAndPlay(track) {
    searchStatus.innerText = 'DOWNLOADING SONG...';
    searchStatus.classList.add('blink');
    
    const loaderOverlay = document.createElement('div');
    loaderOverlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.4); display:flex; justify-content:center; align-items:center; font-size:1.5rem;';
    loaderOverlay.innerHTML = '<div class="text-glow blink">&gt; DOWNLOADING MP3 &lt;</div>';
    viewSearch.appendChild(loaderOverlay);

    try {
        const res = await fetch('/api/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: track.id,
                url: track.url,
                title: track.title,
                artist: track.artist
            })
        });

        if (!res.ok) throw new Error('Download failed');
        const data = await res.json();

        searchStatus.classList.remove('blink');
        searchStatus.innerText = 'READY';
        loaderOverlay.remove();

        const playableTrack = {
            id: track.id,
            title: track.title,
            artist: track.artist,
            path: data.path,
            filename: data.filename,
            duration: track.duration,
            isSearch: true
        };

        // Command server to play, setting the active single queue
        switchView('playing');
        playTrack(playableTrack, [playableTrack], 0);

    } catch (err) {
        console.error(err);
        searchStatus.classList.remove('blink');
        searchStatus.innerText = 'DOWNLOAD ERROR';
        loaderOverlay.remove();
        alert('Could not download track. Check connections.');
    }
}

// LIBRARY VIEW LOGIC
async function loadLibrary() {
    try {
        const response = await fetch('/api/library');
        if (!response.ok) throw new Error('Failed to load library');
        const data = await response.json();
        cachedLibraryData = data;

        renderLibrary(data);
    } catch (err) {
        console.error(err);
        libraryContent.innerHTML = '<div class="placeholder-text">ERROR LOADING LIBRARY</div>';
    }
}

function renderLibrary(data) {
    libraryContent.innerHTML = '';

    if (data.folders.length === 0 && data.songs.length === 0) {
        libraryContent.innerHTML = '<div class="placeholder-text">LIBRARY IS EMPTY. DOWNLOAD SONGS!</div>';
        return;
    }

    // 1. Folders
    data.folders.forEach(folder => {
        const folderSec = document.createElement('div');
        folderSec.className = 'folder-section';

        const row = document.createElement('div');
        row.className = 'folder-row';
        row.innerHTML = `
            <span class="folder-icon">📁</span>
            <span class="folder-name">${folder.name.toUpperCase()}</span>
            <span class="folder-count">[${folder.songs.length}]</span>
            <div class="folder-actions">
                <button class="mini-btn del-folder-btn" title="Delete folder (songs will move to root)">DEL</button>
            </div>
        `;

        const contents = document.createElement('div');
        contents.className = 'folder-contents';
        
        row.addEventListener('click', (e) => {
            if (e.target.classList.contains('del-folder-btn')) return;
            contents.classList.toggle('open');
            row.querySelector('.folder-icon').innerText = contents.classList.contains('open') ? '📂' : '📁';
        });

        row.querySelector('.del-folder-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Delete playlist folder "${folder.name}"? Songs inside will move to root.`)) {
                await deleteFolder(folder.name);
            }
        });

        // Songs inside folder
        folder.songs.forEach((song, sIdx) => {
            const songRow = document.createElement('div');
            songRow.className = 'song-row';
            if (currentTrack && currentTrack.path === song.path) {
                songRow.classList.add('active');
            }
            songRow.setAttribute('data-path', song.path);
            songRow.innerHTML = `
                <div class="song-row-main">
                    <span class="song-icon">🎵</span>
                    <span>${song.title.toUpperCase()}</span>
                </div>
                <div class="song-row-actions">
                    <button class="song-action-btn move-song-btn">MOVE</button>
                    <button class="song-action-btn del del-song-btn">DEL</button>
                </div>
            `;

            songRow.querySelector('.song-row-main').addEventListener('click', () => {
                switchView('playing');
                playTrack(song, folder.songs, sIdx);
            });

            songRow.querySelector('.move-song-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                openMoveModal(song);
            });

            songRow.querySelector('.del-song-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Delete file "${song.title}" physically from server?`)) {
                    await deleteSong(song.path);
                }
            });

            contents.appendChild(songRow);
        });

        folderSec.appendChild(row);
        folderSec.appendChild(contents);
        libraryContent.appendChild(folderSec);
    });

    // 2. Root Songs
    if (data.songs.length > 0) {
        const rootHeader = document.createElement('div');
        rootHeader.style.cssText = 'font-size: 1.2rem; color: #444; margin: 12px 0 6px 0; border-bottom: 1px solid #222; padding-bottom: 2px;';
        rootHeader.innerText = 'LIBRARY ROOT (UNCLASSIFIED)';
        libraryContent.appendChild(rootHeader);

        data.songs.forEach((song, sIdx) => {
            const songRow = document.createElement('div');
            songRow.className = 'song-row';
            if (currentTrack && currentTrack.path === song.path) {
                songRow.classList.add('active');
            }
            songRow.setAttribute('data-path', song.path);
            songRow.innerHTML = `
                <div class="song-row-main">
                    <span class="song-icon">🎵</span>
                    <span>${song.title.toUpperCase()}</span>
                </div>
                <div class="song-row-actions">
                    <button class="song-action-btn move-song-btn">MOVE</button>
                    <button class="song-action-btn del del-song-btn">DEL</button>
                </div>
            `;

            songRow.querySelector('.song-row-main').addEventListener('click', () => {
                switchView('playing');
                playTrack(song, data.songs, sIdx);
            });

            songRow.querySelector('.move-song-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                openMoveModal(song);
            });

            songRow.querySelector('.del-song-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Delete file "${song.title}" physically from server?`)) {
                    await deleteSong(song.path);
                }
            });

            libraryContent.appendChild(songRow);
        });
    }
}

// Open Create Folder Modal
btnCreateFolder.addEventListener('click', () => {
    newFolderInput.value = '';
    createFolderModal.classList.remove('hidden');
    newFolderInput.focus();
});

// Close Create Folder Modal
btnCancelFolder.addEventListener('click', () => {
    createFolderModal.classList.add('hidden');
});

// Submit Create Folder
async function submitNewFolder() {
    const name = newFolderInput.value.trim();
    if (!name) return;

    try {
        const res = await fetch('/api/library/folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Failed to create folder');
        }
        createFolderModal.classList.add('hidden');
        loadLibrary();
    } catch (err) {
        alert(err.message);
    }
}

btnSubmitFolder.addEventListener('click', submitNewFolder);
newFolderInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        submitNewFolder();
    }
});

// Delete Folder API
async function deleteFolder(folderName) {
    try {
        const res = await fetch('/api/library/folder', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: folderName })
        });
        if (!res.ok) throw new Error('Deletion failed');
        loadLibrary();
    } catch (err) {
        alert('Could not delete folder');
    }
}

// Delete Song API
async function deleteSong(songPath) {
    try {
        const res = await fetch('/api/library/song', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: songPath })
        });
        if (!res.ok) throw new Error('Deletion failed');
        loadLibrary();
    } catch (err) {
        alert('Could not delete song file');
    }
}

// Move Modal Logic
function openMoveModal(song) {
    songToMove = song;
    modalFolderList.innerHTML = '';

    const rootOption = document.createElement('div');
    rootOption.className = 'modal-item';
    rootOption.innerText = '[ MOVE TO LIBRARY ROOT ]';
    rootOption.addEventListener('click', () => moveSongTo(''));
    modalFolderList.appendChild(rootOption);

    if (cachedLibraryData && cachedLibraryData.folders) {
        cachedLibraryData.folders.forEach(folder => {
            const opt = document.createElement('div');
            opt.className = 'modal-item';
            opt.innerText = folder.name.toUpperCase();
            opt.addEventListener('click', () => moveSongTo(folder.name));
            modalFolderList.appendChild(opt);
        });
    }

    modalOverlay.classList.remove('hidden');
}

async function moveSongTo(folderName) {
    if (!songToMove) return;

    try {
        const res = await fetch('/api/library/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sourcePath: songToMove.path,
                targetFolder: folderName
            })
        });

        if (!res.ok) throw new Error('Move failed');
        modalOverlay.classList.add('hidden');
        songToMove = null;
        loadLibrary();
        syncPlayerState();
    } catch (err) {
        alert('Could not move song');
    }
}

// Close Modal
btnCloseModal.addEventListener('click', () => {
    modalOverlay.classList.add('hidden');
    songToMove = null;
});

// Now Playing Add Button
addBtn.addEventListener('click', () => {
    if (!currentTrack) {
        alert('No track playing. Load a song first!');
        return;
    }
    fetch('/api/library')
        .then(res => res.json())
        .then(data => {
            cachedLibraryData = data;
            openMoveModal(currentTrack);
        })
        .catch(() => {
            openMoveModal(currentTrack);
        });
});

// Initialize view
switchView('playing');
loadLibrary();