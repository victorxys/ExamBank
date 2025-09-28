from sqlalchemy import event, inspect
from backend.models import CustomerBill
from backend.tasks import process_statement_for_bill
from flask import current_app

def customer_bill_after_update_listener(mapper, connection, target):
    """
    监听 CustomerBill 更新事件。
    (V2 - 增加健壮性检查)
    """
    # target 是被更新的 CustomerBill 实例
    if not target.statement_id:
        return

    inst = inspect(target)
    # 我们关心的、可能触发结算单更新的字段
    attrs_to_check = ['total_due', 'paid_amount', 'statement_id']

    for attr_name in attrs_to_check:
        # 从实例状态中获取特定属性的状态对象
        attr_state = inst.attrs.get(attr_name)

        # 核心修复：在访问 .history 之前，必须检查 attr_state 是否存在
        if attr_state and attr_state.history.has_changes():
            current_app.logger.info(f"[EventListener] Bill {target.id} 的 '{attr_name}' 字段发生变化。准备触发结算单更新。")
            # 添加一个小的延迟（例如5秒），以确保主事务有足够的时间提交到数据库
            # 避免Celery worker在事务提交前就执行任务，导致读取到旧数据
            process_statement_for_bill.apply_async(args=[target.id], countdown=5)
            # 只要有一个关键字段变化，就触发任务并返回，避免对同一个对象的同一次操作重复触发任务
            return

# 将监听器函数“挂载”到 CustomerBill 模型的 after_update 事件上
event.listen(CustomerBill, 'after_update', customer_bill_after_update_listener)