# populate_pinyin.py
# 确保能正确导入 pypinyin
from pypinyin import pinyin, Style

# 导入创建Flask app的函数和db实例
from backend.app import app
from backend.models import User, db, BaseContract


def populate_user_pinyin():
    with app.app_context():
        # --- 调试代码开始 ---
        debug_user_id = 'f723b9b7-2187-42ca-8707-c61224abbb1f'
        debug_user = User.query.get(debug_user_id)
        if debug_user:
            print(f"【调试】找到了用户 (ID: {debug_user.id})，姓名: {debug_user.username}。")
            print(f"【调试】该用户的 name_pinyin 字段值为: {debug_user.name_pinyin}")
        else:
            print(f"【调试】在当前连接的数据库中，未找到 ID 为 {debug_user_id} 的用户。")
        # --- 调试代码结束 ---

        print("开始为 User 表填充拼音字段...")
        users_to_update = User.query.filter(User.name_pinyin.is_(None)).all()
        if not users_to_update:
            print("所有用户的拼音字段都已填充，无需操作。")
            return

        print(f"找到 {len(users_to_update)} 个需要更新的用户。")
        count = 0
        for user in users_to_update:
            if user.username:
                try:
                    # 生成全拼 (e.g., 'zhangsan') 和首字母 (e.g., 'zs')
                    full_pinyin_list = pinyin(user.username, style=Style.NORMAL)
                    full_pinyin = "".join(item[0] for item in full_pinyin_list)

                    first_letters_list = pinyin(user.username, style=Style.FIRST_LETTER)
                    first_letters = "".join(item[0] for item in first_letters_list)

                    user.name_pinyin = f"{full_pinyin} {first_letters}"
                    count += 1
                except Exception as e:
                    print(f"处理用户 '{user.username}' (ID: {user.id}) 时出错: {e}")

        if count > 0:
            try:
                db.session.commit()
                print(f"成功为 {count} 个用户填充了拼音字段！")
            except Exception as e:
                db.session.rollback()
                print(f"提交数据库时出错: {e}")
        else:
            print("没有用户被更新。")

def populate_contract_customer_pinyin():
    with app.app_context():
        print("开始为 Contract 表填充客户姓名拼音字段...")
        contracts_to_update = BaseContract.query.filter(BaseContract.customer_name_pinyin.is_(None)).all()
        if not contracts_to_update:
            print("所有合同的客户姓名拼音字段都已填充，无需操作。")
            return

        print(f"找到 {len(contracts_to_update)} 个需要更新的合同。")
        count = 0
        for contract in contracts_to_update:
            if contract.customer_name:
                try:
                    # 生成全拼 (e.g., 'zhangsan') 和首字母 (e.g., 'zs')
                    full_pinyin_list = pinyin(contract.customer_name, style=Style.NORMAL)
                    full_pinyin = "".join(item[0] for item in full_pinyin_list)

                    first_letters_list = pinyin(contract.customer_name, style=Style.FIRST_LETTER)
                    first_letters = "".join(item[0] for item in first_letters_list)

                    contract.customer_name_pinyin = f"{full_pinyin} {first_letters}"
                    count += 1
                except Exception as e:
                    print(f"处理合同 '{contract.id}' 的客户 '{contract.customer_name}' 时出错: {e}")

        if count > 0:
            try:
                db.session.commit()
                print(f"成功为 {count} 个合同填充了客户姓名拼音字段！")
            except Exception as e:
                db.session.rollback()
                print(f"提交数据库时出错: {e}")
        else:
            print("没有合同被更新。")

if __name__ == "__main__":
    populate_user_pinyin()
    populate_contract_customer_pinyin()