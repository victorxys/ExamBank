import httpx
from celery import Celery

# 1. 直接在这里定义一个最小化的Celery App
# celery_app = Celery('test_tasks', broker='redis://localhost:6379/0', backend='redis://localhost:6379/0')
celery_app = Celery('test_app', broker='redis://localhost:6379/0', backend='redis://localhost:6379/0')


# 2. 定义一个只做网络请求的、最小化的测试任务
@celery_app.task
def minimal_network_test_task(proxy_url):
    print(f"\n[Celery Task] 开始执行网络测试，代理: {proxy_url}")
    
    test_url = "https://api.ipify.org?format=json"
    
    try:
        print("[Celery Task] 正在创建 HTTPTransport...")
        transport = httpx.HTTPTransport(proxy=proxy_url)
        
        print("[Celery Task] 正在创建 mounts 字典...")
        proxy_mounts = {"all://": transport}
        
        print("[Celery Task] 正在创建 httpx.Client...")
        with httpx.Client(mounts=proxy_mounts, timeout=15.0) as client:
            print("[Celery Task] 客户端已创建，正在发送 GET 请求...")
            response = client.get(test_url)
            print("[Celery Task] 已收到响应！")
            
            if response.status_code == 200:
                result = f"✅ 连接成功！响应: {response.json()}"
                print(result)
                return result
            else:
                result = f"❌ 连接失败！状态码: {response.status_code}"
                print(result)
                return result
    except Exception as e:
        error_result = f"❌ 任务执行中发生致命错误: {type(e).__name__}: {e}"
        print(error_result)
        return error_result

# 3. 如果直接运行这个文件，就触发测试任务
if __name__ == '__main__':
    # 你的代理URL
    test_proxy = "http://victor:xys131313@webservice-google-tw1.58789018.xyz:8888"
    print(f"正在向Celery提交一个网络测试任务，代理为: {test_proxy}")
    minimal_network_test_task.delay(test_proxy)