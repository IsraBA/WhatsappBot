// prepareMessage.js
require('dotenv').config();
const { CohereClient } = require("cohere-ai");

const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY,
});

// פונקציה להכנת הודעת הבוט שמבוססת על השיחה עד כה
async function prepareBotMessage(conversation, isNewConversation) {
    // יצירת כל ההודעות שהיו בשיחה עד כה עם ירידת שורה מסודרת בין המשתמש לבוט
    const conversationHistory = conversation.messages.map((msg, index) => {
        let sender = msg.sender.startsWith('בוט') ? 'bot' : msg.sender;
        let message = msg.message;

        // הסרת המחרוזת '*בוט:* ' מתחילת ההודעות של הבוט
        if (sender === 'bot') {
            message = message.replace(/^\*בוט:\* /, ''); // הסרת '*בוט:* ' אם היא בתחילת ההודעה
        } else {
            message = message.replace(/^בוט[,\s]+/, ''); // הסרת המילה "בוט" רק בתחילת ההודעה
        };

        return `${sender}: ${message}`;
    }).join('\n');

    const systemPrompt = `You are a WhatsApp group assistant bot. 
You must answer users' questions directly without any unnecessary information or greetings. 
Follow these strict instructions:
1. Do not include greetings (e.g., "Hello") or mention your role unless asked directly.
2. Provide concise answers that address only the question asked.
3. Respond in Hebrew unless the conversation is in another language.
4. If users explicitly ask how you work, explain that you are a WhatsApp bot and respond automatically to messages that start with "בוט". Do not provide this information unless asked directly.`;

    try {
        const fullPrompt = systemPrompt + '\n\nConversation:\n' + conversationHistory;
        console.log('fullPrompt :>> ', fullPrompt);
        // שליחת השיחה ל-Cohere לקבלת תשובה
        const response = await cohere.generate({
            model: 'command-xlarge-nightly',
            prompt: fullPrompt,
            max_tokens: 300, // מגביל את אורך התשובה
            temperature: 0.5 // מידת היצירתיות
        });

        // console.log('response :>> ', response);
        // קבלת התשובה מה-API
        const botReply = response.generations[0].text.trim();

        // החזרת השיחה כולה כולל התשובה האחרונה של הבוט
        return '*בוט:* ' + botReply;
    } catch (error) {
        console.error('Error communicating with Cohere API:', error);
        return '*בוט:* מצטער, יש בעיה עם התשובה כרגע.';
    }
}

module.exports = { prepareBotMessage };