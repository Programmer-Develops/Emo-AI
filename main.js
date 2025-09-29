const emotionColors = {
    'angry': '#ff4757',
    'disgust': '#2ed573',
    'fear': '#a55eea',
    'happy': '#fbc531',
    'sad': '#3498db',
    'surprise': '#ff9f43',
    'neutral': '#dfe6e9',
    'no_face': '#dfe6e9',
    'error': '#ff4757'
};

const emotionNames = {
    'angry': 'Angry',
    'disgust': 'Disgust',
    'fear': 'Fear',
    'happy': 'Happy',
    'sad': 'Sad',
    'surprise': 'Surprise',
    'neutral': 'Neutral',
    'no_face': 'No Face Detected',
    'error': 'Detection Error'
};

const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('start-btn');
const resetBtn = document.getElementById('reset-btn');
const currentEmotionEl = document.getElementById('current-emotion');
const confidenceEl = document.getElementById('confidence');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const emotionBars = document.getElementById('emotion-bars');
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

let emotionHistory = [];
let isDetecting = false;
let stableEmotion = null;
let currentEmotion = 'neutral';
let progress = 0;
let ctx = null;
let detectingInterval = null;
let videoReady = false;

// Detection parameters
const CONFIDENCE_THRESHOLD = 60;
const MIN_EMOTION_DURATION = 1500;
const SMOOTHING_FACTOR = 0.7;
let lastEmotionChangeTime = 0;
let emotionConfidences = {};

let lastBotMessage = "";
let hasWelcomed = false;
let conversationHistory = [];
let isWaitingForAIResponse = false;

const API_URL = "http://localhost:5000/api/detect_emotion";
const AI_API_URL = "http://localhost:3001/api/chat";

function initEmotionConfidences() {
    for (const emotion of Object.keys(emotionColors)) {
        emotionConfidences[emotion] = 0;
    }
}

function initEmotionBars() {
    emotionBars.innerHTML = '';
    for (const emotion of Object.keys(emotionColors)) {
        if (emotion === 'no_face' || emotion === 'error') continue;
        
        const barDiv = document.createElement('div');
        barDiv.className = 'emotion-bar';
        barDiv.innerHTML = `
            <div class="emotion-name">${emotionNames[emotion]}</div>
            <div class="emotion-bar-inner">
                <div class="emotion-bar-fill" id="${emotion}-bar" style="width: 0%; background: ${emotionColors[emotion]}"></div>
            </div>
            <div class="emotion-value" id="${emotion}-value">0%</div>
        `;
        emotionBars.appendChild(barDiv);
    }
}

async function setupVideo() {
    try {
        statusEl.textContent = "Requesting camera access...";
        
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 640 },
                height: { ideal: 480 }
            } 
        });
        
        video.srcObject = stream;
        
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx = canvas.getContext('2d', { willReadFrequently: true });
                videoReady = true;
                statusEl.textContent = "Camera ready. Click Start Detection.";
                resolve();
            };
        });
        
        return true;
    } catch (err) {
        console.error("Error accessing webcam:", err);
        statusEl.textContent = "Error accessing camera. Please check permissions.";
        return false;
    }
}

async function detectEmotion() {
    if (!ctx || !videoReady || canvas.width === 0 || canvas.height === 0) {
        return null;
    }
    
    try {
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();
        
        const imageData = canvas.toDataURL('image/jpeg', 0.7);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                image: imageData
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }
        
        const result = await response.json();
        
        if (result.error) {
            throw new Error(result.error);
        }
        
        return {
            emotion: result.emotion,
            confidence: result.confidence,
            emotions: result.emotions,
            color: result.color
        };
        
    } catch (error) {
        console.error("Error in detectEmotion:", error);
        
        // Show error in status
        if (error.name === 'AbortError') {
            statusEl.textContent = "Request timeout - try again";
        } else {
            statusEl.textContent = "API error - check console";
        }
        
        return {
            emotion: 'error',
            confidence: 0,
            emotions: {},
            color: '#ff4757',
            error: error.message
        };
    }
}

// Update emotion display
function updateEmotionDisplay(emotion, confidence, emotions, color) {
    currentEmotion = emotion;
    currentEmotionEl.textContent = emotionNames[emotion] || emotion;
    currentEmotionEl.style.color = color || emotionColors[emotion] || '#ffffff';
    
    if (emotion === 'no_face') {
        confidenceEl.textContent = 'Please position your face in the camera';
    } else if (emotion === 'error') {
        confidenceEl.textContent = 'Detection error - try again';
    } else {
        confidenceEl.textContent = `${confidence.toFixed(1)}% confidence`;
    }
    
    // Update emotion bars
    for (const [e, value] of Object.entries(emotions)) {
        const bar = document.getElementById(`${e}-bar`);
        const valueEl = document.getElementById(`${e}-value`);
        
        if (bar && valueEl) {
            bar.style.width = `${value}%`;
            valueEl.textContent = `${value.toFixed(1)}%`;
        }
    }
    
    // Add to emotion history (only if a face was detected)
    if (emotion !== 'no_face' && emotion !== 'error') {
        emotionHistory.push(emotion);
    }
    
    if (emotionHistory.length > 15) {
        emotionHistory.shift();
    }
    
    // Check if we have a stable emotion for 3 seconds
    checkStableEmotion();
}

// Check for stable emotion
function checkStableEmotion() {
    if (emotionHistory.length < 5) return;
    
    // Count occurrences of each emotion in history
    const counts = {};
    for (const emotion of emotionHistory) {
        counts[emotion] = (counts[emotion] || 0) + 1;
    }
    
    // Find the most frequent emotion
    let maxCount = 0;
    let mostFrequent = null;
    
    for (const [emotion, count] of Object.entries(counts)) {
        if (count > maxCount) {
            maxCount = count;
            mostFrequent = emotion;
        }
    }
    
    // If we have a consistent emotion for at least 60% of readings
    if (maxCount >= emotionHistory.length * 0.6) {
        progress += 0.33;
        
        if (progress >= 3) {
            // Only update if the emotion has changed
            if (stableEmotion !== mostFrequent) {
                stableEmotion = mostFrequent;
                
                // Send welcome message only once
                if (!hasWelcomed && stableEmotion !== 'no_face') {
                    generateAIResponse(`The user appears to be feeling ${emotionNames[stableEmotion]}. Introduce yourself as an emotion-aware AI assistant and ask how you can help. Keep it brief.`);
                    hasWelcomed = true;
                }
                
                userInput.disabled = stableEmotion === 'no_face';
                sendBtn.disabled = stableEmotion === 'no_face';
                statusEl.textContent = stableEmotion === 'no_face' 
                    ? "No face detected" 
                    : `Detected emotion: ${emotionNames[stableEmotion]}`;
            }
            progress = 3;
        }
    } else {
        // Reset progress if emotion is not consistent
        progress = Math.max(0, progress - 0.2);
    }
    
    // Update progress bar and text
    progressBar.style.width = `${(progress / 3) * 100}%`;
    progressText.textContent = `Detecting stable emotion (${progress.toFixed(1)}s/3s)`;
}

// Add message to chat
function addChatMessage(sender, text) {
    // Don't add the same message consecutively
    if (sender === "bot" && text === lastBotMessage) {
        return;
    }
    
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(sender === 'user' ? 'user-message' : 'bot-message');
    messageDiv.textContent = text;
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Store the last bot message
    if (sender === "bot") {
        lastBotMessage = text;
    }
    
    // Add to conversation history
    conversationHistory.push({
        role: sender === 'user' ? 'user' : 'assistant',
        content: text
    });
    
    // Keep conversation history manageable
    if (conversationHistory.length > 10) {
        conversationHistory = conversationHistory.slice(-10);
    }
}

// Generate AI response using Gemini API via proxy
async function generateAIResponse(userMessage) {
    const typingIndicator = document.createElement('div');
    typingIndicator.id = 'typing-indicator';
    typingIndicator.textContent = "EMO AI is thinking...";
    typingIndicator.classList.add('message', 'bot-message');
    chatMessages.appendChild(typingIndicator);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    try {
        const response = await fetch(AI_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                message: userMessage,
                emotion: stableEmotion,
                emotionName: emotionNames[stableEmotion],
                conversationHistory: conversationHistory.slice(-6) // Last 6 messages for context
            })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        const aiResponse = data.response;
        
        document.getElementById('typing-indicator')?.remove();
        
        addChatMessage("bot", aiResponse);
        
    } catch (error) {
        console.error("Error calling AI API:", error);
        
        document.getElementById('typing-indicator')?.remove();

        const fallbackResponse = generateFallbackResponse(userMessage);
        addChatMessage("bot", fallbackResponse);
    }
}

// Fallback response generator if API fails
function generateFallbackResponse(userMessage) {
    const responses = {
        happy: [
            "It's wonderful to see you so happy! What's bringing you joy today? 😊",
            "Your positive energy is contagious! Tell me more about what's making you smile. 🌟",
            "I love seeing you this happy! Would you like to share what's going well? 🎉"
        ],
        sad: [
            "I'm here for you. Would you like to talk about what's making you feel down? 💙",
            "It's okay to feel sad sometimes. I'm listening if you want to share what's on your mind. 🌧️",
            "I sense you're having a tough time. Remember that I'm here to support you. 🫂"
        ],
        angry: [
            "I can see you're upset. Would it help to talk about what's frustrating you? 🔥",
            "Anger is a valid emotion. Want to discuss what's triggering these feelings? ⚡",
            "I notice you're angry. Sometimes expressing it can help - want to talk about it? 💢"
        ],
        surprise: [
            "You seem surprised! Did something unexpected happen? 😲",
            "I detect surprise! Care to share what caught you off guard? 🤩",
            "You look surprised! Is there something new or unexpected happening? 🎭"
        ],
        fear: [
            "It seems like you're feeling anxious. Would it help to talk about what's worrying you? 😰",
            "I sense some fear or anxiety. Remember, you're safe here. Want to discuss what's troubling you? 🌫️",
            "I notice you're feeling fearful. Sometimes sharing our concerns can make them feel more manageable. 🫂"
        ],
        neutral: [
            "You seem calm and neutral. How's your day going? 🍃",
            "I detect a neutral mood. What's on your mind today? 💭",
            "You appear balanced and calm. Is there anything you'd like to talk about? 🌊"
        ],
        disgust: [
            "You seem displeased with something. Want to talk about what's bothering you? 🤢",
            "I sense some disapproval. Care to share what's causing this reaction? 😖",
            "You appear to be feeling disgusted. Is there something specific that's triggering this feeling? 🙅"
        ]
    };
    
    const emotionResponses = responses[stableEmotion] || responses['neutral'];
    const availableResponses = emotionResponses.filter(response => response !== lastBotMessage);
    
    return availableResponses.length > 0 
        ? availableResponses[Math.floor(Math.random() * availableResponses.length)]
        : emotionResponses[Math.floor(Math.random() * emotionResponses.length)];
}

async function startDetection() {
    if (isDetecting) return;
    
    startBtn.innerHTML = '<div class="spinner"></div> Loading...';
    startBtn.disabled = true;
    
    // Initialize
    if (!videoReady) {
        const videoReady = await setupVideo();
        if (!videoReady) {
            startBtn.textContent = 'Start Detection';
            startBtn.disabled = false;
            return;
        }
    }
    
    isDetecting = true;
    startBtn.textContent = 'Detecting...';
    emotionHistory = [];
    progress = 0;
    stableEmotion = null;
    currentEmotion = 'neutral';
    userInput.disabled = true;
    sendBtn.disabled = true;
    statusEl.textContent = "Detecting emotions...";
    lastEmotionChangeTime = Date.now();
    initEmotionConfidences();
    
    detectingInterval = setInterval(async () => {
        const result = await detectEmotion();
        if (result) {
            updateEmotionDisplay(result.emotion, result.confidence, result.emotions, result.color);
        }
    }, 1000); // Detect every second to avoid overloading the API
}

// Reset detection
function resetDetection() {
    clearInterval(detectingInterval);
    isDetecting = false;
    startBtn.textContent = 'Start Detection';
    startBtn.disabled = false;
    currentEmotionEl.textContent = 'Neutral';
    currentEmotionEl.style.color = emotionColors['neutral'];
    confidenceEl.textContent = '0% confidence';
    progressBar.style.width = '0%';
    progressText.textContent = 'Detecting stable emotion (0s/3s)';
    emotionHistory = [];
    progress = 0;
    stableEmotion = null;
    currentEmotion = 'neutral';
    userInput.disabled = true;
    sendBtn.disabled = true;
    statusEl.textContent = "Ready to detect emotions";
    lastEmotionChangeTime = Date.now();
    initEmotionConfidences();
    hasWelcomed = false;
    lastBotMessage = "";
    conversationHistory = [];
    isWaitingForAIResponse = false;
    
    // Clear chat except the first message
    const initialMessage = chatMessages.querySelector('.bot-message');
    chatMessages.innerHTML = '';
    if (initialMessage) {
        chatMessages.appendChild(initialMessage);
    }
    
    // Reset emotion bars
    for (const emotion of Object.keys(emotionColors)) {
        if (emotion === 'no_face' || emotion === 'error') continue;
        
        const bar = document.getElementById(`${emotion}-bar`);
        const valueEl = document.getElementById(`${emotion}-value`);
        
        if (bar && valueEl) {
            bar.style.width = '0%';
            valueEl.textContent = '0%';
        }
    }
}

function handleSend() {
    if (isWaitingForAIResponse) return;
    
    const message = userInput.value.trim();
    if (!message) return;
    
    addChatMessage('user', message);
    userInput.value = '';
    
    isWaitingForAIResponse = true;
    sendBtn.disabled = true;
    
    generateAIResponse(message);
    
    setTimeout(() => {
        isWaitingForAIResponse = false;
        sendBtn.disabled = false;
    }, 3000);
}

startBtn.addEventListener('click', startDetection);
resetBtn.addEventListener('click', resetDetection);
sendBtn.addEventListener('click', handleSend);
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSend();
});

initEmotionBars();
initEmotionConfidences();

window.addEventListener('load', () => {
    setupVideo();
});