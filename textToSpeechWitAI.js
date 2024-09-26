const axios = require('axios');
require('dotenv').config();

// פונקציה לשימוש ב-Wit.ai להמרת שמע לטקסט
async function transcribeAudioWit(media) {
    try {
        const response = await axios({
            method: 'POST',
            url: 'https://api.wit.ai/speech',
            headers: {
                'Authorization': `Bearer ${process.env.WIT_API_KEY}`,
                'Content-Type': 'audio/mpeg3' // עדכן בהתאם לפורמט הקובץ (MP3, WAV וכו')
            },
            data: Buffer.from(media.data, 'base64') // שליחת הקובץ כ-Buffer מ-base64
        });
        
        console.log('Wit.ai response:', response.data);
        return response.data.text; // מקבלים את הטקסט מתשובת Wit.ai
    } catch (error) {
        console.error('Error transcribing audio with Wit.ai:', error);
        throw error;
    }
}

module.exports = { transcribeAudioWit };
