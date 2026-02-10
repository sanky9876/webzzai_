const { GoogleGenerativeAI } = require('@google/generative-ai');

// Hardcode key for test since it's already in our context/env
const genAI = new GoogleGenerativeAI('AIzaSyA9U8Jn9aNv3AKHcWjrX8Rp1R4X2-RwpGg');

async function listModels() {
    try {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyA9U8Jn9aNv3AKHcWjrX8Rp1R4X2-RwpGg');
        const data = await response.json();
        if (data.models) {
            console.log('Available Models (Names only):');
            data.models.forEach(m => {
                if (m.name.includes('gemini')) {
                    console.log(m.name);
                }
            });
        } else {
            console.log('No models found or error:', data);
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

listModels();
