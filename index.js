// index.js

// השבתת בדיקות תעודות TLS (לבדיקות בלבד, לא מומלץ בייצור)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode-terminal');
const { prepareBotMessage } = require('./prepareMessage');
const { cleanUpOldConversations } = require('./cleanUpOldConversations');
const { transcribeAudio } = require('./textToSpeechAssemblyAI');
const { transcribeAudioWit } = require('./textToSpeechWitAI');
const { transcribeAudioDeepgram } = require('./textToSpeechDeepgram');
require('dotenv').config();
const express = require('express');

const app = express();

// -------------------------
// משתנים גלובליים
// -------------------------

// מאגר השיחות – כל שיחה נשמרת לפי מזהה ייחודי
const conversations = {};
const CLEANUP_INTERVAL_HOURS = 1; // ניקוי כל שעה
setInterval(() => cleanUpOldConversations(conversations), CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000);

// MAP גלובלי לשמירת מופעי Baileys לפי userId (תומך בריבוי משתמשים/סשנים)
const clientsMap = new Map();

// משתנה לשליטה במצב הבוט (מופעל/מושתק)
let botEnabled = true;

// מספר הטלפון של המשתמש
const ownerNumber = process.env.USER_NUMBER;

// -------------------------
// הגדרת נתיב בסיסי לשרת HTTP
// -------------------------
app.get('/', (req, res) => {
    res.send('WhatsApp AI bot is running!');
});

// -------------------------
// פונקציות אתחול לקוח Baileys
// -------------------------

// יצירת מופע חדש עבור משתמש מסוים (משתמש זה ישמש גם כשם הסשן)
async function createClient(userId) {
    const authFolder = path.join(__dirname, 'auth_data', `session-${userId}`);
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'warn' }), // רק הודעות עם רמת 'warn' ומעלה יודפסו
        // printQRInTerminal: true, // לשיקולך אם להשאיר את ההדפסת QR
    });

    sock.userId = userId;
    bindClientEvents(sock, userId, saveCreds);

    return sock;
};

// החזרת מופע קיים או אתחול מופע חדש במידת הצורך
async function getClient(userId) {
    if (clientsMap.has(userId)) return clientsMap.get(userId);
    const client = await createClient(userId);
    clientsMap.set(userId, client);
    return client;
}

// -------------------------
// קישור אירועים למופע (sock)
// -------------------------
function bindClientEvents(sock, userId, saveCreds) {
    sock.ev.on('connection.update', async (update) => {
        // נדרש לשמור על lastDisconnect לצורך בדיקת סיבת הניתוק
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log(`[${userId}] QR Code generated`);
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log(`[${userId}] WhatsApp client is ready!`);

            // שליחת הודעת אתחול לחשבון הבעלים
            const chatId = `${ownerNumber}@c.us`;
            const message = '✅ WhatsApp server is ready';
            await sock.sendMessage(chatId, { text: message })
                .then(response => {
                    console.log('Initial message sent successfully');
                })
                .catch(error => {
                    console.error('Error sending initial message:', error);
                });
        }

        // אם החיבור נסגר
        if (connection === 'close') {
            // בדיקה של סיבת הניתוק מתוך lastDisconnect
            const code = lastDisconnect?.error?.output?.statusCode;
            if (code === 515) {
                console.log(`[${userId}] Reinitializing due to stream error...`);
                clientsMap.delete(userId);
                getClient(userId);
            } else {
                console.log(`[${userId}] Connection closed with code: ${code}`, lastDisconnect?.error);

                // הגדרת קריטריונים לניתוק בלתי ניתן לשיקום
                const unrecoverable = (
                    code === DisconnectReason.loggedOut || // משתמש התנתק באופן ידני
                    code === 401 || // Unauthorized
                    code === 403 || // Forbidden
                    code === 419    // Session/token לא תקין
                );

                if (unrecoverable) {
                    console.log(`[${userId}] Unrecoverable disconnect. Removing client & session folder.`);
                    // הסר מהמפה
                    clientsMap.delete(userId);

                    // מחיקת תיקיית הסשן מהדיסק
                    try {
                        const authFolder = path.join(__dirname, 'auth_data', `session-${userId}`);
                        if (fs.existsSync(authFolder)) {
                            fs.rmSync(authFolder, { recursive: true, force: true });
                            console.log(`[${userId}] Auth folder deleted:`, authFolder);
                        }
                    } catch (err) {
                        console.error(`[${userId}] Error deleting auth folder:`, err.message);
                    }
                } else {
                    // Baileys ינסה להתחבר מחדש לבד (autoReconnect)
                    console.log(`[${userId}] Connection closed, but should be recoverable. Baileys will attempt reconnect automatically.`);
                }
            }
        }
    });

    // שמירת עדכוני האישורים
    sock.ev.on('creds.update', saveCreds);

    // -------------------------
    // טיפול בהודעות נכנסות
    // -------------------------
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; // מתעלמים מהודעות שאינן notify
        const message = messages[0];

        // קבלת מזהה השיחה, הבדלה בין הודעות קבוצתיות
        const senderId = message.key.remoteJid;
        const isGroupMessage = senderId.endsWith('@g.us');
        const userName = message.pushName || 'Unknown User';
        const messageId = message.key.id;

        // חילוץ גוף ההודעה ממספר פורמטים אפשריים
        let body = message.message?.conversation || message.message?.extendedTextMessage?.text || '';
        if (!body) return;

        // קביעת המזהה של השולח בפועל:
        const sender = isGroupMessage ? message.key.participant : senderId;
        // נגדיר את המשתמש המורשה לשליטה
        const adminId = `${ownerNumber}@s.whatsapp.net`;

        // בדיקה אם ההודעה היא פקודה מהמשתמש המורשה
        if (sender === adminId) {
            if (body.trim() === 'עצור בוט') {
                botEnabled = false;
                console.log("The bot turn off successfully!")
                await sock.sendMessage(senderId, { text: '⛔ הבוט הושבת' });
                return;
            }
            if (body.trim() === 'הפעל בוט') {
                botEnabled = true;
                console.log("The bot turn on successfully!")
                await sock.sendMessage(senderId, { text: '✅ הבוט הופעל' });
                return;
            }
        }
        // אם הבוט מושתק, אין לעבד הודעות נוספות
        if (!botEnabled) return;

        // אם המשתמש שלח את פקודת "בוט הוראות הפעלה" – שולחים הודעה מותאמת
        if (body.trim() === 'בוט הוראות הפעלה' && isGroupMessage) {
            const instructionsMessage = `✨ *הוראות הפעלה* ✨\n\n` +
                `🤖 *להפעיל אותי*: כתבו הודעה שמתחילה במילה "בוט".\n` +
                `↩️ *להמשך שיחה קיימת*: תייגו את ההודעה שכתבתי, כך אשמור על ההקשר.\n` +
                `❇️ *לשיחה חדשה*: שלחו הודעה חדשה ללא תיוג הודעה קודמת והתחילו במילה "בוט".\n` +
                `🔗 *הפניה להודעה קודמת*: אם אתם רוצים שאני אתייחס להודעה כלשהי (למשל כדי לסכם אותה), עליכם לתייג את ההודעה הרצויה ולהתחיל את ההודעה שלכם במילה "בוט".\n📝 *לדוגמה*: "בוט, תסכם לי את ההודעה הזאת" (תוך תיוג הודעה קודמת).`;
            await sock.sendMessage(senderId, { text: instructionsMessage });
            return;
        };

        // בדיקה האם יש הודעה מצוטטת (reply)
        const hasQuotedMsg = message.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        // דגל למניעת הפעלה כפולה
        let isAlreadyHandled = false;

        // ----------------------------------------------------
        // 1. התחלת שיחה חדשה – הודעה שמתחילה ב-"בוט " או "בוט," ללא הודעה מצוטטת
        // ----------------------------------------------------
        if (
            isGroupMessage
            && (body.toLowerCase().startsWith('בוט'))
            && !hasQuotedMsg
        ) {
            isAlreadyHandled = true;

            // שליחת מצב הקלדה עד התשובה
            await sock.sendPresenceUpdate('composing', senderId);

            const conversationId = `${senderId}_${Date.now()}`;
            conversations[conversationId] = {
                conversationId,
                senderId,
                messages: [{
                    sender: `user (user name: ${userName})`,
                    message: body,
                    messageId,
                    timestamp: Date.now()
                }],
                lastMessageFrom: 'user',
                active: true
            };

            // העברת true כפרמטר לצורך סימון התחלת שיחה חדשה (אם יש צורך בהתאמות בתוך prepareBotMessage)
            const preparedMessage = await prepareBotMessage(conversations[conversationId], true);

            // עדכון שהקלדה הסתיימה
            await sock.sendPresenceUpdate('paused', senderId);

            // שליחת התגובה תוך ציטוט ההודעה המקורית
            await sock.sendMessage(senderId, {
                text: preparedMessage,
                contextInfo: {
                    stanzaId: messageId,
                    participant: message.key.participant,
                    quotedMessage: message.message
                }
            }).then(response => {
                conversations[conversationId].messages.push({
                    sender: 'בוט',
                    messageId: response.key.id,
                    message: preparedMessage,
                    timestamp: Date.now()
                });
                console.log(`New conversation started with ID: ${conversationId}`);
            }).catch(error => {
                console.error('Error sending reply:', error);
            });
        };

        // ----------------------------------------------------
        // 2. המשך שיחה קיימת – כאשר המשתמש מגיב להודעת בוט מצוטטת
        // יש לבדוק שההודעה המצוטטת אכן נשלחה על ידי הבוט (למשל, על ידי בדיקה שהטקסט מתחיל ב"*בוט:*")
        // ----------------------------------------------------
        if (
            isGroupMessage
            && hasQuotedMsg
            && !isAlreadyHandled
        ) {
            const contextInfo = message.message.extendedTextMessage.contextInfo;
            const quoted = contextInfo.quotedMessage;
            const quotedText = quoted.conversation || (quoted.extendedTextMessage ? quoted.extendedTextMessage.text : '');
            // רק אם הטקסט של ההודעה המצוטטת מתחיל ב"*בוט:*" וההודעה נשלחה מהבוט עצמו, נמשיך את השיחה
            if (
                quotedText.startsWith('*בוט:*')
                && contextInfo.participant?.startsWith(ownerNumber)
            ) {
                isAlreadyHandled = true;

                const quotedMessageId = contextInfo.stanzaId;
                // חיפוש שיחה קיימת על פי מזהה ההודעה המצוטטת
                const conversation = Object.values(conversations).find(conv =>
                    conv.messages.some(msg => msg.messageId === quotedMessageId)
                );

                if (conversation && conversation.active) {
                    // שליחת מצב הקלדה עד התשובה
                    await sock.sendPresenceUpdate('composing', senderId);

                    conversation.messages.push({
                        sender: `user (user name: ${userName})`,
                        message: body,
                        messageId,
                        timestamp: Date.now()
                    });
                    conversation.lastMessageFrom = 'user';
                    console.log(`Message added to conversation ${conversation.conversationId}`);

                    const preparedMessage = await prepareBotMessage(conversation);

                    // עדכון שהקלדה הסתיימה
                    await sock.sendPresenceUpdate('paused', senderId);

                    await sock.sendMessage(senderId, {
                        text: preparedMessage,
                        contextInfo: {
                            stanzaId: messageId,
                            participant: message.key.participant,
                            quotedMessage: message.message
                        }
                    }).then(response => {
                        conversation.messages.push({
                            sender: 'בוט',
                            messageId: response.key.id,
                            message: preparedMessage,
                            timestamp: Date.now()
                        });
                        console.log('Reply to quoted message sent and added to conversation.');
                    }).catch(error => {
                        console.error('Error sending reply to quoted message:', error);
                    });
                }
            }
        };


        // ----------------------------------------------------
        // 3. התחלת שיחה חדשה – הודעה שמתחילה ב-"בוט " או "בוט," עם הודעה מצוטטת
        // כולל טיפול בסיסי בתוכן המצוטט (למשל, זיהוי מדיה)
        // ----------------------------------------------------
        if (
            isGroupMessage
            && (body.toLowerCase().startsWith('בוט'))
            && hasQuotedMsg
            && !isAlreadyHandled
        ) {
            isAlreadyHandled = true;

            // שליחת מצב הקלדה עד התשובה
            await sock.sendPresenceUpdate('composing', senderId);

            // חילוץ פרטי ההודעה המצוטטת
            const contextInfo = message.message.extendedTextMessage.contextInfo;
            const quotedMessageId = contextInfo.stanzaId;
            let quotedBody = '';

            // זיהוי סוג המדיה או טקסט של ההודעה המצוטטת
            if (contextInfo.quotedMessage.imageMessage) {
                quotedBody = '[Image]';
            } else if (contextInfo.quotedMessage.videoMessage) {
                quotedBody = '[Video]';
            } else if (contextInfo.quotedMessage.documentMessage) {
                quotedBody = '[Document]';
            } else if (contextInfo.quotedMessage.conversation) {
                quotedBody = contextInfo.quotedMessage.conversation;
            } else if (contextInfo.quotedMessage.extendedTextMessage) {
                quotedBody = contextInfo.quotedMessage.extendedTextMessage.text;
            }

            const conversationId = `${senderId}_${Date.now()}`;
            conversations[conversationId] = {
                conversationId,
                senderId,
                messages: [
                    { // הודעה חדשה מהמשתמש
                        sender: `user (user name: ${userName})`,
                        message: body,
                        messageId,
                        timestamp: Date.now()
                    },
                    { // הודעה מצוטטת
                        sender: `quoted user (user name: Unknown)`,
                        message: quotedBody,
                        messageId: quotedMessageId,
                        timestamp: Date.now()
                    }
                ],
                lastMessageFrom: 'user',
                active: true
            };

            const preparedMessage = await prepareBotMessage(conversations[conversationId], true);

            // עדכון שהקלדה הסתיימה
            await sock.sendPresenceUpdate('paused', senderId);

            await sock.sendMessage(senderId, {
                text: preparedMessage,
                contextInfo: {
                    stanzaId: messageId,
                    participant: message.key.participant,
                    quotedMessage: message.message
                }
            }).then(response => {
                conversations[conversationId].messages.push({
                    sender: 'בוט',
                    messageId: response.key.id,
                    message: preparedMessage,
                    timestamp: Date.now()
                });
                console.log(`New conversation (with quoted message) started with ID: ${conversationId}`);
            }).catch(error => {
                console.error('Error sending reply:', error);
            });
        };

    });
}

// -------------------------
// אתחול מופע הבוט הראשי
// כאן אנו מניחים ש- ownerNumber מכיל את מזהה הבוט (למשל, בלי @c.us)
// -------------------------
getClient(ownerNumber)
    .then(client => {
        console.log(`Bot client initialized for ${ownerNumber}`);
    })
    .catch(err => {
        console.error('Error initializing bot client:', err);
    });

// -------------------------
// אתחול שרת HTTP להאזנה לפורט
// -------------------------
const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Server is listening on port ${port}`);
});
