require('dotenv').config();
const { CohereClient } = require("cohere-ai");
const cohere = new CohereClient({
    token: process.env.COHERE_API_KEY,
});

// פונקציה להכנת הודעת הבוט שמבוססת על השיחה עד כה
async function prepareBotMessage(conversation, isNewConversation) {
    // יצירת כל ההודעות שהיו בשיחה עד כה עם ירידת שורה מסודרת בין המשתמש לבוט
    const conversationHistory = conversation.messages.map((msg, index) => {
        let sender = msg.sender === 'בוט' ? 'bot' : msg.sender;
        let message = msg.message;

        // אם השיחה חדשה וההודעה הראשונה היא של המשתמש, נסיר את המילה הראשונה (הטריגר)
        if (isNewConversation && index === 0 && sender === 'user') {
            message = message.split(' ').slice(1).join(' '); // הסרת המילה הראשונה
        }
        // הסרת המחרוזת '*בוט:* ' מתחילת ההודעות של הבוט
        if (sender === 'bot') {
            message = message.replace(/^\*בוט:\* /, ''); // הסרת '*בוט:* ' אם היא בתחילת ההודעה
        }

        return `${sender}: ${message}`;
    }).join('\n');

    const systemPrompt = `General instructions for your answers: This is a WhatsApp group chat, your job is to help the users and answer them politely and nicely, try not to answer in a long way and the longest you can answer is up to three paragraphs (something like a maximum of 300 words), in any case it is better not to answer at length from. Answer in Hebrew unless they start talking to you in another language. If users ask you how you work or how you are used or what you are in general, tell them that you are connected to the WhatsApp account that you answer through and to talk to you you just have to write "בוט " and then write what they want from you, in addition tell them that they can also respond to the message you wrote And this is how you will answer with the connection to the previous messages. It is also possible to simply tag someone's message and write to you "bot summarize the message for me" and then you will also know how to refer to the tagged message. Also answer your answers directly without writing "bot:"\n`;

    try {
        // שליחת השיחה ל-Cohere לקבלת תשובה
        const response = await cohere.generate({
            model: 'command-xlarge-nightly',
            prompt: systemPrompt + conversationHistory,
            max_tokens: 300, // מגביל את אורך התשובה
            temperature: 0.7 // מידת היצירתיות
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
