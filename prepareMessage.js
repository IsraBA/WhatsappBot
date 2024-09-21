const cohere = require('cohere-ai');
cohere.init(process.env.COHERE_API_KEY);

// פונקציה להכנת הודעת הבוט שמכילה את כל ההודעות בשיחה
function prepareBotMessage(conversation, upcomingBotMessage) {
    // הכנת כל ההודעות שהיו בשיחה עד כה
    const allMessages = conversation.messages.map(msg => {
        return `${msg.sender === 'bot' ? '*bot:* \n' : '*' + msg.sender + ':* \n'}${msg.message}`;
    });

    // הוספת ההודעה שהבוט עומד לשלוח
    allMessages.push(`*GPT:* \n${upcomingBotMessage}`);

    // החזרת כל ההודעות כשורה אחת משולבת עם רווח בין ההודעות
    return '*GPT:* \n' + allMessages.join('\n\n');
}

module.exports = { prepareBotMessage };