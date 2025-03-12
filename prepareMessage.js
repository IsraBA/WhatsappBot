// prepareMessage.js
require('dotenv').config();
const { CohereClientV2 } = require("cohere-ai");

const cohere = new CohereClientV2({
    token: process.env.COHERE_API_KEY,
});

// פונקציה להכנת הודעת הבוט שמבוססת על השיחה עד כה
async function prepareBotMessage(conversation, isNewConversation) {
    const messages = [];

    // הוספת הנחיית מערכת
    //     messages.push({
    //         role: 'system',
    //         content: `You are a WhatsApp group assistant bot.
    // You must answer users' questions directly without any unnecessary information or greetings.
    // Follow these strict instructions:
    // 1. Do not include greetings (e.g., "Hello") or mention your role unless asked directly.
    // 2. Provide concise answers that address only the question asked.
    // 3. Respond in Hebrew unless the conversation is in another language.
    // 4. If users explicitly ask how you work, explain that you are a WhatsApp bot and respond automatically to messages that start with "בוט". Do not provide this information unless asked directly.`
    //     });
    messages.push({
        role: 'system',
        content: `Your maximum answer length is 140 words.`
    });

    // יצירת כל ההודעות שהיו בשיחה עד כה 
    // היסטוריית שיחה בפורמט messages
    for (const msg of conversation.messages) {
        let role = msg.sender.startsWith('בוט') ? 'chatbot' : 'user';
        let content = msg.message;

        // ניקוי טקסט
        if (role === 'chatbot') {
            content = content.replace(/^\*בוט:\* /, '');
        } else {
            content = content.replace(/^בוט[,\s]+/, '');
            content = `[${msg.sender}] ${content}`;
        }


        messages.push({ role, content });
    };

    try {
        console.log('messages :>> ', messages);
        // שליחת השיחה ל-Cohere לקבלת תשובה
        const response = await cohere.chat({
            model: 'command-r-plus',
            messages,
            temperature: 1,
            max_tokens: 300
        });
        console.dir(response, { depth: null, colors: true });
        // קבלת התשובה מה-API
        const botReply = response.message.content
            ?.find(part => part.type === 'text')
            ?.text
            ?.trim() || 'מצטער, לא הצלחתי להפיק תשובה.';

        // החזרת השיחה כולה כולל התשובה האחרונה של הבוט
        return '*בוט:* ' + botReply;
    } catch (error) {
        console.error('Error communicating with Cohere API:', error);
        return '*בוט:* מצטער, יש בעיה עם התשובה כרגע.';
    }
}

module.exports = { prepareBotMessage };