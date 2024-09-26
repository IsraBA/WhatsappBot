const axios = require('axios');
require('dotenv').config();

// פונקציה לשימוש ב-Deepgram להמרת שמע לטקסט
async function transcribeAudioDeepgram(media) {
    try {
        // המרת ה-base64 ל-buffer ושימוש ב-axios לשליחת הבקשה ל-Deepgram
        const response = await axios.post('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true', 
        Buffer.from(media.data, 'base64'), // המרת base64 ל-buffer
        {
            headers: {
                'Authorization': `Token ${process.env.DEEPGRAM_API_KEY}`,
                'Content-Type': 'application/octet-stream' // יש לשלוח את קובץ השמע כ-binary
            }
        });

        return response.data.results.channels[0].alternatives[0].transcript; // מקבל את התמלול
    } catch (error) {
        console.error('Error transcribing audio with Deepgram:', error);
        throw error;
    }
}

module.exports = { transcribeAudioDeepgram };
