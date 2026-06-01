from celery.schedules import crontab

# This file centralizes all Celery configuration, especially for beat schedules.

# Define the timezone for Celery Beat
timezone = 'America/Los_Angeles'

# Define all periodic tasks
beat_schedule = {
    'reset-tts-usage-at-pt-midnight': {
        'task': 'tasks.reset_daily_tts_usage',
        'schedule': crontab(hour=0, minute=1),
    },
    # 'sync-contracts-hourly': {
    #     'task': 'tasks.sync_all_contracts',
    #     'schedule': crontab(minute=1),
    # },
    'auto-extend-renewal-bills-weekly': {
        'task': 'tasks.auto_check_and_extend_renewal_bills',
        'schedule': crontab(hour=2, minute=0, day_of_week='monday'),
    },
    'update-contract-statuses-daily': {
        'task': 'tasks.update_contract_statuses',
        # Schedule for 00:05 AM Beijing Time.
        # Beijing (UTC+8) vs Los Angeles (PST, UTC-8 in winter) is a 16-hour difference.
        # 10:30 CST is 18:30 PST on the previous day.
        'schedule': crontab(hour=10, minute=5), # 北京时间每天上午 00:05
    },
    'send-daily-reminders-job': {
        'task': 'tasks.send_daily_reminders',
        # 北京时间每天上午 09:00
        'schedule': crontab(hour=17, minute=0),
    },
    'send-monthly-attendance-reminder-job': {
        'task': 'tasks.send_monthly_attendance_reminder',
        # 北京时间每月 1 号上午 09:00
        'schedule': crontab(day_of_month=1, hour=17, minute=0),
    },
}

# Other Celery settings
task_serializer = 'json'
accept_content = ['json']
result_serializer = 'json'
enable_utc = True
