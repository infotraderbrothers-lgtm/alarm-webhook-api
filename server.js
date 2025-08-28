const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');

// Use dynamic import for node-fetch (ES module)
let fetch;
(async () => {
    const fetchModule = await import('node-fetch');
    fetch = fetchModule.default;
})();

class AlarmWebhookAPI {
    constructor() {
        this.app = express();
        this.alarmsFile = path.join(__dirname, 'alarms.json');
        this.alarms = new Map();
        this.cronJobs = new Map();
        
        this.setupMiddleware();
        this.setupRoutes();
        this.initializeFetch().then(() => {
            this.loadAlarms();
        });
    }
    
    async initializeFetch() {
        if (!fetch) {
            const fetchModule = await import('node-fetch');
            fetch = fetchModule.default;
        }
    }
    
    setupMiddleware() {
        this.app.use(express.json());
        
        // CORS for web requests
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            next();
        });
        
        // Logging middleware
        this.app.use((req, res, next) => {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] ${req.method} ${req.path}`);
            next();
        });
    }
    
    setupRoutes() {
        // Root route for health check
        this.app.get('/', (req, res) => {
            res.json({
                service: 'Alarm Webhook API with Make.com Integration',
                status: 'running',
                timestamp: new Date().toISOString(),
                activeAlarms: this.alarms.size,
                makeWebhook: 'https://hook.eu2.make.com/6keyrp44odhz8cbxbz7owjjl3t3ag945',
                endpoints: {
                    'POST /api/alarms': 'Create new alarm (webhookUrl optional)',
                    'GET /api/alarms': 'List all alarms',
                    'GET /api/alarms/:id': 'Get specific alarm',
                    'DELETE /api/alarms/:id': 'Delete alarm',
                    'POST /api/test-webhook': 'Test webhook',
                    'GET /api/health': 'Health check'
                }
            });
        });
        
        // Create new alarm
        this.app.post('/api/alarms', async (req, res) => {
            try {
                const { contactName, email, phone, datetime, webhookUrl, repeatDays } = req.body;
                
                if (!contactName || !datetime) {
                    return res.status(400).json({
                        error: 'Missing required fields: contactName, datetime',
                        example: {
                            contactName: 'John Doe',
                            email: 'john@example.com (optional)',
                            phone: '+1234567890 (optional)',
                            datetime: '2025-08-27T15:30:00.000Z',
                            webhookUrl: 'https://webhook.site/your-id (optional)',
                            repeatDays: ['monday', 'friday'] // optional
                        },
                        note: 'All alarms automatically send to Make.com webhook. Custom webhookUrl is optional.'
                    });
                }
                
                // Validate datetime
                const targetDate = new Date(datetime);
                if (isNaN(targetDate.getTime())) {
                    return res.status(400).json({
                        error: 'Invalid datetime format. Use ISO 8601 format (e.g., 2025-08-27T15:30:00.000Z)'
                    });
                }
                
                const alarmId = await this.createAlarm({
                    contactName,
                    email: email || '',
                    phone: phone || '',
                    datetime,
                    webhookUrl: webhookUrl || '', // Optional now
                    repeatDays: repeatDays || []
                });
                
                res.status(201).json({
                    success: true,
                    alarmId,
                    message: 'Alarm created successfully',
                    scheduledFor: targetDate.toISOString(),
                    webhooks: {
                        makeWebhook: 'Will be sent to Make.com',
                        customWebhook: webhookUrl ? `Will also be sent to: ${webhookUrl}` : 'None specified'
                    }
                });
            } catch (error) {
                console.error('Error creating alarm:', error);
                res.status(500).json({ 
                    error: 'Internal server error',
                    message: error.message 
                });
            }
        });
        
        // Get all alarms
        this.app.get('/api/alarms', (req, res) => {
            const alarmsList = Array.from(this.alarms.values()).map(alarm => ({
                ...alarm,
                nextTrigger: this.getNextTriggerTime(alarm)
            }));
            
            res.json({
                success: true,
                count: alarmsList.length,
                alarms: alarmsList,
                note: 'All alarms send to Make.com webhook: https://hook.eu2.make.com/6keyrp44odhz8cbxbz7owjjl3t3ag945'
            });
        });
        
        // Get specific alarm
        this.app.get('/api/alarms/:id', (req, res) => {
            const alarm = this.alarms.get(req.params.id);
            if (!alarm) {
                return res.status(404).json({ error: 'Alarm not found' });
            }
            
            res.json({ 
                success: true, 
                alarm: {
                    ...alarm,
                    nextTrigger: this.getNextTriggerTime(alarm)
                }
            });
        });
        
        // Delete alarm
        this.app.delete('/api/alarms/:id', async (req, res) => {
            try {
                const deleted = await this.deleteAlarm(req.params.id);
                if (deleted) {
                    res.json({ success: true, message: 'Alarm deleted successfully' });
                } else {
                    res.status(404).json({ error: 'Alarm not found' });
                }
            } catch (error) {
                console.error('Error deleting alarm:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        
        // Test Make.com webhook
        this.app.post('/api/test-webhook', async (req, res) => {
            try {
                const makeWebhookUrl = 'https://hook.eu2.make.com/6keyrp44odhz8cbxbz7owjjl3t3ag945';
                const result = await this.testWebhook(makeWebhookUrl);
                res.json({
                    ...result,
                    testedWebhook: makeWebhookUrl,
                    note: 'This tests your Make.com webhook endpoint'
                });
            } catch (error) {
                console.error('Error testing webhook:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });
        
        // Health check
        this.app.get('/api/health', (req, res) => {
            const uptime = process.uptime();
            res.json({
                success: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
                activeAlarms: this.alarms.size,
                activeCronJobs: this.cronJobs.size,
                makeWebhook: 'https://hook.eu2.make.com/6keyrp44odhz8cbxbz7owjjl3t3ag945'
            });
        });
    }
    
    async createAlarm(alarmData) {
        const alarmId = this.generateId();
        const alarm = {
            id: alarmId,
            ...alarmData,
            created: new Date().toISOString(),
            isActive: true,
            triggeredCount: 0
        };
        
        this.alarms.set(alarmId, alarm);
        await this.saveAlarms();
        this.scheduleAlarm(alarm);
        
        console.log(`✅ Created alarm ${alarmId} for ${alarm.contactName} at ${alarm.datetime}`);
        console.log(`📡 Will send to Make.com webhook + ${alarm.webhookUrl ? 'custom webhook' : 'no custom webhook'}`);
        return alarmId;
    }
    
    async deleteAlarm(alarmId) {
        const alarm = this.alarms.get(alarmId);
        if (!alarm) return false;
        
        // Cancel cron job if exists
        const cronJob = this.cronJobs.get(alarmId);
        if (cronJob) {
            cronJob.destroy();
            this.cronJobs.delete(alarmId);
        }
        
        this.alarms.delete(alarmId);
        await this.saveAlarms();
        
        console.log(`🗑️ Deleted alarm ${alarmId}`);
        return true;
    }
    
    scheduleAlarm(alarm) {
        const targetDate = new Date(alarm.datetime);
        const now = new Date();
        
        if (alarm.repeatDays && alarm.repeatDays.length > 0) {
            // Recurring alarm - schedule with cron
            const cronExpression = this.createCronExpression(targetDate, alarm.repeatDays);
            const job = cron.schedule(cronExpression, () => {
                this.triggerAlarm(alarm);
            }, {
                scheduled: true,
                timezone: 'UTC'
            });
            this.cronJobs.set(alarm.id, job);
            console.log(`📅 Scheduled recurring alarm ${alarm.id} with cron: ${cronExpression}`);
        } else {
            // One-time alarm
            if (targetDate > now) {
                const delay = targetDate.getTime() - now.getTime();
                setTimeout(() => {
                    this.triggerAlarm(alarm);
                }, delay);
                console.log(`⏰ Scheduled one-time alarm ${alarm.id} for ${targetDate.toISOString()} (in ${Math.round(delay/1000)}s)`);
            } else {
                console.log(`⚠️ Alarm ${alarm.id} scheduled for past time (${targetDate.toISOString()}), will not trigger`);
            }
        }
    }
    
    createCronExpression(date, repeatDays) {
        const minutes = date.getMinutes();
        const hours = date.getHours();
        
        // Convert day names to cron day numbers (0 = Sunday, 1 = Monday, etc.)
        const dayMap = {
            'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
            'thursday': 4, 'friday': 5, 'saturday': 6
        };
        
        const cronDays = repeatDays
            .map(day => dayMap[day.toLowerCase()])
            .filter(day => day !== undefined)
            .join(',');
        
        return `${minutes} ${hours} * * ${cronDays}`;
    }
    
    getNextTriggerTime(alarm) {
        if (!alarm.isActive) return null;
        
        const now = new Date();
        const targetDate = new Date(alarm.datetime);
        
        if (alarm.repeatDays && alarm.repeatDays.length > 0) {
            // Find next occurrence for recurring alarm
            const dayMap = {
                'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
                'thursday': 4, 'friday': 5, 'saturday': 6
            };
            
            const targetDays = alarm.repeatDays.map(day => dayMap[day.toLowerCase()]);
            let nextTrigger = new Date(now);
            
            // Set to target time
            nextTrigger.setHours(targetDate.getHours(), targetDate.getMinutes(), targetDate.getSeconds(), 0);
            
            // If we've passed today's trigger time, start from tomorrow
            if (nextTrigger <= now) {
                nextTrigger.setDate(nextTrigger.getDate() + 1);
            }
            
            // Find next matching day
            while (!targetDays.includes(nextTrigger.getDay())) {
                nextTrigger.setDate(nextTrigger.getDate() + 1);
            }
            
            return nextTrigger.toISOString();
        } else {
            // One-time alarm
            return targetDate > now ? targetDate.toISOString() : null;
        }
    }
    
    async triggerAlarm(alarm) {
        const triggerTime = new Date().toISOString();
        console.log(`🚨 ALARM TRIGGERED: ${alarm.id} - ${alarm.contactName} at ${triggerTime}`);
        
        // Create payload for webhooks
        const payload = {
            type: 'alarm_triggered',
            alarm: {
                id: alarm.id,
                contactName: alarm.contactName,
                email: alarm.email,
                phone: alarm.phone,
                scheduledTime: alarm.datetime,
                triggeredAt: triggerTime,
                triggeredCount: alarm.triggeredCount + 1
            },
            metadata: {
                source: 'alarm-webhook-api',
                version: '1.0'
            }
        };

        // Define webhooks to send to
        const webhooks = [
            {
                url: 'https://hook.eu2.make.com/6keyrp44odhz8cbxbz7owjjl3t3ag945',
                name: 'Make.com Webhook',
                required: true
            }
        ];

        // Add custom webhook if provided
        if (alarm.webhookUrl && alarm.webhookUrl.trim() !== '') {
            webhooks.push({
                url: alarm.webhookUrl,
                name: 'Custom Webhook',
                required: false
            });
        }

        let successCount = 0;
        let makeWebhookSuccess = false;

        // Send to all webhooks
        for (const webhook of webhooks) {
            try {
                console.log(`📡 Sending to ${webhook.name}: ${webhook.url}`);
                
                const response = await fetch(webhook.url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'AlarmWebhookAPI/1.0'
                    },
                    body: JSON.stringify(payload),
                    timeout: 10000 // 10 second timeout
                });
                
                if (response.ok) {
                    console.log(`✅ ${webhook.name} sent successfully (HTTP ${response.status})`);
                    successCount++;
                    
                    if (webhook.url === 'https://hook.eu2.make.com/6keyrp44odhz8cbxbz7owjjl3t3ag945') {
                        makeWebhookSuccess = true;
                    }
                } else {
                    const responseText = await response.text();
                    console.error(`❌ ${webhook.name} failed: HTTP ${response.status} - ${responseText}`);
                }
            } catch (error) {
                console.error(`❌ Error sending to ${webhook.name}:`, error.message);
            }
        }

        // Update alarm stats if Make.com webhook succeeded
        if (makeWebhookSuccess) {
            alarm.triggeredCount++;
            alarm.lastTriggered = triggerTime;
            console.log(`📊 Updated alarm stats - Total webhooks sent: ${successCount}/${webhooks.length}`);
        }
        
        // Delete alarm if it's not recurring
        if (!alarm.repeatDays || alarm.repeatDays.length === 0) {
            console.log(`🗑️ Auto-deleting one-time alarm ${alarm.id}`);
            await this.deleteAlarm(alarm.id);
        } else {
            // Save updated alarm data for recurring alarms
            await this.saveAlarms();
        }
    }
    
    async testWebhook(webhookUrl) {
        const testPayload = {
            type: 'test_webhook',
            message: 'This is a test from Alarm Webhook API',
            timestamp: new Date().toISOString(),
            source: 'alarm-webhook-api'
        };
        
        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'User-Agent': 'AlarmWebhookAPI/1.0'
                },
                body: JSON.stringify(testPayload),
                timeout: 10000
            });
            
            const responseText = await response.text();
            
            return {
                success: response.ok,
                status: response.status,
                statusText: response.statusText,
                responseBody: responseText,
                message: response.ok ? 'Test webhook sent successfully' : `HTTP ${response.status}: ${response.statusText}`
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    async loadAlarms() {
        try {
            const data = await fs.readFile(this.alarmsFile, 'utf8');
            const alarms = JSON.parse(data);
            
            for (const alarm of alarms) {
                this.alarms.set(alarm.id, alarm);
                // Reschedule alarms that are still active
                if (alarm.isActive) {
                    this.scheduleAlarm(alarm);
                }
            }
            
            console.log(`📂 Loaded ${alarms.length} alarms from storage`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('📂 No existing alarms file found, starting fresh');
                await this.saveAlarms(); // Create empty file
            } else {
                console.error('Error loading alarms:', error);
            }
        }
    }
    
    async saveAlarms() {
        try {
            const alarmsArray = Array.from(this.alarms.values());
            await fs.writeFile(this.alarmsFile, JSON.stringify(alarmsArray, null, 2));
            console.log(`💾 Saved ${alarmsArray.length} alarms to storage`);
        } catch (error) {
            console.error('Error saving alarms:', error);
        }
    }
    
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }
    
    start(port = 3000) {
        this.app.listen(port, '0.0.0.0', () => {
            console.log(`🚀 Alarm Webhook API Server running on port ${port}`);
            console.log(`🌐 Server time: ${new Date().toISOString()}`);
            console.log(`🎯 Make.com webhook: https://hook.eu2.make.com/6keyrp44odhz8cbxbz7owjjl3t3ag945`);
            console.log(`📡 API Endpoints:`);
            console.log(`   GET  /                      - Service info`);
            console.log(`   POST /api/alarms           - Create alarm (simple!)`);
            console.log(`   GET  /api/alarms           - List all alarms`);
            console.log(`   GET  /api/alarms/:id       - Get specific alarm`);
            console.log(`   DELETE /api/alarms/:id     - Delete alarm`);
            console.log(`   POST /api/test-webhook     - Test Make.com webhook`);
            console.log(`   GET  /api/health           - Health check`);
        });
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully');
    process.exit(0);
});

// Start the server
const alarmAPI = new AlarmWebhookAPI();
alarmAPI.start(process.env.PORT || 3000);

module.exports = AlarmWebhookAPI;
