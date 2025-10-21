# backend/tests/conftest.py
import sys
from unittest.mock import MagicMock

def pytest_configure(config):
    """
    在 pytest 收集和导入测试模块之前，提前注入 mock 对象。
    这是解决在导入时就出错的最终方法。
    """
    # 创建一个 mock 对象来代表 'genai' 模块
    mock_genai = MagicMock()

    # 创建一个 mock 对象来代表 'google' 包
    mock_google = MagicMock()
    mock_google.genai = mock_genai

    # 将伪造的模块/包放入 sys.modules 中
    # 当解释器执行 from google import genai 时，它会直接使用我们伪造的对象
    sys.modules['google'] = mock_google
    sys.modules['google.genai'] = mock_genai
