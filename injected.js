let originalHowlPlay = null;
let mediaRecorder = null;
let audioChunks = [];
let recordingDurationMs = 100;
let mediaStreamDestinationForRecording = null;
let connectedSourceNodeForRecording = null;
let isCurrentlyRecording = false;
let lastUsedAudioContext = null;

function ensureMediaStreamDestination(audioCtx) {
    if (!audioCtx) return null;
    if (audioCtx !== lastUsedAudioContext || !mediaStreamDestinationForRecording) {
        try {
            mediaStreamDestinationForRecording = audioCtx.createMediaStreamDestination();
            lastUsedAudioContext = audioCtx;
        } catch (e) {
            return null;
        }
    }
    return mediaStreamDestinationForRecording;
}

function startRecording(sourceNodeToConnect, sourceAudioCtx, durationMs) {
    if (isCurrentlyRecording) return;
    if (!sourceNodeToConnect || !sourceAudioCtx) {
        window.postMessage({ type: "SONGLESS_SOLVER_AUDIO_DATA", error: "No audio source/context for recording.", duration: durationMs / 1000 }, "*");
        return;
    }

    isCurrentlyRecording = true;
    recordingDurationMs = durationMs;

    const localMediaStreamDestination = ensureMediaStreamDestination(sourceAudioCtx);
    if (!localMediaStreamDestination) {
        window.postMessage({ type: "SONGLESS_SOLVER_AUDIO_DATA", error: "Failed to ensure MediaStreamDestination for recording.", duration: recordingDurationMs / 1000 }, "*");
        isCurrentlyRecording = false;
        return;
    }

    if (connectedSourceNodeForRecording && connectedSourceNodeForRecording.context === sourceAudioCtx) {
        try {
            connectedSourceNodeForRecording.disconnect(localMediaStreamDestination);
        } catch (e) {}
    }

    try {
        if (sourceNodeToConnect.numberOfOutputs === 0 && !(sourceNodeToConnect instanceof MediaElementAudioSourceNode)) {
            if (sourceNodeToConnect === sourceAudioCtx.destination) {
                throw new Error("Cannot connect AudioContext.destination directly for recording.");
            }
            if (window.Howler && window.Howler.masterGain && window.Howler.masterGain.context === sourceAudioCtx) {
                sourceNodeToConnect = window.Howler.masterGain;
                if (sourceNodeToConnect.numberOfOutputs === 0) throw new Error("Howler's masterGain also has 0 outputs for connection.");
            } else {
                throw new Error("Cannot connect a node with 0 outputs for recording.");
            }
        }

        sourceNodeToConnect.connect(localMediaStreamDestination);
        connectedSourceNodeForRecording = sourceNodeToConnect;
    } catch (err) {
        window.postMessage({ type: "SONGLESS_SOLVER_AUDIO_DATA", error: `Audio stream connect error: ${err.message}`, duration: recordingDurationMs / 1000 }, "*");
        isCurrentlyRecording = false;
        return;
    }

    const stream = localMediaStreamDestination.stream;
    try {
        const options = { mimeType: 'audio/webm; codecs=opus', bitsPerSecond: 128000 };
        mediaRecorder = new MediaRecorder(stream, options);
    } catch (e) {
        mediaRecorder = new MediaRecorder(stream);
    }

    audioChunks = [];
    mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = () => {
        isCurrentlyRecording = false;
        if (audioChunks.length === 0) {
            const errorMsg = recordingDurationMs <= 100
                ? "audio clip too short"
                : "No audio data recorded (empty chunks).";
            window.postMessage({ type: "SONGLESS_SOLVER_AUDIO_DATA", error: errorMsg, duration: recordingDurationMs / 1000 }, "*");
        } else {
            const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            const reader = new FileReader();
            reader.onloadend = () => {
                window.postMessage({ type: "SONGLESS_SOLVER_AUDIO_DATA", audioDataUri: reader.result, duration: recordingDurationMs / 1000 }, "*");
            };
            reader.onerror = () => {
                window.postMessage({ type: "SONGLESS_SOLVER_AUDIO_DATA", error: "FileReader error on blob.", duration: recordingDurationMs / 1000 }, "*");
            };
            reader.readAsDataURL(audioBlob);
        }

        if (connectedSourceNodeForRecording && localMediaStreamDestination) {
            try {
                connectedSourceNodeForRecording.disconnect(localMediaStreamDestination);
                connectedSourceNodeForRecording = null;
            } catch (e) {}
        }
    };

    mediaRecorder.onerror = (event) => {
        isCurrentlyRecording = false;
        window.postMessage({ type: "SONGLESS_SOLVER_AUDIO_DATA", error: `MediaRecorder error: ${event.error ? event.error.name : "Unknown"}`, duration: recordingDurationMs / 1000 }, "*");
        if (connectedSourceNodeForRecording && localMediaStreamDestination) {
            try {
                connectedSourceNodeForRecording.disconnect(localMediaStreamDestination);
                connectedSourceNodeForRecording = null;
            } catch (e) {}
        }
    };

    mediaRecorder.start();
    window.postMessage({ type: "SONGLESS_SOLVER_RECORDING_STARTED" }, "*");

    setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
    }, recordingDurationMs + 200);
}

function tryHookHowler() {
    if (window.Howler && window.Howler.prototype && typeof window.Howler.prototype.play === 'function') {
        if (originalHowlPlay && originalHowlPlay !== window.Howler.prototype.play) {
        } else if (originalHowlPlay) {
            return true;
        }
        originalHowlPlay = window.Howler.prototype.play;
        window.Howler.prototype.play = function (...args) {
            const howlInstance = this;
            const sound = howlInstance._sounds && howlInstance._sounds.find(s => s._paused === false || s.playing());
            const targetSoundNode = sound && sound._node;

            if (targetSoundNode && targetSoundNode.context && !isCurrentlyRecording && recordingDurationMs > 0) {
                setTimeout(() => startRecording(targetSoundNode, targetSoundNode.context, recordingDurationMs), 50);
            } else if (howlInstance === window.Howler && window.Howler.masterGain && !isCurrentlyRecording && recordingDurationMs > 0) {
                setTimeout(() => startRecording(window.Howler.masterGain, window.Howler.ctx, recordingDurationMs), 50);
            }
            return originalHowlPlay.apply(this, args);
        };
        return true;
    }
    return false;
}

if (window.AudioContext && window.AudioContext.prototype) {
    const originalCreateBufferSource = window.AudioContext.prototype.createBufferSource;
    window.AudioContext.prototype.createBufferSource = function (...args) {
        const bufferSourceNode = originalCreateBufferSource.apply(this, args);
        const originalBufferSourceStart = bufferSourceNode.start;
        const currentAudioContext = this;
        bufferSourceNode.start = function (...startArgs) {
            if (window.Howler && window.Howler.ctx === currentAudioContext && originalHowlPlay) {
            } else if (!isCurrentlyRecording && recordingDurationMs > 0) {
                setTimeout(() => startRecording(this, currentAudioContext, recordingDurationMs), 50);
            }
            return originalBufferSourceStart.apply(this, startArgs);
        };
        return bufferSourceNode;
    };
}

if (window.HTMLAudioElement && window.HTMLAudioElement.prototype) {
    const originalAudioElementPlay = window.HTMLAudioElement.prototype.play;
    window.HTMLAudioElement.prototype.play = function (...args) {
        if (!isCurrentlyRecording && recordingDurationMs > 0 && this.src) {
            const audioCtxForHtml5 = new (window.AudioContext || window.webkitAudioContext)();
            try {
                const sourceNode = audioCtxForHtml5.createMediaElementSource(this);
                setTimeout(() => startRecording(sourceNode, audioCtxForHtml5, recordingDurationMs), 50);
            } catch (e) {
                window.postMessage({ type: "SONGLESS_SOLVER_AUDIO_DATA", error: `HTML5 audio capture setup error: ${e.message}`, duration: recordingDurationMs / 1000 }, "*");
            }
        }
        return originalAudioElementPlay.apply(this, args);
    };
}

const hookInterval = setInterval(() => {
    tryHookHowler();
}, 1500);

window.addEventListener("message", (event) => {
    if (event.source === window && event.data && event.data.type === "SONGLESS_SOLVER_SET_DURATION") {
        recordingDurationMs = event.data.duration * 1000;
    }
});