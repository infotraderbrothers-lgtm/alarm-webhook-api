# Alarm Webhook API

A 24/7 backend service that schedules alarms and triggers webhooks when they fire.

## Features
- ✅ Create one-time and recurring alarms via HTTP API
- ✅ Automatic webhook notifications when alarms trigger
- ✅ Persistent JSON storage
- ✅ 24/7 uptime on Render
- ✅ Auto-deletion of one-time alarms after firing

## API Endpoints

### Create Alarm
```bash
POST /api/alarms
Content-Type: application/json

{
  "contactName": "John Doe",
  "email": "john@example.com",
  "phone": "+1234567890", 
  "datetime": "2025-08-27T15:30:00.000Z",
  "webhookUrl": "https://webhook.site/your-id",
  "repeatDays": ["monday", "friday"]
}
