const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/chat', async (req, res) => {
    try {
        const { message, emotion, emotionName, conversationHistory } = req.body;
        
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        let historyContext = "";
        if (conversationHistory && conversationHistory.length > 0) {
            historyContext = "Previous conversation:\n";
            conversationHistory.forEach(msg => {
                historyContext += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
            });
        }
        
        const prompt = `
        You are EMO AI, an emotion-aware AI assistant. The user is currently feeling ${emotionName} (${emotion}).
        
        ${historyContext}
        
        Current user message: "${message}"
        
        Please respond appropriately to the user's emotional state. Be empathetic, supportive, and engaging.
        Keep your response concise (1-10 sentences maximum).
        Respond naturally as if you're having a conversation.
        `;
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const aiResponse = response.text().trim();
        
        res.json({ response: aiResponse });
        
    } catch (error) {
        console.error('Error calling Gemini API:', error);
        
        // Fallback response if API call fails
        const fallbackResponses = {
            happy: "I'm glad you're feeling happy! What would you like to talk about? 😊",
            sad: "I'm here for you. Would you like to talk about what's on your mind? 💙",
            angry: "I sense you're little angry. Would it help to talk about what's bothering you? 🔥",
            surprise: "You seem surprised! What happened? 😲",
            fear: "It's okay to feel anxious sometimes. I'm here to listen. 🌫️",
            disgust: "You seem displeased. Want to talk about what's bothering you? 🤢",
            neutral: "How's your day going? What would you like to talk about? 🍃"
        };
        
        res.json({ 
            response: fallbackResponses[req.body.emotion] || fallbackResponses.neutral 
        });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server is running' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});