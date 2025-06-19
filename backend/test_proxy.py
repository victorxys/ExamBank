import httpx
import os

# --- 诊断信息，帮助我们确认环境 ---
try:
    print("--- 诊断信息 ---")
    print(f"httpx 模块版本: {httpx.__version__}")
    print(f"httpx 模块路径: {httpx.__file__}")
    print("------------------\n")
except Exception as e:
    print(f"无法获取 httpx 信息: {e}")

# --- 您的代理池配置 ---
PROXY_POOL = [
    {
        "id": "Server-A",
        "proxy_url": "http://victor:xys131313@webservice-google-tw1.58789018.xyz:8888",
    },
    {
        "id": "Server-B",
        "proxy_url": "http://victor:xys131313@webservice-google-tw2.58789018.xyz:8888",
    },
    {
        "id": "Server-C",
        "proxy_url": "http://victor:xys131313@webservice-google-tw0.58789018.xyz:8888",
    }
]

def test_single_proxy(server_info):
    """使用 mounts 和 HTTPTransport 测试单个代理"""
    proxy_id = server_info['id']
    proxy_url = server_info['proxy_url']
    
    print(f"\n--- 正在测试: {proxy_id} ---")
    print(f"代理地址: {proxy_url}")

    test_url = "https://api.ipify.org?format=json"

    # ++++++++++++++++ 使用您找到的、正确的官方文档语法 ++++++++++++++++
    try:
        # 1. 创建一个 transport 实例，并明确地将代理传递给它
        transport = httpx.HTTPTransport(proxy=proxy_url)

        # 2. 创建一个 mounts 字典，将所有 https 流量都挂载到这个 transport 上
        proxy_mounts = {
            "all://": transport, # "all://" 是一个通配符，会匹配 http 和 https
        }

        # 3. 使用 mounts 参数来初始化客户端
        with httpx.Client(mounts=proxy_mounts, timeout=15.0) as client:
            print("正在发送请求...")
            response = client.get(test_url)
            
            if response.status_code == 200:
                print(f"✅ 连接成功！响应: {response.json()}")
            else:
                print(f"❌ 连接失败！状态码: {response.status_code}, 内容: {response.text}")
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