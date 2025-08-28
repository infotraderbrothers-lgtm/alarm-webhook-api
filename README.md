# Alarm Webhook API with Make.com Integration

A simplified 24/7 backend service that schedules alarms and automatically sends all triggers to Make.com for automation.

## 🎯 Key Features
- ✅ **Super Simple API** - Only requires `contactName` and `datetime`
- ✅ **Make.com Integration** - All alarms automatically sent to your webhook
- ✅ **Optional Custom Webhooks** - Add additional webhook URLs if needed
- ✅ **24/7 Uptime** - Runs continuously on Render
- ✅ **Auto-deletion** - One-time alarms delete themselves after firing
- ✅ **Recurring Alarms** - Set weekly schedules

## 🚀 Quick Start

### Simple Alarm (Make.com only):
```bash
curl -X POST https://your-app.onrender.com/api/alarms \
  -H "Content-Type: application/json" \
  -d '{
    "contactName": "John Doe",
    "datetime": "2025-08-27T15:30:00.000Z"
  }'
