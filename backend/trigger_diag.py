# 这一步是为了确保celery_app能够被正确找到
from .tasks import http_diagnose_task


def run_test():
    print("正在提交独立的网络诊断任务到Celery...")
    # 直接调用 .delay()
    http_diagnose_task.delay()
    print("任务已提交。请观察Celery Worker的终端输出。")


if __name__ == "__main__":
    run_test()
