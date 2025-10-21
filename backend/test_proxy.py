import os
import sys

# --- 设置项目根目录 ---
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from backend.app import app
# --- 导入 PROXY_POOL 来动态计算总配额 ---
from backend.manager_module import get_next_identity, reset_all_usage, PROXY_POOL

def test_dynamic_quota_exhaustion():
    """
    测试动态的配额耗尽逻辑，能自动适应配置中提供商的数量。
    """
    with app.app_context():
        print("--- 开始最终版TTS配额耗尽逻辑测试 ---")

        if not PROXY_POOL:
            print("❌ 代理池为空，无法执行测试。")
            return

        # --- 动态计算总配额和测试次数 ---
        provider_count = len(PROXY_POOL)
        total_quota = provider_count * 50
        test_runs = total_quota + 1 # 我们要运行到超出配额的那一次
        print(f"检测到 {provider_count} 个提供商，总配额为 {total_quota} 次。将运行 {test_runs} 次来验证。")

        # 1. 重置状态
        print("\\n--- 步骤1: 重置所有使用记录 ---")
        reset_all_usage()
        print("--- 重置完成 ---\\n")

        # 2. 动态执行N+1次调用
        print(f"--- 步骤2: 连续调用 {test_runs} 次 get_next_identity ---")
        for i in range(1, test_runs + 1): # 循环次数修正
            print(f"调用第 {i} 次: ", end="")
            try:
                identity = get_next_identity()
            except Exception as e:
                print(f"✅ 成功在第 {i} 次调用时捕获到预期的异常: {e}")
                print("\\n--- ✅ 测试成功！配额耗尽机制按预期工作。 ---")
                break
        else:
             # 如果循环正常结束而没有break，说明没有触发异常，这是个问题
             print(f"\\n--- ❌ 测试失败！循环了 {test_runs} 次但并未触发配额耗尽异常。---")

        print("\\n--- 测试结束 ---")


if __name__ == "__main__":
    test_dynamic_quota_exhaustion()