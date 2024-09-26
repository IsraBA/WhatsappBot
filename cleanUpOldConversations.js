const MAX_CONVERSATION_AGE_MS = 48 * 60 * 60 * 1000; // 48 שעות במילישניות

// פונקציה שמנקה שיחות ישנות
function cleanUpOldConversations(conversations) { // מעבירים את conversations כפרמטר
    const now = Date.now(); // הזמן הנוכחי במילישניות
    for (const conversationId in conversations) {
        const conversation = conversations[conversationId];
        const lastMessage = conversation.messages[conversation.messages.length - 1]; // ההודעה האחרונה בשיחה
        const conversationAge = now - lastMessage.timestamp; // זמן שעבר מאז ההודעה האחרונה
        if (conversationAge > MAX_CONVERSATION_AGE_MS) {
            console.log(`Deleting conversation with ID: ${conversationId}, as the last message is older than 48 hours.`);
            delete conversations[conversationId]; // מחיקת השיחה מהאובייקט
        }
    }
}

module.exports = { cleanUpOldConversations };
