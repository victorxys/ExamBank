import json
import os
from dotenv import load_dotenv

# +++ 新增导入 +++
from .extensions import db
from .models import TtsProviderState
# +++ 结束新增 +++

dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)


# --- 动态构建 PROXY_POOL ---
def load_proxy_pool_from_env():
    """从环境变量中加载并解析代理池配置"""
    pool_json_string = os.environ.get("TTS_PROXY_POOL_JSON")
    if not pool_json_string:
        print("⚠️ 警告: 未在环境变量中找到 TTS_PROXY_POOL_JSON 配置。代理池将为空。")
        return []

    try:
        pool = json.loads(pool_json_string)
        print("✅ 已成功从环境变量加载并解析代理池配置。")
        return pool
    except json.JSONDecodeError:
        print(
            "❌ 错误: 无法解析环境变量 TTS_PROXY_POOL_JSON 中的JSON字符串。请检查格式。"
        )
        return []


# 在模块加载时，直接构建 PROXY_POOL
PROXY_POOL = load_proxy_pool_from_env()

def get_next_identity():
    """
    一个有状态的函数，通过数据库行锁来实现安全的轮询和计数。
    最终规则：顺序使用池中每一个身份50次，全部用完后则停止分发，直到被重置。
    """
    if not PROXY_POOL:
        raise ValueError("代理池为空，无法获取下一个身份。请检查 TTS_PROXY_POOL_JSON 环境变量。")

    MAX_USAGE_PER_PROVIDER = 50

    try:
        # 同样使用行锁来保证并发安全
        state = db.session.query(TtsProviderState).filter_by(group_id='default_tts_pool').with_for_update().first()

        # 如果状态行不存在，则在首次运行时创建它
        if not state:
            print("首次运行，正在初始化TTS提供商状态...")
            state = TtsProviderState(
                group_id='default_tts_pool',
                current_provider_index=0,
                usage_count=0
            )
            db.session.add(state)

        # --- 最终版核心逻辑：检查配额是否已完全用尽 ---
        # 规则：如果当前是池中的最后一个provider，并且它的使用次数也满了
        is_last_provider = state.current_provider_index >= len(PROXY_POOL) - 1
        is_usage_finished = state.usage_count >= MAX_USAGE_PER_PROVIDER

        # print(f"当前提供商索引: {state.current_provider_index}, 使用次数: {state.usage_count}/{MAX_USAGE_PER_PROVIDER}, 池大小: {len(PROXY_POOL)}.is_last_provider:{is_last_provider}.is_usage_finished:{is_usage_finished}")

        if is_last_provider and is_usage_finished:
            db.session.commit() # 提交事务以释放锁
            print(f"--- [数据库代理轮询] 配额已用尽！池中所有 ({len(PROXY_POOL)}) 个提供商均已使用完毕。等待重置。 ---")
            raise Exception("TTS provider daily quota exceeded. Please wait for the next reset.")
        # --- 检查结束 ---

        # 判断是否需要切换到下一个 provider
        if state.usage_count >= MAX_USAGE_PER_PROVIDER:
            print(f"提供商索引 {state.current_provider_index} 已达到 {state.usage_count} 次使用，切换到下一个。")
            state.current_provider_index += 1
            state.usage_count = 1  # 切换后，新的这次使用是第 1 次
        else:
            state.usage_count += 1 # 否则，只是简单地增加计数

        # 获取最终选择的身份
        chosen_identity = PROXY_POOL[state.current_provider_index]
        server_id = chosen_identity.get("id", "N/A")

        print(
            f"--- [数据库代理轮询] 选择使用: {server_id} (Provider Index: {state.current_provider_index}, Usage: {state.usage_count}/{MAX_USAGE_PER_PROVIDER}) ---"
        )

        db.session.commit()
        return chosen_identity

    except Exception as e:
        db.session.rollback()
        if "quota exceeded" in str(e):
            raise e
        print(f"❌ 获取下一个TTS身份时发生数据库错误: {e}")
        raise

def reset_all_usage():
    """
    (可选) 重置TTS提供商的状态，使其从第一个提供商重新开始计数。
    """
    try:
        state = db.session.query(TtsProviderState).filter_by(group_id='default_tts_pool').with_for_update().first()

        if not state:
            print("状态尚未初始化，创建一个新的。")
            state = TtsProviderState()
            db.session.add(state)

        print("重置TTS提供商状态...")
        state.current_provider_index = 0
        state.usage_count = 0

        db.session.commit()
        print("TTS提供商状态已成功重置。")

    except Exception as e:
        db.session.rollback()
        print(f"❌ 重置TTS状态时发生数据库错误: {e}")
        raise




