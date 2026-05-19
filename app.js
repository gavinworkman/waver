// Grab elements from the DOM
const audioPlayer = document.getElementById('audio-player');
const playBtn = document.getElementById('btn-play');
const canvas = document.getElementById('waveform-canvas');
const ctx = canvas.getContext('2d');

// Variables for the Web Audio API
let audioContext;
let analyser;
let source;
let isPlaying = false;

// Function to initialize the audio analyzer (Must be done after user clicks play)
function initAudio() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256; // Defines how many bars we get

        source = audioContext.createMediaElementSource(audioPlayer);
        source.connect(analyser);
        analyser.connect(audioContext.destination);

        // Adjust canvas size to match its CSS size
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
    }
}

// The loop that draws the dancing bars
function drawWaveform() {
    requestAnimationFrame(drawWaveform);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Clear the canvas for the next frame
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;

    // Draw each bar based on the frequency data
    for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2; // Scale the height down a bit

        // Draw the bar in stark white
        ctx.fillStyle = '#fff';
        
        // Draw from the center going up and down (to match your mockup)
        const y = (canvas.height / 2) - (barHeight / 2);
        ctx.fillRect(x, y, barWidth - 1, barHeight);

        x += barWidth;
    }
}

// Play/Pause button logic
playBtn.addEventListener('click', () => {
    initAudio(); // Required by browsers to start audio context on user gesture
    
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }

    if (isPlaying) {
        audioPlayer.pause();
        playBtn.innerText = '▶';
    } else {
        audioPlayer.play();
        playBtn.innerText = '⏸';
        drawWaveform(); // Start the animation loop
    }
    
    isPlaying = !isPlaying;
});