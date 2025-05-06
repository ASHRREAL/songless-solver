let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let recordingDuration = 100;
let lastAudioContext = null;
let streamDestination = null;
let connectedSourceNode = null;

function createMediaStreamDestination(audioContext) {
    if (!audioContext) return null;

    if (audioContext !== lastAudioContext || !streamDestination) {
        try {
            streamDestination = audioContext.createMediaStreamDestination();
            lastAudioContext = audioContext;
        } catch (e) {
            console.error("Error creating media stream destination:", e);
            return null;
        }
    }
    return streamDestination;
}

function startRecording(sourceNode, audioContext, duration) {
    if (isRecording) return;

    isRecording = true;
    recordingDuration = duration;

    const destination = createMediaStreamDestination(audioContext);
    if (!destination) {
        console.error("Failed to create media stream destination");
        isRecording = false;
        return;
    }

    if (connectedSourceNode && connectedSourceNode.context === audioContext) {
        try {
            connectedSourceNode.disconnect(destination);
        } catch (e) {
            console.error("Error disconnecting previous source node:", e);
        }
    }

    try {
        if (sourceNode.numberOfOutputs === 0 && !(sourceNode instanceof MediaElementAudioSourceNode)) {
            throw new Error("Cannot connect a node with 0 outputs");
        }

        sourceNode.connect(destination);
        connectedSourceNode = sourceNode;
    } catch (err) {
        console.error("Error connecting audio source:", err);
        isRecording = false;
        return;
    }

    const stream = destination.stream;
    try {
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm; codecs=opus' });
    } catch (e) {
        mediaRecorder = new MediaRecorder(stream); // fallback
    }

    audioChunks = [];
    mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
        isRecording = false;
        if (audioChunks.length === 0) {
            console.error("No audio recorded");
        } else {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => {
                console.log("Audio recorded:", reader.result);
            };
            reader.onerror = () => {
                console.error("Error reading audio blob");
            };
            reader.readAsDataURL(audioBlob);
        }

        if (connectedSourceNode) {
            try {
                connectedSourceNode.disconnect(destination);
                connectedSourceNode = null;
            } catch (e) {
                console.error("Error disconnecting source node:", e);
            }
        }
    };

    mediaRecorder.onerror = event => {
        isRecording = false;
        console.error("MediaRecorder error:", event.error || "Unknown");
        if (connectedSourceNode) {
            try {
                connectedSourceNode.disconnect(destination);
                connectedSourceNode = null;
            } catch (e) {
                console.error("Error disconnecting source node:", e);
            }
        }
    };

    mediaRecorder.start();
    setTimeout(() => {
        if (mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
    }, recordingDuration + 200);
}

function hookHowler() {
    if (window.Howler && window.Howler.prototype.play) {
        const originalPlay = window.Howler.prototype.play;

        window.Howler.prototype.play = function (...args) {
            const howlInstance = this;
            const sound = howlInstance._sounds?.find(s => s._paused === false || s.playing());
            const targetNode = sound?._node;

            if (targetNode && targetNode.context && !isRecording) {
                setTimeout(() => startRecording(targetNode, targetNode.context, recordingDuration), 50);
            }

            return originalPlay.apply(this, args);
        };
    }
}

if (window.AudioContext) {
    const originalCreateBufferSource = window.AudioContext.prototype.createBufferSource;

    window.AudioContext.prototype.createBufferSource = function (...args) {
        const bufferSourceNode = originalCreateBufferSource.apply(this, args);
        const currentAudioContext = this;

        bufferSourceNode.start = function (...startArgs) {
            if (!isRecording) {
                setTimeout(() => startRecording(bufferSourceNode, currentAudioContext, recordingDuration), 50);
            }

            return bufferSourceNode.start.apply(this, startArgs);
        };

        return bufferSourceNode;
    };
}

if (window.HTMLAudioElement) {
    const originalPlay = window.HTMLAudioElement.prototype.play;

    window.HTMLAudioElement.prototype.play = function (...args) {
        if (!isRecording && this.src) {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            try {
                const sourceNode = audioContext.createMediaElementSource(this);
                setTimeout(() => startRecording(sourceNode, audioContext, recordingDuration), 50);
            } catch (e) {
                console.error("Error setting up HTML5 audio capture:", e);
            }
        }
        return originalPlay.apply(this, args);
    };
}

setInterval(() => hookHowler(), 1500);

window.addEventListener("message", event => {
    if (event.data && event.data.type === "SET_RECORDING_DURATION") {
        recordingDuration = event.data.duration * 1000;
    }
});
