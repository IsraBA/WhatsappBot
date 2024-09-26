require('dotenv').config();

const { AssemblyAI } = require('assemblyai');

const assemblyClient = new AssemblyAI({ apiKey: process.env.API_KEY_ASSEMBLYAI });

// פונקציה לשימוש ב-AssemblyAI
async function transcribeAudio(mediaUrl) {
    try {
        const config = {
            audio_url: mediaUrl
        };
        const transcript = await assemblyClient.transcripts.transcribe(config);
        return transcript.text; // תמלול ההודעה הקולית
    } catch (error) {
        console.error('Error transcribing audio:', error);
        throw error;
    }
};

module.exports = { transcribeAudio };