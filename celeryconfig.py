from celery.schedules import crontab

# This file centralizes all Celery configuration, especially for beat schedules.

# Define the timezone for Celery Beat
timezone = 'Asia/Shanghai'

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
        # 北京时间每天凌晨 00:05 执行合同状态自动更新
        'schedule': crontab(hour=0, minute=5),
    },
    'check-daily-reminders-dynamically': {
        'task': 'tasks.check_and_run_daily_reminders_task',
        # 高频轮询数据库中的动态提醒配置；实际是否发送由任务内部按开关、日期、时间和 last_run_date 判断。
        'schedule': crontab(minute='*/1'),
    },
    # =========================================================================
    # ⚠️ 【重要说明】以下静态定时提醒任务已废弃！
    # 提醒的开启状态、提前天数、具体推送时间已全部移交至数据库进行动态管理 (SystemSetting: notification_config)。
    # 新的调度器 check_and_run_daily_reminders_task 会在后台每 10 分钟执行一次高频轮询扫描，
    # 避免了静态 crontab 由于 America/Los_Angeles 时区差导致的“北京时间清晨推送/提前/滞后”的幽灵 bug。
    # =========================================================================
    # 'send-daily-reminders-job': {
    #     'task': 'tasks.send_daily_reminders',
    #     # 北京时间每天上午 09:00
    #     'schedule': crontab(hour=17, minute=0),
    # },
    # 'send-monthly-attendance-reminder-job': {
    #     'task': 'tasks.send_monthly_attendance_reminder',
    #     # 北京时间每月 1 号上午 09:00
    #     'schedule': crontab(day_of_month=1, hour=17, minute=0),
    # },
}


# Other Celery settings
task_serializer = 'json'
accept_content = ['json']
result_serializer = 'json'
enable_utc = True
