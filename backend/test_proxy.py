import httpx
import os
import json
from dotenv import load_dotenv

# --- 诊断信息，帮助我们确认环境 ---
try:
    print("--- 诊断信息 ---")
    print(f"httpx 模块版本: {httpx.__version__}")
    print(f"httpx 模块路径: {httpx.__file__}")
    print("------------------\n")
except Exception as e:
    print(f"无法获取 httpx 信息: {e}")

# from dotenv import load_dotenv

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


def test_single_proxy(server_info):
    """使用 mounts 和 HTTPTransport 测试单个代理"""
    proxy_id = server_info["id"]
    proxy_url = server_info["proxy_url"]

    print(f"\n--- 正在测试: {proxy_id} ---")
    print(f"代理地址: {proxy_url}")

    test_url = "https://api.ipify.org?format=json"

    # ++++++++++++++++ 使用您找到的、正确的官方文档语法 ++++++++++++++++
    try:
        # 1. 创建一个 transport 实例，并明确地将代理传递给它
        transport = httpx.HTTPTransport(proxy=proxy_url)

        # 2. 创建一个 mounts 字典，将所有 https 流量都挂载到这个 transport 上
        proxy_mounts = {
            "all://": transport,  # "all://" 是一个通配符，会匹配 http 和 https
        }

        # 3. 使用 mounts 参数来初始化客户端
        with httpx.Client(mounts=proxy_mounts, timeout=15.0) as client:
            print("正在发送请求...")
            response = client.get(test_url)

            if response.status_code == 200:
                print(f"✅ 连接成功！响应: {response.json()}")
            else:
                print(
                    f"❌ 连接失败！状态码: {response.status_code}, 内容: {response.text}"
                )
    # +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++

    except httpx.TimeoutException:
        print("❌ 连接失败！错误: 请求超时 (Timeout)。")
    except httpx.ProxyError as e:
        print(f"❌ 连接失败！错误: 代理错误 (Proxy Error)。详细信息: {e}")
    except httpx.ConnectError as e:
        print(f"❌ 连接失败！错误: 连接错误 (Connect Error)。详细信息: {e}")
    except Exception as e:
        print(f"❌ 连接失败！未知错误: {e}")


if __name__ == "__main__":
    for server in PROXY_POOL:
        test_single_proxy(server)
