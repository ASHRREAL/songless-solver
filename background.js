async function getAcrCloudCredentials() {
    return new Promise((resolve, reject) => {
        chrome.storage.local.get(['acrCloudCredentials'], (result) => {
            if (chrome.runtime.lastError) {
                return reject(chrome.runtime.lastError);
            }
            if (result.acrCloudCredentials &&
                result.acrCloudCredentials.host &&
                result.acrCloudCredentials.accessKey &&
                result.acrCloudCredentials.accessSecret) {
                resolve(result.acrCloudCredentials);
            } else {
                resolve(null);
            }
        });
    });
}

async function signStringWithHmacSha1(stringToSign, secretKey) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secretKey),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        enc.encode(stringToSign)
    );
    return btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "recognizeSong") {
        const { audioDataUri, duration } = request;

        // Asynchronously get credentials first
        getAcrCloudCredentials().then(credentials => {
            if (!credentials) {
                sendResponse({ error: "ACRCloud API credentials not configured. Please set them in the extension popup." });
                return;
            }

            const { host: ACRCLOUD_HOST, accessKey: ACRCLOUD_ACCESS_KEY, accessSecret: ACRCLOUD_ACCESS_SECRET } = credentials;

            fetch(audioDataUri)
                .then(res => res.blob())
                .then(async audioBlob => { 
                    const formData = new FormData();
                    formData.append('sample', audioBlob, 'recording.webm');
                    formData.append('access_key', ACRCLOUD_ACCESS_KEY);
                    formData.append('data_type', 'audio');
                    formData.append('sample_bytes', audioBlob.size);

                    const timestamp = String(Math.floor(Date.now() / 1000));
                    formData.append('timestamp', timestamp);
                    formData.append('signature_version', '1');

                    const httpMethod = "POST";
                    const httpUri = "/v1/identify";
                    const dataType = "audio"; 
                    const signatureVersion = "1"; 

                    const stringToSign = `${httpMethod}\n${httpUri}\n${ACRCLOUD_ACCESS_KEY}\n${dataType}\n${signatureVersion}\n${timestamp}`;

                    try {
                        const signature = await signStringWithHmacSha1(stringToSign, ACRCLOUD_ACCESS_SECRET);
                        formData.append('signature', signature);

                        const recognitionUrl = `https://${ACRCLOUD_HOST}/v1/identify`;

                        fetch(recognitionUrl, {
                            method: 'POST',
                            body: formData,
                        })
                        .then(response => response.json())
                        .then(data => {
                            if (data.status && data.status.code === 0 && data.metadata && data.metadata.music) {
                                const matches = data.metadata.music.map(song => ({
                                    title: song.title,
                                    artist: song.artists.map(a => a.name).join(', '),
                                    album: song.album ? song.album.name : 'N/A',
                                    score: song.score,
                                    external_ids: song.external_ids || {}
                                }));
                                sendResponse({ matches: matches });
                            } else if (data.status && data.status.msg) {
                                console.warn("ACRCloud API Response:", data.status.msg, "(Code:", data.status.code, ")");
                                let userMessage = `API Error: ${data.status.msg} (Code: ${data.status.code})`;
                                if (data.status.code === 1001 && duration < 3) { 
                                    userMessage = "Snippet too short. ACRCloud usually needs at least 3 seconds. Try again with a longer snippet.";
                                } else if (data.status.code === 2004 || data.status.code === 3000 || data.status.code === 3003 || data.status.code === 3015) {
                                    userMessage = "Recognition failed (No result). This song might not be in the database, or the snippet was unclear.";
                                } else if (data.status.code === 1004) { // Invalid access key
                                    userMessage = "Invalid ACRCloud Access Key. Please check your credentials in the extension popup.";
                                } else if (data.status.code === 1005 || data.status.code === 2002) { // Signature error or invalid access secret
                                    userMessage = "Invalid ACRCloud Access Secret or signature error. Please check your credentials.";
                                } else if (data.status.code === 2005) { // Server error
                                     userMessage = "ACRCloud server error. Please try again later.";
                                }
                                sendResponse({ error: userMessage });
                            } else {
                                console.warn("ACRCloud unexpected response:", data);
                                sendResponse({ error: "Unknown API error or unexpected response format from ACRCloud." });
                            }
                        })
                        .catch(error => {
                            console.error('Error during recognition fetch:', error);
                            sendResponse({ error: error.message || "Network error during recognition. Check ACRCloud Host in settings or your internet connection." });
                        });

                    } catch (signError) {
                        console.error('Error generating signature:', signError);
                        sendResponse({ error: "Failed to generate request signature. Check Access Secret." });
                    }
                })
                .catch(error => {
                    console.error('Error converting data URI to Blob:', error);
                    sendResponse({ error: error.message || "Failed to process audio data" });
                });
        }).catch(storageError => {
            console.error('Error fetching credentials from storage:', storageError);
            sendResponse({ error: "Could not retrieve API credentials from extension storage." });
        });

        return true; 
    }
});