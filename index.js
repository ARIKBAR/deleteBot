// const ngrok = require('ngrok');
const express = require('express');
const cors = require('cors');

require('dotenv').config();
const { Client, LocalAuth, RemoteAuth } = require('whatsapp-web.js');
// const qrcode = require('qrcode');
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const events = require('events');
const connectDB = require('./config/db');
const puppeteer = require('puppeteer');
// const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// הגדרות מתקדמות לפלאגין Stealth
// const pluginStealth = StealthPlugin();
// pluginStealth.enabledEvasions.delete('chrome.runtime');
// pluginStealth.enabledEvasions.delete('navigator.plugins');
// puppeteer.use();

const app = express();
app.use(cors());

app.use(express.json());
app.use(express.static('public'));

console.log('Starting script...');
let hasStartedAutomation = false;

// פונקציה להשהייה אקראית
async function randomDelay(min = 500, max = 2000) {
    const delay = Math.floor(Math.random() * (max - min) + min);
    await new Promise(resolve => setTimeout(resolve, delay));
}



let clientInstance;
let globalcode
let currentPhoneNumber = null;

const eventEmitter = new events.EventEmitter();

const scheduledMessages = new Map();

function scheduleMessage(groupId, message, timestamp) {
    const timeoutId = setTimeout(async () => {
        try {
            const chat = await clientInstance.getChatById(groupId);
            await chat.sendMessage(message);
            scheduledMessages.delete(`${groupId}-${timestamp}`);
        } catch (error) {
            console.error(`Error sending scheduled message to group ${groupId}:`, error);
        }
    }, timestamp - Date.now());

    scheduledMessages.set(`${groupId}-${timestamp}`, timeoutId);
}

app.post('/send-message', async (req, res) => {
    try {
        if (!clientInstance) {
            return res.status(400).json({ error: 'Client not initialized' });
        }

        const { groupIds, message, scheduleTime } = req.body;

        if (!Array.isArray(groupIds) || groupIds.length === 0) {
            return res.status(400).json({ error: 'No groups selected' });
        }

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        let sentCount = 0;
        let scheduledCount = 0;

        for (let groupId of groupIds) {
            try {
                const chat = await clientInstance.getChatById(groupId);

                if (scheduleTime) {
                    // תזמון ההודעה
                    scheduleMessage(groupId, message, scheduleTime);
                    scheduledCount++;
                } else {
                    // שליחה מיידית
                    await chat.sendMessage(message);
                    sentCount++;
                }
            } catch (err) {
                console.error(`Error with group ${groupId}:`, err);
            }
        }

        let responseMessage = '';
        if (sentCount > 0) {
            responseMessage += `נשלחו ${sentCount} הודעות בהצלחה. `;
        }
        if (scheduledCount > 0) {
            responseMessage += `תוזמנו ${scheduledCount} הודעות לשליחה.`;
        }

        res.json({ message: responseMessage });
    } catch (error) {
        console.error('Error sending messages:', error);
        res.status(500).json({ error: error.message });
    }
});

// הוסף את נקודת הקצה לביטול הודעות מתוזמנות (אופציונלי)
app.post('/cancel-scheduled-messages', (req, res) => {
    const { groupId, timestamp } = req.body;
    const key = `${groupId}-${timestamp}`;

    if (scheduledMessages.has(key)) {
        clearTimeout(scheduledMessages.get(key));
        scheduledMessages.delete(key);
        res.json({ message: 'Scheduled message cancelled successfully' });
    } else {
        res.status(404).json({ error: 'Scheduled message not found' });
    }
});

app.post('/start-connection', async (req, res) => {
    try {
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // שמירת מספר הטלפון
        currentPhoneNumber = phoneNumber;

        // שליחת תשובה חיובית
        res.json({ success: true });



    } catch (error) {
        console.error('Error starting connection:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/qr', async (req, res) => {
    let store;
    try {
        // await connectDB();
        // store = new MongoStore({ mongoose: mongoose});
        const client = new Client({
            puppeteer: {
                args: [
                    '--no-sandbox',
                    "--no-zygote",
                    "--disable-setuid-sandbox",
                    '--disable-blink-features=AutomationControlled',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--disable-site-isolation-trials'
                ],
                executablePath:
                    process.env.NODE_ENV === "production"
                        ? process.env.PUPPETEER_EXECUTABLE_PATH
                        : puppeteer.executablePath(),
                headless: true,
                defaultViewport: null,
                ignoreDefaultArgs: ['--enable-automation'],
            },
            authStrategy: new LocalAuth({
                clientId: "ari",
                // store: store,
                // backupSyncIntervalMs: 300000
            }),
            pairWithPhoneNumber: {
                // phoneNumber: "972509926121",
                showNotification: true,
            }
        });
        let extractedCode = null;

        async function startAutomation() {
            try {
                if (hasStartedAutomation) {
                    console.log('Automation already started, skipping...');
                    return;
                }

                hasStartedAutomation = true;
                const page = await client.pupPage;

                if (!page) {
                    throw new Error('Page not available');
                }

                // הוספת הסוואות
                await page.evaluateOnNewDocument(() => {
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    window.navigator.chrome = { runtime: {} };
                    Object.defineProperty(navigator, 'languages', { get: () => ['he-IL', 'he'] });
                    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                });

                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

                console.log('Starting automation with page...');
                await randomDelay(2000, 4000);

                const phoneButtonSelector = '[data-icon="chevron"]';
                console.log('Looking for phone button...');
                await page.waitForSelector(phoneButtonSelector, { timeout: 30000 });
                await randomDelay(500, 1500);
                await page.click(phoneButtonSelector);
                console.log('Clicked phone button');

                await randomDelay(1000, 2000);

                const phoneInputSelector = '.selectable-text.x1n2onr6.xy9n6vp.x1n327nk.xh8yej3.x972fbf.xcfux6l.x1qhh985.xm0m39n.xjbqb8w.x1uvtmcs.x1jchvi3.xss6m8b.xexx8yu.x4uap5.x18d9i69.xkhd6sd';
                await page.waitForSelector(phoneInputSelector);
                await randomDelay(500, 1500);
                await page.type(phoneInputSelector, currentPhoneNumber, { delay: Math.random() * 100 + 50 });
                console.log('Entered phone number');

                await randomDelay(1000, 2000);

                const nextButtonSelector = '.x889kno.x1a8lsjc.xbbxn1n.xxbr6pl.x1n2onr6.x1rg5ohu.xk50ysn.x1f6kntn.xyesn5m.x1z11no5.xjy5m1g.x1mnwbp6.x4pb5v6.x178xt8z.xm81vs4.xso031l.xy80clv.x13fuv20.xu3j5b3.x1q0q8m5.x26u7qi.x1v8p93f.xogb00i.x16stqrj.x1ftr3km.x1hl8ikr.xfagghw.x9dyr19.x9lcvmn.xbtce8p.x14v0smp.xo8ufso.xcjl5na.x1k3x3db.xuxw1ft.xv52azi';
                await page.click(nextButtonSelector);
                console.log('Clicked next button');

                await randomDelay(3000, 5000);
                await page.waitForSelector('div[data-link-code]');

                const code = await page.evaluate(() => {
                    const codeElement = document.querySelector('div[data-link-code]');
                    if (codeElement) {
                        const codeAttr = codeElement.getAttribute('data-link-code');
                        return codeAttr.split(',').join('');
                    }
                    return null;
                });

                if (code) {
                    console.log('Successfully extracted pairing code:', code);
                    extractedCode = code; // שומרים את הקוד במשתנה הגלובלי
                    return code; // מחזירים את הקוד למי שקרא לפונקציה
                } else {
                    throw new Error('Could not extract pairing code');
                }

            } catch (error) {
                console.error('Error in automation:', error);
                hasStartedAutomation = false;
                throw error; // מעבירים את השגיאה הלאה
            }
        }
        app.get('/code', (req, res) => {
            if (extractedCode) {
                res.json({ code: extractedCode });
            } else {
                res.status(404).json({ error: 'Code not yet available' });
            }
        });


        client.on('qr', async () => {
            console.log('QR Code received, starting automation...');
            if (!hasStartedAutomation) {
                setTimeout(async () => {
                    await startAutomation().catch(console.error);
                }, 800);
            }
        });

        client.on('remote_session_saved', (session) => {
            console.log('Remote session saved:', session);
        });
        ;

        client.on('message_create', async (message) => {


            if (message.body === '!cleargroups' && message.fromMe) {
                console.log('Starting clear groups process...');
                try {
                    const chats = await client.getChats();
                    console.log(`Found ${chats.length} total chats`);

                    const groupChats = chats.filter(chat => chat.id._serialized.endsWith('@g.us'));
                    console.log(`Found ${groupChats.length} group chats`);

                    let clearedCount = 0;
                    for (let chat of groupChats) {
                        console.log(`Attempting to clear group: ${chat.name} (ID: ${chat.id._serialized})`);
                        try {
                            await chat.clearMessages();
                            console.log(`Successfully cleared group: ${chat.name} (ID: ${chat.id._serialized})`);
                            clearedCount++;
                        } catch (err) {
                            console.error(`Error clearing group ${chat.name} (ID: ${chat.id._serialized}):`, err);
                        }
                    }

                    await message.reply(`נמחקו בהצלחה  ${clearedCount} קבוצות. פרטי הקבוצות:\n` +
                        groupChats.map(chat => `${chat.name}`).join('\n \n'));
                    console.log('Finished clearing groups');
                } catch (error) {
                    console.error('Error clearing groups:', error);
                    await message.reply('Error occurred while clearing groups');
                }
            }
        });

        client.on('ready', async () => {
            console.log('Client is ready!');
            clientInstance = client;

            try {
                console.log('Start loading groups...');
                const startTime = Date.now();

                const groups = await client.getGroupsFromStore();

                const durationInSeconds = (Date.now() - startTime) / 1000;
                console.log(`Groups loaded (${groups.length}) in ${durationInSeconds} seconds`);

                // שמירת הקבוצות ושליחת אירוע מיד
                app.locals.groupChats = groups;
                eventEmitter.emit('client_ready');

            } catch (error) {
                console.error('Error fetching groups:', error);
            }
        });

        console.log('Initializing client...');
        client.on('loading_screen', (percent, message) => {
            console.log('LOADING SCREEN', percent, message);
        });

        client.on('authenticated', () => {
            console.log('AUTHENTICATED');
            eventEmitter.emit('authenticated');
        });

        client.on('auth_failure', msg => {
            console.error('AUTHENTICATION FAILURE', msg);
        });
        client.initialize();

        client.on('message_create', message => {
            if (message.body === 'שליחת צילום מסך מפייבוקס') {
                // reply back "pong" directly to the message
                setTimeout(() => {
                    message.reply('אנא שלח פה צילום מסך של ההעברה על מנת שנוכל לאשר את הצטרפותך לבוט');
                }
                    , 1500);
            }
        });

        client.on('message_create', message => {
            if (message.body === 'הוספה כנהג') {
                // reply back "pong" directly to the message
                setTimeout(() => {
                    message.reply(`היי,
לא מצאנו את הפרטים שלך במאגר הנהגים שלנו
כדי שנוכל לצרף אותך אנא שלח לנו את הפרטים הבאים:
        *שם מלא:*
        *סוג רכב:*
        *שנתון רכב:*
        *מספר הווטסאפ שלך:*
                    
לאחר קבלת הפרטים נטפל בבקשתך בהקדם האפשרי.
    בברכה,
    קאש דרייבר`);
                }
                    , 1000);
            }
        });

        client.on('message_create', message => {
            if (message.body === 'מעוניין להצטרף לבוט') {
                // reply back "pong" directly to the message
                setTimeout(() => {
                    message.reply(`שמנו לב שהתחלת בתהליך ההתחברות לבוט שלנו

אם ברצונך להשתמש באגרון נהגים (חינמי לכולם) שלח את ההודעה הבאה:

> https://api.whatsapp.com/send?phone=972538651172&text=דירוג

אם ברצונך להצטרף לאחד מהמסלולים בתשלום, 
עקוב אחר ההוראות
> הליך הצטרפות

• בחירת מסלול : בחר את המסלול המתאים לך מתוך האפשרויות המפורטות.

• תשלום באמצעות PayBox: בצע את התשלום באמצעות אפליקציית PayBox למספר המצורף בפירוט החבילות.

• תשלום בהעברה בנקאית: בצע העברה בנקאית לחשבון המצורף באפשרויות תשלום.

• אישור התשלום : שלח צילום מסך המאשר את ביצוע התשלום למספר: 050-9926121.

לאחר השלמת שלבים אלו, תצורף בהצלחה למסלול הנבחר.

> פירוט חבילות

*_______________*
מסלול BASIC
✔️ הכנסות הוצאות וסיכום
✔️ הגדרות וסטטוס יעד
✔️ רישום וניהול תותים (בפיתוח)
✔️ חיפוש מידע על נהג
❌ הפקת דוח אקסל
❌ חישוב רווח לשעת עבודה
פייבוקס:0525868551
💵 מסלול בייסיק - 40₪
*_______________*
מסלול PREMIUM:
✔️ הכנסות הוצאות וסיכום
✔️ הגדרות וסטטוס יעד
✔️ רישום וניהול תותים (בפיתוח)
✔️ הפקת דוח אקסל
✔️ חישוב רווח לשעת עבודה
✔️ חיפוש מידע על נהג
➕ גישה מוקדמת לפיצ'רים חדשים
פייבוקס:0525868551
💵 מסלול פרימיום - 60₪
*_______________*

`);
                }
                    , 3500);
            }
        });

    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({ error: error.message });
    }
});

// נוסיף אחרי app.get('/qr')
// app.post('/request-code', async (req, res) => {
//     try {
//         const { phoneNumber } = req.body;
//         if (!phoneNumber) {
//             return res.status(400).json({ error: 'Phone number is required' });
//         }

//         const client = new Client({
//             authStrategy: new RemoteAuth({ clientId: Date.now().toString() }),
//             puppeteer: {
//                 headless: true,
//                 args: [
//                     '--no-sandbox',
//                     '--disable-setuid-sandbox',
//                     '--disable-dev-shm-usage',
//                     '--disable-accelerated-2d-canvas',
//                     '--no-first-run',
//                     '--no-zygote',
//                     '--disable-gpu'
//                 ]
//             }
//         });

//         client.on('ready', async () => {
//             console.log('Client is ready!');
//             clientInstance = client;
//             try {
//                 const groups = await client.getGroupsFromStore();
//                 app.locals.groupChats = groups;
//                 eventEmitter.emit('client_ready');
//             } catch (error) {
//                 console.error('Error fetching groups:', error);
//             }
//         });

//         client.initialize();

//         const formattedNumber = phoneNumber.replace(/[^0-9]/g, '');
//         const code = await client.requestPairingCode(formattedNumber);
//         console.log('Pairing code generated:', code);
//         res.json({ code });

//     } catch (error) {
//         console.error('Error requesting pairing code:', error);
//         res.status(500).json({ error: error.message });
//     }
// });

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const clientReadyListener = () => {
        res.write('data: client_ready\n\n');
    };

    const authenticatedListener = () => {
        res.write('data: authenticated\n\n');
    };

    eventEmitter.on('client_ready', clientReadyListener);
    eventEmitter.on('authenticated', authenticatedListener);

    req.on('close', () => {
        eventEmitter.removeListener('client_ready', clientReadyListener);
        eventEmitter.removeListener('authenticated', authenticatedListener);
    });
});

app.get('/groups', async (req, res) => {
    try {
        if (!clientInstance) {
            return res.status(400).json({ error: 'Client not initialized' });
        }
        const groups = await clientInstance.getGroupsFromStore();
        console.log(`Sending ${groups.length} groups to client`);
        res.json(groups);
    } catch (error) {
        console.error('Error fetching groups:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/clear-groups', async (req, res) => {
    try {
        if (!clientInstance) {
            return res.status(400).json({ error: 'Client not initialized' });
        }
        const { groupIds } = req.body;
        if (!Array.isArray(groupIds) || groupIds.length === 0) {
            return res.status(400).json({ error: 'No groups selected' });
        }
        let clearedCount = 0;
        for (let groupId of groupIds) {
            const chat = await clientInstance.getChatById(groupId);
            if (chat) {
                try {
                    await chat.clearMessages();
                    clearedCount++;
                } catch (err) {
                    console.error(`Error clearing group ${chat.name} (ID: ${chat.id._serialized}):`, err);
                }
            }
        }
        res.json({ message: `Successfully cleared ${clearedCount} groups` });
    } catch (error) {
        console.error('Error clearing groups:', error);
        res.status(500).json({ error: error.message });
    }
});


const port = process.env.PORT || 2000;

app.listen(port, async () => {
    console.log(`Server running on port ${port}`);

    // try {
    //     const url = await ngrok.connect({
    //         proto: 'http',
    //         addr: port,
    //         authtoken: process.env.NGROK_AUTH_TOKEN // אם יש לך token
    //     });
    //     console.log('Public URL:', url);
    //     console.log('You can now access the app from your phone at:', url);
    // } catch (error) {
    //     console.error('Ngrok Error:', error);
    // }

});
