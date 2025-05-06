let resultsDiv;
let statusDiv;
let currentStageDuration = 0.1;

const s = document.createElement('script');
s.src = chrome.runtime.getURL('injected.js');
s.onload = function() { this.remove(); };
(document.head || document.documentElement).appendChild(s);

function createUI() {
    if (document.getElementById("songless-solver-ui")) {
        return;
    }

    statusDiv = document.createElement('div');
    statusDiv.id = "songless-status-div";
    statusDiv.innerHTML = "<i>Waiting for song to play...</i>";

    resultsDiv = document.createElement('div');
    resultsDiv.id = "songless-results-div";

    const uiContainer = document.createElement('div');
    uiContainer.id = "songless-solver-ui";
    uiContainer.appendChild(statusDiv);
    uiContainer.appendChild(resultsDiv);

    let attempts = 0;
    const maxAttempts = 30;
    const intervalId = setInterval(() => {
        attempts++;
        let insertionPoint = null;
        let parentToInsertInto = null;

        const searchInput = document.querySelector('input[placeholder="Know it? Search for the title"]');
        if (searchInput && searchInput.parentElement && searchInput.parentElement.parentElement) {
            parentToInsertInto = searchInput.parentElement.parentElement;
            insertionPoint = searchInput.parentElement.nextSibling;
        }

        if (!parentToInsertInto) {
            const submitButton = Array.from(document.querySelectorAll('button.chakra-button')).find(btn => btn.textContent.trim() === "Submit");
            if (submitButton && submitButton.parentElement && submitButton.parentElement.parentElement) {
                 parentToInsertInto = submitButton.parentElement.parentElement;
                 insertionPoint = submitButton.parentElement.nextSibling;
            }
        }
        
        if (!parentToInsertInto) {
            parentToInsertInto = document.querySelector('.css-15v5v82');
            insertionPoint = null; 
        }

        if (parentToInsertInto) {
            if (insertionPoint) {
                parentToInsertInto.insertBefore(uiContainer, insertionPoint);
            } else {
                parentToInsertInto.appendChild(uiContainer);
            }
            clearInterval(intervalId);
            initializeStageObserver();
        } else if (attempts >= maxAttempts) {
            clearInterval(intervalId);
            const appRoot = document.getElementById('__next') || document.body;
            if (appRoot) {
                 appRoot.appendChild(uiContainer);
                 initializeStageObserver();
            }
        }
    }, 500);
}

function initializeStageObserver() {
    const stageObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            const durationElements = document.querySelectorAll('.chakra-text.css-qmn8d1 + .chakra-text.css-1d43xg9');
            if (durationElements.length > 0) {
                const durationElement = durationElements[durationElements.length - 1];
                 if (durationElement && durationElement.parentElement && durationElement.parentElement.className.includes('css-1kjx7mh')) {
                    const durationText = durationElement.textContent;
                    const durationMatch = durationText.match(/([\d.]+)\s*Seconds/);
                    if (durationMatch && durationMatch[1]) {
                        const newDuration = parseFloat(durationMatch[1]);
                        if (newDuration !== currentStageDuration) {
                            currentStageDuration = newDuration;
                            window.postMessage({ type: "SONGLESS_SOLVER_SET_DURATION", duration: currentStageDuration }, "*");
                            if (statusDiv) {
                                if (currentStageDuration < 1.0) {
                                    statusDiv.innerHTML = `<i>Snippet too short (${currentStageDuration}s). Waiting...</i>`;
                                } else {
                                    statusDiv.innerHTML = "<i>Waiting for song to play...</i>";
                                }
                            }
                            if (resultsDiv) resultsDiv.innerHTML = "";
                        }
                    }
                }
            }
        });
    });
    const gameAreaWrapper = document.querySelector('.css-kzln0j');
    if (gameAreaWrapper) {
        stageObserver.observe(gameAreaWrapper, { childList: true, subtree: true, characterData: true });
        if (statusDiv) {
            if (currentStageDuration < 1.0) {
                statusDiv.innerHTML = `<i>Snippet too short (${currentStageDuration}s). Waiting...</i>`;
            } else {
                statusDiv.innerHTML = "<i>Waiting for song to play...</i>";
            }
        }
        window.postMessage({ type: "SONGLESS_SOLVER_SET_DURATION", duration: currentStageDuration }, "*");
    }
}

window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || !event.data.type) return;

    if (event.data.type === "SONGLESS_SOLVER_RECORDING_STARTED") {
        if (statusDiv) statusDiv.innerHTML = `<i>Recognizing ${currentStageDuration}s snippet...</i>`;
        if (resultsDiv) resultsDiv.innerHTML = "";
    } else if (event.data.type === "SONGLESS_SOLVER_AUDIO_DATA") {
        const { audioDataUri, duration, error: injectedError } = event.data;

        if (injectedError) {
            if (statusDiv) statusDiv.innerHTML = `<p style="color:red;">Audio Capture Error</p>`;
            if (resultsDiv) resultsDiv.innerHTML = `<p style="color:orange; font-size: small;">${injectedError}</p>`;
            return;
        }
        if (!audioDataUri) {
             if (statusDiv) {
                if (currentStageDuration < 1.0) {
                     statusDiv.innerHTML = `<p style="color:orange;">Capture Failed (snippet likely too short)</p>`;
                } else {
                    statusDiv.innerHTML = `<p style="color:red;">No Audio Data Captured</p>`;
                }
            }
            return;
        }

        if (statusDiv) statusDiv.innerHTML = "<i>Sending for recognition...</i>";
        chrome.runtime.sendMessage(
            { action: "recognizeSong", audioDataUri: audioDataUri, duration: duration },
            response => {
                if (chrome.runtime.lastError) {
                    if (statusDiv) statusDiv.innerHTML = `<p style="color:red;">Extension Error</p>`;
                    if (resultsDiv) resultsDiv.innerHTML = `<p style="color:orange; font-size: small;">${chrome.runtime.lastError.message}</p>`;
                    return;
                }
                if (response && response.error) {
                     if (statusDiv) statusDiv.innerHTML = `<p style="color:orange;">Recognition Attempt Failed</p>`;
                    if (resultsDiv) resultsDiv.innerHTML = `<p style="color:orange; font-size: small;">${response.error}</p>`;
                } else if (response && response.matches && response.matches.length > 0) {
                    if (statusDiv) statusDiv.innerHTML = "Potential Matches:";
                    displayResults(response.matches);
                } else {
                    if (statusDiv) statusDiv.innerHTML = "No Matches Found";
                    if (resultsDiv) resultsDiv.innerHTML = `<p>No matches found for ${currentStageDuration}s snippet.</p>`;
                }
            }
        );
    }
});

function displayResults(matches) {
    if (!resultsDiv) return;
    if (!matches || matches.length === 0) {
        resultsDiv.innerHTML = "<p>No strong matches found.</p>";
        return;
    }
    let html = "<ul>";
    matches.forEach(match => {
        const probability = match.score ? (match.score / 100).toFixed(2) : "N/A";
        const safeTitle = (match.title || "Unknown Title").replace(/"/g, "");
        const safeArtist = (match.artist || 'Unknown Artist').replace(/"/g, "");

       html += `<li class="songless-result-item" data-title="${safeTitle}" data-artist="${safeArtist}">
                    🎵 <strong>${safeTitle}</strong> by ${safeArtist}
                    (Prob: ${probability})
                 </li>`;
    });
    html += "</ul>";
    resultsDiv.innerHTML = html;

    document.querySelectorAll('.songless-result-item').forEach(item => {
        item.onclick = () => {
            const title = item.dataset.title;
            const searchInput = document.querySelector('input.chakra-input.css-ktznyb');
            if (searchInput) {
                searchInput.value = title;
                const event = new Event('input', { bubbles: true });
                searchInput.dispatchEvent(event);
            }
        };
    });
}

createUI();