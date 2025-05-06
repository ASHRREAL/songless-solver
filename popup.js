document.addEventListener('DOMContentLoaded', () => {
    const hostInput = document.getElementById('acrHost');
    const keyInput = document.getElementById('acrAccessKey');
    const secretInput = document.getElementById('acrAccessSecret');
    const saveButton = document.getElementById('saveButton');
    const statusDiv = document.getElementById('status');


    chrome.storage.local.get(['acrCloudCredentials'], (result) => {
        if (result.acrCloudCredentials) {
            hostInput.value = result.acrCloudCredentials.host || '';
            keyInput.value = result.acrCloudCredentials.accessKey || '';
            secretInput.value = result.acrCloudCredentials.accessSecret || '';
        } else {
            hostInput.value = 'identify-us-west-2.acrcloud.com';
        }
    });

    saveButton.addEventListener('click', () => {
        statusDiv.textContent = ''; 
        const credentials = {
            host: hostInput.value.trim(),
            accessKey: keyInput.value.trim(),
            accessSecret: secretInput.value.trim() 
        };

        chrome.storage.local.set({ acrCloudCredentials: credentials }, () => {
            if (chrome.runtime.lastError) {
                statusDiv.textContent = 'Error saving: ' + chrome.runtime.lastError.message;
                statusDiv.style.color = 'red';
            } else {
                statusDiv.textContent = 'Credentials saved successfully!';
                statusDiv.style.color = 'green';
                setTimeout(() => { 
                    statusDiv.textContent = ''; 
                    window.close(); 
                }, 2500);
            }
        });
    });
});