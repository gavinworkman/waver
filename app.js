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

// ==========================================
// CLIENT-SIDE AUDIO PLAYBACK ENGINE
// ==========================================
const audio = new Audio();
audio.preload = 'metadata';

let currentTrack = null;
let isShuffle = false;
let queue = [];
let queueIndex = -1;

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
    const isPlaying = !audio.paused && !audio.ended && audio.readyState > 2;

    if (!isPlaying) {
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

// ==========================================
// AUDIO EVENT HANDLERS (Client-Side Playback)
// ==========================================

// Update progress bar and time display continuously
audio.addEventListener('timeupdate', () => {
    if (!currentTrack) return;
    const cur = audio.currentTime;
    const dur = audio.duration || 0;

    timeCurrent.innerText = formatTime(cur);
    timeDuration.innerText = formatTime(dur);

    const percent = dur > 0 ? (cur / dur) * 100 : 0;
    progressBar.style.width = `${percent}%`;
});

// When metadata loads, update duration display
audio.addEventListener('loadedmetadata', () => {
    timeDuration.innerText = formatTime(audio.duration);
});

// When track ends, auto-advance to next
audio.addEventListener('ended', () => {
    console.log('[Player] Track ended, advancing to next');
    nextTrack();
});

// When playback starts
audio.addEventListener('play', () => {
    playBtn.innerText = '[PAUS]';
    if (!animationFrameId) {
        drawWaveform();
    }
});

// When playback pauses
audio.addEventListener('pause', () => {
    playBtn.innerText = '[PLAY]';
});

// Handle playback errors
audio.addEventListener('error', () => {
    console.error('[Player] Audio playback error:', audio.error);
    trackName.innerText = 'PLAYBACK ERROR';
    artistName.innerText = 'FILE MAY BE MISSING';
    albumName.innerText = 'CHECK LIBRARY';
});

// Playback Scrubbing Interaction
progressBarContainer.addEventListener('click', (e) => {
    if (!audio.duration) return;
    const rect = progressBarContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const percentage = clickX / width;
    audio.currentTime = percentage * audio.duration;
});

// ==========================================
// PLAYBACK CONTROLS (All Client-Side)
// ==========================================

function playTrack(track, newQueue, index) {
    currentTrack = track;
    if (newQueue && newQueue.length > 0) {
        queue = newQueue;
        queueIndex = index >= 0 ? index : 0;
    }

    // Update UI immediately
    trackName.innerText = (track.title || 'UNKNOWN').toUpperCase();
    artistName.innerText = (track.artist || 'UNKNOWN ARTIST').toUpperCase();

    let albumStr = 'LIBRARY ROOT';
    if (track.path) {
        const parts = track.path.split('/');
        if (parts.length > 3) {
            albumStr = `PLAYLIST: ${decodeURIComponent(parts[2]).toUpperCase()}`;
        } else if (track.isSearch) {
            albumStr = 'DOWNLOADED (SEARCH)';
        }
    }
    albumName.innerText = albumStr;

    // Set audio source and play
    audio.src = track.path;
    audio.play().catch(err => {
        console.error('[Player] Play failed:', err);
    });

    switchView('playing');
    updateActiveRows();
}

function togglePlay() {
    if (!currentTrack) {
        playFirstInLibrary();
        return;
    }

    if (audio.paused) {
        audio.play().catch(err => console.error('[Player] Resume failed:', err));
    } else {
        audio.pause();
    }
}

function nextTrack() {
    if (queue.length === 0) return;
    let index;
    if (isShuffle) {
        index = Math.floor(Math.random() * queue.length);
    } else {
        index = (queueIndex + 1) % queue.length;
    }
    playTrack(queue[index], queue, index);
}

function prevTrack() {
    if (queue.length === 0) return;

    // If more than 3 seconds in, restart current track
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
    }

    let index;
    if (isShuffle) {
        index = Math.floor(Math.random() * queue.length);
    } else {
        index = (queueIndex - 1 + queue.length) % queue.length;
    }
    playTrack(queue[index], queue, index);
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    if (isShuffle) {
        shuffleBtn.classList.add('active-mode');
    } else {
        shuffleBtn.classList.remove('active-mode');
    }
}

// Button Bindings
playBtn.addEventListener('click', togglePlay);
nextBtn.addEventListener('click', nextTrack);
prevBtn.addEventListener('click', prevTrack);
shuffleBtn.addEventListener('click', toggleShuffle);

// Highlight currently active song row in library
function updateActiveRows() {
    document.querySelectorAll('.song-row').forEach(row => {
        row.classList.remove('active');
        if (currentTrack && row.getAttribute('data-path') === currentTrack.path) {
            row.classList.add('active');
        }
    });
}

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
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Search failed');
        }
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
        searchResults.innerHTML = `<div class="placeholder-text">${err.message || 'SEARCH FAILED. TRY AGAIN.'}</div>`;
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

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Download failed');
        }
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

        // Play directly in browser
        playTrack(playableTrack, [playableTrack], 0);

    } catch (err) {
        console.error(err);
        searchStatus.classList.remove('blink');
        searchStatus.innerText = 'DOWNLOAD ERROR';
        loaderOverlay.remove();
        alert(err.message || 'Could not download track. Check connections.');
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
        e.preventDefault();
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

        // If deleted song is currently playing, stop
        if (currentTrack && currentTrack.path === songPath) {
            audio.pause();
            audio.src = '';
            currentTrack = null;
            trackName.innerText = 'NO TRACK PLAYING';
            artistName.innerText = 'CHOOSE A SONG';
            albumName.innerText = 'FROM LIBRARY OR SEARCH';
            timeCurrent.innerText = '00:00';
            timeDuration.innerText = '00:00';
            progressBar.style.width = '0%';
        }

        loadLibrary();
    } catch (err) {
        alert('Could not delete song file');
    }
}

// Move Modal Logic
async function openMoveModal(song) {
    songToMove = song;
    modalFolderList.innerHTML = '';

    // Always fetch fresh folder list
    try {
        const res = await fetch('/api/library');
        const data = await res.json();
        cachedLibraryData = data;
    } catch (e) {
        console.error('Failed to fetch library for move modal:', e);
    }

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

        // Update the current track path if we moved the playing song
        if (currentTrack && currentTrack.path === songToMove.path) {
            const filename = songToMove.path.split('/').pop();
            currentTrack.path = folderName ? `/music/${folderName}/${filename}` : `/music/${filename}`;
        }

        modalOverlay.classList.add('hidden');
        songToMove = null;
        loadLibrary();
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
    openMoveModal(currentTrack);
});

// Initialize view
switchView('playing');
loadLibrary();

// Draw initial flat waveform
drawWaveform();