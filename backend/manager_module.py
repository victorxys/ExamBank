import json
from threading import Lock
import os
from dotenv import load_dotenv

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

# --- 模块级的全局变量 (保持不变) ---
USAGE_FILE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "instance", "usage_data.json")
)
FILE_LOCK = Lock()
print("✅ 已加载代理池，包含以下服务器:")
for server in PROXY_POOL:
    print(
        f" - {server['id']} (API Key: {server['api_key']}, Proxy URL: {server['proxy_url']})"
    )


USAGE_FILE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "instance", "usage_data.json")
)
FILE_LOCK = Lock()  # 用于保证文件读写操作的线程安全


def get_next_identity():
    """
    一个无状态的函数，通过读写文件来实现轮询和计数。
    每次调用都返回下一个要使用的 "身份" (包含api_key和proxy_url的字典)。
    """
    with FILE_LOCK:
        # 1. 读取当前状态
        usage_data = {}
        try:
            # 确保instance目录存在
            os.makedirs(os.path.dirname(USAGE_FILE_PATH), exist_ok=True)
            with open(USAGE_FILE_PATH, "r") as f:
                usage_data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            # 如果文件不存在或为空，则初始化状态
            pass

        # 2. 决定下一个要使用的索引
        last_used_index = usage_data.get("_last_used_index", -1)
        next_index = (last_used_index + 1) % len(PROXY_POOL)

        # 3. 获取选择的身份
        chosen_identity = PROXY_POOL[next_index]
        server_id = chosen_identity["id"]

        # 4. 更新使用数据
        current_usage = usage_data.get(server_id, 0)
        usage_data[server_id] = current_usage + 1
        usage_data["_last_used_index"] = next_index

        # 5. 将更新后的状态写回文件
        with open(USAGE_FILE_PATH, "w") as f:
            json.dump(usage_data, f, indent=4)

        print(
            f"--- [代理轮询] 选择使用: {server_id} (今日已用: {usage_data[server_id]} 次) ---"
        )

        return chosen_identity


def reset_all_usage():
    """
    一个无状态的函数，用于重置所有使用记录。
    这个函数由您的crontab任务调用。
    """
    with FILE_LOCK:
        print("开始执行每日TTS使用量重置任务...")
        # 创建一个全新的、所有计数都为0的字典
        fresh_usage_data = {item["id"]: 0 for item in PROXY_POOL}
        # 将上次使用的索引也重置
        fresh_usage_data["_last_used_index"] = -1

        # 写入文件，覆盖旧的记录
        with open(USAGE_FILE_PATH, "w") as f:
            json.dump(fresh_usage_data, f, indent=4)

        print("TTS使用量已成功重置。")
