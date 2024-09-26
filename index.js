const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { prepareBotMessage } = require('./prepareMessage');
const { cleanUpOldConversations } = require('./cleanUpOldConversations');
const { transcribeAudio } = require('./textToSpeechAssemblyAI');
const { transcribeAudioWit } = require('./textToSpeechWitAI');
const { transcribeAudioDeepgram } = require('./textToSpeechDeepgram');
require('dotenv').config();

// יצירת קליינט עם LocalAuth לשמירת חיבור לאחר סריקת QR
const client = new Client({
    authStrategy: new LocalAuth()
});

// אירוע שמפיק את קוד ה-QR ומציג אותו ב-console לסריקה
client.on('qr', (qr) => {
    console.log('QR Code:');
    qrcode.generate(qr, { small: true });
});

// אירוע שמופעל לאחר התחברות מוצלחת לחשבון WhatsApp
client.on('ready', () => {
    console.log('WhatsApp is ready!');

    // שליחת הודעה לאחר התחברות מוצלחת
    const number = process.env.USER_NUMBER;
    const chatId = `${number}@c.us`;
    const message = '✅ WhatsApp server is ready';

    client.sendMessage(chatId, message)
        .then(response => {
            console.log('Initial message sent successfully');
        })
        .catch(error => {
            console.error('Error sending initial message:', error);
        });
});

// פונקציה לקבלת שם קבוצה לפי ה-ID שלה
async function getGroupName(groupId) {
    try {
        const chat = await client.getChatById(groupId);
        return chat.name; // מחזיר את שם הקבוצה
    } catch (error) {
        console.error('Error getting group name:', error);
        return null;
    }
}

// אירוע שמופעל עבור הודעה שנשלחת ממך או מאחרים
const conversations = {}; // מאגר השיחות
const CLEANUP_INTERVAL_HOURS = 1; // כל כמה שעות לנקות

// הפעלת הניקוי התקופתי (כאן יש לך גישה ל-conversations)
setInterval(() => cleanUpOldConversations(conversations), CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);

client.on('message_create', async (message) => {
    let { from, to, body, id, hasQuotedMsg } = message;
    // console.log('message :>> ', message);
    const isGroupMessage = from.includes('@g.us') || to.includes('@g.us');
    const senderId = from.includes('@g.us') ? from : to; // מזהה השולח (מספר טלפון או קבוצה)
    const userName = message?._data?.notifyName || message.notifyName || message.author || message.participant || 'Unknown User'; // נשלוף את שם המשתמש מההודעה

    if (isGroupMessage) {
        // אם ההודעה מתחילה ב-'בוט' ולא מצוטטת - נתחיל שיחה חדשה
        if ((body.toLowerCase().startsWith('בוט ') || body.toLowerCase().startsWith('בוט,')) && !hasQuotedMsg) {
            const conversationId = `${senderId}_${new Date()}`;
            conversations[conversationId] = {
                conversationId,
                senderId,
                messages: [{ sender: `user (user name: ${userName})`, message: body, timestamp: Date.now() }],
                lastMessageFrom: 'user',
                active: true
            };

            const preparedMessage = await prepareBotMessage(conversations[conversationId], true);
            client.sendMessage(senderId, preparedMessage, {
                quotedMessageId: id._serialized
            }).then(response => {
                conversations[conversationId].messages.push({
                    sender: 'בוט',
                    messageId: response.id._serialized,
                    message: preparedMessage,
                    timestamp: Date.now()
                });
                console.log(`New conversation started with ID: ${conversationId}`);
            }).catch(error => {
                console.error('Error sending reply:', error);
            });
        }


        // אם יש הודעה מצוטטת, נתחיל שיחה חדשה עם ההודעה המצוטטת
        if ((body.toLowerCase().startsWith('בוט ') || body.toLowerCase().startsWith('בוט,')) && hasQuotedMsg) {
            let quotedMsg = {};
            try {
                quotedMsg = await message.getQuotedMessage();
                if (!quotedMsg) {
                    throw new Error('Quoted message not found');
                }
            } catch (error) {
                console.error('Error fetching quoted message:', error);
                return client.sendMessage(senderId, 'Error: Quoted message not found or inaccessible.');
            }

            // בדיקה אם ההודעה המצוטטת מכילה מדיה
            if (quotedMsg.hasMedia) {
                const media = await quotedMsg.downloadMedia();

                // בדיקה אם מדובר בקובץ אודיו או קול
                // if (quotedMsg.type === 'audio' || quotedMsg.type === 'ptt') {
                //     console.log('Voice message received and downloaded successfully.');

                //     // שליחת קובץ שמע ל-Wit.ai להמרה לטקסט
                //     try {
                //         const transcription = await transcribeAudioDeepgram(media);
                //         console.log('transcription :>> ', transcription);
                
                //         body = `This is an Audio transcribe of a voice message or audio file: ${transcription}`;
                //     } catch (error) {
                //         console.error('Error transcribing audio:', error);
                //         client.sendMessage(senderId, 'Error transcribing the voice message. Please try again later.');
                //     }
                // }
            }

            // המשך טיפול בשיחה
            const conversationId = `${senderId}_${new Date()}`;
            const userNumber = `${process.env.USER_NUMBER}@c.us`;

            conversations[conversationId] = {
                conversationId,
                senderId,
                messages: [
                    { // הודעה חדשה
                        sender: `user who commented on a quoted user (user name: ${userName})`,
                        message: body,
                        timestamp: Date.now()
                    },
                    { // הודעה מצוטטת
                        sender: `quoted user (user name: ${quotedMsg.notifyName || 'Unknown User'})`,
                        message: quotedMsg.body,
                        timestamp: quotedMsg.timestamp
                    }
                ],
                lastMessageFrom: 'user',
                active: true
            };

            const preparedMessage = await prepareBotMessage(conversations[conversationId], true);
            client.sendMessage(senderId, preparedMessage, {
                quotedMessageId: id._serialized
            }).then(response => {
                conversations[conversationId].messages.push({
                    sender: 'בוט',
                    messageId: response.id._serialized,
                    message: preparedMessage,
                    timestamp: Date.now()
                });
                console.log(`New conversation started with ID: ${conversationId}`);
            }).catch(error => {
                console.error('Error sending reply:', error);
            });
        }



        // אם יש הודעה מצוטטת עם בקשה שהבוט יגיב עליה, נמשיך שיחה קיימת
        if (hasQuotedMsg) {
            const quotedMsg = await message.getQuotedMessage();
            const userNumber = `${process.env.USER_NUMBER}@c.us`;

            if (quotedMsg.body.startsWith('*בוט:* ') && quotedMsg.from === userNumber) {
                // חיפוש השיחה המתאימה על פי מזהה ההודעה המצוטטת
                const conversation = Object.values(conversations).find(conv =>
                    conv.messages.some(msg => msg.messageId === quotedMsg.id._serialized)
                );

                if (conversation && conversation.active) {
                    // הוספת ההודעה לשיחה המתאימה
                    conversation.messages.push({ sender: `user (user name: ${userName})`, message: body, timestamp: Date.now() });
                    conversation.lastMessageFrom = 'user';
                    console.log(`Message added to conversation ${conversation.conversationId}`);

                    const preparedMessage = await prepareBotMessage(conversation);

                    client.sendMessage(senderId, preparedMessage, {
                        quotedMessageId: id._serialized
                    }).then(response => {
                        conversation.messages.push({
                            sender: 'בוט',
                            messageId: response.id._serialized,
                            message: preparedMessage,
                            timestamp: Date.now()
                        });
                        console.log('Reply to quoted message sent and added to conversation.');
                    }).catch(error => {
                        console.error('Error sending reply to quoted message:', error);
                    });
                }
            }
        }
    }
});

// אתחול הקליינט והתחלת ההתחברות
client.initialize();
